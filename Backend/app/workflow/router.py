from __future__ import annotations

from pathlib import Path
from typing import Optional, Any
import asyncio
import logging
import subprocess
import time
import httpx
from app.watermark.service import (
    _resolve_gwr_runtime,
    _gwr_command,
    _gwr_environment,
    _parse_frame_progress,
)

logger = logging.getLogger(__name__)

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.workflow.schemas import (
    GeminiAnalysisRequest,
    GeminiAnalysisResponse,
    GeminiPromptResponse,
    GeminiPromptUpdateRequest,
    GptPromptResponse,
    GptPromptPreviewResponse,
    MotionPromptResponse,
    GptScriptRequest,
    GptScriptResponse,
    WorkflowAssetUploadResponse,
    WorkflowAssetImportVeoRequest,
    WorkflowExportRequest,
    WorkflowExportResponse,
    WorkflowVoiceoverRequest,
    WorkflowVoiceoverResponse,
    WorkflowExtractProfilesRequest,
    WorkflowExtractProfilesResponse,
    ExportedVideoListResponse,
    PromptPresetItem,
    PromptPresetCreateRequest,
    PromptPresetUpdateRequest,
    PromptPresetListResponse,
    WorkflowConfigResponse,
    MotionWorkflowConfig,
    MotionPresetItem,
    MotionPresetListResponse,
    MotionCharacterSheetRequest,
    MotionCharacterSheetResponse,
)
from app.workflow import motion_character
from app.ai.gemini.service import login_and_save_cookie
from app.ai.gemini.recap import _fresh_tokens, _gemini_config
from app.workflow.service import (
    concat_workflow_scenes,
    create_prompt_preset,
    delete_exported_video,
    delete_prompt_preset,
    execute_gemini_analysis,
    execute_chatgpt_vision_analysis,
    extract_character_scene_profiles,
    generate_validated_gpt_scripts,
    generate_voiceover_batch,
    get_all_prompt_presets,
    get_default_gemini_prompt,
    save_default_gemini_prompt,
    reset_system_gemini_prompt,
    get_default_gpt_prompt,
    get_default_motion_prompt,
    get_motion_workflow_config,
    save_motion_workflow_config,
    get_motion_presets,
    get_workflow_config,
    get_workflow_asset_path,
    import_veo_image_to_workflow,
    list_exported_videos,
    open_export_folder_in_explorer,
    parse_analysis_to_structured,
    preview_gpt_script_prompt,
    save_workflow_asset,
    update_prompt_preset,
    VOICEOVER_DIR,
    WORKFLOW_EXPORTS_DIR,
    VEO_DATA_DIR,
)

router = APIRouter(prefix="/api/workflow", tags=["Workflow"])


@router.get("/config", response_model=WorkflowConfigResponse)
def workflow_config() -> WorkflowConfigResponse:
    return get_workflow_config()


# ─────────────────────────────────────────────────────────────────────────────
# Asset Management Endpoints
# ─────────────────────────────────────────────────────────────────────────────

MAX_ASSET_SIZE = 20 * 1024 * 1024  # 20MB
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
    is_valid_magic = (
        content.startswith(b"\xff\xd8\xff")  # JPEG
        or content.startswith(b"\x89PNG\r\n\x1a\n")  # PNG
        or (content[:4] == b"RIFF" and content[8:12] == b"WEBP")  # WEBP
    )
    # A client-controlled MIME header is not sufficient; reject spoofed files
    # before they reach the AI providers or image decoders.
    if not is_valid_magic:
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


@router.post("/assets/from-veo", response_model=WorkflowAssetUploadResponse)
async def import_asset_from_veo(req: WorkflowAssetImportVeoRequest) -> WorkflowAssetUploadResponse:
    """Import ảnh từ thư viện Veo Studio thành một Asset chính thức của Workflow."""
    try:
        return await run_in_threadpool(
            import_veo_image_to_workflow,
            image_id=req.image_id,
            kind=req.kind or "product",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi import ảnh từ Veo: {exc}",
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


@router.put("/prompts/gemini", response_model=GeminiPromptResponse)
def update_gemini_prompt(req: GeminiPromptUpdateRequest) -> GeminiPromptResponse:
    """Lưu prompt tùy biến của người dùng làm prompt mặc định lâu dài cho Gemini Vision."""
    try:
        saved = save_default_gemini_prompt(req.prompt)
        return GeminiPromptResponse(prompt=saved)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/prompts/gemini/reset", response_model=GeminiPromptResponse)
def reset_gemini_prompt() -> GeminiPromptResponse:
    """Khôi phục prompt phân tích Gemini về mẫu mặc định gốc của hệ thống."""
    prompt = reset_system_gemini_prompt()
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
    """Gửi ảnh sản phẩm và prompt tới Google Gemini Web hoặc tài khoản ChatGPT web để phân tích chi tiết."""
    valid_images = [img for img in req.images if img and img.strip()]
    if not valid_images:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng cung cấp ít nhất 1 ảnh sản phẩm để AI phân tích.",
        )

    prompt = req.prompt.strip() if req.prompt and req.prompt.strip() else get_default_gemini_prompt()
    provider = (req.provider or "gemini").lower().strip()

    try:
        if provider in ("chatgpt", "9router"):          # "9router": giá trị cũ còn lưu trong sơ đồ workflow -> ChatGPT web
            raw_text = await run_in_threadpool(
                execute_chatgpt_vision_analysis,
                prompt=prompt,
                images=valid_images,
            )
            return parse_analysis_to_structured(raw_text, provider_used="chatgpt")
        else:
            raw_text, provider_used = await run_in_threadpool(
                execute_gemini_analysis,
                prompt=prompt,
                images=valid_images,
                allow_refresh=True,
                fallback_to_chatgpt=False,
            )
            return parse_analysis_to_structured(raw_text, provider_used=provider_used)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi phân tích ({provider}): {exc}",
        ) from exc


@router.get("/prompts/gpt", response_model=GptPromptResponse)
def get_gpt_prompt(
    preset_id: Optional[str] = Query(None, description="ID của thể loại kịch bản"),
    content_mode: Optional[str] = Query(None, description="Mã content mode"),
) -> GptPromptResponse:
    """Lấy prompt mẫu sinh kịch bản theo thể loại được chỉ định hoặc thể loại mặc định."""
    prompt = get_default_gpt_prompt(preset_id=preset_id, content_mode=content_mode)
    return GptPromptResponse(prompt=prompt)


@router.get("/prompts/motion", response_model=MotionPromptResponse)
def get_motion_prompt() -> MotionPromptResponse:
    """Lấy prompt mẫu Motion Control từ Backend/prompts/workflow/motion_control_prompt.txt."""
    prompt = get_default_motion_prompt()
    return MotionPromptResponse(prompt=prompt)


@router.get("/motion/config", response_model=MotionWorkflowConfig)
def get_motion_config() -> MotionWorkflowConfig:
    """Lấy cấu hình lưu trữ bền vững của Motion Control."""
    return get_motion_workflow_config()


@router.put("/motion/config", response_model=MotionWorkflowConfig)
def update_motion_config(req: MotionWorkflowConfig) -> MotionWorkflowConfig:
    """Cập nhật và lưu cấu hình bền vững cho Motion Control vào config.json."""
    return save_motion_workflow_config(req)


@router.get("/motion/presets", response_model=MotionPresetListResponse)
def list_motion_presets() -> MotionPresetListResponse:
    """Lấy danh sách các mẫu phong cách chuyển động cho Motion Control."""
    presets = get_motion_presets()
    return MotionPresetListResponse(presets=[MotionPresetItem(**p) for p in presets])


@router.post("/motion/character-sheet", response_model=MotionCharacterSheetResponse)
def create_motion_character_sheet(req: MotionCharacterSheetRequest) -> MotionCharacterSheetResponse:
    """Node tùy chọn "Tạo ảnh nhân vật mới": ảnh người + ảnh trang phục -> ảnh tham chiếu nhân vật (ChatGPT, mẫu look sheet).

    Chạy đồng bộ (thường 40–70 giây), không gọi Flow, không tự thử lại. Kết quả là asset workflow để gắn vào ô Nhân Vật.
    """
    try:
        result = motion_character.generate(req.identity_path, req.outfit_path, req.changes)
    except motion_character.CharacterSheetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except motion_character.CharacterSheetBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - lỗi tài khoản/giới hạn ChatGPT: báo nguyên văn
        logger.exception("Tạo ảnh nhân vật Motion Control lỗi")
        raise HTTPException(status_code=502, detail=f"ChatGPT không tạo được ảnh nhân vật: {exc}") from exc
    asset = result["asset"].model_copy(update={"data_url": None})   # ảnh lớn: frontend xem qua preview_url
    return MotionCharacterSheetResponse(asset=asset, prompt=result["prompt"], template=result["template"],
                                        seconds=result["seconds"])


@router.get("/prompt-presets", response_model=PromptPresetListResponse)
def list_prompt_presets() -> PromptPresetListResponse:
    """Lấy danh sách các mẫu thể loại kịch bản kèm prompt chuyên biệt."""
    presets = get_all_prompt_presets()
    return PromptPresetListResponse(presets=[PromptPresetItem(**p) for p in presets])


@router.post("/prompt-presets", response_model=PromptPresetItem)
def create_new_prompt_preset(req: PromptPresetCreateRequest) -> PromptPresetItem:
    """Lưu một mẫu thể loại kịch bản mới kèm prompt tùy chỉnh."""
    try:
        new_preset = create_prompt_preset(
            name=req.name,
            prompt=req.prompt,
            content_mode=req.content_mode or "custom",
            description=req.description,
            is_default=bool(req.is_default),
        )
        return PromptPresetItem(**new_preset)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/prompt-presets/{preset_id}", response_model=PromptPresetItem)
def update_existing_prompt_preset(preset_id: str, req: PromptPresetUpdateRequest) -> PromptPresetItem:
    """Cập nhật nội dung prompt, tên hoặc trạng thái mặc định của thể loại kịch bản."""
    try:
        updated = update_prompt_preset(
            preset_id=preset_id,
            name=req.name,
            prompt=req.prompt,
            description=req.description,
            is_default=req.is_default,
        )
        return PromptPresetItem(**updated)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/prompt-presets/{preset_id}")
def delete_existing_prompt_preset(preset_id: str) -> dict[str, Any]:
    """Xóa một mẫu thể loại kịch bản tùy chỉnh (không thể xóa mẫu hệ thống)."""
    try:
        ok = delete_prompt_preset(preset_id)
        return {"ok": ok, "deleted_id": preset_id}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@router.post("/gpt/preview-prompt", response_model=GptPromptPreviewResponse)
async def preview_script_prompt(req: GptScriptRequest) -> GptPromptPreviewResponse:
    """Dựng prompt thực tế của batch đầu tiên mà không gọi model."""
    try:
        script_config = req.script_config.model_dump() if req.script_config else None
        user_prompt, system_prompt = await run_in_threadpool(
            preview_gpt_script_prompt,
            product_data=req.product_data,
            images=req.images,
            product_analysis=req.product_analysis,
            assets=req.assets,
            scene_config=req.scene_config,
            script_config=script_config,
            prompt_template=req.prompt_template,
        )
        return GptPromptPreviewResponse(user_prompt=user_prompt, system_prompt=system_prompt)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Không thể dựng prompt xem trước: {exc}") from exc


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


WORKFLOW_CLEAN_DIR = WORKFLOW_EXPORTS_DIR / "clean_cache"
WORKFLOW_CLEAN_DIR.mkdir(parents=True, exist_ok=True)

clean_export_jobs: dict[str, dict] = {}


def _clean_single_video_sync(input_path: Path, output_path: Path, job_key: str) -> bool:
    """Xóa watermark khỏi file video bằng GWR runtime (Playwright Headless)."""
    runtime = _resolve_gwr_runtime()
    if runtime is None:
        raise FileNotFoundError("Watermark runtime is unavailable")
    if not runtime.video_available:
        raise RuntimeError("Trình duyệt xử lý video không có trong watermark runtime.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [*_gwr_command(runtime), "remove", str(input_path), "--output", str(output_path), "--overwrite"]
    logger.info("[workflow.clean] Running gwr remove: %s", " ".join(cmd))

    stderr_tail: list[str] = []
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=_gwr_environment(runtime),
    )

    assert proc.stderr is not None
    for line in proc.stderr:
        line = line.strip()
        if line:
            logger.debug("[gwr] %s", line)
            stderr_tail.append(line)
            del stderr_tail[:-8]
        processed, total = _parse_frame_progress(line)
        if processed is not None and job_key in clean_export_jobs:
            clean_export_jobs[job_key]["processed_frames"] = processed
            if total is not None:
                clean_export_jobs[job_key]["frame_estimate"] = total
            clean_export_jobs[job_key]["updated_at"] = time.time()

    proc.wait()
    if proc.returncode == 0 and output_path.is_file() and output_path.stat().st_size > 0:
        logger.info("[workflow.clean] Xóa watermark hoàn tất: %s", output_path.name)
        return True

    detail = stderr_tail[-1] if stderr_tail else f"exit code {proc.returncode}"
    if proc.returncode == 0:
        detail = "Lệnh gwr hoàn tất nhưng không tạo file đầu ra hợp lệ"
    raise RuntimeError(f"gwr error: {detail}")


async def _run_clean_export_job(orig_path: Path, base_name: str, mute: bool, job_key: str):
    stem = orig_path.stem
    base_clean_file = WORKFLOW_CLEAN_DIR / f"{stem}_clean.mp4"
    muted_clean_file = WORKFLOW_CLEAN_DIR / f"{stem}_clean_no_audio.mp4"

    job = clean_export_jobs.get(job_key)
    if not job:
        return
    job["status"] = "running"

    try:
        # Bước 1: Xóa watermark bằng GWR nếu chưa có hoặc cũ hơn file gốc
        if not base_clean_file.exists() or base_clean_file.stat().st_mtime < orig_path.stat().st_mtime:
            await asyncio.to_thread(
                _clean_single_video_sync,
                input_path=orig_path,
                output_path=base_clean_file,
                job_key=job_key,
            )

        # Bước 2: Nếu yêu cầu mute, tách audio bằng FFmpeg lossless copy
        target_file = base_clean_file
        if mute:
            if not muted_clean_file.exists() or muted_clean_file.stat().st_mtime < base_clean_file.stat().st_mtime:
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(base_clean_file),
                    "-c:v", "copy",
                    "-an",
                    str(muted_clean_file),
                ]
                proc = await run_in_threadpool(subprocess.run, cmd, capture_output=True, timeout=30)
                if proc.returncode != 0 or not muted_clean_file.exists() or muted_clean_file.stat().st_size == 0:
                    raise RuntimeError("Lỗi khi tách tiếng từ video đã xóa watermark")
            target_file = muted_clean_file

        job["status"] = "done"
        job["output_file"] = str(target_file)
        job["download_url"] = f"/api/workflow/exports/{base_name}?clean=true&mute={'true' if mute else 'false'}"
        job["updated_at"] = time.time()
    except Exception as exc:
        logger.exception("Lỗi trong quá trình xóa watermark video export %s: %s", base_name, exc)
        job["status"] = "error"
        job["error"] = str(exc)
        job["updated_at"] = time.time()


@router.get("/exports/{filename}/clean-status")
async def get_export_clean_status(filename: str, mute: bool = False):
    """Kiểm tra trạng thái xóa watermark và tiến trình real-time của video export."""
    base_name = Path(filename).name
    stem = Path(base_name).stem

    orig_path = WORKFLOW_EXPORTS_DIR / base_name
    if not orig_path.exists() or not orig_path.is_file():
        orig_path = VEO_DATA_DIR / base_name
    if not orig_path.exists() or not orig_path.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file video.")

    target_file = WORKFLOW_CLEAN_DIR / (f"{stem}_clean_no_audio.mp4" if mute else f"{stem}_clean.mp4")
    cached = target_file.exists() and target_file.stat().st_size > 0 and target_file.stat().st_mtime >= orig_path.stat().st_mtime

    job_key = f"{base_name}_{'mute' if mute else 'audio'}"
    job = clean_export_jobs.get(job_key)

    is_processing = job is not None and job.get("status") in ("pending", "running")
    status = job.get("status") if job else ("done" if cached else "idle")

    return {
        "filename": base_name,
        "mute": mute,
        "cached": cached,
        "is_processing": is_processing,
        "status": status,
        "download_url": f"/api/workflow/exports/{base_name}?clean=true&mute={'true' if mute else 'false'}" if cached else None,
        "processed_frames": job.get("processed_frames", 0) if job else 0,
        "frame_estimate": job.get("frame_estimate", 0) if job else 0,
        "error": job.get("error") if job else None,
    }


@router.post("/exports/{filename}/clean")
async def trigger_export_clean(filename: str, mute: bool = False):
    """Kích hoạt tác vụ xóa watermark bằng AI trong nền cho video export."""
    base_name = Path(filename).name
    stem = Path(base_name).stem

    orig_path = WORKFLOW_EXPORTS_DIR / base_name
    if not orig_path.exists() or not orig_path.is_file():
        orig_path = VEO_DATA_DIR / base_name
    if not orig_path.exists() or not orig_path.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file video.")

    target_file = WORKFLOW_CLEAN_DIR / (f"{stem}_clean_no_audio.mp4" if mute else f"{stem}_clean.mp4")
    if target_file.exists() and target_file.stat().st_size > 0 and target_file.stat().st_mtime >= orig_path.stat().st_mtime:
        return {
            "cached": True,
            "status": "done",
            "download_url": f"/api/workflow/exports/{base_name}?clean=true&mute={'true' if mute else 'false'}",
        }

    job_key = f"{base_name}_{'mute' if mute else 'audio'}"
    current = clean_export_jobs.get(job_key)
    if current and current.get("status") in ("pending", "running"):
        return {
            "cached": False,
            "status": current["status"],
            "processed_frames": current.get("processed_frames", 0),
            "frame_estimate": current.get("frame_estimate", 0),
        }

    clean_export_jobs[job_key] = {
        "status": "pending",
        "processed_frames": 0,
        "frame_estimate": 0,
        "error": None,
        "output_file": None,
        "download_url": None,
        "updated_at": time.time(),
    }

    asyncio.create_task(_run_clean_export_job(orig_path, base_name, mute, job_key))
    return {
        "cached": False,
        "status": "pending",
        "job_key": job_key,
    }


@router.get("/exports/{filename}")
async def get_exported_video(filename: str, mute: bool = False, clean: bool = False):
    """Stream hoặc tải về file video (hỗ trợ ?mute=true và ?clean=true)."""
    base_name = Path(filename).name
    stem = Path(base_name).stem
    p = WORKFLOW_EXPORTS_DIR / base_name
    if not p.exists() or not p.is_file():
        p = VEO_DATA_DIR / base_name
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file video.")

    if clean:
        clean_file = WORKFLOW_CLEAN_DIR / (f"{stem}_clean_no_audio.mp4" if mute else f"{stem}_clean.mp4")
        if clean_file.exists() and clean_file.stat().st_size > 0:
            dl_name = f"{stem}_clean_no_audio.mp4" if mute else f"{stem}_clean.mp4"
            return FileResponse(
                clean_file,
                media_type="video/mp4",
                filename=dl_name,
                headers={"Content-Disposition": f'attachment; filename="{dl_name}"'},
            )
        base_clean = WORKFLOW_CLEAN_DIR / f"{stem}_clean.mp4"
        if mute and base_clean.exists() and base_clean.stat().st_size > 0:
            cmd = ["ffmpeg", "-y", "-i", str(base_clean), "-c:v", "copy", "-an", str(clean_file)]
            await run_in_threadpool(subprocess.run, cmd, capture_output=True, timeout=30)
            if clean_file.exists() and clean_file.stat().st_size > 0:
                dl_name = f"{stem}_clean_no_audio.mp4"
                return FileResponse(
                    clean_file,
                    media_type="video/mp4",
                    filename=dl_name,
                    headers={"Content-Disposition": f'attachment; filename="{dl_name}"'},
                )
        raise HTTPException(
            status_code=404,
            detail="Video chưa được xóa watermark. Vui lòng kích hoạt xóa watermark qua POST /api/workflow/exports/{filename}/clean trước.",
        )

    if mute:
        muted_dir = WORKFLOW_EXPORTS_DIR / "muted_cache"
        muted_dir.mkdir(parents=True, exist_ok=True)
        muted_file = muted_dir / f"{stem}_noaudio.mp4"

        # Nếu file muted chưa tồn tại hoặc file gốc mới hơn, tạo file không tiếng bằng FFmpeg stream copy (-c:v copy -an)
        if not muted_file.exists() or muted_file.stat().st_mtime < p.stat().st_mtime:
            cmd = [
                "ffmpeg", "-y",
                "-i", str(p),
                "-c:v", "copy",
                "-an",
                str(muted_file),
            ]
            proc = await run_in_threadpool(subprocess.run, cmd, capture_output=True, timeout=30)
            if proc.returncode != 0 or not muted_file.exists() or muted_file.stat().st_size == 0:
                logger.warning("Lỗi khi tách âm thanh bằng FFmpeg: %s", proc.stderr.decode(errors="ignore") if proc.stderr else "")
                return FileResponse(p, media_type="video/mp4")

        download_name = f"{stem}_no_audio.mp4"
        return FileResponse(
            muted_file,
            media_type="video/mp4",
            filename=download_name,
            headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
        )

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

@router.post("/exports/{filename}/reference")
async def attach_reference_video(filename: str, file: UploadFile = File(...)):
    """Gắn hoặc cập nhật video gốc tham chiếu cho clip Veo / Motion Control."""
    base_name = Path(filename).name
    veo_p = VEO_DATA_DIR / base_name
    if not veo_p.exists():
        # Kiểm tra trong WORKFLOW_EXPORTS_DIR
        veo_p = WORKFLOW_EXPORTS_DIR / base_name
        if not veo_p.exists():
            raise HTTPException(status_code=404, detail="Không tìm thấy video")

    ref_dir = DATA_DIR / "media" / "veo_references"
    ref_dir.mkdir(parents=True, exist_ok=True)
    ref_filename = f"{veo_p.stem}_ref.mp4"
    target_ref = ref_dir / ref_filename
    
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="File video rỗng")
    target_ref.write_bytes(file_bytes)

    ref_url = f"/api/veo/references/{ref_filename}"

    # Cập nhật metadata .json
    meta_p = veo_p.with_suffix(".json")
    meta = {}
    if meta_p.exists():
        try:
            meta = json.loads(meta_p.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    meta["reference_video_url"] = ref_url
    try:
        meta_p.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning("Không thể cập nhật sidecar json: %s", e)

    return {
        "ok": True,
        "filename": filename,
        "reference_video_url": ref_url
    }
