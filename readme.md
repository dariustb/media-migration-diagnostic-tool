# Media Diagnostic

A tool for verifying that files migrated correctly from a local library to a remote server. It compares both sides by filename and SHA-256 checksum, then produces a health grade and a breakdown of what matched, what changed, and what's missing.

## What it does

1. **Enumerates** all files under the local root path
2. **Enumerates** all files under the remote root path over SSH
3. **Matches** files by filename (unique names only — duplicates on either side are flagged and skipped)
4. **Checksums** every matched file pair using SHA-256 to detect corruption or changes
5. **Reports** a grade (A–F), match rate, integrity rate, and per-file results

### Grading

| Grade | Criteria |
|-------|----------|
| A | 100% matched, 100% checksums OK |
| B | ≥95% matched and 100% integrity, or 100% matched and ≥95% integrity |
| C | ≥90% matched and ≥90% integrity |
| D | ≥75% matched and ≥75% integrity |
| F | Below D thresholds |

## Requirements

- Python 3.11+
- Node.js 18+
- SSH access (password auth) to the remote host
- `sha256sum` and `find` available on the remote host (standard on Linux)

## Setup

### Backend

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Frontend

```bash
npm install
```

## Running

Start both servers — they need to run at the same time.

**Backend** (terminal 1):
```bash
source venv/bin/activate
python app.py
# Runs on http://localhost:5000
```

**Frontend** (terminal 2):
```bash
npm run dev
# Runs on http://localhost:5173 (or next available port)
```

Open the URL printed by the frontend server. The dev server proxies all `/api` requests to the Flask backend on port 5000, so both must be running.

## Using the app

Fill in the form and click **Start scan**:

| Field | Description |
|-------|-------------|
| Local root path | Absolute path to the source library on this machine |
| Host | IP address or hostname of the remote server |
| Port | SSH port (default: 22) |
| Username | SSH username |
| Password | SSH password |
| Remote root path | Absolute path to the destination library on the remote server |

Results appear automatically when the scan completes. Large libraries will take longer at the checksum stage.

## Results explained

- **Matched files** — files found by name on both sides. Green check = checksums identical. Yellow triangle = file exists on both sides but content differs.
- **Source only — not found in destination** — files present in the local library with no match on the remote.
- **Destination only — not found in source** — files on the remote with no match in the local library (expected if the destination had pre-existing content).
- Filenames that appear more than once on either side are excluded from matching and noted in a warning.

## API

The frontend communicates with two endpoints if you want to drive scans programmatically:

**POST `/api/scan`** — start a scan

```json
{
  "local_root": "/path/to/local",
  "remote_host": "192.168.1.10",
  "remote_port": 22,
  "remote_user": "pi",
  "remote_password": "secret",
  "remote_root": "/path/to/remote"
}
```

Returns `{ "job_id": "<uuid>" }` with HTTP 202.

**GET `/api/scan/<job_id>`** — poll for status

```json
{
  "job_id": "...",
  "status": "running",
  "stage": 3,
  "stage_name": "Comparing file names",
  "stage_progress": { "done": 0, "total": 0 },
  "error": null,
  "results": {}
}
```

`status` is one of `pending`, `running`, `complete`, or `error`. Poll until `complete` or `error`. Results are populated incrementally and fully available when `complete`.
