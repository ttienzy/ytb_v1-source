from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, Field


class MuseSettingsPayload(BaseModel):
    app_url: str = Field(default="https://muse.ai/", description="URL truy cập Muse")
    cdp_port: int = Field(default=9225, description="Port Remote Debugging (CDP)")
    auto_download: bool = Field(default=True, description="Tự động tải video MP4 về máy khi sinh xong")
    download_dir: str = Field(default="", description="Thư mục lưu trữ video MP4")
    timeout_seconds: int = Field(default=120, description="Thời gian chờ tối đa khi sinh video (giây)")
    default_prompt_prefix: str = Field(default="", description="Tiền tố mặc định gắn vào mỗi prompt")


class MuseSettingsResponse(BaseModel):
    ok: bool = True
    is_connected: bool = False
    last_checked_at: Optional[str] = None
    app_url: str = "https://muse.ai/"
    cdp_port: int = 9225
    auto_download: bool = True
    download_dir: str = ""
    timeout_seconds: int = 120
    default_prompt_prefix: str = ""
    profile_dir: str = ""


class MuseStatusResponse(BaseModel):
    is_connected: bool
    is_running: bool
    cdp_port: int
    tab_title: Optional[str] = None
    tab_url: Optional[str] = None
    last_checked_at: str
    message: str


class MuseUploadResponse(BaseModel):
    ok: bool = True
    file_name: str
    file_path: str
    file_type: str = "image"  # "image" hoặc "video"
    file_size: int
    preview_url: str


class MuseGenerateRequest(BaseModel):
    prompt: str = Field(..., description="Prompt mô tả video cần tạo")
    reference_image: Optional[str] = Field(default=None, description="Đường dẫn ảnh mẫu hoặc URL tham chiếu (tương thích ngược)")
    reference_images: Optional[list[str]] = Field(default=None, description="Danh sách các file ảnh tham chiếu")
    reference_video: Optional[str] = Field(default=None, description="Đường dẫn video tham chiếu")
    reference_videos: Optional[list[str]] = Field(default=None, description="Danh sách các file video tham chiếu")
    reference_media: Optional[list[str]] = Field(default=None, description="Danh sách tổng hợp file ảnh/video tham chiếu")
    use_side_chat: bool = Field(default=False, description="Tự động tạo New side chat để tách biệt luồng dự án")
    continuation: bool = Field(default=False, description="Nối tiếp phân cảnh của video trước đó")
    timeout_seconds: Optional[int] = Field(default=None, description="Thời gian timeout tuỳ chỉnh (giây)")


class MuseGenerateResponse(BaseModel):
    ok: bool
    prompt: str
    video_url: Optional[str] = None
    local_path: Optional[str] = None
    file_size: Optional[int] = None
    error: Optional[str] = None
    duration_seconds: Optional[float] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class MuseHistoryItem(BaseModel):
    id: str
    filename: str
    local_path: str
    file_size: int
    created_at: str
    preview_url: str


class MuseHistoryResponse(BaseModel):
    ok: bool = True
    items: list[MuseHistoryItem] = Field(default_factory=list)

