from datetime import datetime, timezone
from typing import Literal, Optional
from pydantic import BaseModel, Field


class MuseSettingsPayload(BaseModel):
    # Trường cũ (app_url, cdp_port, auto_download) nếu client gửi lên sẽ bị bỏ qua.
    download_dir: str = Field(default="", description="Thư mục lưu video MP4 tải về")
    timeout_seconds: int = Field(default=600, description="Thời gian chờ tối đa khi sinh video (giây, tối thiểu 600)")
    default_prompt_prefix: str = Field(default="", description="Tiền tố mặc định gắn vào mỗi prompt")


class MuseSettingsResponse(BaseModel):
    ok: bool = True
    download_dir: str = ""
    timeout_seconds: int = 600
    default_prompt_prefix: str = ""


class MuseStatusResponse(BaseModel):
    is_connected: bool
    last_checked_at: str
    message: str
    account_id: Optional[str] = None
    account_label: Optional[str] = None


class MuseAccountView(BaseModel):
    id: str
    label: str
    viewerId: str = ""
    hasSession: bool = False
    partition: str = ""
    cdpPort: int = 0
    status: str = "active"
    message: str = ""
    addedAt: float = 0
    lastUsed: float = 0
    lastCheckedAt: float = 0
    exhaustedAt: float = 0
    running: bool = False
    busy: bool = False


class MuseAccountsResponse(BaseModel):
    accounts: list[MuseAccountView] = Field(default_factory=list)
    active_accounts_count: int = 0
    total_accounts_count: int = 0


class MuseLoginRequest(BaseModel):
    account_id: Optional[str] = Field(default=None, description="Có giá trị = đăng nhập lại tài khoản này")


class MuseRenameRequest(BaseModel):
    label: str = Field(..., min_length=1, max_length=60)


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
    account_id: Optional[str] = Field(default=None, description="Tài khoản Muse dùng để tạo; bỏ trống = tự xoay vòng")
    output_kind: Literal["video", "image", "text"] = Field(
        default="video", description="Chờ Muse trả video, ảnh, hay chỉ câu trả lời chữ (vd. kịch bản)"
    )
    apply_prefix: bool = Field(default=True, description="Ghép tiền tố prompt chung (Cài đặt) vào đầu prompt")
    chat_title: Optional[str] = Field(default=None, max_length=80, description="Tên chat phụ khi use_side_chat")
    file_prefix: Optional[str] = Field(default=None, max_length=40, description="Tiền tố tên file tải về")
    settle_seconds: Optional[int] = Field(
        default=None, ge=5, le=600, description="Có media rồi vẫn chờ chat im lặng chừng này giây mới chốt (mặc định 15)"
    )
    collect_all: bool = Field(default=False, description="Tải mọi video/ảnh Muse trả (không chỉ file cuối)")


class MuseGenerateResponse(BaseModel):
    ok: bool
    prompt: str
    account_id: Optional[str] = None
    account_label: Optional[str] = None
    output_kind: str = "video"
    preview_url: Optional[str] = None  # ảnh: /api/ai/muse/output?file=...
    video_url: Optional[str] = None  # đường dẫn sandbox:// của file Muse tạo (video hoặc ảnh)
    local_path: Optional[str] = None
    local_paths: list[str] = Field(default_factory=list)  # collect_all: mọi file đã tải, theo thứ tự (cuối = local_path)
    file_size: Optional[int] = None
    error: Optional[str] = None
    duration_seconds: Optional[float] = None
    session_id: Optional[str] = None  # chat Muse chứa video (None = chat chính)
    reply_text: Optional[str] = None  # câu trả lời chữ của Muse (output_kind=text: toàn bộ bài, đã lưu ở local_path .md)
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

