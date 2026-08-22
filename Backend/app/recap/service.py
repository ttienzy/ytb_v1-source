"""Recap orchestration — Phase R1 (generate) + R2 (cut) + R3 (voice+sync) + R4 (merge). State in-memory.

- ``generate``: tạo recap dict (Gemini HTTP) → status recap_done.
- ``cut``: tải video (yt-dlp, video-only 1080p) vào source/ → stream-copy cut từng segment
  vào clips/ → giữ source → status cut_done.
- ``voice``: TTS batch (voice-service) cloned voice → giải nén + atempo sync từng VO về
  ``duration_sec`` → voice/voice_i.wav → status voice_done + overspeed[].
- ``merge``: mux clip_i + voice_i → seg_i (merge/) → concat → final_recap.mp4 → status merged.
Mỗi bước chạy ``run_in_threadpool`` (sync httpx/yt-dlp/ffmpeg blocking) để không block event loop.
"""
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
from app.recap.ytdlp import download_video
from app.voices import voice_client

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
    # Persist recap ra disk → rehydrate được sau restart server.
    try:
        rp = recap_path(job.job_id)
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text(json.dumps(recap, ensure_ascii=False), encoding="utf-8")
        state.update_job(job.job_id, job_dir=str(rp.parent))
    except OSError:
        pass  # recap trong memory vẫn dùng được; chỉ mất resume sau restart
    return state.get_job(job.job_id)


def _segments_flat(recap: dict) -> list[dict]:
    """L flatten scenes[].segments[] thành list tuần tự (đánh idx cắt clip)."""
    flat: list[dict] = []
    for scene in recap.get("scenes", []):
        for seg in scene.get("segments", []):
            flat.append(seg)
    return flat


def _status_from_disk(job_id: str, n_segs: int) -> tuple[str, list[str], str | None]:
    """Suy luận status + clips + final từ file trên disk (sau restart)."""
    clips = [f"clip_{i}.mp4" for i in range(n_segs)] if (clips_dir(job_id) / "clip_0.mp4").exists() else []
    has_clips = bool(clips)
    has_voice = (voice_dir(job_id) / "voice_0.wav").exists()
    has_final = final_path(job_id).exists() and final_path(job_id).stat().st_size
    if has_final:
        return "merged", clips, "final_recap.mp4"
    if has_voice:
        return "voice_done", clips, None
    if has_clips:
        return "cut_done", clips, None
    return "recap_done", [], None


def rehydrate(job_id: str) -> JobState | None:
    """Đọc ``Downloads/{job_id}/recap.json`` + file trên disk → dựng lại JobState.

    Dùng sau khi server restart (state in-memory mất). overspeed không suy luận được
    (cần re-run voice) → None. Trả None nếu không có recap.json.
    """
    rp = recap_path(job_id)
    if not rp.exists():
        return None
    try:
        recap = json.loads(rp.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    n = len(_segments_flat(recap))
    status, clips, final = _status_from_disk(job_id, n)
    # youtube_url: ưu tiên field `youtube_url` (nếu có), fallback regex video_url.
    url = str(recap.get("youtube_url") or recap.get("video_url") or "")
    m = re.search(r"https?://[^\s\)\]]+watch\?v=[\w-]+", url)
    job = JobState(
        job_id=job_id,
        youtube_url=m.group(0) if m else url,
        status=status,
        recap=recap,
        clips=clips,
        overspeed=None,
        final=final,
        job_dir=str(job_dir_of(job_id)),
    )
    state._JOBS[job_id] = job
    return job


def list_disk_jobs() -> list[str]:
    """Scan ``Downloads/`` lấy các job_id có recap.json (chưa có trong memory)."""
    if not DOWNLOADS_DIR.exists():
        return []
    out: list[str] = []
    for p in sorted(DOWNLOADS_DIR.iterdir(), reverse=True):
        if p.is_dir() and (p / "recap.json").exists() and p.name not in state._JOBS:
            out.append(p.name)
    return out


def _do_cut(job: JobState) -> None:
    """Sync: tải video vào source/ → cut từng segment vào clips/ → giữ source (re-merge)."""
    recap = job.recap or {}
    segs = _segments_flat(recap)
    if not segs:
        raise RuntimeError("Recap không có segment nào để cắt.")

    jdir = job_dir_of(job.job_id)
    jdir.mkdir(parents=True, exist_ok=True)
    video = download_video(job.youtube_url, source_dir(job.job_id))

    clips: list[str] = []
    for i, seg in enumerate(segs):
        start = float(seg.get("start_time_sec", 0.0))
        end = float(seg.get("end_time_sec", start))
        out = clip_path(job.job_id, i)
        cut_segment(video, start, end, out)
        clips.append(out.name)

    # Giữ file nguồn (source/video.mp4) để R4 merge / re-cut khỏi re-download.
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


def _do_voice(job: JobState, segs: list[dict], zip_bytes: bytes) -> list[int]:
    """Sync: giải nén zip → vo_i.wav nguyên gốc (KHÔNG atempo kéo giãn).

    VO giữ tốc độ đọc tự nhiên của TTS. Trả list idx các đoạn "low-coverage"
    (voice_dur < 70% target) → R4 sẽ cắt clip ngắn theo voice, video bị lược bớt;
    giọng nghe vẫn tự nhiên vì không nén/kéo. Idempotent: voice_i đã có → skip.
    """
    vdir = voice_dir(job.job_id)
    vdir.mkdir(parents=True, exist_ok=True)

    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    manifest = json.loads(zf.read("manifest.json"))
    dur_map = {int(it["index"]): float(it["duration"]) for it in manifest.get("items", [])}

    low_coverage_idx: list[int] = []
    for i, seg in enumerate(segs):
        out = voice_path(job.job_id, i)
        if out.exists() and out.stat().st_size:
            # idempotent skip (re-run sau retry TTS)
            tts_dur = dur_map.get(i, 0.0)
        else:
            out.write_bytes(zf.read(f"vo_{i}.wav"))
            tts_dur = dur_map.get(i, 0.0)

        target = float(seg.get("duration_sec", 0.0) or 0.0)
        if target > 0 and 0 < tts_dur < target * 0.7:
            low_coverage_idx.append(i)

    return low_coverage_idx


async def voice(job_id: str, voice_id: str) -> JobState:
    """Phase R3: TTS batch VO Việt (cloned voice) → atempo sync về duration_sec → voice_done.

    Gate: cần status=cut_done (đã có clips). VO text lấy từ ``vietnamese_vo`` mỗi segment.
    """
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy job — state in-memory, có thể server đã restart.",
        )
    if job.status != "cut_done" or not job.clips:
        raise HTTPException(
            status_code=400,
            detail=f"Cần cut trước khi voice (status hiện tại: {job.status}).",
        )

    segs = _segments_flat(job.recap or {})
    if not segs:
        raise HTTPException(status_code=400, detail="Recap không có segment nào để voice.")

    items = [{"text": (seg.get("vietnamese_vo") or "").strip()} for seg in segs]
    missing = [i for i, it in enumerate(items) if not it["text"]]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Có segment thiếu vietnamese_vo: idx {missing[:8]}.",
        )

    voice_id = voice_id.strip()
    if not voice_id:
        raise HTTPException(status_code=400, detail="voice_id rỗng.")

    state.update_job(job_id, status="voice_running", voice_id=voice_id)

    try:
        zip_bytes = await voice_client.tts_batch(items, voice_id)
    except RuntimeError as error:
        state.update_job(job_id, status="error", error=str(error))
        raise HTTPException(status_code=502, detail=str(error)) from error

    try:
        overspeed = await run_in_threadpool(_do_voice, job, segs, zip_bytes)
    except RuntimeError as error:
        state.update_job(job_id, status="error", error=str(error))
        raise HTTPException(status_code=502, detail=str(error)) from error

    state.update_job(job_id, status="voice_done", overspeed=overspeed)
    return state.get_job(job_id)


def _do_merge(job: JobState, segs: list[dict]) -> None:
    """Sync: VO drives duration — re-cut clip_i theo voice_dur từ source → mux → concat.

    KHÔNG kéo giãn voice. Voice_i.wav chạy tốc độ tự nhiên; clip_i được re-cut từ
    ``source/video.mp4`` đúng ``[start, start+voice_dur]`` (mở rộng cho intro/outro,
    lược bớt khi VO ngắn). Clamp về source_dur để không vượt quá video. Cuối cùng
    mux clip+voice (``-shortest`` vô hại vì clip đã khớp voice) → seg_i → concat.
    """
    mdir = merge_dir(job.job_id)
    mdir.mkdir(parents=True, exist_ok=True)

    source = video_path(job.job_id)
    if not source.exists() or not source.stat().st_size:
        raise RuntimeError("source/video.mp4 chưa có — chạy cut trước.")
    source_dur = ffprobe_duration(source)
    if source_dur <= 0:
        raise RuntimeError(f"Không đo được duration source video: {source}")

    segments: list[Path] = []
    for i, seg in enumerate(segs):
        vo = voice_path(job.job_id, i)
        if not vo.exists() or not vo.stat().st_size:
            raise RuntimeError(f"voice/voice_{i}.wav chưa có — chạy voice trước.")
        voice_dur = ffprobe_duration(vo)
        if voice_dur <= 0:
            raise RuntimeError(f"Không đo được duration voice_{i}.wav (ffprobe fail).")

        start = max(0.0, float(seg.get("start_time_sec", 0.0) or 0.0))
        end = min(start + voice_dur, source_dur)  # clamp: không vượt quá video gốc
        clip = clip_path(job.job_id, i)
        # Bỏ clip draft (cut theo target) → re-cut đúng voice_dur. Idempotent: cut_segment
        # skip nếu file có, nên phải unlink để re-cut lấy duration mới.
        if clip.exists():
            clip.unlink()
        cut_segment(source, start, end, clip)
        if not clip.exists() or not clip.stat().st_size:
            raise RuntimeError(f"re-cut clip_{i}.mp4 thất bại.")

        out = segment_path(job.job_id, i)
        mux_segment(clip, vo, out)
        segments.append(out)

    final = final_path(job.job_id)
    concat_segments(segments, final, mdir)
    state.update_job(job.job_id, final=final.name)


async def merge(job_id: str) -> JobState:
    """Phase R4: mux clip_i + voice_i → seg_i → concat → final_recap.mp4 → status merged.

    Gate: cần status=voice_done (đã có clips + voice cho mọi segment).
    """
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy job — state in-memory, có thể server đã restart.",
        )
    if job.status != "voice_done":
        raise HTTPException(
            status_code=400,
            detail=f"Cần voice trước khi merge (status hiện tại: {job.status}).",
        )

    segs = _segments_flat(job.recap or {})
    if not segs:
        raise HTTPException(status_code=400, detail="Recap không có segment nào để merge.")

    state.update_job(job_id, status="merge_running")
    try:
        await run_in_threadpool(_do_merge, job, segs)
    except RuntimeError as error:
        state.update_job(job_id, status="error", error=str(error))
        raise HTTPException(status_code=502, detail=str(error)) from error
    state.update_job(job_id, status="merged")
    return state.get_job(job_id)
