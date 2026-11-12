"""In-memory job store — Phase A redesign: 4 per-phase status + progress fields.

Thay `status: str` đơn bằng 4 field độc lập:
  recap_status / cut_status / voice_status / merge_status ∈ "idle" | "running" | "done" | "error"

Thêm 3 progress dict:
  progress_cut / progress_voice / progress_merge = {"done": int, "total": int}

Điều này cho phép cut + voice chạy song song mà không xung đột state.
State mất khi restart server (chấp nhận cho dev/phase 1).
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class JobState:
    job_id: str
    youtube_url: str
    # ── Per-phase status ── (idle | running | done | error)
    recap_status: str = "idle"
    cut_status: str = "idle"
    voice_status: str = "idle"
    merge_status: str = "idle"
    polish_status: str = "idle"  # Phase R5 (BGM/watermark hậu xử lý)
    # ── Per-phase progress ──
    progress_recap: dict = field(default_factory=lambda: {"done": 0, "total": 0, "phase": "chunk_llm"})
    progress_cut: dict = field(default_factory=lambda: {"done": 0, "total": 0})
    progress_voice: dict = field(default_factory=lambda: {"done": 0, "total": 0, "phase": "tts"})
    progress_merge: dict = field(default_factory=lambda: {"done": 0, "total": 0})
    progress_polish: dict = field(default_factory=lambda: {"done": 0, "total": 1, "step": "encode"})
    # ── Payload ──
    recap: dict | None = None
    caption: dict | None = None
    voice_id: str | None = None
    error: str | None = None
    raw_bytes: bytes | None = None   # transcript gốc (giữ để re-run nếu lỗi)
    raw_name: str | None = None
    job_dir: str | None = None       # thư mục media (Data/Downloads/{job_id})
    clips: list[str] | None = None   # ["clip_0.mp4", ...] — tên file (Phase B cut)
    overspeed: list[int] | None = None  # idx VO bị nén mạnh (Phase B voice)
    final: str | None = None         # "final_recap.mp4" (Phase B merge)
    final_studio: str | None = None  # "final_studio.mp4" (Phase R5 polish)
    polish_opts: dict | None = None  # snapshot opts lúc trigger (bgm_ids, volume...)
    credits: str | None = None       # credit text BGM (để FE show dán lên YouTube)
    timings: dict = field(default_factory=dict)  # phase → {started_at, ended_at, duration_sec, ...} (app.recap.timing)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


_JOBS: dict[str, JobState] = {}


def create_job(youtube_url: str, raw_bytes: bytes | None = None, raw_name: str | None = None) -> JobState:
    job = JobState(
        job_id=secrets.token_hex(6),
        youtube_url=youtube_url,
        recap_status="idle",
        cut_status="idle",
        voice_status="idle",
        merge_status="idle",
        polish_status="idle",
        progress_recap={"done": 0, "total": 0, "phase": "chunk_llm"},
        progress_cut={"done": 0, "total": 0},
        progress_voice={"done": 0, "total": 0, "phase": "tts"},
        progress_merge={"done": 0, "total": 0},
        progress_polish={"done": 0, "total": 1, "step": "encode"},
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


def delete_job(job_id: str) -> JobState | None:
    """Xóa job khỏi in-memory state."""
    return _JOBS.pop(job_id, None)


# ── Batch Queue State ─────────────────────────────────────────────────────────

@dataclass
class BatchItem:
    """Trạng thái của 1 URL trong batch queue."""
    url: str
    job_id: str | None = None        # set sau khi job được tạo
    status: str = "pending"          # pending | running | done | error | skipped
    error: str | None = None
    retry_count: int = 0             # số lần đã retry (tối đa 1)


@dataclass
class BatchState:
    """Trạng thái của cả batch queue (tối đa 10 URL)."""
    batch_id: str
    items: list[BatchItem]           # list URL theo thứ tự submit
    voice_id: str
    polish_opts: dict | None = None
    status: str = "idle"             # idle | running | stopped | done
    current_index: int = 0           # index đang xử lý (0-based)
    stop_requested: bool = False     # True khi user nhấn "Dừng batch"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


_BATCHES: dict[str, BatchState] = {}


def create_batch(
    urls: list[str],
    voice_id: str,
    polish_opts: dict | None = None,
) -> BatchState:
    """Tạo batch mới từ danh sách URL. Trả BatchState với batch_id mới."""
    batch = BatchState(
        batch_id=secrets.token_hex(6),
        items=[BatchItem(url=url) for url in urls],
        voice_id=voice_id,
        polish_opts=polish_opts,
    )
    _BATCHES[batch.batch_id] = batch
    return batch


def get_batch(batch_id: str) -> BatchState | None:
    return _BATCHES.get(batch_id)


def update_batch(batch_id: str, **fields) -> BatchState:
    batch = _BATCHES.get(batch_id)
    if batch is None:
        raise KeyError(batch_id)
    for key, value in fields.items():
        setattr(batch, key, value)
    batch.updated_at = datetime.now(timezone.utc)
    return batch


def update_batch_item(batch_id: str, index: int, **fields) -> BatchItem:
    """Cập nhật 1 item trong batch theo index."""
    batch = _BATCHES.get(batch_id)
    if batch is None:
        raise KeyError(batch_id)
    item = batch.items[index]
    for key, value in fields.items():
        setattr(item, key, value)
    batch.updated_at = datetime.now(timezone.utc)
    return item


def list_batches() -> list[BatchState]:
    return list(_BATCHES.values())


def delete_batch(batch_id: str) -> BatchState | None:
    """Xóa batch khỏi in-memory state."""
    return _BATCHES.pop(batch_id, None)
