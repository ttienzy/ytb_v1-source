"""REST /api/watermark — watermark remover (Hybrid: path-based + upload).

Hỗ trợ 2 mode:
1. Path-based (Electron): gửi đường dẫn file native
2. Upload (Web): upload file thực tế qua multipart/form-data

Endpoints:
- GET  /api/watermark/check              → kiểm tra gwr CLI
- POST /api/watermark/process            → {paths: [...]} → job_id (path-based)
- POST /api/watermark/upload             → multipart files → job_id (upload mode)
- GET  /api/watermark/jobs/{id}          → poll trạng thái
- GET  /api/watermark/jobs               → list all jobs
- GET  /api/watermark/download/{id}/{fn} → tải file đã xử lý
"""
import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app.watermark import service, state as wstate
from app.watermark.schemas import BatchJob, VideoItem

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/watermark", tags=["Watermark"])

# Upload directory
UPLOAD_DIR = Path("Data/watermark/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ── Helpers ────────────────────────────────────────────────────────────────────

SUPPORTED_EXTENSIONS = {".mp4", ".mov", ".webm", ".png", ".jpg", ".jpeg", ".webp"}


def _get_media_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".png":
        return "image/png"
    elif ext in [".jpg", ".jpeg"]:
        return "image/jpeg"
    elif ext == ".webp":
        return "image/webp"
    elif ext == ".mov":
        return "video/quicktime"
    elif ext == ".webm":
        return "video/webm"
    return "video/mp4"


def _video_item(v: wstate.VideoState) -> VideoItem:
    return VideoItem(
        name=v.name,
        size_bytes=v.size_bytes,
        media_type=getattr(v, "media_type", "video"),
        status=v.status,
        output_name=v.output_name,
        error=v.error,
        processed_frames=v.processed_frames,
        frame_estimate=v.frame_estimate,
        drive_status=v.drive_status,
        drive_file_id=v.drive_file_id,
        drive_url=v.drive_url,
    )



def _job_out(job: wstate.BatchJobState) -> BatchJob:
    return BatchJob(
        job_id=job.job_id,
        status=job.status,
        total=job.total,
        done=job.done,
        failed=job.failed,
        videos=[_video_item(v) for v in job.videos],
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


# ── Request bodies ─────────────────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    paths: list[str]    # danh sách đường dẫn file trên máy local


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/check")
def check_cli() -> dict:
    """Kiểm tra gwr CLI đã cài chưa."""
    available = service._gwr_available()
    return {
        "gwr_available": available,
        "message": (
            "gwr CLI sẵn sàng."
            if available
            else "gwr chưa được cài. Chạy: npm install -g @pilio/gemini-watermark-remover"
        ),
    }


@router.post("/process", status_code=202)
async def process_paths(req: ProcessRequest) -> JSONResponse:
    """Nhận danh sách đường dẫn file/thư mục → xử lý watermark (ảnh + video) → trả job_id.

    Electron renderer gọi endpoint này với file.path của từng file được chọn.
    Không upload — gwr đọc trực tiếp từ disk.
    Trả 202 {job_id} ngay — poll /jobs/{job_id} để lấy progress.
    """
    if not service._gwr_available():
        raise HTTPException(
            status_code=503,
            detail="gwr CLI chưa được cài. Chạy: npm install -g @pilio/gemini-watermark-remover",
        )

    if not req.paths:
        raise HTTPException(status_code=400, detail="Danh sách paths rỗng.")

    # Chuẩn hoá và lọc các file video & ảnh hợp lệ (hỗ trợ cả đường dẫn thư mục)
    valid: list[str] = []
    for raw in req.paths:
        raw_str = raw.strip().strip('"').strip("'")
        if not raw_str:
            continue
        p = Path(raw_str)
        if p.exists():
            if p.is_dir():
                # Quét tất cả file video & ảnh trong thư mục
                for f in p.iterdir():
                    if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS:
                        valid.append(str(f))
            elif p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
                valid.append(str(p))

    # Loại bỏ phần tử trùng lặp giữ nguyên thứ tự
    valid = list(dict.fromkeys(valid))

    if not valid:
        raise HTTPException(
            status_code=400,
            detail=f"Không tìm thấy file video/ảnh hợp lệ (.mp4, .mov, .png, .jpg, .webp) tại các đường dẫn: {req.paths}",
        )

    job = service.create_batch_job_from_paths(valid)
    asyncio.create_task(service.run_batch(job))   # schedule coroutine vào event loop hiện tại
    logger.info("[watermark] Job %s queued — %d files", job.job_id, job.total)

    return JSONResponse({
        "job_id": job.job_id,
        "total": job.total,
        "files": [v.name for v in job.videos],
    }, status_code=202)


@router.post("/upload", status_code=202)
async def process_upload(files: list[UploadFile] = File(...)) -> JSONResponse:
    """Upload file video hoặc ảnh → xử lý watermark → trả job_id.
    
    Dành cho web browser không có quyền truy cập filesystem.
    Lưu file vào Data/watermark/uploads/{job_id}/ rồi xử lý.
    """
    if not service._gwr_available():
        raise HTTPException(
            status_code=503,
            detail="gwr CLI chưa được cài. Chạy: npm install -g @pilio/gemini-watermark-remover",
        )
    
    if not files:
        raise HTTPException(status_code=400, detail="Không có file được upload.")
    
    # Filter valid video and image files
    valid_files = [
        f for f in files
        if f.filename and Path(f.filename).suffix.lower() in SUPPORTED_EXTENSIONS
    ]
    if not valid_files:
        raise HTTPException(status_code=400, detail="Không có file video hoặc ảnh hợp lệ (.mp4, .mov, .png, .jpg, .webp).")
    
    # Create job directory
    job_id = service._generate_job_id()
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    # Save uploaded files
    saved_paths: list[str] = []
    for upload_file in valid_files:
        dest = job_dir / upload_file.filename
        try:
            content = await upload_file.read()
            dest.write_bytes(content)
            saved_paths.append(str(dest))
            logger.info("[watermark] Saved upload: %s (%d bytes)", dest, len(content))
        except Exception as e:
            logger.error("[watermark] Failed to save %s: %s", upload_file.filename, e)
            raise HTTPException(status_code=500, detail=f"Lỗi lưu file {upload_file.filename}")
    
    # Create and run job
    job = service.create_batch_job_from_paths(saved_paths)
    asyncio.create_task(service.run_batch(job))
    logger.info("[watermark] Job %s queued (upload mode) — %d files", job.job_id, job.total)
    
    return JSONResponse({
        "job_id": job.job_id,
        "total": job.total,
        "files": [v.name for v in job.videos],
    }, status_code=202)


@router.get("/jobs/{job_id}", response_model=BatchJob)
def get_job(job_id: str) -> BatchJob:
    job = wstate.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    return _job_out(job)


@router.get("/jobs", response_model=list[BatchJob])
def list_jobs() -> list[BatchJob]:
    jobs = wstate.list_jobs()
    jobs.sort(key=lambda j: j.created_at, reverse=True)
    return [_job_out(j) for j in jobs]


@router.get("/preview/{job_id}/{filename}")
def preview_file(job_id: str, filename: str, type: str = "clean"):
    """Xem trước file gốc (type=orig) hoặc file đã xử lý (type=clean)."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Tên file không hợp lệ.")

    job = wstate.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")

    video = next((v for v in job.videos if v.name == filename), None)
    if not video:
        raise HTTPException(status_code=404, detail=f"{filename} không tìm thấy.")

    target_path = Path(video.input_path) if type == "orig" else (Path(video.output_path) if video.output_path else None)
    if not target_path or not target_path.exists():
        raise HTTPException(status_code=404, detail="File không còn tồn tại trên disk.")

    return FileResponse(target_path, media_type=_get_media_type(target_path.name))


@router.get("/download/{job_id}/{filename}")
def download_file(job_id: str, filename: str):
    """Tải file đã xử lý — tìm theo job_id + filename."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Tên file không hợp lệ.")

    job = wstate.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")

    # Tìm video trong job
    video = next((v for v in job.videos if v.name == filename), None)
    if not video or not video.output_path:
        raise HTTPException(status_code=404, detail=f"{filename} chưa được xử lý.")

    path = Path(video.output_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File output không còn tồn tại.")

    return FileResponse(path, media_type=_get_media_type(filename), filename=filename)


@router.get("/download-all/{job_id}")
def download_all_files(job_id: str):
    """Tải toàn bộ các video đã xử lý xong trong job dưới dạng file ZIP."""
    import zipfile

    job = wstate.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")

    done_videos = [
        v for v in job.videos
        if v.status == "done" and v.output_path and Path(v.output_path).exists()
    ]
    if not done_videos:
        raise HTTPException(status_code=404, detail="Chưa có video nào hoàn thành để tải về.")

    temp_zip_path = Path("Data/watermark/temp") / f"watermark_clean_{job_id}.zip"
    temp_zip_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(temp_zip_path, "w", compression=zipfile.ZIP_STORED) as zip_file:
        for v in done_videos:
            p = Path(v.output_path)
            arcname = v.output_name or v.name
            zip_file.write(p, arcname=arcname)

    return FileResponse(
        temp_zip_path,
        media_type="application/zip",
        filename=f"watermark_clean_{job_id}.zip",
    )


import threading

_SYNCING_JOBS: set[str] = set()
_SYNC_LOCK = threading.Lock()


def _bg_sync_job_to_drive(job_id: str, target_folder_id: str | None, force: bool = False) -> None:
    from app.externals.gdrive import service as gdrive_service

    client = gdrive_service.get_client()
    if not client:
        logger.warning("[GDrive Sync] Không tìm thấy client Google Drive.")
        with _SYNC_LOCK:
            _SYNCING_JOBS.discard(job_id)
        return

    try:
        job = wstate.get_job(job_id)
        if not job:
            return

        if force:
            wstate.reset_job_drive_status(job_id)
            job = wstate.get_job(job_id)

        for v in job.videos:
            if v.status == "done" and v.output_path and Path(v.output_path).exists():
                v.drive_status = "uploading"
                try:
                    wstate.update_job(job_id)
                except KeyError:
                    pass

                try:
                    res = client.upload_file_resumable(
                        file_path=v.output_path,
                        folder_id=target_folder_id,
                        custom_name=v.output_name or v.name,
                    )
                    v.drive_status = "done"
                    v.drive_file_id = res.get("file_id")
                    v.drive_url = res.get("web_view_link")
                    v.drive_error = None
                except Exception as exc:
                    logger.error("[GDrive] Lỗi upload thủ công %s: %s", v.name, exc)
                    v.drive_status = "error"
                    v.drive_error = str(exc)

                try:
                    wstate.update_job(job_id)
                except KeyError:
                    pass
    except Exception as exc:
        logger.error("[GDrive Sync] Lỗi trong luồng sync job %s: %s", job_id, exc)
    finally:
        with _SYNC_LOCK:
            _SYNCING_JOBS.discard(job_id)


@router.post("/jobs/{job_id}/sync-drive", response_model=BatchJob)
def sync_job_to_drive(job_id: str, force: bool = False):
    """Bắt đầu đẩy toàn bộ video đã xử lý sạch trong job lên Google Drive dưới nền."""
    from app.externals.gdrive import service as gdrive_service

    client = gdrive_service.get_client()
    if not client:
        raise HTTPException(
            status_code=400,
            detail="Google Drive chưa được kết nối. Vui lòng vào Cài đặt để kết nối Google Drive.",
        )

    job = wstate.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")

    with _SYNC_LOCK:
        if job_id not in _SYNCING_JOBS:
            _SYNCING_JOBS.add(job_id)
            cfg = gdrive_service.get_gdrive_config()
            target_folder_id = gdrive_service.get_workflow_folder_id("watermark") or cfg.get("folder_id")
            threading.Thread(
                target=_bg_sync_job_to_drive,
                args=(job_id, target_folder_id, force),
                daemon=True,
            ).start()

    return _job_out(job)


@router.post("/jobs/{job_id}/reset-drive-sync", response_model=BatchJob)
def reset_job_drive_sync(job_id: str):
    """Đặt lại trạng thái upload Google Drive về idle cho tất cả video trong job."""
    job = wstate.reset_job_drive_status(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    return _job_out(job)


@router.post("/jobs/{job_id}/videos/{filename}/sync-drive", response_model=BatchJob)
def sync_single_video_to_drive(job_id: str, filename: str):
    """Đẩy thủ công 1 video sạch trong job lên Google Drive."""
    from app.externals.gdrive import service as gdrive_service

    client = gdrive_service.get_client()
    if not client:
        raise HTTPException(
            status_code=400,
            detail="Google Drive chưa được kết nối. Vui lòng vào Cài đặt để kết nối Google Drive.",
        )

    job = wstate.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")

    video = next((v for v in job.videos if v.name == filename or v.output_name == filename), None)
    if not video or not video.output_path or not Path(video.output_path).exists():
        raise HTTPException(status_code=404, detail=f"Không tìm thấy file sạch của {filename}.")

    cfg = gdrive_service.get_gdrive_config()
    target_folder_id = gdrive_service.get_workflow_folder_id("watermark") or cfg.get("folder_id")

    video.drive_status = "uploading"
    try:
        wstate.update_job(job_id)
    except KeyError:
        pass

    try:
        res = client.upload_file_resumable(
            file_path=video.output_path,
            folder_id=target_folder_id,
            custom_name=video.output_name or video.name,
        )
        video.drive_status = "done"
        video.drive_file_id = res.get("file_id")
        video.drive_url = res.get("web_view_link")
    except Exception as exc:
        logger.error("[GDrive] Lỗi upload thủ công %s: %s", video.name, exc)
        video.drive_status = "error"
        video.drive_error = str(exc)

    try:
        wstate.update_job(job_id)
    except KeyError:
        pass

    return _job_out(job)

