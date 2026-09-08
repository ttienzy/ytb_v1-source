from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


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
    classifications: list[GeminiProductClassification] = Field(default_factory=list, description="Phân loại chi tiết từng sản phẩm")
    key_selling_points: list[str] = Field(default_factory=list, description="Gạch đầu dòng các USP chính")
    suggested_angles: list[str] = Field(default_factory=list, description="Gợi ý góc quay / góc thể hiện video")


class GptPromptResponse(BaseModel):
    prompt: str = Field(description="Prompt mẫu tạo kịch bản bán hàng")


class GptScriptItem(BaseModel):
    angle: str = Field(description="Tên góc tiếp cận (Góc 1 / Góc 2 / Góc 3)")
    title: str = Field(default="", description="Tiêu đề tóm tắt kịch bản")
    content: str = Field(description="Toàn văn kịch bản (80-130 từ)")
    hook: Optional[str] = Field(default=None, description="Câu mở đầu thu hút (Hook)")
    problem: Optional[str] = Field(default=None, description="Vấn đề / nhu cầu")
    product: Optional[str] = Field(default=None, description="Sản phẩm giải quyết")
    benefits: Optional[str] = Field(default=None, description="Lợi ích chính")
    cta: Optional[str] = Field(default=None, description="Kêu gọi hành động (CTA)")
    word_count: int = Field(default=0, description="Số lượng từ")


class GptScriptRequest(BaseModel):
    product_data: str = Field(default="", description="Dữ liệu phân tích sản phẩm (từ node Gemini)")
    images: list[str] = Field(default_factory=list, description="Ảnh sản phẩm từ node Products")
    prompt_template: Optional[str] = Field(default=None, description="Prompt tùy chỉnh. Nếu None, dùng prompt từ file.")
    model: Optional[str] = Field(default=None, description="Model GPT sử dụng (e.g. cx/gpt-5.5)")


class GptScriptResponse(BaseModel):
    raw_text: str = Field(default="", description="Nội dung kịch bản thô từ GPT")
    scripts: list[GptScriptItem] = Field(default_factory=list, description="3 kịch bản đã bóc tách theo góc tiếp cận")
    model: str = Field(default="", description="Model đã tạo kịch bản")
