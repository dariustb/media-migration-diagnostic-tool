import threading
import uuid

from app.models import ScanJob, ScanParams
from app.scanner import run_scan

_store: dict[str, ScanJob] = {}


def create_job(params: ScanParams) -> ScanJob:
    job = ScanJob(job_id=str(uuid.uuid4()))
    _store[job.job_id] = job
    threading.Thread(target=run_scan, args=(job, params), daemon=True).start()
    return job


def get_job(job_id: str) -> ScanJob | None:
    return _store.get(job_id)
