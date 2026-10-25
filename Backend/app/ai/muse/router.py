from pathlib import Path
import shutil
import uuid
from typing import Optional
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from app.ai.muse.schemas import (
    MuseSettingsPayload,
    MuseSettingsResponse,
    MuseStatusResponse,
    MuseGenerateRequest,
    MuseGenerateResponse,
    MuseHistoryResponse,
    MuseUploadResponse,
)
from app.ai.muse.service import muse_service

router = APIRouter(tags=["Muse AI"])

_UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent.parent / "Data" / "media" / "muse_uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/api/settings/muse", response_model=MuseSettingsResponse)
def get_muse_settings():
    """Lấy cấu hình hiện tại của Muse AI."""
    cfg = muse_service.get_config()
    return MuseSettingsResponse(
        ok=True,
        is_connected=cfg.get("is_connected", False),
        last_checked_at=cfg.get("last_checked_at"),
        app_url=cfg.get("app_url", "https://muse.ai/"),
        cdp_port=cfg.get("cdp_port", 9225),
        auto_download=cfg.get("auto_download", True),
        download_dir=cfg.get("download_dir", str(muse_service.profile_dir.parent / "Downloads")),
        timeout_seconds=cfg.get("timeout_seconds", 120),
        default_prompt_prefix=cfg.get("default_prompt_prefix", ""),
        profile_dir=str(muse_service.profile_dir),
    )


@router.put("/api/settings/muse", response_model=MuseSettingsResponse)
def update_muse_settings(payload: MuseSettingsPayload):
    """Cập nhật cấu hình Muse AI."""
    return muse_service.update_config(payload)


@router.get("/api/settings/muse/status", response_model=MuseStatusResponse)
def get_muse_status():
    """Kiểm tra trực tiếp trạng thái kết nối & phiên đăng nhập của Muse qua CDP."""
    return muse_service.check_status()


@router.post("/api/settings/muse/open-browser")
def open_muse_browser():
    """Khởi chạy hoặc mở cửa sổ Chrome Muse để người dùng đăng nhập/thao tác."""
    try:
        return muse_service.open_browser()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/ai/muse/generate", response_model=MuseGenerateResponse)
def generate_muse_video(req: MuseGenerateRequest):
    """API sinh video tự động từ prompt thông qua Muse AI."""
    res = muse_service.generate_video(req)
    if not res.ok:
        raise HTTPException(status_code=500, detail=res.error or "Lỗi không xác định khi sinh video.")
    return res


@router.get("/api/ai/muse/history", response_model=MuseHistoryResponse)
def get_muse_history(limit: int = Query(default=50, ge=1, le=200)):
    """Lấy lịch sử các video đã tạo qua Muse AI."""
    return muse_service.get_history(limit=limit)


@router.get("/api/ai/muse/stream")
def stream_muse_video(
    file: Optional[str] = Query(default=None),
    path: Optional[str] = Query(default=None),
):
    """Phát stream file MP4 video cho trình phát trên giao diện người dùng."""
    download_dir = muse_service.get_download_dir()
    target_path: Optional[Path] = None

    if file:
        target_path = download_dir / Path(file).name
    elif path:
        p = Path(path)
        if p.is_absolute() and p.exists():
            target_path = p
        else:
            target_path = download_dir / p.name

    if not target_path or not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file video.")

    if target_path.suffix.lower() != ".mp4":
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ stream định dạng MP4.")

    return FileResponse(
        path=str(target_path),
        media_type="video/mp4",
        filename=target_path.name,
    )


@router.post("/api/ai/muse/open-folder")
def open_muse_folder():
    """Mở thư mục lưu trữ video trên máy tính."""
    try:
        return muse_service.open_download_folder()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/ai/muse/upload", response_model=MuseUploadResponse)
async def upload_muse_media(file: UploadFile = File(...)):
    """Upload ảnh hoặc video tham chiếu cho Muse AI."""
    ct = file.content_type or ""
    is_img = ct.startswith("image/")
    is_vid = ct.startswith("video/")

    ext = Path(file.filename or "file").suffix.lower()
    if not is_img and not is_vid:
        if ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp"]:
            is_img = True
        elif ext in [".mp4", ".webm", ".mov"]:
            is_vid = True
        else:
            raise HTTPException(status_code=400, detail="Chỉ hỗ trợ file ảnh (jpg, png, webp) hoặc video (mp4, webm).")

    file_id = str(uuid.uuid4())[:12]
    clean_name = Path(file.filename or f"media_{file_id}{ext}").name
    dest = _UPLOAD_DIR / f"{file_id}_{clean_name}"

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    file_size = dest.stat().st_size
    file_type = "video" if is_vid else "image"

    return MuseUploadResponse(
        ok=True,
        file_name=clean_name,
        file_path=str(dest.resolve()),
        file_type=file_type,
        file_size=file_size,
        preview_url=f"/api/ai/muse/preview?file={dest.name}",
    )


@router.get("/api/ai/muse/preview")
def preview_muse_media(file: str = Query(...)):
    """Xem trước file ảnh hoặc video đã upload."""
    target = _UPLOAD_DIR / Path(file).name
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File không tồn tại.")

    ext = target.suffix.lower()
    media_type = "video/mp4" if ext in [".mp4", ".mov", ".webm"] else ("image/png" if ext == ".png" else "image/jpeg")
    return FileResponse(path=str(target), media_type=media_type)

