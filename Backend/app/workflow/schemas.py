from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field

DEFAULT_CLIP_DURATION_SECONDS = 10


class GeminiPromptResponse(BaseModel):
    prompt: str = Field(description="Nội dung prompt phân tích sản phẩm mặc định")


class GeminiAnalysisRequest(BaseModel):
    images: list[str] = Field(default_factory=list, description="Danh sách ảnh (data URLs base64 hoặc file paths)")
    prompt: Optional[str] = Field(default=None, description="Prompt tùy chỉnh. Nếu None, dùng prompt mặc định từ file.")


class GeminiProductClassification(BaseModel):
    name: str = Field(default="", description="Tên / màu sắc sản phẩm")
    color_variant: Optional[str] = Field(default=None, description="Màu sắc / phiên bản")
    main_ingredients: Optional[str] = Field(default=None, description="Thành phần chính")
    core_benefits: Optional[str] = Field(default=None, description="Công dụng cốt lõi")
    experience_scent: Optional[str] = Field(default=None, description="Trải nghiệm / mùi hương")


class GeminiAnalysisResponse(BaseModel):
    raw_text: str = Field(default="", description="Toàn bộ câu trả lời dạng text Markdown từ Gemini")
    product_features: str = Field(default="", description="Điểm ăn tiền và yếu tố thu hút chung")
    features: list[str] = Field(default_factory=list, description="Danh sách các tính năng cốt lõi")
    classifications: list[GeminiProductClassification] = Field(default_factory=list, description="Phân loại chi tiết từng sản phẩm")
    key_selling_points: list[str] = Field(default_factory=list, description="Gạch đầu dòng các USP chính")
    suggested_angles: list[str] = Field(default_factory=list, description="Gợi ý góc quay / góc thể hiện video")


class GptPromptResponse(BaseModel):
    prompt: str = Field(description="Prompt mẫu tạo kịch bản bán hàng")


class GptScriptItem(BaseModel):
    angle: str = Field(description="Tên góc tiếp cận (Góc 1 / Góc 2 / Review chân thực...)")
    title: str = Field(default="", description="Tiêu đề tóm tắt kịch bản")
    content: str = Field(description="Toàn văn kịch bản")
    voiceover: Optional[str] = Field(default=None, description="Lời đọc thoại (Voiceover)")
    visual_direction: Optional[str] = Field(default=None, description="Chỉ dẫn hình ảnh / góc máy cho Veo")
    on_screen_text: Optional[str] = Field(default=None, description="Chữ hiển thị trên màn hình")
    hook: Optional[str] = Field(default=None, description="Câu mở đầu thu hút (Hook)")
    problem: Optional[str] = Field(default=None, description="Vấn đề / nhu cầu")
    product: Optional[str] = Field(default=None, description="Sản phẩm giải quyết")
    benefits: Optional[str] = Field(default=None, description="Lợi ích chính")
    cta: Optional[str] = Field(default=None, description="Kêu gọi hành động (CTA)")
    word_count: int = Field(default=0, description="Số lượng từ")


class ScriptGenerationConfig(BaseModel):
    count: int = Field(default=3, ge=1, le=10, description="Số lượng kịch bản mong muốn")
    content_mode: str = Field(default="sales", description="Loại nội dung: sales, review, ugc, lifestyle, tutorial, unboxing")
    clip_duration_seconds: int = Field(default=DEFAULT_CLIP_DURATION_SECONDS, ge=1, le=60, description="Thời lượng một clip Google Flow")
    min_words: Optional[int] = Field(default=None, ge=1, description="Số từ tối thiểu; để trống để tính theo thời lượng clip")
    max_words: Optional[int] = Field(default=None, ge=1, description="Số từ tối đa; để trống để tính theo thời lượng clip")
    platform: Optional[str] = Field(default="auto", description="Nền tảng mục tiêu: auto, tiktok, reels, shorts")


class GptScriptRequest(BaseModel):
    product_data: str = Field(default="", description="Dữ liệu phân tích sản phẩm (từ node Gemini)")
    images: list[str] = Field(default_factory=list, description="Ảnh sản phẩm từ node Products")
    product_analysis: Optional[dict[str, Any]] = Field(default=None, description="Object ProductAnalysis chi tiết")
    assets: Optional[dict[str, Any]] = Field(default=None, description="Object AssetBundle chi tiết")
    scene_config: Optional[dict[str, Any]] = Field(default=None, description="Cấu hình scene (số lượng, duration)")
    script_config: Optional[ScriptGenerationConfig] = Field(default=None, description="Cấu hình sinh kịch bản riêng biệt")
    prompt_template: Optional[str] = Field(default=None, description="Prompt tùy chỉnh. Nếu None, dùng prompt từ file.")
    model: Optional[str] = Field(default=None, description="Model GPT sử dụng (e.g. cx/gpt-5.5)")


class GptScriptResponse(BaseModel):
    raw_text: str = Field(default="", description="Nội dung kịch bản thô từ GPT")
    scripts: list[GptScriptItem] = Field(default_factory=list, description="Danh sách kịch bản đã bóc tách")
    model: str = Field(default="", description="Model đã tạo kịch bản")
    requested_count: int = Field(default=0, description="Số kịch bản được yêu cầu")
    actual_count: int = Field(default=0, description="Số kịch bản hợp lệ trả về")
    clip_duration_seconds: int = Field(default=DEFAULT_CLIP_DURATION_SECONDS, description="Thời lượng mục tiêu của mỗi clip")
    min_words: int = Field(default=0, description="Số từ lời thoại tối thiểu")
    max_words: int = Field(default=0, description="Số từ lời thoại tối đa")
    repaired: bool = Field(default=False, description="Kết quả đã qua một lượt tự sửa hay chưa")


class WorkflowAssetUploadResponse(BaseModel):
    id: str = Field(..., description="UUID định danh asset")
    kind: str = Field(default="product", description="product | model | scene")
    preview_url: str = Field(..., description="URL để preview trên frontend")
    backend_path: str = Field(..., description="Đường dẫn file thực tế trên server")
    file_name: str = Field(..., description="Tên file gốc")
    size_bytes: int = Field(default=0, description="Dung lượng file")


class WorkflowExportRequest(BaseModel):
    scene_video_paths: list[str] = Field(..., min_length=1, description="Danh sách đường dẫn video từng phân cảnh cần ghép")
    bgm_path: Optional[str] = Field(default=None, description="Đường dẫn audio nền (tùy chọn)")
    output_filename: Optional[str] = Field(default=None, description="Tên file video thành phẩm")


class WorkflowExportResponse(BaseModel):
    job_id: str = Field(..., description="ID job xuất video")
    final_video_url: str = Field(..., description="URL video hoàn chỉnh để tải hoặc stream")
    file_path: str = Field(..., description="Đường dẫn file MP4 trên server")
    duration_sec: float = Field(default=0.0, description="Tổng thời lượng video hoàn chỉnh (giây)")
    status: str = Field(default="done", description="done | error")
    error: Optional[str] = Field(default=None, description="Thông báo lỗi nếu có")


class ExportedVideoItem(BaseModel):
    id: str = Field(..., description="ID định danh video xuất")
    filename: str = Field(..., description="Tên file video MP4 trên disk")
    video_url: str = Field(..., description="URL stream hoặc xem video")
    file_path: str = Field(..., description="Đường dẫn tuyệt đối trên disk")
    size_bytes: int = Field(default=0, description="Dung lượng byte")
    duration_sec: float = Field(default=0.0, description="Thời lượng tính bằng giây")
    created_at: str = Field(..., description="Thời gian tạo ISO format")
    scene_count: Optional[int] = Field(default=None, description="Số lượng phân cảnh đã ghép")
    aspect_ratio: Optional[str] = Field(default=None, description="Tỉ lệ khung hình")
    resolution: Optional[str] = Field(default=None, description="Độ phân giải")
    title: Optional[str] = Field(default=None, description="Tiêu đề video")
    source_type: str = Field(default="export", description="export (video hoàn chỉnh) | veo_scene (clip phân cảnh Veo)")
    prompt: Optional[str] = Field(default=None, description="Prompt đã dùng tạo video nếu có")
    model_display_name: Optional[str] = Field(default=None, description="Model AI đã tạo video")


class ExportedVideoListResponse(BaseModel):
    items: list[ExportedVideoItem] = Field(default_factory=list)
    total: int = Field(default=0)

