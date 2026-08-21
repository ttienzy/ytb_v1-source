"""Layout thư mục media theo job — Phase R2 trở đi.

Mỗi job 1 thư mục riêng dưới ``Data/Downloads/{job_id}/``:
  video.mp4        — bản tải từ YouTube (xoá sau khi cut xong để tiết kiệm disk;
                     re-cut → re-download, chấp nhận).
  clip_i.mp4       — đoạn cắt theo segment (giữ cho Phase R3 voice + R4 merge).

Tách ra module riêng để ytdlp/ffmpeg/service cùng chia sẻ layout nhất quán.
"""
from __future__ import annotations

from app.core.config import TOOLS_DIR

DOWNLOADS_DIR = TOOLS_DIR / "Backend" / "Data" / "Downloads"


def job_dir_of(job_id: str):
    return DOWNLOADS_DIR / job_id


def video_path(job_id: str):
    return job_dir_of(job_id) / "video.mp4"


def clip_path(job_id: str, idx: int):
    return job_dir_of(job_id) / f"clip_{idx}.mp4"
