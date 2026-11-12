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
import logging
import os
import re
import shutil
import time
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from app.core.config import TOOLS_DIR
from app.ai.gemini.recap import (
    RecapConfigError,
    _auto_refresh_cookies,
    check_cookie_state,
    generate_recap,
)
from app.discover.history import (
    mark_disk_cleaned,
    record_batch_queue,
    record_job_completed,
    record_job_failed,
    record_job_metadata,
    record_job_start,
)
from app.recap import state, timing
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
    job_meta_path,
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

logger = logging.getLogger(__name__)

PROMPT_PATH = TOOLS_DIR / "Backend" / "prompts" / "recap" / "food_review_chunk.prompt.txt"


# ── Cookie pre-check helper ───────────────────────────────────────────────────

def _set_cookie_step(job_id: str, text: str | None) -> None:
    """Báo bước đang làm khi lấy lại cookie (hiện ở node Recap: "Mở Chrome…", "Chờ đăng nhập (còn 40s)").

    ``text=None`` → xoá bước. Lưu trong ``progress_recap`` ({phase: "cookie", step: ...}) — không đổi schema."""
    job = state.get_job(job_id)
    if job is None:
        return
    prog = dict(job.progress_recap or {})
    if text:
        prog["phase"], prog["step"] = "cookie", text
    else:
        prog.pop("step", None)
        if prog.get("phase") == "cookie":
            prog["phase"] = "chunk_llm"
    state.update_job(job_id, progress_recap=prog)


def _ensure_gemini_cookie(job_id: str) -> bool:
    """Kiểm tra cookie Gemini còn hạn bằng cách GET /app. Nếu fail → tự động refresh.

    Cập nhật ``recap_status="refreshing_cookie"`` trong job state để FE hiển thị
    trạng thái rõ ràng (“Đang làm mới cookie...”) thay vì bị chặn im lặng.
    Trả ``True`` nếu cookie OK (hoặc refresh thành công), ``False`` nếu refresh thất bại
    (khi đó ``recap_status`` được set “error” kèm message rõ).

    Gọ vào _run_pipeline TRƯỚC bước generate Gemini để phát hiện sớm cookie hết hạn,
    tránh lãng phí thời gian yt-dlp đang tải video rồi mới báo lỗi recap.
    """
    try:
        cookie_state = check_cookie_state()
    except Exception as exc:
        # Chưa có cookie / inner_template → báo rõ thay vì khởng chết
        state.update_job(job_id, recap_status="error", error=str(exc))
        return False

    if cookie_state == "ok":
        return True
    if cookie_state == "network":
        # Lỗi mạng KHÔNG phải cookie hỏng: không mở Chrome (tốn phút, vô ích). Cứ chạy tiếp —
        # bước generate có retry mạng riêng và báo lỗi mạng rõ ràng nếu vẫn không được.
        print("[Gemini] Pre-check cookie gặp lỗi mạng (không phải cookie hết hạn) → bỏ qua refresh, tiếp tục.", flush=True)
        return True

    # cookie_state == "auth": Google trả trang không có token → cookie thật sự hết hạn → cập nhật trạng thái và refresh
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
        _auto_refresh_cookies(lambda text: _set_cookie_step(job_id, text))
        _set_cookie_step(job_id, None)
        _log("[Gemini] Làm mới cookie thành công. Tiếp tục pipeline...")
        # Đặt lại trạng thái → running (generate bước sau sẽ set đúng)
        state.update_job(job_id, recap_status="running")
        return True
    except Exception as refresh_err:
        _set_cookie_step(job_id, None)
        refresh_msg = getattr(refresh_err, "detail", None) or refresh_err  # HTTPException → lấy detail
        state.update_job(
            job_id,
            recap_status="error",
            error=(
                f"Cookie Gemini hết hạn và tự động làm mới thất bại: {refresh_msg}. "
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
    # TTS theo lô: voice chỉ "done" khi MỌI đoạn đã có file (có voice_0 thôi = mới xong lô đầu).
    has_voice = n_segs > 0 and all(_voice_ready(job_id, i) for i in range(n_segs))
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

    # Đo chi tiết Gemini: giây/chunk (đã gồm retry + chờ rate-limit), tổng giây chờ 429, giây refresh cookie.
    acc: dict = {"chunks": [], "rate_limit_wait_sec": 0, "cookie_refresh_sec": 0.0, "network_retries": 0}
    mark: dict = {"t": time.perf_counter(), "cookie_t0": None}

    def on_progress(done: int, total: int) -> None:
        state.update_job(
            job_id,
            progress_recap={"done": done, "total": total, "phase": "chunk_llm"},
        )
        now = time.perf_counter()
        acc["chunks"].append(round(now - mark["t"], 1))
        mark["t"] = now
        timing.set_detail(job_id, "gemini", **acc)

    def on_status(status_msg: str) -> None:
        if status_msg.startswith("rate_limited"):
            state.update_job(job_id, recap_status="rate_limited")
            try:
                acc["rate_limit_wait_sec"] += int(status_msg.split(":", 1)[1])
            except (IndexError, ValueError):
                pass
            timing.set_detail(job_id, "gemini", **acc)
        elif status_msg == "network_retry":
            acc["network_retries"] += 1  # lỗi mạng thoáng qua được thử lại; recap_status giữ nguyên
            timing.set_detail(job_id, "gemini", **acc)
        elif status_msg.startswith("cookie_step:"):
            _set_cookie_step(job_id, status_msg.split(":", 1)[1])
        elif status_msg == "refreshing_cookie":
            state.update_job(job_id, recap_status="refreshing_cookie")
            mark["cookie_t0"] = time.perf_counter()
        else:
            state.update_job(job_id, recap_status="running")
            if mark["cookie_t0"] is not None:
                _set_cookie_step(job_id, None)
                acc["cookie_refresh_sec"] = round(acc["cookie_refresh_sec"] + time.perf_counter() - mark["cookie_t0"], 1)
                mark["cookie_t0"] = None
                timing.set_detail(job_id, "gemini", **acc)

    try:
        with timing.timed(job_id, "gemini"):
            recap = await run_in_threadpool(
                generate_recap,
                job.youtube_url,
                job.raw_bytes,
                job.raw_name or "raw.txt",
                prompt_template_path=PROMPT_PATH,
                progress_callback=on_progress,
                status_callback=on_status,
            )
        # Phần còn lại sau chunk cuối = ghép scenes + sinh caption/hashtag.
        g_dur = (state.get_job(job_id).timings.get("gemini") or {}).get("duration_sec")
        if g_dur is not None:
            timing.set_detail(job_id, "gemini", tail_sec=round(max(0.0, g_dur - sum(acc["chunks"])), 1))
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

INTERRUPTED_MSG = "Job bị gián đoạn (server khởi động lại) — bấm Thử lại để chạy tiếp từ bước đang dở."


def _persist_job_meta(job: JobState) -> None:
    """Ghi job.json (url, giọng, BGM, giờ tạo) ngay khi tạo job.

    Nhờ đó job sống sót qua restart server: ``rehydrate`` dựng lại được kể cả khi chưa có recap.json
    (job đang ở bước transcript/Gemini) và nút Thử lại chạy tiếp được thay vì mất sạch."""
    try:
        p = job_meta_path(job.job_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            json.dumps(
                {
                    "youtube_url": job.youtube_url,
                    "voice_id": job.voice_id,
                    "polish_opts": job.polish_opts,
                    "raw_name": job.raw_name,
                    "created_at": job.created_at.isoformat(),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    except OSError:
        pass  # không ghi được thì job chỉ mất khả năng sống sót qua restart, pipeline vẫn chạy bình thường


def _load_job_meta(job_id: str) -> dict:
    try:
        data = json.loads(job_meta_path(job_id).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _mark_interrupted(job: JobState) -> None:
    """Job dựng lại sau restart mà chưa có video thành phẩm = bị GIÁN ĐOẠN.

    Phase đầu tiên chưa xong → ``error`` + thông báo, để giao diện dừng "đang chạy" ảo và hiện nút Thử lại
    (``resume_pipeline`` đặt lại phase error rồi chạy tiếp từ đó). Đã có video (merge done) thì chỉ còn
    polish có thể dở; job cũ đã hoàn tất không bị đụng tới."""
    if job.merge_status == "done":
        first = "polish_status" if (job.polish_opts and job.polish_status != "done") else None
    elif job.recap is None:
        first = "recap_status"
    elif job.cut_status != "done":
        first = "cut_status"
    elif job.voice_status != "done":
        first = "voice_status"
    else:
        first = "merge_status"
    if first is None:
        return
    setattr(job, first, "error")
    job.error = INTERRUPTED_MSG


def rehydrate(job_id: str) -> JobState | None:
    """Dựng lại JobState từ Downloads/{job_id}/ (job.json + recap.json + file trên đĩa).

    Mỗi phase suy luận độc lập từ file output. Chưa có recap.json nhưng có job.json = job chết giữa transcript/
    Gemini: dựng lại với recap_status "idle" (raw.txt nạp lại nếu có để khỏi fetch lại). Job chưa xong được
    đánh dấu bị gián đoạn (``_mark_interrupted``)."""
    meta = _load_job_meta(job_id)
    recap: dict | None = None
    rp = recap_path(job_id)
    if rp.exists():
        try:
            recap = json.loads(rp.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
    elif not meta:
        return None

    n = len(_segments_flat(recap)) if recap else 0
    disk = _status_from_disk(job_id, n)

    # youtube_url: ưu tiên field được ghi khi generate, rồi job.json, fallback regex.
    url = str((recap or {}).get("youtube_url") or (recap or {}).get("video_url") or meta.get("youtube_url") or "")
    m = re.search(r"https?://[^\s\)\]]+watch\?v=[\w-]+", url)
    youtube_url = m.group(0) if m else url

    # created_at: từ recap.json / job.json nếu có, fallback now (không mất thông tin lịch sử).
    created_at_str = (recap or {}).get("created_at") or meta.get("created_at")
    try:
        created_at = datetime.fromisoformat(created_at_str) if created_at_str else None
    except (ValueError, TypeError):
        created_at = None

    raw_bytes = None
    try:
        rawp = raw_path(job_id)
        if rawp.exists():
            raw_bytes = rawp.read_bytes() or None
    except OSError:
        raw_bytes = None

    job = JobState(
        job_id=job_id,
        youtube_url=youtube_url,
        recap_status="done" if recap else "idle",
        cut_status=disk["cut_status"],
        voice_status=disk["voice_status"],
        merge_status=disk["merge_status"],
        polish_status=disk["polish_status"],
        recap=recap,
        caption=(recap or {}).get("caption"),
        clips=disk["clips"],
        overspeed=None,  # không suy luận được từ disk
        final=disk["final"],
        final_studio=disk["final_studio"],
        job_dir=str(job_dir_of(job_id)),
        timings=timing.load(job_id),
        voice_id=meta.get("voice_id"),
        polish_opts=meta.get("polish_opts"),
        raw_bytes=raw_bytes,
        raw_name="raw.txt" if raw_bytes else meta.get("raw_name"),
    )
    if created_at:
        job.created_at = created_at
    _mark_interrupted(job)
    state._JOBS[job_id] = job
    return job


def list_disk_jobs() -> list[str]:
    """Scan Downloads/ lấy các job_id có recap.json hoặc job.json (chưa có trong memory)."""
    if not DOWNLOADS_DIR.exists():
        return []
    out: list[str] = []
    for p in sorted(DOWNLOADS_DIR.iterdir(), reverse=True):
        if p.is_dir() and ((p / "recap.json").exists() or (p / "job.json").exists()) and p.name not in state._JOBS:
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
        with timing.timed(job_id, "cut"):
            await run_in_threadpool(_do_cut, job)
    except Exception as error:  # noqa: BLE001 — bắt mọi lỗi để không stuck cut_status="running"
        state.update_job(job_id, cut_status="error", error=f"cut: {error}")
        raise HTTPException(status_code=502, detail=str(error)) from error
    state.update_job(job_id, cut_status="done")
    return state.get_job(job_id)


# ── Phase B: voice (TTS theo lô — mỗi lô xong là lưu ngay, resume được) ──────

# CPU: thời gian TTS tuyến tính theo số đoạn (không có lợi thế batch) → lô nhỏ để merge bắt đầu sớm
# và khi lỗi/restart chỉ mất tối đa 1 lô thay vì toàn bộ.
VOICE_BATCH_SIZE = 8


def _voice_ready(job_id: str, idx: int) -> bool:
    p = voice_path(job_id, idx)
    return p.exists() and p.stat().st_size > 0


def _write_atomic(path: Path, data: bytes) -> None:
    """Ghi file rồi đổi tên → luồng merge chạy song song không bao giờ thấy file dang dở."""
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _do_voice_batch(job: JobState, batch_segs: list[dict], start: int, zip_bytes: bytes) -> list[int]:
    """Sync: giải nén zip của 1 lô → voice_{start+k}.wav. Không atempo (giọng tự nhiên).

    Trả list idx TOÀN CỤC low-coverage (voice_dur < 70% target).
    """
    voice_dir(job.job_id).mkdir(parents=True, exist_ok=True)

    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    manifest = json.loads(zf.read("manifest.json"))
    dur_map = {int(it["index"]): float(it["duration"]) for it in manifest.get("items", [])}

    low_coverage_idx: list[int] = []
    for k, seg in enumerate(batch_segs):
        i = start + k
        if not _voice_ready(job.job_id, i):
            _write_atomic(voice_path(job.job_id, i), zf.read(f"vo_{k}.wav"))
        tts_dur = dur_map.get(k, 0.0)
        target = float(seg.get("duration_sec", 0.0) or 0.0)
        if target > 0 and 0 < tts_dur < target * 0.7:
            low_coverage_idx.append(i)
    return low_coverage_idx


async def voice(job_id: str, voice_id: str) -> JobState:
    """Phase voice — gate: recap_status=done (KHÔNG phụ thuộc cut, song song được).

    TTS theo lô ``VOICE_BATCH_SIZE`` đoạn; mỗi lô xong ghi file ngay nên:
    - merge (chạy chồng) ghép được đoạn nào có giọng mà không đợi hết TTS;
    - lỗi/restart giữa chừng chỉ mất lô đang chạy; chạy lại bỏ qua lô đã có file.
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

    n = len(segs)
    state.update_job(
        job_id,
        voice_status="running",
        voice_id=voice_id,
        progress_voice={"done": sum(1 for i in range(n) if _voice_ready(job_id, i)), "total": n, "phase": "tts"},
    )

    timing.begin(job_id, "voice")
    overspeed: list[int] = []
    tts_sec = unpack_sec = 0.0
    ran = skipped = 0
    try:
        for start in range(0, n, VOICE_BATCH_SIZE):
            end = min(start + VOICE_BATCH_SIZE, n)
            if all(_voice_ready(job_id, i) for i in range(start, end)):
                skipped += 1  # lô đã có trên đĩa (resume) → không TTS lại
            else:
                t0 = time.perf_counter()
                zip_bytes = await voice_client.tts_batch(items[start:end], voice_id)
                t1 = time.perf_counter()
                low = await run_in_threadpool(_do_voice_batch, job, segs[start:end], start, zip_bytes)
                tts_sec += t1 - t0
                unpack_sec += time.perf_counter() - t1
                overspeed.extend(low)
                ran += 1
            state.update_job(
                job_id,
                progress_voice={"done": end, "total": n, "phase": "tts"},
                overspeed=list(overspeed),
            )
            timing.set_detail(
                job_id, "voice",
                tts_sec=round(tts_sec, 1), unpack_sec=round(unpack_sec, 1),
                batches=ran + skipped, resumed_batches=skipped,
            )
    except Exception as error:  # noqa: BLE001 — mọi lỗi TTS/giải nén đều phải chuyển voice_status sang error
        timing.finish(job_id, "voice", ok=False)
        state.update_job(job_id, voice_status="error", error=f"voice: {error}")
        raise HTTPException(status_code=502, detail=str(error)) from error

    timing.finish(job_id, "voice")
    state.update_job(job_id, voice_status="done", overspeed=overspeed)
    return state.get_job(job_id)


# ── Phase B: merge (gate: cut_done AND voice_done; hoặc chạy chồng lên voice qua _merge_stream) ─────

def _merge_source(job_id: str) -> tuple[Path, float]:
    source = video_path(job_id)
    if not source.exists() or not source.stat().st_size:
        raise RuntimeError("source/video.mp4 chưa có — chạy cut trước.")
    source_dur = ffprobe_duration(source)
    if source_dur <= 0:
        raise RuntimeError(f"Không đo được duration source video: {source}")
    return source, source_dur


# Merge chạy chồng lên TTS: TTS mới là bước nằm trên đường găng (merge nhanh gấp ~2 lần TTS nên không cần chạy
# hết tốc lực). Đo thực tế: ffmpeg full luồng làm TTS chậm ×1.31 → chạy chồng không lợi. Hạn chế luồng + ưu tiên thấp.
MERGE_THROTTLE_THREADS = 3
# Máy ít nhân: TTS và ffmpeg tranh CPU nặng hơn (chưa đo trên máy yếu) → mặc định chỉ chồng khi ≥ 8 luồng CPU.
OVERLAP_MIN_CPUS = 8


def _overlap_enabled() -> bool:
    """Có cho merge chạy chồng lên TTS không. ``RECAP_OVERLAP_MERGE=1|0`` ép bật/tắt; mặc định theo số luồng CPU."""
    forced = os.environ.get("RECAP_OVERLAP_MERGE", "").strip()
    if forced in ("0", "1"):
        return forced == "1"
    return (os.cpu_count() or 1) >= OVERLAP_MIN_CPUS


def _merge_one_segment(
    job_id: str, i: int, seg: dict, source: Path, source_dur: float, throttle: bool = False
) -> float:
    """Frame-accurate cut + mux đoạn i → seg_i.mp4 (bỏ qua nếu đã có). Trả số giây ffmpeg đã tốn.

    ``throttle=True``: TTS đang chạy → ffmpeg ít luồng + ưu tiên thấp để không giành CPU của TTS."""
    vo = voice_path(job_id, i)
    if not _voice_ready(job_id, i):
        raise RuntimeError(f"voice/voice_{i}.wav chưa có — chạy voice trước.")

    # Kẹp start để Gemini chọn mốc vượt độ dài video không làm ffmpeg ra 0 frame.
    start = min(max(0.0, float(seg.get("start_time_sec", 0.0) or 0.0)), max(0.0, source_dur - 0.2))
    end = min(max(start + 0.1, float(seg.get("end_time_sec", start) or start)), source_dur)

    t0 = time.perf_counter()
    # cut_and_mux_segment: 1 pass; VO dài hơn khung thì kéo dài hình theo VO.
    cut_and_mux_segment(
        source, start, end, vo, segment_path(job_id, i),
        threads=MERGE_THROTTLE_THREADS if throttle else None, low_priority=throttle,
    )
    return time.perf_counter() - t0


def _concat_all(job_id: str, n: int) -> None:
    final = final_path(job_id)
    concat_segments([segment_path(job_id, i) for i in range(n)], final, merge_dir(job_id))
    state.update_job(job_id, final=final.name)


def _do_merge(job: JobState, segs: list[dict]) -> float:
    """Sync (merge độc lập, cut + voice đã xong): ghép từng đoạn rồi concat final_recap.mp4. Trả giây ffmpeg."""
    merge_dir(job.job_id).mkdir(parents=True, exist_ok=True)
    source, source_dur = _merge_source(job.job_id)
    state.update_job(job.job_id, progress_merge={"done": 0, "total": len(segs)})

    ffmpeg_sec = 0.0
    for i, seg in enumerate(segs):
        ffmpeg_sec += _merge_one_segment(job.job_id, i, seg, source, source_dur)
        state.update_job(job.job_id, progress_merge={"done": i + 1, "total": len(segs)})

    _concat_all(job.job_id, len(segs))
    return ffmpeg_sec


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
        with timing.timed(job_id, "merge"):
            ffmpeg_sec = await run_in_threadpool(_do_merge, job, segs)
        timing.set_detail(job_id, "merge", segments=len(segs), ffmpeg_sec=round(ffmpeg_sec, 1))
    except Exception as error:  # noqa: BLE001 — gồm subprocess.TimeoutExpired, không chỉ RuntimeError
        state.update_job(job_id, merge_status="error", error=f"merge: {error}")
        raise HTTPException(status_code=502, detail=str(error)) from error
    state.update_job(job_id, merge_status="done")
    return state.get_job(job_id)


class _MergeAborted(Exception):
    """Cut/voice thất bại nên không thể ghép tiếp (lỗi thật đã nằm ở phase đó)."""


async def _merge_stream(job_id: str, cut_task: "asyncio.Future | None", voice_task: "asyncio.Future | None") -> None:
    """Merge CHỒNG lên voice: ghép đoạn i ngay khi ``voice_i.wav`` có, không đợi hết TTS.

    Phụ thuộc theo từng đoạn: đoạn i cần (1) video gốc tải xong, (2) voice_i, (3) mốc start/end từ Gemini.
    Concat cuối cùng đợi đủ mọi đoạn. ``cut_task``/``voice_task`` là task đang chạy (None = đã xong từ trước).
    Cut/voice lỗi → dừng êm (merge_status về idle), để lỗi thật hiển thị ở phase đó; lỗi ffmpeg → merge error.
    """
    job = state.get_job(job_id)
    if job is None:
        return
    segs = _segments_flat(job.recap or {})
    n = len(segs)
    if n == 0:
        raise HTTPException(status_code=400, detail="Recap không có segment nào.")

    # (1) Chờ video gốc: không có nó thì chưa cắt được đoạn nào (tải 30–60s, ngắn hơn TTS lô đầu).
    if cut_task is not None:
        await asyncio.wait([cut_task])
        if cut_task.cancelled() or cut_task.exception() is not None:
            return
    elif job.cut_status != "done":
        return

    started = False
    ffmpeg_sec = 0.0
    try:
        merge_dir(job_id).mkdir(parents=True, exist_ok=True)
        source, source_dur = await run_in_threadpool(_merge_source, job_id)
        for i, seg in enumerate(segs):
            # (2) Chờ giọng đoạn i. voice task đã kết thúc mà vẫn thiếu file = TTS lỗi → dừng.
            while not _voice_ready(job_id, i):
                if voice_task is None or voice_task.done():
                    if _voice_ready(job_id, i):
                        break
                    raise _MergeAborted()
                await asyncio.sleep(0.3)
            if not started:
                started = True
                state.update_job(job_id, merge_status="running", progress_merge={"done": 0, "total": n})
                timing.begin(job_id, "merge")
            # TTS còn chạy → nhường CPU (ít luồng, ưu tiên thấp); TTS xong → chạy hết tốc lực cho các đoạn còn lại.
            throttle = voice_task is not None and not voice_task.done()
            ffmpeg_sec += await run_in_threadpool(_merge_one_segment, job_id, i, seg, source, source_dur, throttle)
            state.update_job(job_id, progress_merge={"done": i + 1, "total": n})
        await run_in_threadpool(_concat_all, job_id, n)
    except _MergeAborted:
        if started:
            timing.finish(job_id, "merge", ok=False)
        state.update_job(job_id, merge_status="idle")
        return
    except Exception as error:  # noqa: BLE001 — gồm subprocess.TimeoutExpired
        if started:
            timing.finish(job_id, "merge", ok=False)
        state.update_job(job_id, merge_status="error", error=f"merge: {error}")
        raise HTTPException(status_code=502, detail=str(error)) from error

    timing.finish(job_id, "merge")
    timing.set_detail(job_id, "merge", segments=n, ffmpeg_sec=round(ffmpeg_sec, 1))
    state.update_job(job_id, merge_status="done")


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
        with timing.timed(job_id, "polish"):
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
    # Lưu voice_id ngay để resume sau lỗi recap/transcript vẫn biết giọng đã chọn.
    state.update_job(job.job_id, recap_status="running", polish_opts=polish_opts, voice_id=voice_id)
    _persist_job_meta(state.get_job(job.job_id))

    try:
        record_job_start(youtube_url, job.job_id, title=raw_name)
    except Exception:
        pass

    asyncio.create_task(_run_pipeline(job.job_id, voice_id, polish_opts))
    return job.job_id


async def _backup_studio_video_to_drive(video_path: Path, job_id: str) -> None:
    """Upload video thành phẩm Studio vào folder Studio nếu Auto Upload đang bật."""
    from app.externals.gdrive import service as gdrive_service

    cfg = gdrive_service.get_gdrive_config()
    client = gdrive_service.get_client()
    if not (cfg.get("enabled") and cfg.get("auto_upload", True) and client):
        return
    with timing.timed(job_id, "drive"):
        await asyncio.to_thread(
            client.upload_file_resumable,
            file_path=video_path,
            folder_id=gdrive_service.get_workflow_folder_id("studio") or cfg.get("folder_id"),
            custom_name=video_path.name,
        )


# Job_id → asyncio.Task của pipeline đang chạy (chống resume song song + biết job còn sống không).
_ACTIVE: dict[str, "asyncio.Task | None"] = {}

# Trạng thái phase coi là "chưa xong" khi resume (kể cả kẹt running do task đã chết).
_RESETTABLE = ("error", "running", "rate_limited", "refreshing_cookie")


def _is_active(job_id: str) -> bool:
    task = _ACTIVE.get(job_id)
    return task is not None and not task.done()


async def _stage_recap(job_id: str) -> bool:
    """Giai đoạn 1+2: [fetch transcript] → pre-check cookie Gemini → generate recap.

    Trả True nếu recap xong. False nếu lỗi (``recap_status`` đã = error + History đã ghi).
    Idempotent: ``raw_bytes`` đã có (user dán, hoặc lần chạy trước đã fetch) thì không fetch lại.
    """
    job = state.get_job(job_id)
    if job is None:
        return False

    # 1) Fetch transcript nếu chưa có raw_bytes (auto từ YouTube).
    if not job.raw_bytes:
        try:
            with timing.timed(job_id, "transcript"):
                transcript = await run_in_threadpool(fetch_transcript_raw, job.youtube_url)
        except Exception as exc:  # noqa: BLE001
            state.update_job(job_id, recap_status="error", error=f"transcript: {exc}")
            try:
                record_job_failed(job_id, f"transcript: {exc}")
            except Exception:
                pass
            return False
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

    # Persist raw ra file Downloads/{job_id}/raw.txt — user có thể inspect lại raw thật sự gửi đi.
    try:
        rp = raw_path(job_id)
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_bytes(raw_bytes)
    except OSError:
        pass  # ghi file fail không fatal — vẫn upload raw_bytes

    # 2a) Pre-check cookie Gemini (nhanh, ~1-2s) — phát hiện sớm cookie hết hạn TRƯỚC khi gọi
    #     Gemini thật sự. Cookie hỏng → tự refresh Chrome profile (recap_status="refreshing_cookie").
    with timing.timed(job_id, "cookie_check"):
        cookie_ok = await run_in_threadpool(_ensure_gemini_cookie, job_id)
    if not cookie_ok:
        try:
            record_job_failed(job_id, "Gemini cookie auth fail")
        except Exception:
            pass
        return False  # recap_status đã = error (refresh thất bại)

    # 2b) Generate (Gemini) — recap_status error đã set bên trong nếu lỗi.
    try:
        await _generate_for_job(job_id)
    except HTTPException as exc:
        try:
            record_job_failed(job_id, str(exc.detail))
        except Exception:
            pass
        return False  # recap_status đã = error
    return True


async def _run_pipeline(job_id: str, voice_id: str, polish_opts: dict | None = None) -> None:
    """Chạy pipeline và đăng ký job là "đang chạy" để resume không chạy chồng."""
    _ACTIVE[job_id] = asyncio.current_task()
    try:
        await _run_pipeline_stages(job_id, voice_id, polish_opts)
    finally:
        _ACTIVE.pop(job_id, None)


async def _run_pipeline_stages(job_id: str, voice_id: str, polish_opts: dict | None = None) -> None:
    """[recap] → gather(cut, voice) → merge → [polish] → Drive/History.

    Mỗi giai đoạn chỉ chạy nếu chưa ``done`` → cùng hàm này phục vụ cả chạy mới lẫn resume
    (job mới thì mọi phase đều chưa done nên chạy đủ).
    return_exceptions=True: HTTPException trong gather thành value, không cancel sibling.
    Phase error được set bên trong từng phase trước khi raise → state luôn consistent.
    """
    try:
        job = state.get_job(job_id)
        if job is None:
            return

        # 1+2) Transcript + Gemini recap.
        if job.recap_status != "done" or not job.recap:
            if not await _stage_recap(job_id):
                return

        # 3+4) Cut + Voice + Merge chạy CHỒNG: video tải song song với TTS, và merge ghép từng đoạn
        #      ngay khi giọng đoạn đó có (không đợi hết TTS). Chỉ chạy phase chưa xong (resume).
        cut_t = asyncio.ensure_future(cut(job_id)) if job.cut_status != "done" else None
        voice_t = asyncio.ensure_future(voice(job_id, voice_id)) if job.voice_status != "done" else None
        if cut_t is not None or voice_t is not None:
            # Máy yếu (ít nhân) → không chồng: merge chạy sau cùng ở bước 4b, hết tốc lực.
            merge_t = (
                asyncio.ensure_future(_merge_stream(job_id, cut_t, voice_t))
                if job.merge_status != "done" and _overlap_enabled()
                else None
            )
            named = [(n, t) for n, t in (("cut", cut_t), ("voice", voice_t), ("merge", merge_t)) if t is not None]
            results = await asyncio.gather(*(t for _, t in named), return_exceptions=True)
            by_name = {n: r for (n, _), r in zip(named, results)}
            failed = [(n, by_name[n]) for n in ("cut", "voice") if isinstance(by_name.get(n), Exception)]
            if failed:
                # Ít nhất 1 phase fail → không đi tiếp; phase đã set error status.
                name, res = failed[0]
                err_msg = f"{name}: {getattr(res, 'detail', None) or res}"
                try:
                    record_job_failed(job_id, err_msg)
                except Exception:
                    pass
                return
            if isinstance(by_name.get("merge"), Exception):
                raise by_name["merge"]  # merge đã set error + message riêng; except ngoài giữ nguyên

        # 4b) Merge độc lập: cut + voice đã xong từ trước nhưng chưa ghép (resume), hoặc luồng chồng chưa hoàn tất.
        if job.merge_status != "done":
            await merge(job_id)

        # 5) Polish (BGM) nếu có polish_opts.
        if polish_opts and job.polish_status != "done":
            await polish(job_id, polish_opts)

        # Video thành phẩm đã sẵn sàng → chốt tổng thời gian (chưa tính upload Drive bên dưới).
        timing.record_total(job_id)

        # Upload sau khi video Studio đã hoàn tất; lỗi Drive không làm fail pipeline local.
        try:
            out_video = final_studio_path(job_id) if polish_opts else final_path(job_id)
            if out_video.exists() and out_video.stat().st_size:
                await _backup_studio_video_to_drive(out_video, job_id)
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
        # Lỗi ngoài dự kiến (hoặc HTTPException từ merge/polish). Phase gây lỗi đã tự set
        # "error" + message riêng → giữ nguyên; chỉ gán lỗi chung khi chưa phase nào báo lỗi.
        try:
            j = state.get_job(job_id)
            phases = [j.recap_status, j.cut_status, j.voice_status, j.merge_status, j.polish_status] if j else []
            if not any(p == "error" for p in phases):
                state.update_job(job_id, polish_status="error", error=f"pipeline: {exc}")
            record_job_failed(job_id, (j.error if j and j.error else None) or f"pipeline: {exc}")
        except Exception:
            pass


async def resume_pipeline(job_id: str, voice_id: str | None = None) -> JobState:
    """Chạy tiếp pipeline từ phase lỗi/dở dang — Recap(transcript+Gemini), Cut, Voice, Merge hoặc Polish.

    Chỉ chạy lại phase CHƯA ``done``; phase đã xong (video đã tải, voice đã sinh...) được giữ nguyên.
    Đặt lại trạng thái đồng bộ TRƯỚC khi trả về để FE poll lần đầu không còn thấy "error"
    (nếu không FE dừng poll ngay). 409 nếu job đang chạy.
    """
    job = state.get_job(job_id) or rehydrate(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    if _is_active(job_id):
        raise HTTPException(status_code=409, detail="Job đang chạy, chưa thể thử lại.")

    # Ưu tiên giọng đã lưu của job (không đổi giọng giữa chừng khi đã đọc dở); tham số chỉ là dự phòng cho job cũ.
    voice_id = (job.voice_id or voice_id or "").strip()
    recap_pending = job.recap_status != "done" or not job.recap
    voice_pending = job.voice_status != "done"
    if (recap_pending or voice_pending) and not voice_id:
        raise HTTPException(
            status_code=400,
            detail="Job không lưu voice_id (đã restart server?) — chọn giọng đọc rồi thử lại.",
        )

    # Phase kẹt error/running (task đã chết) → idle; phase done giữ nguyên.
    reset = {
        f"{p}_status": "idle"
        for p in ("recap", "cut", "voice", "merge", "polish")
        if getattr(job, f"{p}_status") in _RESETTABLE
    }
    state.update_job(job_id, error=None, voice_id=voice_id or job.voice_id, **reset)

    job = state.get_job(job_id)
    cut_pending = job.cut_status != "done"
    voice_pending = job.voice_status != "done"
    merge_pending = job.merge_status != "done"
    polish_pending = bool(job.polish_opts) and job.polish_status != "done"
    if not (recap_pending or cut_pending or voice_pending or merge_pending or polish_pending):
        return job  # không còn gì để chạy

    # Đánh dấu "running" đồng bộ cho phase đầu tiên sẽ chạy → overall không còn là idle/error.
    if recap_pending:
        state.update_job(job_id, recap_status="running")
    elif cut_pending or voice_pending:
        marks = {}
        if cut_pending:
            marks["cut_status"] = "running"
        if voice_pending:
            marks["voice_status"] = "running"
        state.update_job(job_id, **marks)
    elif merge_pending:
        state.update_job(job_id, merge_status="running")
    else:
        state.update_job(job_id, polish_status="running")

    asyncio.create_task(_run_pipeline(job_id, voice_id, job.polish_opts))
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
    state.update_job(job.job_id, recap_status="running", polish_opts=polish_opts, voice_id=voice_id)
    _persist_job_meta(state.get_job(job.job_id))
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
