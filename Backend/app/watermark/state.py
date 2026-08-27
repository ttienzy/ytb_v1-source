"""In-memory batch job store cho watermark remover.

Mỗi batch job theo dõi trạng thái xử lý từng video.
State mất khi restart (chấp nhận cho phase hiện tại — giống recap/state.py).
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class VideoState:
    """Trạng thái xử lý 1 file video."""
    name: str                          # tên file (basename)
    size_bytes: int
    status: str = "pending"           # pending | running | done | error
    input_path: str = ""              # đường dẫn gốc trên disk
    output_path: str | None = None    # đường dẫn file output
    output_name: str | None = None    # tên file output (basename)
    error: str | None = None
    processed_frames: int | None = None
    frame_estimate: int | None = None


@dataclass
class BatchJobState:
    """Trạng thái 1 batch watermark job."""
    job_id: str
    status: str = "idle"              # idle | running | done | error
    videos: list[VideoState] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def total(self) -> int:
        return len(self.videos)

    @property
    def done(self) -> int:
        return sum(1 for v in self.videos if v.status == "done")

    @property
    def failed(self) -> int:
        return sum(1 for v in self.videos if v.status == "error")


_JOBS: dict[str, BatchJobState] = {}


def create_job(videos: list[VideoState]) -> BatchJobState:
    job = BatchJobState(
        job_id=secrets.token_hex(6),
        status="idle",
        videos=videos,
    )
    _JOBS[job.job_id] = job
    return job


def get_job(job_id: str) -> BatchJobState | None:
    return _JOBS.get(job_id)


def update_job(job_id: str, **fields) -> BatchJobState:
    job = _JOBS.get(job_id)
    if job is None:
        raise KeyError(job_id)
    for key, value in fields.items():
        setattr(job, key, value)
    job.updated_at = datetime.now(timezone.utc)
    return job


def list_jobs() -> list[BatchJobState]:
    return list(_JOBS.values())
