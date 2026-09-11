from __future__ import annotations

from pathlib import Path
import httpx

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
    WorkflowVoiceoverRequest,
    WorkflowVoiceoverResponse,
    WorkflowExtractProfilesRequest,
    WorkflowExtractProfilesResponse,
    ExportedVideoListResponse,
)
from app.ai.gemini.service import login_and_save_cookie
from app.ai.gemini.recap import _fresh_tokens, _gemini_config
from app.workflow.service import (
    concat_workflow_scenes,
    delete_exported_video,
    execute_gemini_analysis,
    execute_9router_vision_analysis,
    extract_character_scene_profiles,
    generate_validated_gpt_scripts,
    generate_voiceover_batch,
    get_default_gemini_prompt,
    get_default_gpt_prompt,
    get_workflow_asset_path,
    list_exported_videos,
    open_export_folder_in_explorer,
    parse_analysis_to_structured,
    save_workflow_asset,
    VOICEOVER_DIR,
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


@router.post("/gemini/refresh-cookie")
async def refresh_gemini_cookie():
    """Tự động mở Chrome profile ngầm trong 3-5 giây để làm mới cookies xác thực Gemini."""
    try:
        res = await run_in_threadpool(login_and_save_cookie)
        return {"ok": True, "cookie_count": res.get("cookie_count", 0), "has_cookie": res.get("has_cookie", False)}
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi làm mới cookie: {exc}",
        ) from exc


@router.get("/gemini/cookie-status")
async def get_gemini_cookie_status():
    """Kiểm tra xem cookie Gemini hiện tại trong config.json còn hạn không."""
    try:
        cfg = _gemini_config()
        with httpx.Client(http2=False, timeout=10) as client:
            at, bl, fsid = _fresh_tokens(client, cfg["cookies"], cfg["user_agent"])
            return {"valid": True, "at_prefix": at[:8] if at else ""}
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


@router.post("/gemini/analyze", response_model=GeminiAnalysisResponse)
async def analyze_product(req: GeminiAnalysisRequest) -> GeminiAnalysisResponse:
    """Gửi ảnh sản phẩm và prompt tới Google Gemini Web hoặc 9Router Vision để phân tích chi tiết."""
    valid_images = [img for img in req.images if img and img.strip()]
    if not valid_images:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng cung cấp ít nhất 1 ảnh sản phẩm để AI phân tích.",
        )

    prompt = req.prompt.strip() if req.prompt and req.prompt.strip() else get_default_gemini_prompt()
    provider = (req.provider or "gemini").lower().strip()

    try:
        if provider == "9router":
            raw_text = await run_in_threadpool(
                execute_9router_vision_analysis,
                prompt=prompt,
                images=valid_images,
            )
            return parse_analysis_to_structured(raw_text, provider_used="9router")
        else:
            raw_text, provider_used = await run_in_threadpool(
                execute_gemini_analysis,
                prompt=prompt,
                images=valid_images,
                allow_refresh=True,
                fallback_to_9router=False,
            )
            return parse_analysis_to_structured(raw_text, provider_used=provider_used)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi phân tích ({provider}): {exc}",
        ) from exc


@router.get("/prompts/gpt", response_model=GptPromptResponse)
def get_gpt_prompt() -> GptPromptResponse:
    """Lấy prompt mẫu sinh số lượng kịch bản động từ file Backend."""
    prompt = get_default_gpt_prompt()
    return GptPromptResponse(prompt=prompt)


@router.post("/gpt/generate-script", response_model=GptScriptResponse)
async def generate_sales_script(req: GptScriptRequest) -> GptScriptResponse:
    """Sinh và validate các kịch bản độc lập trước khi trả về frontend."""
    try:
        script_config = req.script_config.model_dump() if req.script_config else None
        raw_text, used_model, scripts, repaired, clip_duration, min_words, max_words = await run_in_threadpool(
            generate_validated_gpt_scripts,
            product_data=req.product_data,
            images=req.images,
            product_analysis=req.product_analysis,
            assets=req.assets,
            scene_config=req.scene_config,
            script_config=script_config,
            prompt_template=req.prompt_template,
            model=req.model,
        )
        requested_count = req.script_config.count if req.script_config else int((req.scene_config or {}).get("count", 3))
        return GptScriptResponse(
            raw_text=raw_text,
            scripts=scripts,
            model=used_model,
            requested_count=requested_count,
            actual_count=len(scripts),
            clip_duration_seconds=clip_duration,
            min_words=min_words,
            max_words=max_words,
            repaired=repaired,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi tạo kịch bản GPT: {exc}",
        ) from exc


@router.post("/extract-profiles", response_model=WorkflowExtractProfilesResponse)
async def extract_profiles(req: WorkflowExtractProfilesRequest) -> WorkflowExtractProfilesResponse:
    """Trích xuất Canonical Character Profile và Scene Profile tiếng Anh chuẩn từ ảnh nhân vật / bối cảnh."""
    char_prof, scene_prof = await run_in_threadpool(
        extract_character_scene_profiles,
        model_image=req.model_image,
        scene_image=req.scene_image,
        model=req.model,
    )
    return WorkflowExtractProfilesResponse(
        character_profile=char_prof,
        scene_profile=scene_prof,
    )


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
            voiceover_audio_path=req.voiceover_audio_path,
            mix_original_audio=req.mix_original_audio,
            bgm_track_ids=req.bgm_track_ids,
            bgm_volume=req.bgm_volume,
            veo_ambient_volume=req.veo_ambient_volume,
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


# ─────────────────────────────────────────────────────────────────────────────
# VieNeu-TTS Voiceover Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/generate-voiceover", response_model=WorkflowVoiceoverResponse)
async def generate_voiceover(req: WorkflowVoiceoverRequest) -> WorkflowVoiceoverResponse:
    """Sinh voiceover cho danh sách lời thoại từ VieNeu-TTS và ghép thành 1 file."""
    try:
        return await generate_voiceover_batch(
            voice_id=req.voice_id,
            scripts=req.scripts,
            combine_all=req.combine_all,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi sinh voiceover: {exc}",
        ) from exc


@router.get("/voiceovers/{job_id}/{filename}")
async def get_voiceover_audio(job_id: str, filename: str):
    """Stream file audio voiceover đã sinh."""
    base_name = Path(filename).name
    p = VOICEOVER_DIR / job_id / base_name
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file audio.")
    return FileResponse(p, media_type="audio/wav")
