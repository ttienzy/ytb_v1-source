"""Recap orchestration — Phase B+C redesign.

Pipeline:
  generate → asyncio.gather(cut, voice, return_exceptions=True) → merge

Phase B changes:
- Gates dùng per-phase status thay vì status string đơn.
- cut_status / voice_status / merge_status độc lập (cut+voice song song được).
- Progress tracking: update_job(progress_cut/voice/merge={done, total}) sau mỗi segment.
- `_status_from_disk`: suy luận từng phase độc lập (không cascaded sequential).
- `generate`: ghi youtube_url + created_at vào recap.json để rehydrate đầy đủ.

Phase C changes:
- `run()`: async wrapper gọi generate → asyncio.create_task(_run_pipeline).
- `_run_pipeline()`: gather(cut, voice, return_exceptions=True) → merge nếu cả 2 ok.
- HTTPException trong gather bị bắt thành value (return_exceptions) → không cancel sibling.
"""
import asyncio
import io
import json
import re
import zipfile
from pathlib import Path

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from app.core.config import TOOLS_DIR
from app.ai.gemini.recap import RecapConfigError, generate_recap
from app.recap import state
from app.recap.ffmpeg import concat_segments, cut_segment, ffprobe_duration, mux_segment
from app.recap.paths import (
    DOWNLOADS_DIR,
    clip_path,
    clips_dir,
    final_path,
    job_dir_of,
    merge_dir,
    recap_path,
    segment_path,
    source_dir,
    video_path,
    voice_dir,
    voice_path,
)
from app.recap.state import JobState
from app.recap.transcript import fetch_transcript_raw
from app.recap.ytdlp import download_video
from app.voices import voice_client

PROMPT_PATH = TOOLS_DIR / "Backend" / "prompts" / "System Prompt Food Review Recap.txt"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _segments_flat(recap: dict) -> list[dict]:
    """Flatten scenes[].segments[] thành list tuần tự (đánh idx)."""
    flat: list[dict] = []
    for scene in recap.get("scenes", []):
        for seg in scene.get("segments", []):
            flat.append(seg)
    return flat


def _status_from_disk(job_id: str, n_segs: int) -> dict:
    """Suy luận per-phase status từ file trên disk — ĐỘCLẬP từng phase.

    Không cascaded: voice có thể done dù cut idle (chạy song song → khả năng partial).
    missing output = idle (re-runnable sau restart).
    """
    clips = [f"clip_{i}.mp4" for i in range(n_segs)] if (clips_dir(job_id) / "clip_0.mp4").exists() else []
    has_clips = bool(clips)
    has_voice = (voice_dir(job_id) / "voice_0.wav").exists()
    fp = final_path(job_id)
    has_final = fp.exists() and fp.stat().st_size > 0

    return {
        "recap_status": "done",   # recap.json tồn tại nên luôn done
        "cut_status": "done" if has_clips else "idle",
        "voice_status": "done" if has_voice else "idle",
        "merge_status": "done" if has_final else "idle",
        "clips": clips if has_clips else [],
        "final": "final_recap.mp4" if has_final else None,
    }


# ── Phase A: generate ────────────────────────────────────────────────────────

async def generate(youtube_url: str, raw_bytes: bytes, raw_name: str) -> JobState:
    """Manual /generate endpoint: tạo job + chạy Gemini (đồng bộ).

    Trả về JobState sau khi recap xong (để /generate trả JobOut ngay).
    """
    youtube_url = youtube_url.strip()
    if not youtube_url:
        raise HTTPException(status_code=400, detail="YouTube URL rỗng.")
    if not PROMPT_PATH.exists():
        raise HTTPException(status_code=500, detail=f"Không tìm thấy system prompt: {PROMPT_PATH}")

    job = state.create_job(youtube_url, raw_bytes=raw_bytes, raw_name=raw_name)
    state.update_job(job.job_id, recap_status="running")
    await _generate_for_job(job.job_id)
    return state.get_job(job.job_id)


async def _generate_for_job(job_id: str) -> None:
    """Chạy Gemini cho job đã tạo (recap_status=running → done/error + persist recap.json).

    Tách khỏi ``generate()`` để ``_run_pipeline`` reuse được: job đã tạo trước, chỉ cần
    gọi Gemini. Raise HTTPException nếu Gemini lỗi (recap_status đã set error trước).
    """
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    if not job.raw_bytes:
        raise HTTPException(status_code=400, detail="Thiếu transcript (raw_bytes) cho job.")

    prompt_bytes = PROMPT_PATH.read_bytes()
    try:
        recap = await run_in_threadpool(
            generate_recap,
            job.youtube_url,
            job.raw_bytes,
            job.raw_name or "raw.txt",
            prompt_bytes,
            PROMPT_PATH.name,
        )
    except RecapConfigError as error:
        state.update_job(job_id, recap_status="error", error=str(error))
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        state.update_job(job_id, recap_status="error", error=str(error))
        raise HTTPException(status_code=502, detail=str(error)) from error

    state.update_job(job_id, recap_status="done", recap=recap)

    # Persist recap ra disk → rehydrate được sau restart.
    # Ghi thêm youtube_url + created_at để rehydrate đầy đủ.
    try:
        rp = recap_path(job_id)
        rp.parent.mkdir(parents=True, exist_ok=True)
        recap_with_meta = {
            **recap,
            "youtube_url": job.youtube_url,
            "created_at": job.created_at.isoformat(),
        }
        rp.write_text(json.dumps(recap_with_meta, ensure_ascii=False), encoding="utf-8")
        state.update_job(job_id, job_dir=str(rp.parent))
    except OSError:
        pass  # recap trong memory vẫn dùng được


# ── Phase B: rehydrate (per-phase, không cascaded) ───────────────────────────

def rehydrate(job_id: str) -> JobState | None:
    """Đọc Downloads/{job_id}/recap.json + file trên disk → dựng lại JobState.

    Mỗi phase suy luận độc lập: recap=done luôn; cut/voice/merge = done nếu output tồn tại.
    Restart mất in-flight task → missing output = idle (re-runnable).
    """
    rp = recap_path(job_id)
    if not rp.exists():
        return None
    try:
        recap = json.loads(rp.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    n = len(_segments_flat(recap))
    disk = _status_from_disk(job_id, n)

    # youtube_url: ưu tiên field được ghi khi generate, fallback regex.
    url = str(recap.get("youtube_url") or recap.get("video_url") or "")
    m = re.search(r"https?://[^\s\)\]]+watch\?v=[\w-]+", url)
    youtube_url = m.group(0) if m else url

    # created_at: từ recap.json nếu có, fallback now (không mất thông tin lịch sử).
    from datetime import timezone
    created_at_str = recap.get("created_at")
    try:
        from datetime import datetime
        created_at = datetime.fromisoformat(created_at_str) if created_at_str else None
    except (ValueError, TypeError):
        created_at = None

    job = JobState(
        job_id=job_id,
        youtube_url=youtube_url,
        recap_status=disk["recap_status"],
        cut_status=disk["cut_status"],
        voice_status=disk["voice_status"],
        merge_status=disk["merge_status"],
        recap=recap,
        clips=disk["clips"],
        overspeed=None,  # không suy luận được từ disk
        final=disk["final"],
        job_dir=str(job_dir_of(job_id)),
    )
    if created_at:
        job.created_at = created_at
    state._JOBS[job_id] = job
    return job


def list_disk_jobs() -> list[str]:
    """Scan Downloads/ lấy các job_id có recap.json (chưa có trong memory)."""
    if not DOWNLOADS_DIR.exists():
        return []
    out: list[str] = []
    for p in sorted(DOWNLOADS_DIR.iterdir(), reverse=True):
        if p.is_dir() and (p / "recap.json").exists() and p.name not in state._JOBS:
            out.append(p.name)
    return out


# ── Phase B: cut (per-phase gate + progress) ─────────────────────────────────

def _do_cut(job: JobState) -> None:
    """Sync: tải video → cut từng segment → giữ source. Progress tracking per segment."""
    recap = job.recap or {}
    segs = _segments_flat(recap)
    if not segs:
        raise RuntimeError("Recap không có segment nào để cắt.")

    jdir = job_dir_of(job.job_id)
    jdir.mkdir(parents=True, exist_ok=True)

    # Init progress
    state.update_job(job.job_id, progress_cut={"done": 0, "total": len(segs)})

    video = download_video(job.youtube_url, source_dir(job.job_id))

    clips: list[str] = []
    for i, seg in enumerate(segs):
        start = float(seg.get("start_time_sec", 0.0))
        end = float(seg.get("end_time_sec", start))
        out = clip_path(job.job_id, i)
        cut_segment(video, start, end, out)
        clips.append(out.name)
        # Bump progress sau mỗi clip
        state.update_job(job.job_id, progress_cut={"done": i + 1, "total": len(segs)})

    state.update_job(job.job_id, job_dir=str(jdir), clips=clips)


async def cut(job_id: str) -> JobState:
    """Phase cut — gate: recap_status=done."""
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    if job.recap_status != "done" or not job.recap:
        raise HTTPException(
            status_code=400,
            detail=f"Cần recap_done trước khi cut (recap_status={job.recap_status}).",
        )
    state.update_job(job_id, cut_status="running")
    try:
        await run_in_threadpool(_do_cut, job)
    except RuntimeError as error:
        state.update_job(job_id, cut_status="error", error=f"cut: {error}")
        raise HTTPException(status_code=502, detail=str(error)) from error
    state.update_job(job_id, cut_status="done")
    return state.get_job(job_id)


# ── Phase B: voice (per-phase gate + progress) ───────────────────────────────

def _do_voice(job: JobState, segs: list[dict], zip_bytes: bytes) -> list[int]:
    """Sync: giải nén zip → vo_i.wav. Không atempo (giọng tự nhiên).

    Trả list idx low-coverage (voice_dur < 70% target).
    Progress tracking: phase "tts" (indeterminate từ FE) → "unpack" (per-segment).
    """
    vdir = voice_dir(job.job_id)
    vdir.mkdir(parents=True, exist_ok=True)

    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    manifest = json.loads(zf.read("manifest.json"))
    dur_map = {int(it["index"]): float(it["duration"]) for it in manifest.get("items", [])}

    # Chuyển sang phase unpack
    state.update_job(job.job_id, progress_voice={"done": 0, "total": len(segs), "phase": "unpack"})

    low_coverage_idx: list[int] = []
    for i, seg in enumerate(segs):
        out = voice_path(job.job_id, i)
        if out.exists() and out.stat().st_size:
            tts_dur = dur_map.get(i, 0.0)
        else:
            out.write_bytes(zf.read(f"vo_{i}.wav"))
            tts_dur = dur_map.get(i, 0.0)

        target = float(seg.get("duration_sec", 0.0) or 0.0)
        if target > 0 and 0 < tts_dur < target * 0.7:
            low_coverage_idx.append(i)

        # Bump progress
        state.update_job(job.job_id, progress_voice={"done": i + 1, "total": len(segs), "phase": "unpack"})

    return low_coverage_idx


async def voice(job_id: str, voice_id: str) -> JobState:
    """Phase voice — gate: recap_status=done (KHÔNG phụ thuộc cut, song song được).

    Đây là thay đổi then chốt so với code cũ (cũ gate cut_done → serial).
    """
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    # Gate mới: chỉ cần recap_status=done (bỏ clause job.clips)
    if job.recap_status != "done":
        raise HTTPException(
            status_code=400,
            detail=f"Cần recap_done trước khi voice (recap_status={job.recap_status}).",
        )

    segs = _segments_flat(job.recap or {})
    if not segs:
        raise HTTPException(status_code=400, detail="Recap không có segment nào.")

    items = [{"text": (seg.get("vietnamese_vo") or "").strip()} for seg in segs]
    missing = [i for i, it in enumerate(items) if not it["text"]]
    if missing:
        raise HTTPException(status_code=400, detail=f"Thiếu vietnamese_vo: idx {missing[:8]}.")

    voice_id = voice_id.strip()
    if not voice_id:
        raise HTTPException(status_code=400, detail="voice_id rỗng.")

    state.update_job(
        job_id,
        voice_status="running",
        voice_id=voice_id,
        progress_voice={"done": 0, "total": len(segs), "phase": "tts"},
    )

    try:
        zip_bytes = await voice_client.tts_batch(items, voice_id)
    except RuntimeError as error:
        state.update_job(job_id, voice_status="error", error=f"voice: {error}")
        raise HTTPException(status_code=502, detail=str(error)) from error

    try:
        overspeed = await run_in_threadpool(_do_voice, job, segs, zip_bytes)
    except RuntimeError as error:
        state.update_job(job_id, voice_status="error", error=f"voice: {error}")
        raise HTTPException(status_code=502, detail=str(error)) from error

    state.update_job(job_id, voice_status="done", overspeed=overspeed)
    return state.get_job(job_id)


# ── Phase B: merge (gate: cut_done AND voice_done) ───────────────────────────

def _do_merge(job: JobState, segs: list[dict]) -> None:
    """Sync: VO drives duration — re-cut clip_i theo voice_dur → mux → concat.

    Progress tracking per segment.
    """
    mdir = merge_dir(job.job_id)
    mdir.mkdir(parents=True, exist_ok=True)

    source = video_path(job.job_id)
    if not source.exists() or not source.stat().st_size:
        raise RuntimeError("source/video.mp4 chưa có — chạy cut trước.")
    source_dur = ffprobe_duration(source)
    if source_dur <= 0:
        raise RuntimeError(f"Không đo được duration source video: {source}")

    # Init progress
    state.update_job(job.job_id, progress_merge={"done": 0, "total": len(segs)})

    segments: list[Path] = []
    for i, seg in enumerate(segs):
        vo = voice_path(job.job_id, i)
        if not vo.exists() or not vo.stat().st_size:
            raise RuntimeError(f"voice/voice_{i}.wav chưa có — chạy voice trước.")
        voice_dur = ffprobe_duration(vo)
        if voice_dur <= 0:
            raise RuntimeError(f"Không đo được duration voice_{i}.wav.")

        start = max(0.0, float(seg.get("start_time_sec", 0.0) or 0.0))
        end = min(start + voice_dur, source_dur)
        clip = clip_path(job.job_id, i)
        if clip.exists():
            clip.unlink()
        cut_segment(source, start, end, clip)
        if not clip.exists() or not clip.stat().st_size:
            raise RuntimeError(f"re-cut clip_{i}.mp4 thất bại.")

        out = segment_path(job.job_id, i)
        mux_segment(clip, vo, out)
        segments.append(out)

        # Bump progress
        state.update_job(job.job_id, progress_merge={"done": i + 1, "total": len(segs)})

    final = final_path(job.job_id)
    concat_segments(segments, final, mdir)
    state.update_job(job.job_id, final=final.name)


async def merge(job_id: str) -> JobState:
    """Phase merge — gate: cut_status=done AND voice_status=done."""
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    if job.cut_status != "done" or job.voice_status != "done":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cần cut_done + voice_done trước khi merge "
                f"(cut={job.cut_status}, voice={job.voice_status})."
            ),
        )

    segs = _segments_flat(job.recap or {})
    if not segs:
        raise HTTPException(status_code=400, detail="Recap không có segment nào.")

    state.update_job(job_id, merge_status="running")
    try:
        await run_in_threadpool(_do_merge, job, segs)
    except RuntimeError as error:
        state.update_job(job_id, merge_status="error", error=f"merge: {error}")
        raise HTTPException(status_code=502, detail=str(error)) from error
    state.update_job(job_id, merge_status="done")
    return state.get_job(job_id)


# ── Phase C: 1-button orchestration ─────────────────────────────────────────

async def run(youtube_url: str, raw_bytes: bytes | None, raw_name: str | None, voice_id: str) -> str:
    """Trigger toàn bộ pipeline: [fetch transcript] → generate → gather(cut, voice) → merge.

    Tạo job ngay + trả job_id (HTTP 202); pipeline chạy background asyncio task.
    ``raw_bytes`` None → tự fetch transcript từ YouTube qua Playwright (get_panel).
    """
    youtube_url = youtube_url.strip()
    if not youtube_url:
        raise HTTPException(status_code=400, detail="YouTube URL rỗng.")
    voice_id = voice_id.strip()
    if not voice_id:
        raise HTTPException(status_code=400, detail="voice_id rỗng.")

    job = state.create_job(youtube_url, raw_bytes=raw_bytes, raw_name=raw_name)
    state.update_job(job.job_id, recap_status="running")
    asyncio.create_task(_run_pipeline(job.job_id, voice_id))
    return job.job_id


async def _run_pipeline(job_id: str, voice_id: str) -> None:
    """Background task: [fetch transcript] → generate → gather(cut, voice) → merge.

    return_exceptions=True: HTTPException trong gather thành value, không cancel sibling.
    Phase error được set bên trong cut()/voice() trước khi raise → state luôn consistent.
    """
    try:
        job = state.get_job(job_id)
        if job is None:
            return

        # 1) Fetch transcript nếu chưa có raw_bytes (auto từ YouTube).
        if not job.raw_bytes:
            try:
                transcript = await run_in_threadpool(fetch_transcript_raw, job.youtube_url)
            except Exception as exc:  # noqa: BLE001
                state.update_job(
                    job_id,
                    recap_status="error",
                    error=f"transcript: {exc}",
                )
                return
            raw_bytes = json.dumps(transcript, ensure_ascii=False).encode("utf-8")
            state.update_job(job_id, raw_bytes=raw_bytes, raw_name="raw.txt")

        # 2) Generate (Gemini) — recap_status error đã set bên trong nếu lỗi.
        try:
            await _generate_for_job(job_id)
        except HTTPException:
            return  # recap_status đã = error

        # 3) Cut + Voice song song (gather return_exceptions → không huỷ sibling).
        results = await asyncio.gather(
            cut(job_id),
            voice(job_id, voice_id),
            return_exceptions=True,
        )
        cut_ok = not isinstance(results[0], Exception)
        voice_ok = not isinstance(results[1], Exception)
        if not cut_ok or not voice_ok:
            # Ít nhất 1 phase fail → không merge; phase đã set error status.
            return

        # 4) Cả 2 thành công → merge.
        await merge(job_id)

    except Exception as exc:  # noqa: BLE001
        # Unexpected error thoát ra ngoài gather
        try:
            state.update_job(job_id, merge_status="error", error=f"pipeline: {exc}")
        except KeyError:
            pass
