import hashlib
import os
from pathlib import Path

import paramiko

from app.models import ScanJob, ScanParams


def _quote(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"


def _enumerate_local(root: str) -> tuple[dict[str, str], dict[str, list[str]]]:
    seen: dict[str, list[str]] = {}
    for p in Path(root).rglob("*"):
        if p.is_file():
            name = p.name
            seen.setdefault(name, []).append(str(p))
    unique = {n: paths[0] for n, paths in seen.items() if len(paths) == 1}
    duplicates = {n: paths for n, paths in seen.items() if len(paths) > 1}
    return unique, duplicates


def _enumerate_remote(
    ssh: paramiko.SSHClient, root: str
) -> tuple[dict[str, str], dict[str, list[str]]]:
    _, stdout, stderr = ssh.exec_command(f"find {_quote(root)} -type f")
    output = stdout.read().decode(errors="replace").strip()
    err = stderr.read().decode(errors="replace").strip()
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError(f"Remote enumeration failed: {err or output}")

    seen: dict[str, list[str]] = {}
    for line in output.splitlines():
        path = line.strip()
        if path:
            name = os.path.basename(path)
            seen.setdefault(name, []).append(path)
    unique = {n: paths[0] for n, paths in seen.items() if len(paths) == 1}
    duplicates = {n: paths for n, paths in seen.items() if len(paths) > 1}
    return unique, duplicates


def _local_checksum(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse_sha256sum(output: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        # sha256sum outputs "<hash>  <path>" (two spaces, text mode)
        # or "<hash> *<path>" (space+asterisk, binary mode)
        if "  " in line:
            hash_val, path = line.split("  ", 1)
        elif " *" in line:
            hash_val, path = line.split(" *", 1)
        else:
            continue
        result[path] = hash_val
    return result


def _remote_batch_checksums(
    ssh: paramiko.SSHClient, paths: list[str]
) -> dict[str, str]:
    stdin, stdout, stderr = ssh.exec_command("xargs -0 sha256sum")
    stdin.write(("\0".join(paths) + "\0").encode())
    stdin.flush()
    stdin.channel.shutdown_write()
    output = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace").strip()
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError(f"Remote checksum failed: {err}")
    return _parse_sha256sum(output)


def _create_ssh(params: ScanParams) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=params.remote_host,
        port=params.remote_port,
        username=params.remote_user,
        password=params.remote_password,
        timeout=10,
    )
    return client


def _grade(match_rate: float, integrity_rate: float) -> str:
    if match_rate == 100 and integrity_rate == 100:
        return "A"
    if match_rate >= 95 and integrity_rate == 100:
        return "B"
    if match_rate == 100 and integrity_rate >= 95:
        return "B"
    if match_rate >= 90 and integrity_rate >= 90:
        return "C"
    if match_rate >= 75 and integrity_rate >= 75:
        return "D"
    return "F"


def run_scan(job: ScanJob, params: ScanParams) -> None:
    ssh: paramiko.SSHClient | None = None
    try:
        job.status = "running"

        # ── Stage 1: local enumeration ────────────────────────────────────
        job.update_stage(1, "Enumerating local files")
        local_unique, local_dups = _enumerate_local(params.local_root)
        job.results.update(
            {
                "local_count": len(local_unique) + sum(len(v) for v in local_dups.values()),
                "local_unique_count": len(local_unique),
                "local_duplicates": local_dups,
            }
        )

        # ── Stage 2: remote enumeration ───────────────────────────────────
        job.update_stage(2, "Enumerating remote files")
        ssh = _create_ssh(params)
        remote_unique, remote_dups = _enumerate_remote(ssh, params.remote_root)
        job.results.update(
            {
                "remote_count": len(remote_unique) + sum(len(v) for v in remote_dups.values()),
                "remote_unique_count": len(remote_unique),
                "remote_duplicates": remote_dups,
            }
        )

        # ── Stage 3: filename matching ────────────────────────────────────
        job.update_stage(3, "Comparing file names")
        local_names = set(local_unique)
        remote_names = set(remote_unique)
        matched_names = local_names & remote_names
        matched = {
            name: {"local_path": local_unique[name], "remote_path": remote_unique[name]}
            for name in matched_names
        }
        def rel_dir(root: str, full_path: str) -> str:
            d = os.path.relpath(os.path.dirname(full_path), root)
            return "" if d == "." else d

        job.results.update(
            {
                "matched": matched,
                "source_only": sorted(
                    ({"name": n, "rel_dir": rel_dir(params.local_root, local_unique[n])}
                     for n in local_names - remote_names),
                    key=lambda x: (x["rel_dir"], x["name"]),
                ),
                "dest_only": sorted(
                    ({"name": n, "rel_dir": rel_dir(params.remote_root, remote_unique[n])}
                     for n in remote_names - local_names),
                    key=lambda x: (x["rel_dir"], x["name"]),
                ),
            }
        )

        # ── Stage 4: checksums (matched files only) ───────────────────────
        job.update_stage(4, "Computing checksums")
        matched_items = list(matched.items())
        total = len(matched_items)
        job.stage_progress = {"done": 0, "total": total}

        local_hashes: dict[str, str] = {}
        for i, (name, paths) in enumerate(matched_items):
            local_hashes[name] = _local_checksum(paths["local_path"])
            job.stage_progress["done"] = i + 1

        remote_hashes: dict[str, str] = {}
        if matched_items:
            remote_paths = [paths["remote_path"] for _, paths in matched_items]
            path_to_hash = _remote_batch_checksums(ssh, remote_paths)
            remote_hashes = {
                name: path_to_hash.get(paths["remote_path"], "")
                for name, paths in matched_items
            }

        ssh.close()
        ssh = None

        checksum_ok = []
        checksum_bad = []
        for name, paths in matched_items:
            local_h = local_hashes[name]
            remote_h = remote_hashes.get(name, "")
            entry = {
                "filename": name,
                "local_path": paths["local_path"],
                "remote_path": paths["remote_path"],
                "local_checksum": local_h,
                "remote_checksum": remote_h,
                "rel_dir": rel_dir(params.local_root, paths["local_path"]),
            }
            (checksum_ok if local_h == remote_h else checksum_bad).append(entry)

        job.results["checksum_ok"] = checksum_ok
        job.results["checksum_bad"] = checksum_bad

        # ── Stage 5: summary ──────────────────────────────────────────────
        job.update_stage(5, "Summarizing results")
        source_unique_count = len(local_unique)
        matched_count = len(matched_items)
        ok_count = len(checksum_ok)
        bad_count = len(checksum_bad)
        source_only_count = len(job.results["source_only"])
        dest_only_count = len(job.results["dest_only"])

        match_rate = (matched_count / source_unique_count * 100) if source_unique_count else 0.0
        integrity_rate = (ok_count / matched_count * 100) if matched_count else 0.0

        job.results["summary"] = {
            "total_source_files": job.results["local_count"],
            "total_dest_files": job.results["remote_count"],
            "source_unique": source_unique_count,
            "dest_unique": len(remote_unique),
            "local_duplicate_names": len(local_dups),
            "remote_duplicate_names": len(remote_dups),
            "matched_count": matched_count,
            "source_only_count": source_only_count,
            "dest_only_count": dest_only_count,
            "checksum_ok_count": ok_count,
            "checksum_bad_count": bad_count,
            "match_rate": round(match_rate, 1),
            "integrity_rate": round(integrity_rate, 1),
            "grade": _grade(match_rate, integrity_rate),
        }

        job.status = "complete"

    except Exception as e:
        job.status = "error"
        job.error = str(e)
    finally:
        if ssh is not None:
            try:
                ssh.close()
            except Exception:
                pass
