"""Persistent batch job store cho watermark remover.

Lưu trạng thái vào Data/watermark/jobs.json để không bị mất khi restart server.
"""
from __future__ import annotations

import json
import logging
import secrets
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path("Data/watermark")
JOBS_FILE = DATA_DIR / "jobs.json"


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
    drive_status: str = "idle"        # idle | uploading | done | error
    drive_file_id: str | None = None
    drive_url: str | None = None
    drive_error: str | None = None


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
_INITIALIZED = False


def _load_jobs_from_disk() -> None:
    global _INITIALIZED, _JOBS
    if not JOBS_FILE.exists():
        _INITIALIZED = True
        return
    try:
        raw_list = json.loads(JOBS_FILE.read_text(encoding="utf-8"))
        for j in raw_list:
            videos = [VideoState(**v) for v in j.get("videos", [])]
            created_at = datetime.fromisoformat(j["created_at"]) if "created_at" in j else datetime.now(timezone.utc)
            updated_at = datetime.fromisoformat(j["updated_at"]) if "updated_at" in j else datetime.now(timezone.utc)
            job = BatchJobState(
                job_id=j["job_id"],
                status=j.get("status", "idle"),
                videos=videos,
                created_at=created_at,
                updated_at=updated_at,
            )
            _JOBS[job.job_id] = job
    except Exception as exc:
        logger.warning("[watermark] Không thể nạp jobs.json: %s", exc)
    _INITIALIZED = True


def _save_jobs_to_disk() -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        raw_list = []
        for job in _JOBS.values():
            j_dict = {
                "job_id": job.job_id,
                "status": job.status,
                "created_at": job.created_at.isoformat(),
                "updated_at": job.updated_at.isoformat(),
                "videos": [asdict(v) for v in job.videos],
            }
            raw_list.append(j_dict)
        JOBS_FILE.write_text(json.dumps(raw_list, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("[watermark] Không thể lưu jobs.json: %s", exc)


def _ensure_init() -> None:
    if not _INITIALIZED:
        _load_jobs_from_disk()


def create_job(videos: list[VideoState]) -> BatchJobState:
    _ensure_init()
    job = BatchJobState(
        job_id=secrets.token_hex(6),
        status="idle",
        videos=videos,
    )
    _JOBS[job.job_id] = job
    _save_jobs_to_disk()
    return job


def get_job(job_id: str) -> BatchJobState | None:
    _ensure_init()
    return _JOBS.get(job_id)


def update_job(job_id: str, **fields) -> BatchJobState:
    _ensure_init()
    job = _JOBS.get(job_id)
    if job is None:
        raise KeyError(job_id)
    for key, value in fields.items():
        setattr(job, key, value)
    job.updated_at = datetime.now(timezone.utc)
    _save_jobs_to_disk()
    return job


def list_jobs() -> list[BatchJobState]:
    _ensure_init()
    return list(_JOBS.values())


def reset_job_drive_status(job_id: str) -> BatchJobState | None:
    """Reset trạng thái upload Google Drive của toàn bộ video trong job về idle."""
    _ensure_init()
    job = _JOBS.get(job_id)
    if not job:
        return None
    for v in job.videos:
        v.drive_status = "idle"
        v.drive_file_id = None
        v.drive_url = None
        v.drive_error = None
    job.updated_at = datetime.now(timezone.utc)
    _save_jobs_to_disk()
    return job
