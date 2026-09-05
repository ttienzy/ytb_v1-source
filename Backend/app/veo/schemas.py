"""
Veo Studio — Pydantic schemas cho request/response.

Tất cả model names & durations ở đây dựa trên tài liệu Google Help công khai.
Internal model IDs chưa xác minh — sẽ được cập nhật sau runtime verification.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


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


# ─────────────────────────────────────────────────────────────────────────────
# Job Request / Response
# ─────────────────────────────────────────────────────────────────────────────

class VeoJobRequest(BaseModel):
    """Request tạo video mới."""
    prompt: str = Field(..., min_length=1, max_length=2000, description="Mô tả cảnh video")
    model_display_name: str = Field(
        default="Veo 3.1 - Fast",
        description="Tên model hiển thị (sẽ map sang ID khi đã xác minh)",
    )
    input_mode: InputMode = Field(default=InputMode.TEXT_TO_VIDEO)
    aspect_ratio: AspectRatio = Field(default=AspectRatio.LANDSCAPE)
    duration_seconds: int = Field(default=8, ge=4, le=10, description="Thời lượng clip (giây)")
    resolution: str = Field(default="720p", description="Độ phân giải mong muốn")
    num_outputs: int = Field(default=1, ge=1, le=4, description="Số video output")
    seed: Optional[int] = Field(default=None, description="Random seed (không bảo đảm giống hệt)")

    # Cho mode frames / ingredients
    image_path: Optional[str] = Field(default=None, description="Đường dẫn ảnh input (local)")
    end_image_path: Optional[str] = Field(default=None, description="Ảnh frame cuối (nếu có)")

    # Cho mode extend
    source_video_id: Optional[str] = Field(default=None, description="Video ID nguồn để extend")
    continuation_prompt: Optional[str] = Field(default=None, description="Prompt tiếp cảnh")


class VeoJobOut(BaseModel):
    """Trạng thái và kết quả của một job."""
    job_id: str
    status: JobStatus = JobStatus.PENDING
    input_mode: InputMode = InputMode.TEXT_TO_VIDEO
    prompt: str = ""
    model_display_name: str = ""
    aspect_ratio: str = "16:9"
    duration_seconds: int = 8
    resolution: str = "720p"
    num_outputs: int = 1

    # Progress
    current_step: str = ""           # Bước hiện tại đang xử lý
    error_message: Optional[str] = None

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
    aspect_ratios: list[str] = Field(default=["16:9", "9:16"])
    max_outputs: int = 4
    last_verified: Optional[str] = None
    note: str = "Dữ liệu từ tài liệu Google Help. Cần xác minh runtime trước khi dispatch."


class ManualCredentialRequest(BaseModel):
    """Yêu cầu lưu credential thủ công từ UI Cài đặt."""
    email: str
    cookie: str
    access_token: str = ""

