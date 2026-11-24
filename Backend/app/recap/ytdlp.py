"""Tải video nguồn cho Recap bằng yt-dlp ở chế độ khách."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

# Ưu tiên video-only H.264 tới 1080p để cắt nhanh và dễ phát trên Chromium.
# Lựa chọn cuối có thể kèm audio, bước ghép Recap chỉ dùng hình.
FORMAT = (
    "bestvideo[height<=1080][ext=mp4][vcodec^=avc1]"
    "/bestvideo[height<=1080][ext=mp4]"
    "/bestvideo[height<=1080]"
    "/bestvideo"
    "/best"
)
TIMEOUT = 600
BOT_WALL_MARKERS = ("sign in to confirm", "not a bot", "exporting-youtube-cookies")


def download_video(youtube_url: str, dest_dir: Path) -> Path:
    """Tải video.mp4 và chỉ ghi vào đích sau khi lệnh tải thành công."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / "video.mp4"
    if out.is_file() and out.stat().st_size:
        return out

    # Bản đóng gói có điểm vào yt-dlp riêng vì sys.executable là backend_server.exe.
    entry = ["--yt-dlp"] if getattr(sys, "frozen", False) else ["-m", "yt_dlp"]
    with TemporaryDirectory(prefix="download-", dir=dest_dir) as tmp:
        staging = Path(tmp)
        cmd = [
            sys.executable, *entry,
            "--ignore-config", "--no-cookies", "--no-cookies-from-browser",
            "-f", FORMAT, "-o", str(staging / "video.%(ext)s"),
            "--no-playlist", "--no-progress", "--remux-video", "mp4",
            "--js-runtimes", "node",
            "--remote-components", "ejs:github",
            "--", youtube_url,
        ]
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"Tải video nguồn quá {TIMEOUT}s. Hãy thử lại sau.") from exc

        if proc.returncode:
            detail = proc.stderr or proc.stdout or ""
            if any(marker in detail.lower() for marker in BOT_WALL_MARKERS):
                raise RuntimeError("YouTube yêu cầu xác thực khi tải video nguồn ở chế độ khách. Hãy thử lại sau hoặc dùng link công khai khác.")
            raise RuntimeError(f"yt-dlp tải video nguồn thất bại: {detail[-600:].strip() or 'không rõ lỗi'}")

        downloaded = staging / out.name
        if not downloaded.is_file() or not downloaded.stat().st_size:
            raise RuntimeError("yt-dlp chưa tạo được file video nguồn MP4.")
        downloaded.replace(out)
    return out
