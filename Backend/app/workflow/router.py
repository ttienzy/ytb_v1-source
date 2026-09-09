from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.workflow.schemas import (
    GeminiAnalysisRequest,
    GeminiAnalysisResponse,
    GeminiPromptResponse,
    GptPromptResponse,
    GptScriptRequest,
    GptScriptResponse,
    WorkflowAssetUploadResponse,
    WorkflowExportRequest,
    WorkflowExportResponse,
    ExportedVideoListResponse,
)
from app.workflow.service import (
    concat_workflow_scenes,
    delete_exported_video,
    execute_gemini_analysis,
    execute_gpt_script_generation,
    get_default_gemini_prompt,
    get_default_gpt_prompt,
    get_workflow_asset_path,
    list_exported_videos,
    open_export_folder_in_explorer,
    parse_analysis_to_structured,
    parse_gpt_scripts,
    save_workflow_asset,
    WORKFLOW_EXPORTS_DIR,
    VEO_DATA_DIR,
)

router = APIRouter(prefix="/api/workflow", tags=["Workflow"])


# ─────────────────────────────────────────────────────────────────────────────
# Asset Management Endpoints
# ─────────────────────────────────────────────────────────────────────────────

MAX_ASSET_SIZE = 20 * 1024 * 1024  # 20MB
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VALID_KINDS = {"product", "model", "scene"}


@router.post("/assets/upload", response_model=WorkflowAssetUploadResponse)
async def upload_asset(
    file: UploadFile = File(...),
    kind: str = Form("product"),
) -> WorkflowAssetUploadResponse:
    """Upload ảnh sản phẩm/nhân vật/bối cảnh, lưu file trên disk và trả về AssetRef."""
    if kind not in VALID_KINDS:
        kind = "product"

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File tải lên rỗng.")
    if len(content) > MAX_ASSET_SIZE:
        raise HTTPException(status_code=413, detail="File tải lên quá lớn (tối đa 20MB).")

    # Kiểm tra MIME type từ header và magic bytes
    content_type = (file.content_type or "").lower()
    is_valid_mime = content_type in ALLOWED_MIME_TYPES
    is_valid_magic = (
        content.startswith(b"\xff\xd8\xff")  # JPEG
        or content.startswith(b"\x89PNG\r\n\x1a\n")  # PNG
        or (content[:4] == b"RIFF" and content[8:12] == b"WEBP")  # WEBP
    )
    if not is_valid_magic and not is_valid_mime:
        raise HTTPException(
            status_code=400,
            detail="Định dạng file không được hỗ trợ. Chỉ cho phép ảnh JPG, PNG hoặc WEBP.",
        )

    # Sanitize filename & extension
    raw_ext = Path(file.filename or "asset.jpg").suffix.lower()
    ext = raw_ext if raw_ext in ALLOWED_EXTENSIONS else ".jpg"
    safe_filename = f"{Path(file.filename or 'asset').stem[:40]}{ext}"

    try:
        return await run_in_threadpool(
            save_workflow_asset,
            file_bytes=content,
            filename=safe_filename,
            kind=kind,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi upload asset: {exc}",
        ) from exc


@router.get("/assets/{asset_id}")
async def get_asset(asset_id: str):
    """Phục vụ file ảnh asset theo ID."""
    p = get_workflow_asset_path(asset_id)
    if not p or not p.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy asset.")
    
    media_type = "image/jpeg" if p.suffix.lower() in [".jpg", ".jpeg"] else "image/png"
    return FileResponse(p, media_type=media_type)


# ─────────────────────────────────────────────────────────────────────────────
# AI Analysis & Scripting Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/prompts/gemini", response_model=GeminiPromptResponse)
def get_gemini_prompt() -> GeminiPromptResponse:
    """Lấy nội dung prompt phân tích sản phẩm mặc định từ file prompts của Backend."""
    prompt = get_default_gemini_prompt()
    return GeminiPromptResponse(prompt=prompt)


@router.post("/gemini/analyze", response_model=GeminiAnalysisResponse)
async def analyze_product(req: GeminiAnalysisRequest) -> GeminiAnalysisResponse:
    """Gửi ảnh sản phẩm và prompt tới Google Gemini Web để phân tích chi tiết."""
    valid_images = [img for img in req.images if img and img.strip()]
    if not valid_images:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng cung cấp ít nhất 1 ảnh sản phẩm để Gemini phân tích.",
        )

    prompt = req.prompt.strip() if req.prompt and req.prompt.strip() else get_default_gemini_prompt()

    try:
        raw_text = await run_in_threadpool(
            execute_gemini_analysis,
            prompt=prompt,
            images=valid_images,
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
            product_analysis=req.product_analysis,
            assets=req.assets,
            scene_config=req.scene_config,
            script_config=req.script_config.model_dump() if req.script_config else None,
            prompt_template=req.prompt_template,
            model=req.model,
        )
        expected_count = 3
        if req.script_config and req.script_config.count:
            expected_count = req.script_config.count
        elif req.scene_config and isinstance(req.scene_config, dict):
            expected_count = req.scene_config.get("count", 3)
        scripts = parse_gpt_scripts(raw_text, expected_count=expected_count)
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


# ─────────────────────────────────────────────────────────────────────────────
# Video Concatenation & Export Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/export", response_model=WorkflowExportResponse)
async def export_workflow_video(req: WorkflowExportRequest) -> WorkflowExportResponse:
    """Ghép nối các video phân cảnh thành 1 file MP4 hoàn chỉnh bằng FFmpeg."""
    try:
        return await run_in_threadpool(
            concat_workflow_scenes,
            scene_video_paths=req.scene_video_paths,
            bgm_path=req.bgm_path,
            output_filename=req.output_filename,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi xuất ghép nối video: {exc}",
        ) from exc


@router.get("/exports")
async def get_all_exported_videos():
    """Lấy danh sách tất cả các video đã xuất trong thư viện."""
    items = await run_in_threadpool(list_exported_videos)
    return {"items": items, "total": len(items)}


@router.delete("/exports/{filename}")
async def remove_exported_video(filename: str):
    """Xóa file video đã xuất khỏi thư viện."""
    try:
        ok = await run_in_threadpool(delete_exported_video, filename=filename)
        return {"ok": ok, "filename": filename}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi khi xóa video: {exc}") from exc


@router.post("/exports/{filename}/open-folder")
async def open_export_in_explorer(filename: str):
    """Mở thư mục chứa video trên Windows File Explorer và chọn file."""
    try:
        ok = await run_in_threadpool(open_export_folder_in_explorer, filename=filename)
        return {"ok": ok, "filename": filename}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi khi mở thư mục: {exc}") from exc


@router.get("/exports/{filename}")
async def get_exported_video(filename: str):
    """Stream hoặc tải về file video hoàn chỉnh hoặc clip phân cảnh Veo."""
    base_name = Path(filename).name
    p = WORKFLOW_EXPORTS_DIR / base_name
    if not p.exists() or not p.is_file():
        p = VEO_DATA_DIR / base_name
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file video.")
    return FileResponse(p, media_type="video/mp4")



