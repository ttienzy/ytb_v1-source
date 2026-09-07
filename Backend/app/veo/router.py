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

import shutil
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.veo import service
from app.veo.schemas import (
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


@router.post("/manual-credentials")
def save_manual_credentials(req: ManualCredentialRequest):
    """Lưu session cookie/token thủ công từ giao diện Cài đặt."""
    return service.save_manual_credential(
        email=req.email,
        cookie=req.cookie,
        access_token=req.access_token,
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


@router.post("/extension/reload")
def reload_extension():
    """Gửi yêu cầu Extension tự reload code service worker."""
    from app.veo import bridge
    bridge.request_extension_reload()
    return {"ok": True, "message": "Extension reload requested"}


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
    """Stream file ảnh cục bộ."""
    path = service.get_image_file_path(image_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail=f"Ảnh '{image_id}' không tìm thấy trên đĩa")
    return FileResponse(path, media_type="image/jpeg", filename=f"{image_id}.jpg")


@router.delete("/images/{image_id}")
def delete_image(image_id: str):
    """Xóa ảnh khỏi thư viện."""
    ok = service.delete_image(image_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Ảnh '{image_id}' không tìm thấy")
    return {"ok": True}
