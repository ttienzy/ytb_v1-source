"""Node "Cắt video" của Muse Canvas: giữ nhiều đoạn của một video rồi ghép lại (như cắt rồi xóa khúc trên CapCut),
và dải khung hình (filmstrip) để vẽ timeline.

- `cut_video`: nhận danh sách đoạn GIỮ LẠI [start, end) theo giây, dựng 1 file mp4 mới (ffmpeg trim + concat, mã hóa lại
  để chính xác từng khung hình). Kết quả lưu ở `DATA_DIR/media/muse_cuts` (thư mục dữ liệu bền: muse_uploads nằm trong thư
  mục tạm của PyInstaller ở bản đóng gói nên không giữ được qua lần khởi động sau), phát bằng
  `GET /api/workflow/muse/video-cut/file?name=…` và đưa tiếp vào node Ingredients / node Cắt video khác như video tham chiếu.
  Cùng nguồn + cùng danh sách đoạn thì dùng lại file đã cắt (không mã hóa lại).
- `video_strip`: 1 ảnh JPEG ghép n khung hình đều nhau của video (n tính theo tỉ lệ khung để mỗi ô đúng tỉ lệ), có cache.

Không gọi dịch vụ ngoài, không tốn credit.
"""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app.core.config import DATA_DIR
from app.workflow import muse_merge

MAX_SEGMENTS = 60
MIN_SEGMENT_SECONDS = 0.1
MIN_RESULT_SECONDS = 0.3
MERGE_GAP_SECONDS = 0.02  # hai đoạn giữ liền nhau (cách nhau < ngưỡng này) gộp làm một
STRIP_DIR = DATA_DIR / "media" / "muse_strips"
CUT_DIR = DATA_DIR / "media" / "muse_cuts"


class CutSegment(BaseModel):
    start: float = Field(..., ge=0)
    end: float = Field(..., gt=0)


class MuseCutRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=1024)
    segments: list[CutSegment] = Field(..., min_length=1, max_length=MAX_SEGMENTS, description="Các đoạn GIỮ LẠI (giây)")
    keep_audio: bool = True


# ---------------------------------------------------------------- đường dẫn an toàn


def _upload_dir() -> Path:
    from app.ai.muse.router import _UPLOAD_DIR  # cùng thư mục với /api/ai/muse/upload và /preview

    return Path(_UPLOAD_DIR)


def resolve_source(raw: str) -> Path:
    """Video trong thư mục video của app (Veo / xuất / Muse), video tải lên node Video tham chiếu (muse_uploads) hoặc video đã cắt."""
    p = Path(raw)
    if p.suffix.lower() not in muse_merge.VIDEO_EXT:
        raise ValueError(f"Không phải file video: {p.name}")
    if p.name == raw and not p.is_file():
        from app.veo import service as veo

        found = veo.get_video_path(raw)
        if found is not None:
            p = Path(found)
    if not p.is_file() or p.stat().st_size <= 0:
        raise FileNotFoundError(f"Không tìm thấy video: {p.name}")
    rp = p.resolve()
    if not any(rp.is_relative_to(r) for r in [*muse_merge._roots(), _upload_dir().resolve(), CUT_DIR.resolve()]):
        raise PermissionError(f"Video nằm ngoài thư mục video của app: {p.name}")
    return rp


# ---------------------------------------------------------------- cắt + ghép


def plan_segments(segments: list[CutSegment] | list[dict[str, float]], duration: float) -> list[tuple[float, float]]:
    """Chuẩn hóa các đoạn giữ lại: sắp theo thời gian, cắt vào [0, duration], bỏ đoạn quá ngắn, gộp đoạn chồng / liền nhau.

    Quá ngắn tổng cộng (< MIN_RESULT_SECONDS) -> ValueError (kiểm tra trước khi chạy ffmpeg).
    """
    raw: list[tuple[float, float]] = []
    for s in segments:
        start = float(s.start if isinstance(s, CutSegment) else s["start"])
        end = float(s.end if isinstance(s, CutSegment) else s["end"])
        start = max(0.0, start)
        end = min(end, duration) if duration > 0 else end
        if end - start >= MIN_SEGMENT_SECONDS:
            raw.append((start, end))
    raw.sort()
    merged: list[tuple[float, float]] = []
    for start, end in raw:
        if merged and start - merged[-1][1] <= MERGE_GAP_SECONDS:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    total = sum(e - s for s, e in merged)
    if not merged or total < MIN_RESULT_SECONDS:
        raise ValueError(f"Các đoạn giữ lại chỉ dài {total:.2f}s (tối thiểu {MIN_RESULT_SECONDS}s) — giữ lại nhiều hơn.")
    return merged


def build_cut_command(src: Path, out: Path, segs: list[tuple[float, float]], *, has_audio: bool) -> list[str]:
    """ffmpeg: trim từng đoạn giữ lại + concat. Mã hóa lại (libx264 / aac) để cắt đúng từng khung hình."""
    parts: list[str] = []
    labels: list[str] = []
    for i, (start, end) in enumerate(segs):
        parts.append(f"[0:v]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS[v{i}]")
        labels.append(f"[v{i}]")
        if has_audio:
            parts.append(f"[0:a]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{i}]")
            labels.append(f"[a{i}]")
    concat = "".join(labels) + f"concat=n={len(segs)}:v=1:a={1 if has_audio else 0}[vc]" + ("[a]" if has_audio else "")
    parts.append(concat)
    parts.append("[vc]format=yuv420p[v]")
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-filter_complex", ";".join(parts), "-map", "[v]"]
    if has_audio:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)]
    return cmd


def _cut_key(src: Path, segs: list[tuple[float, float]], keep_audio: bool) -> str:
    st = src.stat()
    basis = f"{src}|{st.st_size}|{int(st.st_mtime)}|{keep_audio}|" + ";".join(f"{s:.3f}-{e:.3f}" for s, e in segs)
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]


def cut_video(req: MuseCutRequest) -> dict[str, Any]:
    src = resolve_source(req.path)
    info = muse_merge.probe_video(src)
    duration = float(info["duration"] or 0)
    if duration <= 0:
        raise ValueError(f"Không đọc được độ dài video {src.name}.")
    segs = plan_segments(req.segments, duration)
    CUT_DIR.mkdir(parents=True, exist_ok=True)
    out = CUT_DIR / f"cut_{_cut_key(src, segs, req.keep_audio)}.mp4"
    cached = out.is_file() and out.stat().st_size > 0
    if not cached:
        has_audio = bool(info["has_audio"]) and req.keep_audio
        tmp = out.with_name(out.stem + ".part.mp4")
        try:
            muse_merge._run(build_cut_command(src, tmp, segs, has_audio=has_audio), tmp, "Cắt video")
            tmp.replace(out)
        finally:
            tmp.unlink(missing_ok=True)
    probed = muse_merge.probe_video(out)
    return {
        "ok": True,
        "file_name": f"{src.stem}_cut.mp4",
        "file_path": str(out.resolve()),
        "preview_url": f"/api/workflow/muse/video-cut/file?name={out.name}",
        "file_size": out.stat().st_size,
        "duration": round(float(probed["duration"] or sum(e - s for s, e in segs)), 2),
        "width": probed["width"],
        "height": probed["height"],
        "segments": [{"start": round(s, 3), "end": round(e, 3)} for s, e in segs],
        "cached": cached,
    }


# ---------------------------------------------------------------- dải khung hình cho timeline


def video_strip(path: Path, width: int, height: int) -> bytes:
    """Ảnh JPEG width×height ghép n khung hình đều nhau; mỗi ô đúng tỉ lệ khung của video (cắt giữa nếu cần)."""
    width = max(160, min(int(width), 4096))
    height = max(24, min(int(height), 160))
    st = path.stat()
    cache = STRIP_DIR / f"{hashlib.sha1(f'{path}|{st.st_size}|{int(st.st_mtime)}|{width}x{height}'.encode('utf-8')).hexdigest()[:16]}.jpg"
    if cache.is_file() and cache.stat().st_size > 0:
        return cache.read_bytes()
    info = muse_merge.probe_video(path)
    duration = float(info["duration"] or 0)
    if duration <= 0 or not info["width"] or not info["height"]:
        raise ValueError(f"Không đọc được video {path.name}.")
    aspect = info["width"] / info["height"]
    n = max(1, min(240, round(width / max(8.0, height * aspect))))
    tile_w = max(8, round(width / n))
    vf = (f"fps={n}/{duration:.4f},scale={tile_w}:{height}:force_original_aspect_ratio=increase,"
          f"crop={tile_w}:{height},tile={n}x1,scale={width}:{height}")   # scale cuối: làm tròn ô để ảnh đúng width×height
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-an", "-vf", vf, "-frames:v", "1",
         "-f", "image2", "-c:v", "mjpeg", "-q:v", "5", "pipe:1"],
        capture_output=True, timeout=180,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"Không dựng được dải khung hình: {(proc.stderr or b'').decode('utf-8', 'replace').strip()[-300:]}")
    STRIP_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(proc.stdout)
    return proc.stdout
