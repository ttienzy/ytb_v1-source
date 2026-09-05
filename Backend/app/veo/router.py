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
    VeoJobOut,
    VeoJobRequest,
)

router = APIRouter(prefix="/api/veo", tags=["Veo Studio"])

# ─────────────────────────────────────────────────────────────────────────────
# Jobs
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/jobs", response_model=VeoJobOut)
def submit_job(request: VeoJobRequest):
    """Submit job tạo video mới."""
    return service.submit_job(request)


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
