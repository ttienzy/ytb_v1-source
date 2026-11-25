"""Node "Tách khung hình" của Muse Canvas: tách 1 ảnh PNG sắc nét từ video bằng ffmpeg (0 credit).

- `extract_frame_file`: nhận đường dẫn video hợp lệ của app, chế độ ("first" | "last" | "time") và mốc giây.
- Lưu PNG độ phân giải gốc tại `DATA_DIR/media/muse_frames` (tên `frame_<hash>.png`, ghi nguyên tử) để giữ đủ nét
  và kích thước pixel khi nối sang node Tạo video Flow (cả Ingredients lẫn Khung đầu–cuối `frames`) hoặc Tạo ảnh.
- Cache theo (nguồn, kích thước file, mtime, mode, target_sec): gọi lại cùng mốc dùng lại ngay file đã tách.
"""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.config import DATA_DIR
from app.workflow import muse_merge

FRAME_DIR = DATA_DIR / "media" / "muse_frames"
LAST_FRAME_OFFSET = 0.08
TIME_END_MARGIN = 0.08


class MuseFrameRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=1024)
    mode: Literal["first", "last", "time"] = "last"
    time_sec: float = Field(default=0.0, ge=0.0)


def _target_second(mode: Literal["first", "last", "time"], time_sec: float, duration: float) -> float:
    if mode == "first":
        return 0.0
    if mode == "last":
        return max(0.0, round(duration - LAST_FRAME_OFFSET, 3))
    max_t = max(0.0, round(duration - TIME_END_MARGIN, 3))
    return min(max(0.0, round(float(time_sec), 3)), max_t)


def _frame_key(src: Path, mode: str, target: float) -> str:
    st = src.stat()
    basis = f"{src}|{st.st_size}|{int(st.st_mtime)}|{mode}|{target:.3f}"
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]


def _run_extract(cmd: list[str], tmp: Path) -> bool:
    proc = subprocess.run(cmd, capture_output=True, timeout=60)
    return proc.returncode == 0 and tmp.is_file() and tmp.stat().st_size > 0


def _read_image_size(path: Path, fallback_w: int, fallback_h: int) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(path) as img:
            return img.size
    except Exception:
        return fallback_w, fallback_h


def extract_frame_file(req: MuseFrameRequest) -> dict[str, Any]:
    """Tách 1 khung PNG từ video bằng ffmpeg (0 credit, không gọi dịch vụ ngoài)."""
    src = muse_merge.resolve_video(req.path)
    info = muse_merge.probe_video(src)
    duration = float(info["duration"] or 0)
    if duration <= 0:
        raise ValueError(f"Không đọc được độ dài video {src.name}.")

    target = _target_second(req.mode, req.time_sec, duration)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    out = FRAME_DIR / f"frame_{_frame_key(src, req.mode, target)}.png"
    cached = out.is_file() and out.stat().st_size > 0
    if not cached:
        tmp = out.with_name(out.stem + ".part.png")
        try:
            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-ss", f"{target:.3f}", "-i", str(src),
                "-frames:v", "1", "-f", "image2", str(tmp),
            ]
            ok = _run_extract(cmd, tmp)
            if not ok and (req.mode == "last" or target >= max(0.0, duration - 0.5)):
                # Fallback seek từ cuối file khi container có duration header hơi lệch hoặc mốc sát frame cuối (vd. 15fps)
                fallback_cmd = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-sseof", "-0.1", "-i", str(src),
                    "-frames:v", "1", "-f", "image2", str(tmp),
                ]
                ok = _run_extract(fallback_cmd, tmp)
            if not ok:
                raise RuntimeError(f"Không tách được khung hình từ {src.name} tại {target:.2f}s.")
            tmp.replace(out)
        finally:
            tmp.unlink(missing_ok=True)

    w, h = _read_image_size(out, int(info.get("width") or 0), int(info.get("height") or 0))
    return {
        "ok": True,
        "file_name": f"{src.stem}_{req.mode}.png",
        "file_path": str(out.resolve()),
        "preview_url": f"/api/workflow/muse/frame/file?name={out.name}",
        "file_size": out.stat().st_size,
        "width": w,
        "height": h,
        "time_sec": round(target, 2),
        "duration": round(duration, 2),
        "mode": req.mode,
        "cached": cached,
    }
