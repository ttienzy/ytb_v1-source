from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from app.workflow.schemas import (
    GeminiAnalysisRequest,
    GeminiAnalysisResponse,
    GeminiPromptResponse,
    GptPromptResponse,
    GptScriptRequest,
    GptScriptResponse,
)
from app.workflow.service import (
    execute_gemini_analysis,
    execute_gpt_script_generation,
    get_default_gemini_prompt,
    get_default_gpt_prompt,
    parse_analysis_to_structured,
    parse_gpt_scripts,
)

router = APIRouter(prefix="/api/workflow", tags=["Workflow"])


@router.get("/prompts/gemini", response_model=GeminiPromptResponse)
def get_gemini_prompt() -> GeminiPromptResponse:
    """Lấy nội dung prompt phân tích sản phẩm mặc định từ file prompts của Backend."""
    prompt = get_default_gemini_prompt()
    return GeminiPromptResponse(prompt=prompt)


@router.post("/gemini/analyze", response_model=GeminiAnalysisResponse)
async def analyze_product(req: GeminiAnalysisRequest) -> GeminiAnalysisResponse:
    """Gửi ảnh sản phẩm và prompt tới Google Gemini Web để phân tích chi tiết."""
    prompt = req.prompt.strip() if req.prompt and req.prompt.strip() else get_default_gemini_prompt()

    try:
        raw_text = await run_in_threadpool(
            execute_gemini_analysis,
            prompt=prompt,
            images=req.images,
        )
        return parse_analysis_to_structured(raw_text)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi phân tích Gemini: {exc}",
        ) from exc


@router.get("/prompts/gpt", response_model=GptPromptResponse)
def get_gpt_prompt() -> GptPromptResponse:
    """Lấy nội dung prompt mẫu viết 3 kịch bản bán hàng từ file Backend."""
    prompt = get_default_gpt_prompt()
    return GptPromptResponse(prompt=prompt)


@router.post("/gpt/generate-script", response_model=GptScriptResponse)
async def generate_sales_script(req: GptScriptRequest) -> GptScriptResponse:
    """Gọi ChatGPT để tạo 3 kịch bản video bán hàng từ dữ liệu sản phẩm và ảnh."""
    try:
        raw_text, used_model = await run_in_threadpool(
            execute_gpt_script_generation,
            product_data=req.product_data,
            images=req.images,
            prompt_template=req.prompt_template,
            model=req.model,
        )
        scripts = parse_gpt_scripts(raw_text)
        return GptScriptResponse(
            raw_text=raw_text,
            scripts=scripts,
            model=used_model,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi tạo kịch bản GPT: {exc}",
        ) from exc

