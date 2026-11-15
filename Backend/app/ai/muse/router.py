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
    MuseAccountsResponse,
    MuseLoginRequest,
    MuseRenameRequest,
)
from app.ai.muse.service import muse_service

router = APIRouter(tags=["Muse AI"])

_UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent.parent / "Data" / "media" / "muse_uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/api/settings/muse", response_model=MuseSettingsResponse)
def get_muse_settings():
    """Lấy cấu hình hiện tại của Muse AI."""
    return muse_service.get_settings()


@router.put("/api/settings/muse", response_model=MuseSettingsResponse)
def update_muse_settings(payload: MuseSettingsPayload):
    """Cập nhật cấu hình Muse AI."""
    return muse_service.update_config(payload)


@router.get("/api/settings/muse/status", response_model=MuseStatusResponse)
def get_muse_status(account_id: Optional[str] = Query(default=None)):
    """Phiên đăng nhập Muse của một tài khoản (gọi auth/check bằng cookie đã lưu, không mở Chrome).

    account_id bỏ trống: tài khoản sẵn sàng đầu tiên.
    """
    return muse_service.check_status(account_id)


@router.post("/api/settings/muse/open-browser")
def open_muse_browser(account_id: Optional[str] = Query(default=None)):
    """Mở cửa sổ Chrome của một tài khoản Muse để xem chat trên muse.ai."""
    try:
        return muse_service.open_browser(account_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------- tài khoản Muse


@router.get("/api/settings/muse/accounts", response_model=MuseAccountsResponse)
def list_muse_accounts():
    """Danh sách tài khoản Muse (mỗi tài khoản một profile Chrome riêng)."""
    return muse_service.list_accounts()


@router.post("/api/settings/muse/accounts/login")
def login_muse_account(body: Optional[MuseLoginRequest] = None):
    """Mở Chrome để đăng nhập Muse: tạo tài khoản mới, hoặc đăng nhập lại tài khoản `account_id`."""
    try:
        acc = muse_service.login_account(account_id=(body.account_id if body else None))
        return {"ok": True, "account": acc}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/settings/muse/accounts/{account_id}/check")
def check_muse_account(account_id: str):
    """Kiểm tra phiên đăng nhập của một tài khoản Muse."""
    try:
        return {"ok": True, "account": muse_service.check_account(account_id)}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/api/settings/muse/accounts/{account_id}")
def rename_muse_account(account_id: str, body: MuseRenameRequest):
    """Đổi tên hiển thị của tài khoản Muse."""
    try:
        return {"ok": True, "account": muse_service.rename_account(account_id, body.label)}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/api/settings/muse/accounts/{account_id}")
def delete_muse_account(account_id: str):
    """Xóa tài khoản Muse (đóng Chrome của nó và xóa profile Chrome do app tạo)."""
    try:
        deleted = muse_service.delete_account(account_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản để xóa")
    return {"ok": True, "deleted": True}


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


@router.get("/api/ai/muse/output")
def muse_output_file(file: str = Query(...)):
    """Ảnh Muse đã tạo (Data/media/muse_outputs), vd. kết quả node Tách áo quần."""
    from app.ai.muse.service import MUSE_OUTPUT_DIR

    target = MUSE_OUTPUT_DIR / Path(file).name
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File không tồn tại.")
    ext = target.suffix.lower()
    media_type = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif"}.get(ext, "image/webp")
    return FileResponse(path=str(target), media_type=media_type)


@router.get("/api/ai/muse/preview")
def preview_muse_media(file: str = Query(...)):
    """Xem trước file ảnh hoặc video đã upload."""
    target = _UPLOAD_DIR / Path(file).name
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File không tồn tại.")

    ext = target.suffix.lower()
    media_type = "video/mp4" if ext in [".mp4", ".mov", ".webm"] else ("image/png" if ext == ".png" else "image/jpeg")
    return FileResponse(path=str(target), media_type=media_type)

