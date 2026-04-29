from flask import Blueprint, jsonify, request

from app.jobs import create_job, get_job
from app.models import ScanParams

bp = Blueprint("main", __name__)


@bp.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@bp.route("/api/scan", methods=["POST"])
def start_scan():
    data = request.get_json(force=True) or {}
    required = ["local_root", "remote_host", "remote_user", "remote_password", "remote_root"]
    missing = [k for k in required if not data.get(k)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    params = ScanParams(
        local_root=data["local_root"],
        remote_host=data["remote_host"],
        remote_port=int(data.get("remote_port", 22)),
        remote_user=data["remote_user"],
        remote_password=data["remote_password"],
        remote_root=data["remote_root"],
    )
    job = create_job(params)
    return jsonify({"job_id": job.job_id}), 202


@bp.route("/api/scan/<job_id>")
def scan_status(job_id: str):
    job = get_job(job_id)
    if job is None:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(
        {
            "job_id": job.job_id,
            "status": job.status,
            "stage": job.stage,
            "stage_name": job.stage_name,
            "stage_progress": job.stage_progress,
            "error": job.error,
            "results": job.results,
        }
    )
