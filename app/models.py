from dataclasses import dataclass, field
from typing import Any


@dataclass
class ScanParams:
    local_root: str
    remote_host: str
    remote_port: int
    remote_user: str
    remote_password: str
    remote_root: str


@dataclass
class ScanJob:
    job_id: str
    status: str = "pending"  # pending | running | complete | error
    stage: int = 0
    stage_name: str = ""
    stage_progress: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    results: dict[str, Any] = field(default_factory=dict)

    def update_stage(self, stage: int, name: str) -> None:
        self.stage = stage
        self.stage_name = name
        self.stage_progress = {}
