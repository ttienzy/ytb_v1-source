"""yt-dlp wrapper — tải video YouTube, video-only 1080p avc1 (KHÔNG audio).

Phase R2: recap pipeline thay toàn bộ audio gốc bằng VO Việt (Phase R3), nên không tải audio
gốc — bỏ bước mux. Chọn avc1 (H.264) để stream-copy cut + concat (R4) sạch, tương thích Chromium.

Cờ chạy được (xác định thực tế, 2026-08):
  --js-runtimes node            dùng Node để giải n-challenge (YouTube yêu cầu JS runtime).
  --remote-components ejs:github tải challenge-solver lib (1 lần, cached) — không có thì URL bị 403.
  KHÔNG dùng cookies: cookies login kích hoạt SABR-only streaming (account này đang bị thử nghiệm),
  làm biến mất mọi format DASH; không cookies → client visionos ra URL DASH hợp lệ.
Cần yt-dlp >= nightly 2026.8.20 (bản stable cũ bị 403 / SABR). Idempotent: đã có video.mp4 thì skip.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# video-only 1080p avc1 (H.264). Fallback qua 1080p mp4 khác → 1080p bất kỳ → bestvideo.
FORMAT = (
    "bestvideo[height<=1080][ext=mp4][vcodec^=avc1]"
    "/bestvideo[height<=1080][ext=mp4]"
    "/bestvideo[height<=1080]"
    "/bestvideo"
)
TIMEOUT = 600  # 10p — đủ cho video dài 60p ở 1080p (~1GB).


def download_video(youtube_url: str, dest_dir: Path) -> Path:
    """Tải video-only về ``dest_dir/video.mp4``. Skip nếu đã có (idempotent)."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / "video.mp4"
    if out.exists() and out.stat().st_size:
        return out

    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", FORMAT,
        "-o", str(dest_dir / "video.%(ext)s"),
        "--no-playlist", "--no-part", "--no-progress",
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
        youtube_url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-500:]
        raise RuntimeError(f"yt-dlp tải thất bại: {tail or 'không rõ lỗi'}")
    if not (out.exists() and out.stat().st_size):
        found = sorted(dest_dir.glob("video.*"))
        if found:
            out = found[0]
        else:
            raise RuntimeError(f"yt-dlp báo OK nhưng không thấy file video trong {dest_dir}")
    return out
