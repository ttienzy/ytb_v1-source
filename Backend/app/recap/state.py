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
