"""Recap orchestration — Phase R1 (generate) + R2 (cut). State in-memory, không DB/file recap.

- ``generate``: tạo recap dict (Gemini HTTP) → status recap_done.
- ``cut``: load recap → tải video (yt-dlp, video-only 1080p) → stream-copy cut từng segment
  → ``Data/Downloads/{job_id}/clip_i.mp4`` → xoá video.mp4 (tiết kiệm disk) → status cut_done.
Mỗi bước chạy ``run_in_threadpool`` (sync httpx/yt-dlp/ffmpeg blocking) để không block event loop.
"""
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from app.core.config import TOOLS_DIR
from app.ai.gemini.recap import RecapConfigError, generate_recap
from app.recap import state
from app.recap.ffmpeg import cut_segment
from app.recap.paths import clip_path, job_dir_of, video_path
from app.recap.state import JobState
from app.recap.ytdlp import download_video

PROMPT_PATH = TOOLS_DIR / "Backend" / "prompts" / "System Prompt YouTube Video Recap.txt"


async def generate(youtube_url: str, raw_bytes: bytes, raw_name: str) -> JobState:
    youtube_url = youtube_url.strip()
    if not youtube_url:
        raise HTTPException(status_code=400, detail="YouTube URL rỗng.")
    if not PROMPT_PATH.exists():
        raise HTTPException(status_code=500, detail=f"Không tìm thấy system prompt: {PROMPT_PATH}")

    job = state.create_job(youtube_url, raw_bytes=raw_bytes, raw_name=raw_name)
    state.update_job(job.job_id, status="recap_running")

    prompt_bytes = PROMPT_PATH.read_bytes()
    try:
        recap = await run_in_threadpool(
            generate_recap, youtube_url, raw_bytes, raw_name, prompt_bytes, PROMPT_PATH.name
        )
    except RecapConfigError as error:
        state.update_job(job.job_id, status="error", error=str(error))
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        state.update_job(job.job_id, status="error", error=str(error))
        raise HTTPException(status_code=502, detail=str(error)) from error

    state.update_job(job.job_id, status="recap_done", recap=recap)
    return state.get_job(job.job_id)


def _segments_flat(recap: dict) -> list[dict]:
    """L flatten scenes[].segments[] thành list tuần tự (đánh idx cắt clip)."""
    flat: list[dict] = []
    for scene in recap.get("scenes", []):
        for seg in scene.get("segments", []):
            flat.append(seg)
    return flat


def _do_cut(job: JobState) -> None:
    """Sync: tải video → cut từng segment → xoá video.mp4 → lưu clips vào state."""
    recap = job.recap or {}
    segs = _segments_flat(recap)
    if not segs:
        raise RuntimeError("Recap không có segment nào để cắt.")

    jdir = job_dir_of(job.job_id)
    jdir.mkdir(parents=True, exist_ok=True)
    video = download_video(job.youtube_url, jdir)

    clips: list[str] = []
    for i, seg in enumerate(segs):
        start = float(seg.get("start_time_sec", 0.0))
        end = float(seg.get("end_time_sec", start))
        out = clip_path(job.job_id, i)
        cut_segment(video, start, end, out)
        clips.append(out.name)

    # Video full đã dùng xong — xoá để tránh ngốn disk (re-cut → re-download).
    try:
        video.unlink(missing_ok=True)
    except OSError:
        pass

    state.update_job(job.job_id, job_dir=str(jdir), clips=clips)


async def cut(job_id: str) -> JobState:
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy job — state in-memory, có thể server đã restart.",
        )
    if job.status != "recap_done" or not job.recap:
        raise HTTPException(
            status_code=400,
            detail=f"Cần tạo recap trước khi cut (status hiện tại: {job.status}).",
        )
    state.update_job(job_id, status="cut_running")
    try:
        await run_in_threadpool(_do_cut, job)
    except RuntimeError as error:
        state.update_job(job_id, status="error", error=str(error))
        raise HTTPException(status_code=502, detail=str(error)) from error
    state.update_job(job_id, status="cut_done")
    return state.get_job(job_id)
