"""
Veo Studio — Pydantic schemas cho request/response.

Tất cả model names & durations ở đây dựa trên tài liệu Google Help công khai.
Internal model IDs chưa xác minh — sẽ được cập nhật sau runtime verification.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator


# ─────────────────────────────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────────────────────────────

class JobStatus(str, Enum):
    PENDING      = "pending"        # Job đã tạo, chờ xử lý
    CAPTCHA      = "captcha"        # Đang chờ giải reCAPTCHA
    SUBMITTING   = "submitting"     # Đang gửi request tới Flow
    GENERATING   = "generating"     # Flow đang render video
    DOWNLOADING  = "downloading"    # Đang tải MP4 về local
    DONE         = "done"           # Hoàn tất, video sẵn sàng
    ERROR        = "error"          # Lỗi ở bất kỳ bước nào


class InputMode(str, Enum):
    TEXT_TO_VIDEO = "text_to_video"
    FRAMES       = "frames"          # Khung hình (ảnh đầu / đầu+cuối)
    INGREDIENTS  = "ingredients"     # Thành phần (tham chiếu nội dung)
    VIDEO_EDIT   = "video_edit"
    EXTEND       = "extend"


class AspectRatio(str, Enum):
    LANDSCAPE = "16:9"
    PORTRAIT  = "9:16"


# ─────────────────────────────────────────────────────────────────────────────
# Model Info (từ Google Help, chưa xác minh internal IDs)
# ─────────────────────────────────────────────────────────────────────────────

class VeoModelInfo(BaseModel):
    """Thông tin model video trên Flow — theo tài liệu Google Help."""
    display_name: str = Field(..., description="Tên hiển thị trên Flow UI")
    provider: str = Field(default="flow", description="Nguồn: flow | gemini_api | vertex")
    provider_model_id: Optional[str] = Field(
        default=None,
        description="Internal ID khi gửi request. None = chưa xác minh.",
    )
    group: str = Field(default="video", description="video | image")
    supported_modes: list[str] = Field(
        default_factory=list,
        description="Danh sách InputMode hỗ trợ (theo tài liệu, chưa kiểm chứng runtime)",
    )
    supported_durations: list[int] = Field(
        default_factory=list,
        description="Các mốc duration (giây) hỗ trợ",
    )
    supported_resolutions: list[str] = Field(
        default_factory=list,
        description="Độ phân giải hỗ trợ, ví dụ ['360p', '720p']",
    )
    extend_supported: Optional[bool] = Field(
        default=None,
        description="True/False/None(chưa biết). Theo Flow Help.",
    )
    verified: bool = Field(
        default=False,
        description="True = đã có bằng chứng runtime (network trace). False = chỉ từ tài liệu.",
    )


class VeoCapabilityProfile(BaseModel):
    """Một tổ hợp Flow được phép dispatch.

    ``runtime_verified`` không đồng nghĩa Google đã công bố Flow API. Nó chỉ
    nghĩa là đúng tổ hợp này có bằng chứng runtime và adapter tương ứng.
    """

    id: str
    model_display_name: str
    provider_model_id: str
    input_mode: InputMode
    aspect_ratio: AspectRatio
    duration_seconds: int
    resolution: str
    num_outputs: int = 1
    credit_cost: int = 0
    documented: bool = True
    runtime_verified: bool = False
    note: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Job Request / Response
# ─────────────────────────────────────────────────────────────────────────────

class VeoJobRequest(BaseModel):
    """Request tạo video mới."""
    prompt: str = Field(..., min_length=1, max_length=2000, description="Mô tả cảnh video")
    model_display_name: str = Field(
        default="Omni 1.1 Flash",
        description="Tên model hiển thị (sẽ map sang ID khi đã xác minh)",
    )
    input_mode: InputMode = Field(default=InputMode.TEXT_TO_VIDEO)
    aspect_ratio: AspectRatio = Field(default=AspectRatio.PORTRAIT)
    duration_seconds: int = Field(default=6, ge=3, le=15, description="Thời lượng clip (giây)")
    resolution: str = Field(default="720p", description="Độ phân giải mong muốn")
    num_outputs: int = Field(default=1, ge=1, le=4, description="Số video output")
    seed: Optional[int] = Field(default=None, description="Random seed (không bảo đảm giống hệt)")

    # Project
    project_id: Optional[str] = Field(default=None, description="ID của VeoProject đã chọn")
    idempotency_key: Optional[str] = Field(
        default=None,
        max_length=128,
        description="Khóa chống tạo trùng khi client retry cùng một yêu cầu",
    )

    # Cho mode frames
    image_path: Optional[str] = Field(default=None, description="Đường dẫn ảnh input / Frame đầu (local)")
    end_image_path: Optional[str] = Field(default=None, description="Ảnh Frame cuối (nếu có)")

    # Cho mode ingredients (tối đa 3 ảnh: Subject, Scene, Style)
    ingredient_image_paths: list[str] = Field(
        default_factory=list,
        max_length=3,
        description="Danh sách ảnh thành phần tham chiếu (tối đa 3 ảnh: Subject, Scene, Style)",
    )
    ingredient_media_ids: list[str] = Field(
        default_factory=list,
        max_length=3,
        description="Danh sách media_id ảnh/video đã upload lên cùng Flow project",
    )

    # Cho mode video_edit (Motion Control, Omni 1.2 Flash: macaron_cookie_edit)
    reference_video_id: Optional[str] = Field(default=None, description="Flow media_id cua video tham chieu da upload")
    reference_video_start_seconds: float = Field(default=0, ge=0, description="Thoi diem bat dau clip tham chieu")
    reference_video_end_seconds: Optional[float] = Field(default=None, gt=0, description="Thoi diem ket thuc clip tham chieu")
    force_fresh_assets: bool = Field(
        default=False,
        description="Bỏ qua cache media và upload lại reference cho lần render này",
    )

    @model_validator(mode="after")
    def _video_edit_defaults_to_omni_12(self):
        """Chỉnh video chỉ còn Omni 1.2: request không ghi rõ model thì dùng Omni 1.2 (mặc định chung vẫn giữ cho chế độ khác)."""
        if getattr(self.input_mode, "value", self.input_mode) == "video_edit" and "model_display_name" not in self.model_fields_set:
            self.model_display_name = "Omni 1.2 Flash"
        return self

    # Cho mode extend
    source_video_id: Optional[str] = Field(default=None, description="Video ID nguồn để extend")
    continuation_prompt: Optional[str] = Field(default=None, description="Prompt tiếp cảnh")


class VeoJobOut(BaseModel):
    """Trạng thái và kết quả của một job."""
    job_id: str
    project_id: Optional[str] = None
    flow_project_id: Optional[str] = None
    capability_profile_id: Optional[str] = None
    status: JobStatus = JobStatus.PENDING
    input_mode: InputMode = InputMode.TEXT_TO_VIDEO
    prompt: str = ""
    model_display_name: str = ""
    aspect_ratio: str = "16:9"
    duration_seconds: int = 8
    resolution: str = "720p"
    num_outputs: int = 1
    deduplicated: bool = False

    # Progress
    current_step: str = ""           # Bước hiện tại đang xử lý
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    error_stage: Optional[str] = None
    error_hint: Optional[str] = None
    error_retryable: Optional[bool] = None

    # Output
    output_files: list[str] = Field(default_factory=list, description="Danh sách file paths")
    created_at: str = ""
    updated_at: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Bridge Status
# ─────────────────────────────────────────────────────────────────────────────

class ExtensionInfo(BaseModel):
    """Thông tin Extension đang kết nối."""
    ext_fp: str = ""
    version: str = ""
    tab_count: int = 0
    last_heartbeat: Optional[str] = None
    connected: bool = False
    tabs: list[dict] = Field(default_factory=list)


class AccountInfo(BaseModel):
    """Thông tin tài khoản Google Labs thu hoạch từ Extension."""
    email: str
    tier: str = "unknown"         # Heuristic từ extension, không phải gói chính thức
    credits: Optional[int] = None
    has_token: bool = False
    session_valid: bool = False
    last_updated: Optional[str] = None


class VeoBridgeStatus(BaseModel):
    """Trạng thái tổng thể Bridge Server + Extension."""
    bridge_running: bool = False
    bridge_port: int = 60526
    bridge_uptime_seconds: float = 0
    secret_generated: bool = False
    extension: ExtensionInfo = Field(default_factory=ExtensionInfo)
    accounts: list[AccountInfo] = Field(default_factory=list)
    captcha_queue_size: int = 0
    total_captcha_solved: int = 0
    last_captcha_at: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# History
# ─────────────────────────────────────────────────────────────────────────────

class VeoHistoryItem(BaseModel):
    """Video đã tạo thành công, lưu local."""
    video_id: str
    file_name: str
    file_path: str
    file_size_bytes: int = 0
    duration_seconds: float = 0
    width: int = 0
    height: int = 0
    prompt: str = ""
    model_display_name: str = ""
    aspect_ratio: str = "16:9"
    input_mode: str = "text_to_video"
    created_at: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Capabilities
# ─────────────────────────────────────────────────────────────────────────────

class VeoCapabilities(BaseModel):
    """Capabilities trả về cho Frontend — cập nhật khi xác minh runtime."""
    models: list[VeoModelInfo] = Field(default_factory=list)
    profiles: list[VeoCapabilityProfile] = Field(default_factory=list)
    aspect_ratios: list[str] = Field(default=["16:9", "9:16"])
    max_outputs: int = 4
    last_verified: Optional[str] = None
    note: str = "Dữ liệu từ tài liệu Google Help. Cần xác minh runtime trước khi dispatch."


class ManualCredentialRequest(BaseModel):
    """Yêu cầu lưu credential thủ công từ UI Cài đặt."""
    email: str
    cookie: str
    access_token: str = ""
    credits: Optional[int] = None


class ManualCreditsRequest(BaseModel):
    """Yêu cầu cập nhật trực tiếp số dư credits cho một tài khoản."""
    email: str
    credits: int




# ─────────────────────────────────────────────────────────────────────────────
# Projects
# ─────────────────────────────────────────────────────────────────────────────

class VeoProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Tên hiển thị của Project")
    flow_project_id: Optional[str] = Field(default=None, description="Mã Flow Project ID nếu tạo thủ công hoặc liên kết")


class VeoProjectOut(BaseModel):
    id: str
    name: str
    flow_project_id: str
    account_email: str
    is_active: bool = False
    video_count: int = 0
    created_at: str = ""
    updated_at: str = ""


class VeoProjectSelect(BaseModel):
    project_id: str


# ─────────────────────────────────────────────────────────────────────────────
# Images (Nano Banana)
# ─────────────────────────────────────────────────────────────────────────────

class VeoImageGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000, description="Nội dung mô tả ảnh")
    model_key: str = Field(default="GEM_PIX_2", description="GEM_PIX_2 | NARWHAL | HARBOR_SEAL")
    model_display_name: str = Field(default="Nano Banana Pro", description="Tên hiển thị model")
    aspect_ratio: str = Field(default="16:9", description="16:9 | 4:3 | 1:1 | 3:4 | 9:16")
    count: int = Field(default=1, ge=1, le=4, description="Số lượng ảnh sinh (1 đến 4)")
    seed: Optional[int] = Field(default=None, description="Seed ngẫu nhiên")
    project_id: Optional[str] = Field(default=None, description="Project ID")
    reference_image_ids: list[str] = Field(default_factory=list, description="Danh sách media_id nhân vật/ảnh tham chiếu")


class VeoImageItem(BaseModel):
    id: str
    media_id: str
    prompt: str
    model_display_name: str
    model_key: str
    aspect_ratio: str
    seed: Optional[int] = None
    image_url: str
    local_path: str = ""
    project_id: str = ""
    created_at: str = ""


class VeoImageGenerateResponse(BaseModel):
    ok: bool
    images: list[VeoImageItem] = Field(default_factory=list)
    error: Optional[str] = None
