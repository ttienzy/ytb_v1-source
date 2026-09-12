from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field

DEFAULT_CLIP_DURATION_SECONDS = 10


class GeminiPromptResponse(BaseModel):
    prompt: str = Field(description="Nội dung prompt phân tích sản phẩm mặc định")


class GeminiAnalysisRequest(BaseModel):
    images: list[str] = Field(default_factory=list, description="Danh sách ảnh (data URLs base64 hoặc file paths)")
    prompt: Optional[str] = Field(default=None, description="Prompt tùy chỉnh. Nếu None, dùng prompt mặc định từ file.")
    provider: Optional[str] = Field(default="gemini", description="AI provider: 'gemini' (mặc định với auto-refresh) hoặc '9router' (ChatGPT vision)")


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
    provider_used: Optional[str] = Field(default="gemini", description="AI provider đã xử lý phân tích")


class GptPromptResponse(BaseModel):
    prompt: str = Field(description="Prompt mẫu tạo kịch bản bán hàng")


class GptScriptItem(BaseModel):
    phase: Optional[str] = Field(default=None, description="Giai đoạn phễu: Hook | Reveal | Demo | CTA")
    angle: str = Field(description="Tên góc tiếp cận (Góc 1 / Góc 2 / Review chân thực...)")
    title: str = Field(default="", description="Tiêu đề tóm tắt kịch bản")
    content: str = Field(description="Toàn văn kịch bản")
    voiceover: Optional[str] = Field(default=None, description="Lời đọc thoại tiếng Việt (Voiceover)")
    visual_direction: Optional[str] = Field(default=None, description="Chỉ dẫn hình ảnh tiếng Anh cho Veo (camera, lighting, character)")
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
    story_mode: str = Field(default="sequential", description="sequential (chuỗi liên hoàn) hoặc independent (clip độc lập)")
    clip_duration_seconds: int = Field(default=DEFAULT_CLIP_DURATION_SECONDS, ge=1, le=60, description="Thời lượng một clip Google Flow")
    min_words: Optional[int] = Field(default=None, ge=1, description="Số từ tối thiểu; để trống để tính theo thời lượng clip")
    max_words: Optional[int] = Field(default=None, ge=1, description="Số từ tối đa; để trống để tính theo thời lượng clip")
    platform: Optional[str] = Field(default="auto", description="Nền tảng mục tiêu: auto, tiktok, reels, shorts")
    voice_id: Optional[str] = Field(default=None, description="ID giọng đọc VieNeu-TTS cho Brand Voice")
    character_profile: Optional[str] = Field(default=None, description="Mô tả nhân vật tham chiếu bằng tiếng Anh")
    scene_profile: Optional[str] = Field(default=None, description="Mô tả bối cảnh không gian bằng tiếng Anh")


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


class WorkflowVoiceoverItem(BaseModel):
    """Kết quả TTS cho 1 phân cảnh."""
    index: int = Field(description="Số thứ tự phân cảnh (0-based)")
    text: str = Field(description="Lời thoại gốc")
    audio_url: str = Field(description="URL để stream/download audio")
    file_path: str = Field(description="Đường dẫn file trên disk")
    duration_sec: float = Field(default=0.0, description="Thời lượng audio giây")


class WorkflowVoiceoverRequest(BaseModel):
    """Yêu cầu sinh voiceover cho danh sách lời thoại từ VieNeu-TTS."""
    voice_id: str = Field(..., description="ID giọng đọc trong voice-service")
    scripts: list[str] = Field(..., min_length=1, description="Danh sách lời thoại voiceover từng phân cảnh")
    combine_all: bool = Field(default=True, description="Ghép thành 1 file duy nhất hay trả riêng từng phân cảnh")


class WorkflowVoiceoverResponse(BaseModel):
    voice_id: str
    items: list[WorkflowVoiceoverItem] = Field(default_factory=list)
    combined_audio_url: Optional[str] = None
    combined_file_path: Optional[str] = None
    total_duration_sec: float = 0.0


class WorkflowExportRequest(BaseModel):
    scene_video_paths: list[str] = Field(..., min_length=1, description="Danh sách đường dẫn video từng phân cảnh cần ghép")
    bgm_path: Optional[str] = Field(default=None, description="Đường dẫn audio nền (tùy chọn)")
    bgm_track_ids: Optional[list[str]] = Field(default=None, description="Danh sách track ID nhạc nền từ DB")
    bgm_volume: float = Field(default=0.10, description="Volume nhạc nền (0.03 - 0.30, mặc định 0.10)")
    voiceover_audio_path: Optional[str] = Field(default=None, description="Đường dẫn file voiceover VieNeu-TTS (đè lên audio Veo)")
    mix_original_audio: bool = Field(default=False, description="True = trộn ambient Veo + VO; False = chỉ VO (tắt hoàn toàn tạp âm Veo)")
    veo_ambient_volume: float = Field(default=0.0, description="Volume ambient Veo clips nếu mix_original_audio=True (0.0 - 0.25)")
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


class WorkflowExtractProfilesRequest(BaseModel):
    """Yêu cầu trích xuất Canonical Character Profile & Scene Profile từ ảnh nhân vật/bối cảnh bằng AI."""
    model_image: Optional[str] = Field(default=None, description="URL hoặc data URL ảnh người mẫu/KOL")
    scene_image: Optional[str] = Field(default=None, description="URL hoặc data URL ảnh không gian/bối cảnh")
    model: Optional[str] = Field(default=None, description="Model AI sử dụng (mặc định theo cấu hình 9Router hoặc gpt-4o)")


class WorkflowExtractProfilesResponse(BaseModel):
    """Kết quả trích xuất profile tiếng Anh chuẩn hóa cho Veo."""
    character_profile: str = Field(default="", description="Mô tả nhân vật chuẩn hóa bằng tiếng Anh")
    scene_profile: str = Field(default="", description="Mô tả không gian/bối cảnh chuẩn hóa bằng tiếng Anh")


class PromptPresetItem(BaseModel):
    id: str = Field(description="Mã định danh duy nhất của preset")
    name: str = Field(description="Tên thể loại nội dung hiển thị")
    content_mode: str = Field(default="sales", description="Mã content mode: sales, review, ugc, lifestyle, tutorial, comparison, unboxing, custom...")
    prompt: str = Field(description="Nội dung template prompt")
    description: Optional[str] = Field(default=None, description="Mô tả ngắn về thể loại này")
    is_system: bool = Field(default=False, description="True nếu là mẫu mặc định của hệ thống")
    updated_at: Optional[str] = Field(default=None, description="Thời gian cập nhật gần nhất (ISO format)")


class PromptPresetCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Tên thể loại mới")
    content_mode: Optional[str] = Field(default="custom", description="Mã content mode")
    prompt: str = Field(..., min_length=10, description="Nội dung prompt template")
    description: Optional[str] = Field(default=None, max_length=300, description="Mô tả ngắn")


class PromptPresetUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100, description="Tên thể loại")
    prompt: Optional[str] = Field(default=None, min_length=10, description="Nội dung prompt template")
    description: Optional[str] = Field(default=None, max_length=300, description="Mô tả ngắn")


class PromptPresetListResponse(BaseModel):
    presets: list[PromptPresetItem] = Field(default_factory=list)

