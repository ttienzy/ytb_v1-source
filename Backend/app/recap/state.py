"""In-memory job store — Phase R1 chỉ giữ state để flow tiếp, KHÔNG lưu DB / file.

State mất khi restart server (chấp nhận cho dev/phase 1). Các bước sau (R2 cut, R3 voice, R4 merge)
đọc recap từ đây qua ``get_job(job_id)``.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class JobState:
    job_id: str
    youtube_url: str
    status: str  # created → recap_running → recap_done | error  (R2/R3/R4 mở rộng thêm)
    recap: dict | None = None
    voice_id: str | None = None
    error: str | None = None
    raw_bytes: bytes | None = None  # transcript gốc (giữ để re-run nếu lỗi)
    raw_name: str | None = None
    job_dir: str | None = None  # thư mục media (Data/Downloads/{job_id}) — set khi R2 cut chạy
    clips: list[str] | None = None  # ["clip_0.mp4", ...] — tên file đoạn cắt (R2)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


_JOBS: dict[str, JobState] = {}


def create_job(youtube_url: str, raw_bytes: bytes | None = None, raw_name: str | None = None) -> JobState:
    job = JobState(
        job_id=secrets.token_hex(6),
        youtube_url=youtube_url,
        status="created",
        raw_bytes=raw_bytes,
        raw_name=raw_name,
    )
    _JOBS[job.job_id] = job
    return job


def get_job(job_id: str) -> JobState | None:
    return _JOBS.get(job_id)


def update_job(job_id: str, **fields) -> JobState:
    job = _JOBS.get(job_id)
    if job is None:
        raise KeyError(job_id)
    for key, value in fields.items():
        setattr(job, key, value)
    job.updated_at = datetime.now(timezone.utc)
    return job


def list_jobs() -> list[JobState]:
    return list(_JOBS.values())
