"""Muse Canvas → node "Ghép video": ghép các clip Flow đã tạo (Omni 1.2) thành 1 video hoàn chỉnh.

Chuỗi (chạy nền, có tiến độ):
  1. (tùy chọn) xóa watermark Flow TỪNG clip bằng gwr — gwr chỉ làm đúng trên clip gốc nên phải chạy TRƯỚC khi ghép;
     bản sạch lưu cache (DATA_DIR/media/veo_clean) theo tên + kích thước + mtime nên ghép lại không phải chạy lại gwr;
  2. chuẩn hóa từng clip (cắt đầu / cuối theo yêu cầu, cùng kích thước / fps / âm thanh) để ghép bằng stream copy luôn đúng;
  3. ghép + tiếng gốc + nhạc nền + nhãn / logo kênh: dùng lại `muse_finish.finish_video` → Thư Viện Video, mục "Hoàn chỉnh".

Cắt cứng (không làm mờ chuyển cảnh): điểm nối được thiết kế ở khung không thấy trang phục (studio trống, lòng bàn tay),
nên làm mờ chỉ lộ người. Xem trước điểm nối: `extract_frame` (khung đầu / cuối của clip).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Literal, Optional

from pydantic import BaseModel, Field

from app.core.config import DATA_DIR
from app.workflow.muse_finish import Corner, MuseFinishRequest

VIDEO_EXT = {".mp4", ".webm", ".mkv", ".mov"}
CLEAN_DIR = DATA_DIR / "media" / "veo_clean"
MAX_CLIPS = 20
MIN_CLIP_SECONDS = 0.5
_GWR_LOCK = threading.Lock()  # gwr mở trình duyệt: 1 lần một clip trên toàn app


class MergeClip(BaseModel):
    path: str = Field(..., min_length=1, max_length=1024)
    trim_start: float = Field(default=0, ge=0, le=60, description="Cắt bỏ N giây đầu clip")
    trim_end: float = Field(default=0, ge=0, le=60, description="Cắt bỏ N giây cuối clip")


class MuseMergeRequest(BaseModel):
    clips: list[MergeClip] = Field(..., min_length=1, max_length=MAX_CLIPS)
    remove_watermark: bool = True
    title: str = Field(default="", max_length=120)
    mute_original: bool = True
    original_volume: float = Field(default=0.2, ge=0, le=2)
    bgm_track_ids: list[str] = Field(default_factory=list, max_length=10)
    bgm_volume: float = Field(default=0.3, ge=0, le=2)
    label_text: str = Field(default="", max_length=60)
    label_position: Corner = "br"
    label_size: Literal["s", "m", "l"] = "m"
    logo_id: Optional[str] = None
    logo_position: Corner = "tr"
    logo_size: float = Field(default=0.16, ge=0.05, le=0.5)


# ---------------------------------------------------------------- đường dẫn an toàn


def _roots() -> list[Path]:
    from app.veo import service as veo
    from app.workflow.muse_finish import muse_video_dir
    from app.workflow.service import WORKFLOW_EXPORTS_DIR

    roots = [Path(veo._VEO_DATA_DIR), Path(WORKFLOW_EXPORTS_DIR), CLEAN_DIR]
    muse = muse_video_dir()
    if muse:
        roots.append(Path(muse))
    return [r.resolve() for r in roots]


def resolve_video(raw: str) -> Path:
    """Chỉ nhận video nằm trong thư mục video của app (Veo / xuất / Muse); sai -> lỗi rõ ràng trước khi chạy gì."""
    p = Path(raw)
    if p.suffix.lower() not in VIDEO_EXT:
        raise ValueError(f"Không phải file video: {p.name}")
    if p.name == raw and not p.is_file():
        # Job Veo ghi `output_files` là TÊN file trần (vd. "84a4a553-fab.mp4"): tìm trong thư mục video Veo
        from app.veo import service as veo

        found = veo.get_video_path(raw)
        if found is not None:
            p = Path(found)
    if not p.is_file() or p.stat().st_size <= 0:
        raise FileNotFoundError(f"Không tìm thấy video: {p.name}")
    rp = p.resolve()
    if not any(rp.is_relative_to(r) for r in _roots()):
        raise PermissionError(f"Video nằm ngoài thư mục video của app: {p.name}")
    return rp


# ---------------------------------------------------------------- ffprobe / ffmpeg


def probe_video(path: Path) -> dict[str, Any]:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
    )
    if proc.returncode:
        raise RuntimeError(f"Không đọc được video {path.name}: {(proc.stderr or '').strip()[-300:]}")
    data = json.loads(proc.stdout or "{}")
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), {})
    num, _, den = str(v.get("r_frame_rate") or "24/1").partition("/")
    try:
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps = 24.0
    return {
        "duration": float(data.get("format", {}).get("duration") or 0),
        "width": int(v.get("width") or 0),
        "height": int(v.get("height") or 0),
        "fps": round(fps, 3) if 1 <= fps <= 120 else 24.0,
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
    }


def normalize_command(src: Path, out: Path, *, start: float, length: float, width: int, height: int, fps: float, has_audio: bool) -> list[str]:
    """ffmpeg: cắt [start, start+length), đưa về cùng kích thước / fps / âm thanh (thêm tiếng im nếu clip không có)."""
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(src)]
    if not has_audio:
        cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
    vf = (f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
          f"fps={fps:g},setsar=1,format=yuv420p")
    cmd += ["-t", f"{length:.3f}", "-vf", vf, "-map", "0:v:0", "-map", "0:a:0" if has_audio else "1:a:0"]
    if not has_audio:
        cmd += ["-shortest"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", str(out)]
    return cmd


def plan_length(duration: float, trim_start: float, trim_end: float) -> float:
    """Độ dài còn lại sau khi cắt; quá ngắn -> ValueError (kiểm tra trước khi chạy)."""
    length = duration - trim_start - trim_end
    if length < MIN_CLIP_SECONDS:
        raise ValueError(f"Cắt đầu {trim_start:g}s + cuối {trim_end:g}s làm clip {duration:.1f}s chỉ còn {max(length, 0):.1f}s (tối thiểu {MIN_CLIP_SECONDS}s).")
    return length


def _run(cmd: list[str], out: Path, label: str, cwd: Path | None = None) -> Path:
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800, cwd=str(cwd) if cwd else None)
    if proc.returncode != 0 or not out.is_file() or out.stat().st_size == 0:
        raise RuntimeError(f"{label} thất bại (ffmpeg exit {proc.returncode}): {(proc.stderr or '').strip()[-500:]}")
    return out


# ---------------------------------------------------------------- xóa watermark (có cache)


def clean_cache_path(src: Path) -> Path:
    st = src.stat()
    return CLEAN_DIR / f"{src.stem}_{st.st_size}_{int(st.st_mtime)}.mp4"


def remove_watermark(src: Path, on_progress: Callable[[int, int], None] | None = None) -> Path:
    """Bản không watermark của clip gốc Flow; đã có trong cache thì dùng luôn (gwr chạy lâu)."""
    from app.watermark.service import remove_video_watermark_sync

    dest = clean_cache_path(src)
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    with _GWR_LOCK:
        if dest.is_file() and dest.stat().st_size > 0:  # job khác vừa làm xong lúc chờ khóa
            return dest
        return Path(remove_video_watermark_sync(src, dest, on_progress=on_progress))


# ---------------------------------------------------------------- khung hình xem trước điểm nối


def extract_frame(path: Path, at: Literal["first", "last"] = "first", width: int = 360) -> bytes:
    """1 khung JPEG đầu / cuối của clip (xem điểm nối: khung cuối clip k cạnh khung đầu clip k+1)."""
    width = max(80, min(int(width), 1080))
    seek = ["-ss", "0"] if at == "first" else ["-sseof", "-0.1"]
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", *seek, "-i", str(path), "-frames:v", "1", "-vf", f"scale={width}:-2",
         "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "pipe:1"],
        capture_output=True, timeout=60,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"Không lấy được khung hình: {(proc.stderr or b'').decode('utf-8', 'replace').strip()[-300:]}")
    return proc.stdout


# ---------------------------------------------------------------- job nền

_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()
_MAX_JOBS = 50


def _set(job_id: str, **fields: Any) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is not None:
            job.update(fields, updated_at=time.time())


def get_job(job_id: str) -> Optional[dict[str, Any]]:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        return dict(job) if job else None


def prepare(req: MuseMergeRequest) -> list[tuple[Path, dict[str, Any], float]]:
    """Kiểm tra mọi clip TRƯỚC khi chạy gì (đường dẫn, thời lượng sau cắt): [(đường dẫn, probe, độ dài còn lại)]."""
    out = []
    for i, clip in enumerate(req.clips, start=1):
        try:
            src = resolve_video(clip.path)
            info = probe_video(src)
            length = plan_length(info["duration"], clip.trim_start, clip.trim_end)
        except (ValueError, FileNotFoundError, PermissionError) as e:
            raise type(e)(f"Clip {i}: {e}") from e
        out.append((src, info, length))
    return out


def start_merge(req: MuseMergeRequest) -> str:
    planned = prepare(req)
    job_id = uuid.uuid4().hex[:12]
    with _JOBS_LOCK:
        if len(_JOBS) >= _MAX_JOBS:
            for k in sorted(_JOBS, key=lambda k: _JOBS[k].get("updated_at", 0))[: len(_JOBS) - _MAX_JOBS + 1]:
                _JOBS.pop(k, None)
        _JOBS[job_id] = {"job_id": job_id, "status": "running", "step": "Chuẩn bị…", "clip": 0, "total": len(planned),
                         "result": None, "error": None, "created_at": time.time(), "updated_at": time.time()}
    threading.Thread(target=_run_job, args=(job_id, req, planned), daemon=True, name=f"muse-merge-{job_id}").start()
    return job_id


def _run_job(job_id: str, req: MuseMergeRequest, planned: list[tuple[Path, dict[str, Any], float]]) -> None:
    from app.workflow.muse_finish import finish_video
    from app.workflow.service import WORKFLOW_EXPORTS_DIR

    n = len(planned)
    work = Path(WORKFLOW_EXPORTS_DIR) / f"temp_merge_{job_id}"
    try:
        work.mkdir(parents=True, exist_ok=True)
        ref = planned[0][1]  # kích thước / fps của clip đầu làm chuẩn cho cả bản ghép
        width, height, fps = ref["width"] or 720, ref["height"] or 1280, ref["fps"]
        width, height = width - width % 2, height - height % 2
        processed: list[str] = []
        for i, ((src, info, length), clip) in enumerate(zip(planned, req.clips), start=1):
            use = src
            if req.remove_watermark:
                _set(job_id, clip=i, step=f"Clip {i}/{n}: xóa watermark Flow (mất vài phút / clip, lần sau dùng cache)…")

                def on_progress(done: int, total: int, i: int = i) -> None:
                    if total:
                        _set(job_id, step=f"Clip {i}/{n}: xóa watermark Flow… {int(done * 100 / total)}%")

                try:
                    use = remove_watermark(src, on_progress)
                except Exception as e:  # noqa: BLE001
                    raise RuntimeError(f"Clip {i}: không xóa được watermark ({e}). Tắt “Xóa watermark Flow” để ghép bản gốc.") from e
            _set(job_id, clip=i, step=f"Clip {i}/{n}: chuẩn hóa" + (" và cắt" if clip.trim_start or clip.trim_end else ""))
            use_info = probe_video(use) if use != src else info
            out = work / f"c{i:02d}.mp4"
            _run(
                normalize_command(use, out, start=clip.trim_start, length=length, width=width, height=height, fps=fps, has_audio=use_info["has_audio"]),
                out, f"Clip {i}: chuẩn hóa",
            )
            processed.append(str(out))
        _set(job_id, step="Ghép clip, trộn nhạc, phủ nhãn / logo…")
        finish = finish_video(MuseFinishRequest(
            video_paths=processed, title=req.title, mute_original=req.mute_original, original_volume=req.original_volume,
            bgm_track_ids=req.bgm_track_ids, bgm_volume=req.bgm_volume, label_text=req.label_text, label_position=req.label_position,
            label_size=req.label_size, logo_id=req.logo_id, logo_position=req.logo_position, logo_size=req.logo_size,
        ))
        _set(job_id, status="done", step="Xong", result=finish)
    except Exception as e:  # noqa: BLE001
        _set(job_id, status="error", step="Lỗi", error=str(e))
    finally:
        shutil.rmtree(work, ignore_errors=True)
