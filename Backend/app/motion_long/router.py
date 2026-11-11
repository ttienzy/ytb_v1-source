"""REST /api/motion-long — Motion Control cho video mẫu dài (chia đoạn, tạo lần lượt, ghép, xóa watermark)."""
from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import service

router = APIRouter(prefix="/api/motion-long", tags=["Motion dài"])


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except service.LongMotionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (RuntimeError, TimeoutError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/plan")
def plan(body: dict[str, Any] = Body(...)):
    """Xem trước cách chia đoạn và số credit ước tính (không tạo gì, không tốn credit)."""
    return _guard(service.preview_plan, float(body.get("duration") or 0), bool(body.get("overlap", True)),
                  float(body.get("overlap_seconds") or 1.0))


@router.post("/jobs")
def create(video: UploadFile = File(...), prompt: str = Form(...), image_paths: str = Form("[]"),
           aspect_ratio: str = Form(""), options: str = Form("{}")):
    """Nhận video mẫu dài + ảnh tham chiếu (đường dẫn ảnh đã tải lên qua /api/veo/upload-image), chia đoạn, lưu. Chưa gọi Flow."""
    try:
        images = json.loads(image_paths or "[]")
        opts = json.loads(options or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="image_paths/options phải là JSON.") from exc
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "upload.mp4"
        with path.open("wb") as handle:
            shutil.copyfileobj(video.file, handle)
        return _guard(service.create_job, path, video.filename or "video.mp4", prompt=prompt,
                      image_paths=images, aspect_ratio=aspect_ratio or None, options=opts)


@router.get("/jobs")
def list_jobs():
    return service.list_jobs()


@router.get("/jobs/{jid}")
def get_job(jid: str):
    return _guard(lambda: service.public(service.get_job(jid)))


@router.delete("/jobs/{jid}")
def delete_job(jid: str):
    _guard(service.delete_job, jid)
    return {"ok": True}


@router.post("/jobs/{jid}/run")
def run(jid: str, body: dict[str, Any] | None = Body(default=None)):
    """Chạy hàng đợi: mặc định mọi đoạn chưa xong; body {"indices": [1]} để chạy riêng đoạn (số bắt đầu từ 0)."""
    indices = (body or {}).get("indices")
    return _guard(service.start_queue, jid, indices)


@router.post("/jobs/{jid}/stop")
def stop(jid: str):
    return _guard(service.stop_queue, jid)


@router.post("/jobs/{jid}/merge")
def merge(jid: str, body: dict[str, Any] | None = Body(default=None)):
    return _guard(service.start_merge, jid, body or None)


@router.post("/jobs/{jid}/exports/clean")
def export_clean(jid: str):
    return _guard(service.start_clean_export, jid)


@router.get("/jobs/{jid}/file/{kind}")
def download(jid: str, kind: str, index: int | None = None, attachment: bool = False):
    path = _guard(service.file_path, jid, kind, index)
    job = service.get_job(jid)
    stem = Path(job["filename"]).stem or "motion"
    name = {"final": f"{stem}_motion.mp4", "clean": f"{stem}_motion_clean.mp4"}.get(kind, path.name)
    return FileResponse(path, media_type="video/mp4", filename=name if attachment else None,
                        headers={"Accept-Ranges": "bytes"})
