"""
Veo Studio — FastAPI Router.

Endpoints:
  POST /api/veo/jobs              — Submit job tạo video
  GET  /api/veo/jobs              — Danh sách tất cả jobs
  GET  /api/veo/jobs/{job_id}     — Trạng thái job
  DELETE /api/veo/jobs/{job_id}   — Xóa job
  GET  /api/veo/status            — Bridge + Extension status
  GET  /api/veo/capabilities      — Models/configs (từ tài liệu, chưa xác minh)
  GET  /api/veo/history           — Video đã tạo
  GET  /api/veo/history/{id}/file — Stream file video
  DELETE /api/veo/history/{id}    — Xóa video
  POST /api/veo/upload-image      — Upload ảnh input (cho mode frames/ingredients)
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import threading
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse

from app.watermark import service as watermark_service

from app.veo import service
from app.veo.schemas import (
    ManualCreditsRequest,
    ManualCredentialRequest,
    VeoBridgeStatus,
    VeoCapabilities,
    VeoHistoryItem,
    VeoImageGenerateRequest,
    VeoImageGenerateResponse,
    VeoImageItem,
    VeoJobOut,
    VeoJobRequest,
    VeoProjectCreate,
    VeoProjectOut,
    VeoProjectSelect,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/veo", tags=["Veo Studio"])

# ─────────────────────────────────────────────────────────────────────────────
# Projects
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/projects", response_model=list[VeoProjectOut])
def list_projects():
    """Lấy danh sách các Project đã lưu trong SQLite DB."""
    return service.list_projects()


@router.post("/projects", response_model=VeoProjectOut)
def create_project(req: VeoProjectCreate):
    """Tạo Project mới (tự động kích hoạt trên tab Google Flow và lưu DB)."""
    try:
        return service.create_project(name=req.name, flow_project_id=req.flow_project_id)
    except (RuntimeError, TimeoutError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/active", response_model=VeoProjectOut | None)
def get_active_project():
    """Lấy thông tin Project hiện đang kích hoạt."""
    return service.get_active_project()


@router.post("/projects/{project_id}/select", response_model=VeoProjectOut)
def select_project(project_id: str):
    """Chọn Project làm việc."""
    try:
        return service.select_project(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/projects/{project_id}")
def delete_project(project_id: str):
    """Xóa Project khỏi cơ sở dữ liệu."""
    ok = service.delete_project(project_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' không tồn tại")
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Jobs
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/jobs", response_model=VeoJobOut)
def submit_job(request: VeoJobRequest):
    """Submit job tạo video mới (bắt buộc phải có project kích hoạt)."""
    try:
        return service.submit_job(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs", response_model=list[VeoJobOut])
def list_jobs():
    """Lấy danh sách tất cả jobs."""
    return service.get_all_jobs()


@router.get("/jobs/{job_id}", response_model=VeoJobOut)
def get_job(job_id: str):
    """Lấy trạng thái job theo ID."""
    job = service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' không tồn tại")
    return job


@router.post("/jobs/{job_id}/recover-current", response_model=VeoJobOut)
def recover_current_scene(job_id: str):
    """Download the completed video currently open in the Flow project tab."""
    job = service.recover_current_scene(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' không tồn tại")
    return job


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    """Xóa job khỏi danh sách."""
    ok = service.delete_job(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' không tồn tại")
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Status & Capabilities
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/status", response_model=VeoBridgeStatus)
def get_status():
    """Trạng thái Bridge Server + Extension + Accounts."""
    return service.get_bridge_status()


@router.post("/refresh-credits")
def refresh_credits():
    """Yêu cầu Extension đọc lại credits từ Google Flow và cập nhật số dư."""
    return service.trigger_refresh()


@router.post("/extension/reload")
def reload_extension():
    """Yêu cầu Extension tự nạp lại mã nguồn mới nhất (chrome.runtime.reload)."""
    from app.veo import bridge
    bridge.request_extension_reload()
    return {"ok": True, "message": "Đã gửi tín hiệu reload tới Extension"}


@router.post("/tab/reload")
def reload_tab(project_id: str = ""):
    """Yêu cầu Extension làm mới tab Google Flow."""
    from app.veo import bridge
    bridge.request_tab_reload(target_project_id=project_id)
    return {"ok": True, "message": "Đã gửi tín hiệu reload tab"}


@router.get("/prompts/motion")
def get_motion_prompt():
    """Lấy prompt mẫu Motion Control mặc định."""
    from app.workflow.service import get_default_motion_prompt
    return {"prompt": get_default_motion_prompt()}


@router.post("/manual-credentials")
def save_manual_credentials(req: ManualCredentialRequest):
    """Lưu session cookie/token thủ công từ giao diện Cài đặt."""
    return service.save_manual_credential(
        email=req.email,
        cookie=req.cookie,
        access_token=req.access_token,
        credits=req.credits,
    )


@router.post("/manual-credits")
def set_manual_credits(req: ManualCreditsRequest):
    """Cập nhật trực tiếp số dư credits cho tài khoản (ghi đè ngay lập tức)."""
    return service.set_account_credits(
        email=req.email,
        credits=req.credits,
    )


@router.get("/capabilities", response_model=VeoCapabilities)
def get_capabilities():
    """Danh sách models, durations, resolutions — từ tài liệu Google Help."""
    return service.get_capabilities()


# ─────────────────────────────────────────────────────────────────────────────
# History
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/history", response_model=list[VeoHistoryItem])
def get_history():
    """Danh sách video đã tạo thành công."""
    return service.get_history()


@router.get("/history/{video_id}/file")
def stream_video(video_id: str):
    """Stream file video để preview."""
    path = service.get_video_path(video_id)
    if not path:
        raise HTTPException(status_code=404, detail=f"Video '{video_id}' không tìm thấy")
    return FileResponse(
        path=str(path),
        media_type="video/mp4",
        filename=path.name,
    )


@router.delete("/history/{video_id}")
def delete_video(video_id: str):
    """Xóa video đã tạo."""
    ok = service.delete_video(video_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Video '{video_id}' không tìm thấy")
    return {"ok": True}


@router.post("/history/{video_id}/extract-last-frame")
def extract_last_frame(video_id: str):
    """Trích xuất frame cuối của video Veo để làm frame đầu cho phân cảnh tiếp theo."""
    try:
        return service.extract_last_frame(video_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi khi trích xuất frame cuối: {exc}") from exc


# ─────────────────────────────────────────────────────────────────────────────
# Upload (cho mode frames/ingredients)
# ─────────────────────────────────────────────────────────────────────────────

_UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "Data" / "media" / "veo_uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """Upload ảnh cho mode Image-to-Video (Frames/Ingredients)."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File phải là ảnh (image/*)")

    import uuid
    ext = Path(file.filename or "image.png").suffix or ".png"
    file_id = str(uuid.uuid4())[:12]
    dest = _UPLOAD_DIR / f"{file_id}{ext}"

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return {
        "ok": True,
        "file_id": file_id,
        "file_name": file.filename,
        "file_path": str(dest),
    }


@router.post("/tab/reload")
def reload_tab(project_id: str | None = None):
    """Gửi yêu cầu Extension làm mới tab Google Flow để xóa cờ WAF."""
    from app.veo import bridge
    bridge.request_tab_reload(project_id or "")
    return {"ok": True, "message": "Tab reload queued"}


# ─────────────────────────────────────────────────────────────────────────────
# Images (Nano Banana - Pinhole)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/images/generate", response_model=VeoImageGenerateResponse)
def generate_images(req: VeoImageGenerateRequest):
    """Sinh ảnh từ prompt qua Google Flow Nano Banana (Pro/2/Lite)."""
    resp = service.generate_images(req)
    if not resp.ok:
        raise HTTPException(status_code=400, detail=resp.error or "Tạo ảnh thất bại")
    return resp


@router.get("/images", response_model=list[VeoImageItem])
def list_images(project_id: str | None = None):
    """Lấy danh sách ảnh đã tạo."""
    return service.list_images(project_id=project_id)


@router.get("/images/{image_id}/file")
def get_image_file(image_id: str):
    """Stream file ảnh cục bộ, hoặc redirect sang Google CDN nếu file đang tải ngầm."""
    path = service.get_image_file_path(image_id)
    if path and path.exists() and path.stat().st_size > 0:
        return FileResponse(path, media_type="image/jpeg", filename=f"{image_id}.jpg")

    # Nếu file đang tải ngầm, redirect sang CDN để UI hiển thị ảnh ngay lập tức
    img = service.get_image_by_id(image_id)
    if img and img.image_url:
        return RedirectResponse(img.image_url, status_code=307)

    raise HTTPException(status_code=404, detail=f"Ảnh '{image_id}' không tìm thấy trên đĩa")


# ─────────────────────────────────────────────────────────────────────────────
# Image clean (watermark removal) cache directory
# ─────────────────────────────────────────────────────────────────────────────
_BASE_DIR = Path(__file__).resolve().parent.parent.parent  # Backend/
_VEO_IMAGES_CLEAN_DIR = _BASE_DIR / "Data" / "media" / "veo_images_clean"
_VEO_IMAGES_CLEAN_DIR.mkdir(parents=True, exist_ok=True)
_image_clean_locks_guard = threading.Lock()
_image_clean_locks: dict[str, threading.Lock] = {}


def _get_image_clean_lock(image_id: str) -> threading.Lock:
    with _image_clean_locks_guard:
        return _image_clean_locks.setdefault(image_id, threading.Lock())


def _clean_cache_is_fresh(source_path: Path, clean_path: Path) -> bool:
    return (
        clean_path.is_file()
        and clean_path.stat().st_size > 0
        and clean_path.stat().st_mtime >= source_path.stat().st_mtime
    )


def _prepare_clean_image_sync(image_id: str, source_path: Path) -> Path:
    """Create/reuse one clean cache file without duplicate concurrent GWR runs."""
    clean_path = _VEO_IMAGES_CLEAN_DIR / f"{image_id}_clean.jpg"
    with _get_image_clean_lock(image_id):
        if _clean_cache_is_fresh(source_path, clean_path):
            return clean_path
        return watermark_service.remove_image_watermark_sync(source_path, clean_path)


@router.get("/images/{image_id}/clean")
async def get_image_file_clean(image_id: str):
    """Trả file ảnh đã xóa watermark. Kết quả được cache trong veo_images_clean/."""
    image = service.get_image_by_id(image_id)
    if not image:
        raise HTTPException(status_code=404, detail=f"Ảnh '{image_id}' không tồn tại")

    # Ảnh vừa tạo có thể mới chỉ có CDN URL. Chờ/tải file local trong thread
    # pool để thao tác tải về không bị lỗi do background download chưa xong.
    path = await run_in_threadpool(service.ensure_image_file_path, image_id)
    if not path:
        raise HTTPException(
            status_code=502,
            detail="Không thể tải ảnh gốc từ Google Flow. URL ảnh có thể đã hết hạn.",
        )

    try:
        clean_path = await run_in_threadpool(_prepare_clean_image_sync, image_id, path)
    except watermark_service.WatermarkRuntimeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FileResponse(clean_path, media_type="image/jpeg", filename=f"{image_id}_clean.jpg")


@router.delete("/images/{image_id}")
def delete_image(image_id: str):
    """Xóa ảnh khỏi thư viện."""
    ok = service.delete_image(image_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Ảnh '{image_id}' không tìm thấy")
    # Xóa luôn file clean cache nếu có
    clean_cache = _VEO_IMAGES_CLEAN_DIR / f"{image_id}_clean.jpg"
    if clean_cache.exists():
        clean_cache.unlink(missing_ok=True)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Video Upload (reference for Video-to-Video Omni Flash 1.1)
# ─────────────────────────────────────────────────────────────────────────────

from pydantic import BaseModel


class VideoUploadRequest(BaseModel):
    project_id: str
    video_base64: str
    video_mime: str = "video/mp4"
    video_filename: str = "reference_video.mp4"
    force_fresh: bool = False
    native_ui: bool = False


def _strip_audio_and_probe_duration(video_bytes: bytes, filename: str) -> tuple[bytes, float | None]:
    """Tách bỏ audio track bằng ffmpeg (chống lỗi PUBLIC_ERROR_AUDIO_FILTERED từ Google Flow) và đo thời lượng."""
    import tempfile
    import subprocess
    import json

    duration: float | None = None
    clean_bytes = video_bytes

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            in_file = Path(tmpdir) / "input_raw.mp4"
            out_file = Path(tmpdir) / "input_clean.mp4"
            in_file.write_bytes(video_bytes)

            try:
                probe_cmd = [
                    "ffprobe", "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "json",
                    str(in_file),
                ]
                probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
                if probe_res.returncode == 0 and probe_res.stdout.strip():
                    probe_data = json.loads(probe_res.stdout)
                    dur_val = probe_data.get("format", {}).get("duration")
                    if dur_val:
                        duration = round(float(dur_val), 2)
                        logger.info("[UploadVideo] Probed video %s duration: %.2fs", filename, duration)
            except Exception as pe:
                logger.warning("Could not probe video duration: %s", pe)

            clean_cmd = [
                "ffmpeg", "-y",
                "-i", str(in_file),
                "-c:v", "copy",
                "-an",
                str(out_file),
            ]
            clean_res = subprocess.run(clean_cmd, capture_output=True, timeout=15)
            if clean_res.returncode == 0 and out_file.exists() and out_file.stat().st_size > 0:
                clean_bytes = out_file.read_bytes()
                logger.info(
                    "[UploadVideo] Successfully stripped audio track from %s to eliminate AUDIO_FILTERED. Size: %d -> %d bytes",
                    filename, len(video_bytes), len(clean_bytes),
                )
            else:
                logger.warning("[UploadVideo] ffmpeg strip audio non-zero exit (%d); using original bytes", clean_res.returncode)
    except Exception as e:
        logger.warning("[UploadVideo] Error processing video with ffmpeg: %s", e)

    return clean_bytes, duration


@router.post("/upload-video")
def upload_video_reference(req: VideoUploadRequest):
    """Upload video lên Google Flow bằng resumable upload để dùng làm reference.

    Chỉ hoạt động với Omni Flash 1.1 (video-to-video).
    Trả về media_id để dùng trong job submission.
    Mặc định tái sử dụng media_id nếu cùng video và project_id. Motion Control có
    thể đặt force_fresh=true để tránh tái sử dụng asset của lần render trước.
    """
    import base64
    from app.veo import bridge, media_registry

    # 1. Giải mã base64 và tách bỏ audio track để chống lỗi PUBLIC_ERROR_AUDIO_FILTERED
    clean_base64 = req.video_base64
    clean_bytes: bytes | None = None
    video_duration: float | None = None
    try:
        raw_bytes = base64.b64decode(req.video_base64, validate=True)
        clean_bytes, video_duration = _strip_audio_and_probe_duration(raw_bytes, req.video_filename)
        if len(clean_bytes) != len(raw_bytes):
            clean_base64 = base64.b64encode(clean_bytes).decode("ascii")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Video upload body is invalid or the video could not be read.") from exc

    if not clean_bytes:
        raise HTTPException(status_code=400, detail="Video file is empty.")

    # 2. Kiểm tra cache deduplication trước khi gọi Extension
    video_hash = media_registry.compute_bytes_sha256(clean_base64.encode("utf-8"))
    cached_id = media_registry.get_cached_media_id(req.project_id, video_hash)
    if cached_id and not req.force_fresh:
        logger.info(
            "[Deduplication] Video %s đã tồn tại trên project %s với media_id=%s. Tái sử dụng, bỏ qua upload!",
            req.video_filename,
            req.project_id,
            cached_id,
        )
        return {
            "ok": True,
            "media_id": cached_id,
            "project_id": req.project_id,
            "filename": req.video_filename,
            "duration": video_duration,
            "cached": True,
        }

    ext = bridge.get_extension_info()
    if not ext.get("connected"):
        raise HTTPException(status_code=503, detail="Extension chưa kết nối. Hãy mở Chrome + Extension.")

    upload_path: Path | None = None
    if req.native_ui:
        import uuid

        upload_dir = _BASE_DIR / "Data" / "media" / "motion_uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)
        safe_name = Path(req.video_filename).name
        if not safe_name.lower().endswith(".mp4"):
            safe_name = f"{Path(safe_name).stem or 'reference_video'}.mp4"
        upload_path = upload_dir / f"{uuid.uuid4().hex}-{safe_name}"
        upload_path.write_bytes(clean_bytes)
        req_id = bridge.request_video_upload_ui(
            project_id=req.project_id,
            video_local_path=str(upload_path.resolve()),
            video_filename=safe_name,
            force_fresh=req.force_fresh,
        )
    else:
        req_id = bridge.request_video_upload(
            project_id=req.project_id,
            video_base64=clean_base64,
            video_mime=req.video_mime,
            video_filename=req.video_filename,
            force_fresh=req.force_fresh,
        )
    if not req_id:
        if upload_path:
            upload_path.unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail="Bridge queue đầy hoặc Extension chưa sẵn sàng.")

    try:
        result = bridge.wait_video_upload_result(req_id, timeout=240.0 if req.native_ui else 120.0)
    finally:
        if upload_path:
            upload_path.unlink(missing_ok=True)
    if not result:
        timeout = 240 if req.native_ui else 120
        raise HTTPException(status_code=504, detail=f"Timeout chờ Extension upload video ({timeout}s).")

    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Upload video thất bại.")

    media_id = result["media_id"]
    # Lưu bản sao video tham chiếu vào veo_references để đối chiếu sau này
    local_ref_name = f"{video_hash}.mp4"
    try:
        ref_dir = _BASE_DIR / "Data" / "media" / "veo_references"
        ref_dir.mkdir(parents=True, exist_ok=True)
        ref_file = ref_dir / local_ref_name
        if not ref_file.exists():
            ref_file.write_bytes(clean_bytes)
    except Exception as save_err:
        logger.warning("[UploadVideo] Không thể lưu file veo_references: %s", save_err)

    # 3. Đăng ký media_id mới vào Registry kèm thời lượng và local_filename
    media_registry.register_media(
        project_id=req.project_id,
        file_hash=video_hash,
        media_id=media_id,
        filename=req.video_filename,
        mime_type=req.video_mime,
        kind="video",
        duration=video_duration or 0.0,
        local_filename=local_ref_name,
    )

    return {
        "ok": True,
        "media_id": media_id,
        "project_id": result.get("project_id", req.project_id),
        "filename": req.video_filename,
        "duration": video_duration,
        "cached": False,
    }

@router.get("/references/{filename}")
def get_reference_video(filename: str):
    """Serve video tham chiếu lưu trong Data/media/veo_references hỗ trợ Range request."""
    ref_dir = _BASE_DIR / "Data" / "media" / "veo_references"
    target = (ref_dir / filename).resolve()
    if not str(target).startswith(str(ref_dir.resolve())) or not target.is_file():
        raise HTTPException(status_code=404, detail="Video tham chiếu không tồn tại")
    return FileResponse(target, media_type="video/mp4", headers={"Accept-Ranges": "bytes"})
