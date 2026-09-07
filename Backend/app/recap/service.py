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
import shutil
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from app.core.config import TOOLS_DIR
from app.ai.gemini.recap import RecapConfigError, generate_recap, _auto_refresh_cookies, _gemini_config
from app.discover.history import (
    mark_disk_cleaned,
    record_batch_queue,
    record_job_completed,
    record_job_failed,
    record_job_metadata,
    record_job_start,
)
from app.recap import state
from app.recap.ffmpeg import (
    concat_segments,
    cut_and_mux_segment,
    cut_segment,
    ffprobe_duration,
    mux_segment,
    polish_final,
)
from app.recap.paths import (
    DOWNLOADS_DIR,
    clip_path,
    clips_dir,
    final_path,
    final_studio_path,
    job_dir_of,
    merge_dir,
    polish_dir,
    raw_path,
    recap_path,
    segment_path,
    source_dir,
    video_path,
    voice_dir,
    voice_path,
)
from app.recap.state import JobState
from app.recap.transcript import fetch_transcript_raw, transcript_to_text
from app.recap.ytdlp import download_video
from app.voices import voice_client

PROMPT_PATH = TOOLS_DIR / "Backend" / "prompts" / "recap" / "food_review_chunk.prompt.txt"


# ── Cookie pre-check helper ───────────────────────────────────────────────────

def _ensure_gemini_cookie(job_id: str) -> bool:
    """Kiểm tra cookie Gemini còn hạn bằng cách GET /app. Nếu fail → tự động refresh.

    Cập nhật ``recap_status="refreshing_cookie"`` trong job state để FE hiển thị
    trạng thái rõ ràng (“Đang làm mới cookie...”) thay vì bị chặn im lặng.
    Trả ``True`` nếu cookie OK (hoặc refresh thành công), ``False`` nếu refresh thất bại
    (khi đó ``recap_status`` được set “error” kèm message rõ).

    Gọ vào _run_pipeline TRƯỚC bước generate Gemini để phát hiện sớm cookie hết hạn,
    tránh lãng phí thời gian yt-dlp đang tải video rồi mới báo lỗi recap.
    """
    import httpx
    import re as _re

    try:
        cfg = _gemini_config()
    except Exception as exc:
        # Chưa có cookie / inner_template → báo rõ thay vì khởng chết
        state.update_job(job_id, recap_status="error", error=str(exc))
        return False

    cookies = cfg["cookies"]
    ua = cfg["user_agent"]
    cookie_ok = False
    try:
        with httpx.Client(http2=False, timeout=20, follow_redirects=True) as client:
            r = client.get("https://gemini.google.com/app", headers={"User-Agent": ua, "Cookie": cookies})
            at_val = _re.search(r'"SNlM0e":"(.*?)"', r.text)
            cookie_ok = bool(at_val)
    except Exception:
        cookie_ok = False

    if cookie_ok:
        return True

    # Cookie không hợp lệ → cập nhật trạng thái và tự động refresh
    state.update_job(
        job_id,
        recap_status="refreshing_cookie",
        error=None,
    )
    _log = print  # fallback nếu không import
    try:
        from app.ai.gemini.recap import _log as _gemini_log
        _log = _gemini_log
    except Exception:
        pass

    _log("[Gemini] Cookie không hợp lệ (pre-check). Tự động làm mới trước pipeline...")
    try:
        _auto_refresh_cookies()
        _log("[Gemini] Làm mới cookie thành công. Tiếp tục pipeline...")
        # Đặt lại trạng thái → running (generate bước sau sẽ set đúng)
        state.update_job(job_id, recap_status="running")
        return True
    except Exception as refresh_err:
        state.update_job(
            job_id,
            recap_status="error",
            error=(
                f"Cookie Gemini hết hạn và tự động làm mới thất bại: {refresh_err}. "
                f"Vào Cài đặt → Đăng nhập Gemini (Chrome) rồi thử lại."
            ),
        )
        return False


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
    has_source = video_path(job_id).exists() and video_path(job_id).stat().st_size > 0
    has_voice = (voice_dir(job_id) / "voice_0.wav").exists()
    fp = final_path(job_id)
    has_final = fp.exists() and fp.stat().st_size > 0
    sfp = final_studio_path(job_id)
    has_studio = sfp.exists() and sfp.stat().st_size > 0

    return {
        "recap_status": "done",   # recap.json tồn tại nên luôn done
        "cut_status": "done" if has_source else "idle",
        "voice_status": "done" if has_voice else "idle",
        "merge_status": "done" if (has_final or has_studio) else "idle",
        "polish_status": "done" if has_studio else "idle",
        "clips": [],
        "final": "final_recap.mp4" if has_final else None,
        "final_studio": "final_studio.mp4" if has_studio else None,
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

    try:
        (TOOLS_DIR / "raw.txt").write_bytes(raw_bytes)
    except OSError:
        pass

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

    def on_progress(done: int, total: int) -> None:
        state.update_job(
            job_id,
            progress_recap={"done": done, "total": total, "phase": "chunk_llm"},
        )

    def on_status(status_msg: str) -> None:
        if status_msg.startswith("rate_limited"):
            state.update_job(job_id, recap_status="rate_limited")
        elif status_msg == "refreshing_cookie":
            state.update_job(job_id, recap_status="refreshing_cookie")
        else:
            state.update_job(job_id, recap_status="running")

    try:
        recap = await run_in_threadpool(
            generate_recap,
            job.youtube_url,
            job.raw_bytes,
            job.raw_name or "raw.txt",
            prompt_template_path=PROMPT_PATH,
            progress_callback=on_progress,
            status_callback=on_status,
        )
    except RecapConfigError as error:
        state.update_job(job_id, recap_status="error", error=str(error))
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        state.update_job(job_id, recap_status="error", error=str(error))
        raise HTTPException(status_code=502, detail=str(error)) from error

    state.update_job(job_id, recap_status="done", recap=recap, caption=recap.get("caption"))

    try:
        cap = recap.get("caption") or {}
        recap_title = cap.get("title") or recap.get("title") or ""
        record_job_metadata(
            job_id,
            title=recap_title,
            scenes_count=len(recap.get("scenes", [])),
            caption=cap,
        )
    except Exception:
        pass

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
        polish_status=disk["polish_status"],
        recap=recap,
        caption=recap.get("caption"),
        clips=disk["clips"],
        overspeed=None,  # không suy luận được từ disk
        final=disk["final"],
        final_studio=disk["final_studio"],
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


def delete_job_data(job_id: str) -> bool:
    """Xóa job khỏi memory state và xóa toàn bộ thư mục Downloads/{job_id}/ (DB lịch sử vẫn giữ nguyên)."""
    state.delete_job(job_id)
    try:
        mark_disk_cleaned(job_id)
    except Exception:
        pass
    jdir = job_dir_of(job_id)
    if jdir.exists() and jdir.is_dir():
        shutil.rmtree(jdir, ignore_errors=True)
        return True
    return False



# ── Phase B: cut (per-phase gate + progress) ─────────────────────────────────

def _do_cut(job: JobState) -> None:
    """Sync: tải video gốc (1080p source) về source/video.mp4 (chạy song song với voice)."""
    jdir = job_dir_of(job.job_id)
    jdir.mkdir(parents=True, exist_ok=True)

    state.update_job(job.job_id, progress_cut={"done": 0, "total": 1})
    video = download_video(job.youtube_url, source_dir(job.job_id))
    state.update_job(job.job_id, job_dir=str(jdir), progress_cut={"done": 1, "total": 1})


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
    except Exception as error:  # noqa: BLE001 — bắt mọi lỗi để không stuck cut_status="running"
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
    """Sync: Frame-Accurate Cut & Smart Visual Sync (1 pass duy nhất) -> Concat final_recap.mp4."""
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

        start = max(0.0, float(seg.get("start_time_sec", 0.0) or 0.0))
        end = min(max(start + 0.1, float(seg.get("end_time_sec", start) or start)), source_dur)

        out = segment_path(job.job_id, i)
        # Sử dụng cut_and_mux_segment: Frame-Accurate, Smart Sync, 1 pass duy nhất
        cut_and_mux_segment(source, start, end, vo, out)
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


# ── Phase R5: polish (BGM ducked dưới VO) ────────────────────────────────────

def _do_polish(job: JobState, bgm_paths: list[Path], credits: str, volume: float) -> None:
    """Sync: polish final_recap → final_studio (amix BGM + video copy, 1 pass nhanh).

    Sau khi polish xong, xoá ``final_recap.mp4`` (bản trung gian không BGM) — chỉ giữ
    1 file output khi BGM on. Khi BGM off, polish không chạy → final_recap là output cuối.
    Rehydrate coi merge done khi (final_recap HOẶC final_studio) để xoá không vỡ restart.
    """
    src = final_path(job.job_id)
    if not src.exists() or not src.stat().st_size:
        raise RuntimeError("final_recap.mp4 chưa có — chạy merge trước.")
    out = final_studio_path(job.job_id)

    # Xóa file output rỗng/corrupt từ lần chạy trước bị kill giữa chừng.
    # (FFmpeg ghi header trước rồi mới ghi data → nếu killed sẽ để lại file rỗng ~48 bytes)
    if out.exists() and out.stat().st_size < 10_000:
        try:
            out.unlink()
        except OSError:
            pass

    work = polish_dir(job.job_id)

    def _on_progress(done_sec: float, total_sec: float) -> None:
        state.update_job(
            job.job_id,
            progress_polish={
                "done": round(done_sec, 1),
                "total": max(1.0, round(total_sec, 1)),
                "step": "mix",
            },
        )

    polish_final(
        src,
        out,
        bgm_paths=bgm_paths or None,
        volume=volume,
        work_dir=work,
        progress_cb=_on_progress,
    )
    # Polish xong → xoá final_recap (chỉ còn final_studio). Bỏ qua nếu xoá lỗi (không fatal).
    if out.exists() and out.stat().st_size:
        try:
            src.unlink()
        except OSError:
            pass
    state.update_job(job.job_id, final=None, final_studio=out.name, credits=credits or None)


async def polish(job_id: str, opts: dict) -> JobState:
    """Phase R5 polish — gate: merge_status=done.

    opts = {bgm_paths, credits?, volume?} — cần ít nhất 1 BGM track.
    """
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    if job.merge_status != "done":
        raise HTTPException(
            status_code=400,
            detail=f"Cần merge_done trước khi polish (merge_status={job.merge_status}).",
        )
    bgm_paths = [Path(p) for p in opts.get("bgm_paths", [])]
    if not bgm_paths:
        raise HTTPException(status_code=400, detail="polish: cần ít nhất 1 BGM track.")
    credits = opts.get("credits", "") or ""
    volume = float(opts.get("volume", 0.10))

    state.update_job(
        job_id,
        polish_status="running",
        progress_polish={"done": 0, "total": 0, "step": "mix"},
        polish_opts=opts,
        credits=credits or None,
    )
    try:
        await run_in_threadpool(_do_polish, job, bgm_paths, credits, volume)
    except Exception as error:
        state.update_job(job_id, polish_status="error", error=f"polish: {error}")
        raise HTTPException(status_code=502, detail=str(error)) from error
    state.update_job(
        job_id,
        polish_status="done",
        progress_polish={"done": 1, "total": 1, "step": "done"},
    )
    return state.get_job(job_id)


# ── Phase C: 1-button orchestration ─────────────────────────────────────────

async def run(
    youtube_url: str,
    raw_bytes: bytes | None,
    raw_name: str | None,
    voice_id: str,
    polish_opts: dict | None = None,
) -> str:
    """Trigger toàn bộ pipeline: [fetch transcript] → generate → gather(cut, voice) → merge → [polish].

    Tạo job ngay + trả job_id (HTTP 202); pipeline chạy background asyncio task.
    ``raw_bytes`` None → tự fetch transcript từ YouTube qua Playwright (get_panel).
    ``polish_opts`` không None → chạy R5 polish (BGM) sau khi merge xong.
    """
    youtube_url = youtube_url.strip()
    if not youtube_url:
        raise HTTPException(status_code=400, detail="YouTube URL rỗng.")
    voice_id = voice_id.strip()
    if not voice_id:
        raise HTTPException(status_code=400, detail="voice_id rỗng.")

    job = state.create_job(youtube_url, raw_bytes=raw_bytes, raw_name=raw_name)
    state.update_job(job.job_id, recap_status="running", polish_opts=polish_opts)

    try:
        record_job_start(youtube_url, job.job_id, title=raw_name)
    except Exception:
        pass

    asyncio.create_task(_run_pipeline(job.job_id, voice_id, polish_opts))
    return job.job_id


async def _backup_studio_video_to_drive(video_path: Path) -> None:
    """Upload video thành phẩm Studio vào folder Studio nếu Auto Upload đang bật."""
    from app.externals.gdrive import service as gdrive_service

    cfg = gdrive_service.get_gdrive_config()
    client = gdrive_service.get_client()
    if not (cfg.get("enabled") and cfg.get("auto_upload", True) and client):
        return
    await asyncio.to_thread(
        client.upload_file_resumable,
        file_path=video_path,
        folder_id=gdrive_service.get_workflow_folder_id("studio") or cfg.get("folder_id"),
        custom_name=video_path.name,
    )


async def _run_pipeline(job_id: str, voice_id: str, polish_opts: dict | None = None) -> None:
    """Background task: [fetch transcript] → generate → gather(cut, voice) → merge → [polish].

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
                try:
                    record_job_failed(job_id, f"transcript: {exc}")
                except Exception:
                    pass
                return
            # Nếu transcript là _dom_transcript (từ yt-dlp VTT / DOM scrape) → text "[MM:SS] ..." sạch,
            # lưu thẳng text (chunker parse text format tốt hơn JSON wrap).
            if isinstance(transcript, dict) and "_dom_transcript" in transcript:
                raw_bytes = transcript["_dom_transcript"].encode("utf-8")
            else:
                # Giữ nguyên 100% JSON thô gốc từ YouTube get_panel
                raw_bytes = json.dumps(transcript, ensure_ascii=False, indent=2).encode("utf-8")
            state.update_job(job_id, raw_bytes=raw_bytes, raw_name="raw.txt")
        else:
            # Raw do user đính kèm/dán thủ công → GIỮ NGUYÊN (user controls content, không
            # normalize/mangle). Chỉ ghi ra file raw.txt rồi upload file đó đi.
            raw_bytes = job.raw_bytes

        # Ghi đè vào root raw.txt (TOOLS_DIR / "raw.txt") để sẵn sàng cho bước tiếp theo / inspect.
        try:
            (TOOLS_DIR / "raw.txt").write_bytes(raw_bytes)
        except OSError:
            pass

        # Persist raw ra file Downloads/{job_id}/raw.txt — upload file này đi (không giữ
        # raw lớn trong memory), user có thể inspect lại raw thật sự gửi đi.
        try:
            rp = raw_path(job_id)
            rp.parent.mkdir(parents=True, exist_ok=True)
            rp.write_bytes(raw_bytes)
        except OSError:
            pass  # ghi file fail không fatal — vẫn upload raw_bytes

        # 2a) Pre-check cookie Gemini (nhanh, ~1-2s) — phát hiện sớm cookie hết hạn TRƯỚC
        #     khi gọi Gemini thật sự. Nếu cookie hỏng → tự động refresh Chrome profile.
        #     _ensure_gemini_cookie set recap_status="refreshing_cookie" khi đang refresh
        #     để FE hiển thị rõ "Đang làm mới cookie Gemini..." thay vì treo im lặng.
        cookie_ok = await run_in_threadpool(_ensure_gemini_cookie, job_id)
        if not cookie_ok:
            try:
                record_job_failed(job_id, "Gemini cookie auth fail")
            except Exception:
                pass
            return  # recap_status đã = error (refresh thất bại)

        # 2b) Generate (Gemini) — recap_status error đã set bên trong nếu lỗi.
        try:
            await _generate_for_job(job_id)
        except HTTPException as exc:
            try:
                record_job_failed(job_id, str(exc.detail))
            except Exception:
                pass
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
            err_msg = str(results[0]) if not cut_ok else str(results[1])
            try:
                record_job_failed(job_id, err_msg)
            except Exception:
                pass
            return

        # 4) Cả 2 thành công → merge.
        await merge(job_id)

        # 5) Polish (BGM) nếu có polish_opts.
        if polish_opts:
            await polish(job_id, polish_opts)

        # Upload sau khi video Studio đã hoàn tất; lỗi Drive không làm fail pipeline local.
        try:
            out_video = final_studio_path(job_id) if polish_opts else final_path(job_id)
            if out_video.exists() and out_video.stat().st_size:
                await _backup_studio_video_to_drive(out_video)
        except Exception as drive_error:
            logger.warning("[Studio] Tự động upload Google Drive thất bại: %s", drive_error)

        # 6) Đánh dấu thành công trong History DB
        try:
            out_video = final_studio_path(job_id) if polish_opts else final_path(job_id)
            recap_title = None
            if job.recap:
                recap_title = (job.recap.get("caption") or {}).get("title") or job.recap.get("title")
            record_job_completed(job_id, str(out_video), youtube_url=job.youtube_url, title=recap_title)
        except Exception:
            pass

    except Exception as exc:  # noqa: BLE001
        # Unexpected error thoát ra ngoài gather
        try:
            state.update_job(job_id, polish_status="error", error=f"pipeline: {exc}")
            record_job_failed(job_id, f"pipeline: {exc}")
        except Exception:
            pass


async def resume_pipeline(job_id: str) -> JobState:
    """Tiếp tục pipeline cho job bị gián đoạn hoặc lỗi ở bước Cut / Voice / Merge / Polish."""
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")

    state.update_job(job_id, error=None)

    async def _do_resume():
        j = state.get_job(job_id)
        if not j:
            return

        # 1. Nếu Cut lỗi -> Thử tải lại video
        if j.cut_status == "error":
            try:
                await cut(job_id)
            except Exception:
                return

        # 2. Cập nhật state sau khi Cut xong
        j = state.get_job(job_id)
        if not j:
            return

        # 3. Nếu cả Cut và Voice đều xong mà Merge chưa xong -> Tiếp tục Merge
        if j.cut_status == "done" and j.voice_status == "done" and j.merge_status != "done":
            try:
                await merge(job_id)
            except Exception:
                return

        # 4. Nếu Merge xong và có Polish opts -> Tiếp tục Polish
        j = state.get_job(job_id)
        if not j:
            return
        if j.merge_status == "done" and j.polish_opts and j.polish_status != "done":
            try:
                await polish(job_id, j.polish_opts)
            except Exception:
                return

    asyncio.create_task(_do_resume())
    return state.get_job(job_id)


def publish_job_to_facebook(job_id: str, payload) -> dict:
    """Upload video đã tạo của job lên Pippit Cloud và lên lịch đăng bài cho Facebook Page."""
    from app.externals.pippit import service as pippit_service
    from app.externals.pippit.schemas import PippitPublishRequest

    p_studio = final_studio_path(job_id)
    p_recap = final_path(job_id)

    video_file: Path | None = None
    if p_studio.exists() and p_studio.stat().st_size > 0:
        video_file = p_studio
    elif p_recap.exists() and p_recap.stat().st_size > 0:
        video_file = p_recap

    if not video_file:
        raise HTTPException(
            status_code=400,
            detail="Job này chưa có video thành phẩm (chưa có final_studio.mp4 hoặc final_recap.mp4).",
        )

    req = PippitPublishRequest(
        account_id=payload.account_id,
        page_id=payload.page_id,
        platform=getattr(payload, "platform", "facebook") or "facebook",
        video_path=str(video_file),
        caption=payload.caption,
        title=payload.title,
        when_minutes_ahead=payload.when_minutes_ahead,
        job_id=job_id,
    )
    res = pippit_service.publish_video_to_page(req)
    return res.model_dump() if hasattr(res, "model_dump") else res.dict()


def publish_job_to_youtube(job_id: str, payload) -> dict:
    """Upload video đã tạo của job lên YouTube Channel."""
    from app.externals.youtube import service as yt_service
    from app.externals.youtube.schemas import YouTubePublishRequest

    p_studio = final_studio_path(job_id)
    p_recap = final_path(job_id)

    video_file: Path | None = None
    if p_studio.exists() and p_studio.stat().st_size > 0:
        video_file = p_studio
    elif p_recap.exists() and p_recap.stat().st_size > 0:
        video_file = p_recap

    if not video_file:
        raise HTTPException(
            status_code=400,
            detail="Job này chưa có video thành phẩm (chưa có final_studio.mp4 hoặc final_recap.mp4).",
        )

    schedule_iso = getattr(payload, "schedule_time_iso", None)
    mins = getattr(payload, "when_minutes_ahead", 0) or 0
    if not schedule_iso and mins > 0:
        now_dt = datetime.now(timezone.utc)
        sched_dt = now_dt + timedelta(minutes=mins)
        schedule_iso = sched_dt.isoformat()

    req = YouTubePublishRequest(
        file_path=str(video_file),
        file_name=f"{job_id}_{video_file.name}",
        title=payload.title or f"Video Recap {job_id}",
        description=payload.description or "",
        tags=getattr(payload, "tags", "") or "",
        privacy_status=getattr(payload, "privacy_status", "public") or "public",
        category_id=getattr(payload, "category_id", "22") or "22",
        schedule_time_iso=schedule_iso,
    )
    res = yt_service.publish_single_video(req)
    return res.model_dump() if hasattr(res, "model_dump") else res.dict()


# ── Batch Queue ───────────────────────────────────────────────────────────────

def _batch_overall(job: state.JobState) -> str:
    """Tính overall cho 1 job trong batch — xem job đã hoàn tất chưa."""
    phases = [job.recap_status, job.cut_status, job.voice_status, job.merge_status, job.polish_status]
    if any(p == "error" for p in phases):
        return "error"
    if any(p == "running" for p in phases):
        return "running"
    if job.polish_status == "done":
        return "polished"
    if job.merge_status == "done":
        return "merged"
    return "idle"


async def _run_one_batch_job(
    url: str,
    voice_id: str,
    polish_opts: dict | None,
    batch_id: str | None = None,
    item_index: int | None = None,
) -> tuple[str, str]:
    """Tạo job mới và await pipeline đến khi xong (khác run() là không create_task).

    Trả tuple(job_id, overall) với overall ∈ "merged" | "polished" | "error" | "idle".
    """
    url = url.strip()
    job = state.create_job(url)
    state.update_job(job.job_id, recap_status="running", polish_opts=polish_opts)
    try:
        record_job_start(url, job.job_id)
    except Exception:
        pass
    if batch_id and item_index is not None:
        try:
            state.update_batch_item(batch_id, item_index, job_id=job.job_id, status="running")
        except KeyError:
            pass

    # AWAIT trực tiếp (không asyncio.create_task) — đảm bảo sequential trong batch
    await _run_pipeline(job.job_id, voice_id, polish_opts)

    job_final = state.get_job(job.job_id)
    if job_final is None:
        return job.job_id, "error"
    return job.job_id, _batch_overall(job_final)


async def _run_batch_worker(batch_id: str) -> None:
    """Background worker: chạy từng item trong batch tuần tự.

    Logic retry: mỗi item được thử tối đa 2 lần (lần đầu + 1 retry).
    Nếu item vẫn lỗi sau retry → set batch status="stopped", dừng queue.
    Nếu user gọi DELETE /batch/{id} → stop_requested=True → dừng sau job hiện tại.
    """
    batch = state.get_batch(batch_id)
    if batch is None:
        return

    state.update_batch(batch_id, status="running")

    for i, item in enumerate(batch.items):
        # Kiểm tra soft-cancel từ user
        batch = state.get_batch(batch_id)
        if batch is None or batch.stop_requested:
            # Đánh dấu các item còn lại là skipped
            for j in range(i, len(batch.items if batch else [])):
                state.update_batch_item(batch_id, j, status="skipped")
            state.update_batch(batch_id, status="stopped")
            return

        state.update_batch(batch_id, current_index=i)
        state.update_batch_item(batch_id, i, status="running")

        # Lần 1
        job_id, overall = await _run_one_batch_job(
            url=item.url,
            voice_id=batch.voice_id,
            polish_opts=batch.polish_opts,
            batch_id=batch_id,
            item_index=i,
        )

        if overall in ("merged", "polished"):
            state.update_batch_item(batch_id, i, status="done", job_id=job_id)
            if i < len(batch.items) - 1 and not batch.stop_requested:
                print(f"[Batch {batch_id}] Item {i+1}/{len(batch.items)} hoàn tất. Nghỉ an toàn 10s trước video kế tiếp...")
                await asyncio.sleep(10)
            continue

        # Lỗi lần 1 → nghỉ 15s trước khi retry
        job_fail = state.get_job(job_id)
        err_msg = (job_fail.error if job_fail else None) or "Pipeline error"
        print(f"[Batch {batch_id}] Item {i} lỗi lần 1 ({err_msg}). Tạm dừng 15s trước khi retry...")
        await asyncio.sleep(15)
        state.update_batch_item(batch_id, i, retry_count=1, status="running", error=None)

        job_id, overall = await _run_one_batch_job(
            url=item.url,
            voice_id=batch.voice_id,
            polish_opts=batch.polish_opts,
            batch_id=batch_id,
            item_index=i,
        )

        if overall in ("merged", "polished"):
            state.update_batch_item(batch_id, i, status="done", job_id=job_id)
            if i < len(batch.items) - 1 and not batch.stop_requested:
                print(f"[Batch {batch_id}] Item {i+1}/{len(batch.items)} hoàn tất sau retry. Nghỉ an toàn 10s trước video kế tiếp...")
                await asyncio.sleep(10)
            continue

        # Lỗi lần 2 → dừng queue
        job_fail = state.get_job(job_id)
        err_msg = (job_fail.error if job_fail else None) or "Pipeline error (retry)"
        print(f"[Batch {batch_id}] Item {i} lỗi sau retry. Dừng queue.")
        state.update_batch_item(
            batch_id, i,
            status="error",
            job_id=job_id,
            error=err_msg,
        )
        # Đánh dấu các item còn lại là skipped
        for j in range(i + 1, len(batch.items)):
            state.update_batch_item(batch_id, j, status="skipped")
        state.update_batch(batch_id, status="stopped")
        return

    # Đã xử lý hết tất cả item mà không bị dừng
    state.update_batch(batch_id, status="done")


async def run_batch(
    urls: list[str],
    voice_id: str,
    polish_opts: dict | None = None,
) -> str:
    """Tạo batch queue và kick off worker. Trả batch_id ngay (HTTP 202).

    - urls: tối thiểu 1, tối đa 10 YouTube URLs
    - voice_id: voice dùng cho TTS toàn bộ batch
    - polish_opts: cấu hình BGM (dùng chung cho tất cả job trong batch)
    """
    if not urls:
        raise HTTPException(status_code=400, detail="Cần ít nhất 1 URL.")
    if len(urls) > 10:
        raise HTTPException(status_code=400, detail="Batch tối đa 10 URL.")
    if not voice_id.strip():
        raise HTTPException(status_code=400, detail="voice_id rỗng.")

    # Loại bỏ URL rỗng và duplicate, giữ thứ tự
    seen: set[str] = set()
    clean_urls: list[str] = []
    for url in urls:
        url = url.strip()
        if url and url not in seen:
            clean_urls.append(url)
            seen.add(url)

    if not clean_urls:
        raise HTTPException(status_code=400, detail="Không có URL hợp lệ nào.")

    batch = state.create_batch(clean_urls, voice_id.strip(), polish_opts)
    try:
        record_batch_queue(clean_urls)
    except Exception:
        pass
    asyncio.create_task(_run_batch_worker(batch.batch_id))
    return batch.batch_id
