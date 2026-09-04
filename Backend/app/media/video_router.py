from pathlib import Path
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from urllib.parse import urlparse
from app.media import video_service as service

router = APIRouter(prefix="/api/video", tags=["Video"])

class PresetBody(BaseModel):
    aspect: str = "9:16"
    crop: str = "fit"
    background: str = "#111827"
    label: str = ""
    label_background: str = "#000000"
    crop_x: float = 0
    crop_y: float = 0
    crop_w: float = 1
    crop_h: float = 1
    remove_audio: bool = False
    label_position: str = "bottom"
    label_x: float = 0.5
    label_y: float = 0.88
    blur: dict = {}

class NamedPresetBody(BaseModel):
    name: str
    options: dict

@router.get("/preset")
def preset():
    return service.load_preset()

@router.post("/preset")
def save_preset(body: PresetBody):
    return service.save_preset(body.model_dump())

@router.get("/presets")
def presets():
    return service.list_presets()

@router.post("/presets")
def save_named_preset(body: NamedPresetBody):
    if not body.name.strip(): raise HTTPException(400, "Tên state không được để trống.")
    return service.save_named_preset(body.name, body.options)

@router.get("/done")
def done():
    return service.list_done()

@router.get("/done/{done_id}/file")
def done_file(done_id: str):
    item = service.get_done(done_id)
    if not item: raise HTTPException(404, "Không tìm thấy video đã xử lý.")
    return FileResponse(item["file_path"], media_type="video/mp4", filename=item["name"])

@router.get("/library")
def library():
    return service.list_videos()

@router.post("/background")
async def upload_background(file: UploadFile = File(...)):
    data = await file.read()
    try: return service.add_background(data, file.filename or "background.jpg")
    except ValueError as e: raise HTTPException(400, str(e)) from e

@router.get("/background/{background_id}")
def background(background_id: str):
    item = service.get_background(background_id)
    if not item: raise HTTPException(404, "Không tìm thấy ảnh nền.")
    return FileResponse(item["file_path"])

@router.post("/library")
async def upload(files: list[UploadFile] = File(...)):
    result = []
    for f in files:
        data = await f.read()
        if data:
            try: result.append(service.add_video(data, f.filename or "video.mp4"))
            except ValueError as e: raise HTTPException(400, str(e)) from e
    return result

@router.post("/youtube")
def youtube(url: str = Form(...)):
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or parsed.netloc not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}:
        raise HTTPException(400, "Vui lòng nhập link YouTube hợp lệ.")
    try:
        return service.import_youtube(url)
    except (OSError, RuntimeError) as e:
        raise HTTPException(502, f"Không tải được video YouTube: {e}") from e

@router.delete("/library/{video_id}")
def delete(video_id: str):
    if not service.remove(video_id): raise HTTPException(404, "Không tìm thấy video.")
    return {"ok": True}

@router.get("/library/{video_id}/file")
def source(video_id: str):
    item = service.get(video_id)
    if not item or not Path(item["file_path"]).exists():
        raise HTTPException(404, "Không tìm thấy file video.")
    return FileResponse(item["file_path"], media_type="video/mp4", filename=item["name"])

@router.post("/process")
def process(video_ids: list[str] = Form(...), options: str = Form(...)):
    try: opts = __import__("json").loads(options)
    except ValueError as e: raise HTTPException(400, "Cấu hình xử lý không hợp lệ.") from e
    if not video_ids: raise HTTPException(400, "Chưa chọn video.")
    first = service.get(video_ids[0])
    if not first: raise HTTPException(404, "Không tìm thấy video.")
    try: out = service.transform(first, opts); service.record_done(out, first, opts)
    except (OSError, RuntimeError) as e: raise HTTPException(500, f"Xử lý video thất bại: {e}") from e
    return FileResponse(out, media_type="video/mp4", filename=out.name)
