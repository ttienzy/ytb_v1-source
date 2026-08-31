"""Pydantic schemas cho /api/watermark — Gemini SynthID ✦ watermark remover."""
from datetime import datetime
from pydantic import BaseModel


class VideoItem(BaseModel):
    """Thông tin 1 file media (video hoặc ảnh) trong thư mục nguồn."""
    name: str                       # tên file, vd: image.png hoặc video.mp4
    size_bytes: int                 # kích thước gốc
    media_type: str = "video"       # "video" | "image"
    status: str = "pending"        # pending | running | done | error
    output_name: str | None = None  # tên file output sau khi xử lý
    error: str | None = None        # thông báo lỗi nếu có
    processed_frames: int | None = None
    frame_estimate: int | None = None
    drive_status: str = "idle"     # idle | uploading | done | error
    drive_file_id: str | None = None
    drive_url: str | None = None



class BatchRequest(BaseModel):
    """Request khởi động batch job."""
    filenames: list[str] | None = None  # None = xử lý tất cả trong fl1/


class BatchJob(BaseModel):
    """Trạng thái 1 batch job (dùng cho response)."""
    job_id: str
    status: str                 # idle | running | done | error
    total: int
    done: int
    failed: int
    videos: list[VideoItem]
    created_at: datetime
    updated_at: datetime
