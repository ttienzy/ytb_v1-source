from pathlib import Path
from urllib.parse import quote
import asyncio
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from app.db import get_db
from app.stories.models import CrawledStory, CrawledChapter
from app.media import audio_workflow
from app.media import service as bgm_service

router = APIRouter(prefix="/api/audio", tags=["Audio workflow"])

class RunBody(BaseModel):
    story_slug: str
    chapter_number: Optional[int] = None
    chapter_numbers: list[int] | None = None
    batch_items: list[dict] | None = None
    voice_id: str
    aspect: str = "9:16"
    bgm_random: bool = True
    bgm_enabled: bool = True

class TestRunBody(BaseModel):
    text: str
    voice_id: str = "Adam"
    aspect: str = "9:16"

@router.get("/stories")
def stories(db: Session = Depends(get_db)):
    return [{"story_slug": s.story_slug, "name": s.name, "thumbnail_name": audio_workflow.thumbnail_path(s.story_slug).name if audio_workflow.thumbnail_path(s.story_slug) else None, "chapters": [{"chapter_number": c.chapter_number, "title": c.title} for c in db.query(CrawledChapter).filter_by(story_slug=s.story_slug).order_by(CrawledChapter.chapter_number).all()]} for s in db.query(CrawledStory).order_by(CrawledStory.name).all()]

@router.post("/stories/{story_slug}/thumbnail")
async def upload_thumbnail(story_slug: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not db.get(CrawledStory, story_slug): raise HTTPException(404, "Không tìm thấy truyện đã crawl.")
    if not file.content_type or not file.content_type.startswith("image/"): raise HTTPException(400, "File thumbnail phải là ảnh.")
    suffix = Path(file.filename or ".jpg").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}: raise HTTPException(400, "Chỉ hỗ trợ PNG, JPG, JPEG hoặc WEBP.")
    data = await file.read()
    if not data: raise HTTPException(400, "Ảnh thumbnail đang rỗng.")
    audio_workflow.AUDIO_THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
    for old in audio_workflow.AUDIO_THUMBNAIL_DIR.glob(f"{audio_workflow._safe_name(story_slug)}.*"): old.unlink(missing_ok=True)
    path = audio_workflow.AUDIO_THUMBNAIL_DIR / f"{audio_workflow._safe_name(story_slug)}{suffix}"
    path.write_bytes(data)
    return {"thumbnail_name": path.name}

@router.get("/thumbnails/{filename}")
def thumbnail(filename: str):
    path = audio_workflow.AUDIO_THUMBNAIL_DIR / Path(filename).name
    if path.parent != audio_workflow.AUDIO_THUMBNAIL_DIR or not path.exists(): raise HTTPException(404, "Không tìm thấy thumbnail.")
    return FileResponse(path)

@router.post("/run", status_code=202)
async def run(body: RunBody, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if body.aspect not in {"9:16", "16:9"}: raise HTTPException(400, "Khổ video không hợp lệ.")
    if body.batch_items is not None:
        if not body.batch_items or len(body.batch_items) > 10:
            raise HTTPException(400, "Queue Audio phải có từ 1 đến 10 truyện.")
        queue: list[tuple[CrawledStory, list[CrawledChapter]]] = []
        total_chapters = 0
        for item in body.batch_items:
            slug = item.get("story_slug") if isinstance(item, dict) else None
            numbers = item.get("chapter_numbers") if isinstance(item, dict) else None
            if not slug or not isinstance(numbers, list) or not numbers:
                raise HTTPException(400, "Mỗi truyện trong queue phải có ít nhất 1 chương.")
            story = db.get(CrawledStory, slug)
            if not story:
                raise HTTPException(404, f"Không tìm thấy truyện đã crawl: {slug}.")
            chapters = db.query(CrawledChapter).filter(
                CrawledChapter.story_slug == slug,
                CrawledChapter.chapter_number.in_(numbers),
            ).order_by(CrawledChapter.chapter_number).all()
            if not chapters:
                raise HTTPException(404, f"Không tìm thấy chương đã chọn trong truyện {story.name}.")
            empty = next((c for c in chapters if not c.paragraph.strip()), None)
            if empty:
                raise HTTPException(400, f"Nội dung chương {empty.chapter_number} của truyện {story.name} đang rỗng.")
            queue.append((story, chapters))
            total_chapters += len(chapters)
        thumbnail_missing = next((story.name for story, _ in queue if audio_workflow.thumbnail_path(story.story_slug) is None), None)
        if thumbnail_missing:
            raise HTTPException(400, f"Truyện {thumbnail_missing} chưa có thumbnail.")
        bgm_pool: list[Path] = []
        if body.bgm_enabled:
            tracks = bgm_service.list_tracks(db)
            valid_tracks = [t for t in tracks if Path(t.file_path).exists() and Path(t.file_path).stat().st_size]
            if not valid_tracks: raise HTTPException(400, "Bạn đã bật nhạc nền nhưng thư viện nhạc chưa có bài nào hợp lệ.")
            bgm_pool = [Path(t.file_path) for t in valid_tracks]
        job_id = audio_workflow.create("Queue Audio", "Nhiều truyện", total_chapters)
        queue_data = [(story.name, chapters, audio_workflow.thumbnail_path(story.story_slug)) for story, chapters in queue]
        background_tasks.add_task(audio_workflow.run_queue, job_id, queue_data, body.voice_id, body.aspect, bgm_pool)
        return {"job_id": job_id}

    story = db.get(CrawledStory, body.story_slug)
    if not story: raise HTTPException(404, "Không tìm thấy truyện đã crawl.")
    query = db.query(CrawledChapter).filter_by(story_slug=body.story_slug)
    if body.chapter_numbers is not None:
        if not body.chapter_numbers or len(body.chapter_numbers) > 10:
            raise HTTPException(400, "Queue Audio phải có từ 1 đến 10 chương.")
        query = query.filter(CrawledChapter.chapter_number.in_(body.chapter_numbers))
    elif body.chapter_number is not None:
        query = query.filter_by(chapter_number=body.chapter_number)
    chapters = query.order_by(CrawledChapter.chapter_number).all()
    if not chapters: raise HTTPException(404, "Không tìm thấy chương đã crawl.")
    empty = next((c for c in chapters if not c.paragraph.strip()), None)
    if empty: raise HTTPException(400, f"Nội dung chương {empty.chapter_number} đang rỗng.")
    thumbnail = audio_workflow.thumbnail_path(story.story_slug)
    if thumbnail is None: raise HTTPException(400, "Truyện chưa có thumbnail. Hãy chọn và tải lên 1 ảnh thumbnail trước.")
    bgm_pool: list[Path] = []
    if body.bgm_enabled:
        tracks = bgm_service.list_tracks(db)
        valid_tracks = [t for t in tracks if Path(t.file_path).exists() and Path(t.file_path).stat().st_size]
        if not valid_tracks: raise HTTPException(400, "Bạn đã bật nhạc nền nhưng thư viện nhạc chưa có bài nào hợp lệ.")
        bgm_pool = [Path(t.file_path) for t in valid_tracks]
    job_id = audio_workflow.create(story.name, chapters[0].title, len(chapters))
    if len(chapters) == 1:
        background_tasks.add_task(audio_workflow.run, job_id, story.name, chapters[0].title, chapters[0].paragraph, body.voice_id, body.aspect, chapters[0].chapter_number, thumbnail, bgm_pool)
    else:
        background_tasks.add_task(audio_workflow.run_batch, job_id, story.name, chapters, body.voice_id, body.aspect, thumbnail, bgm_pool)
    return {"job_id": job_id}

@router.post("/test-run", status_code=202)
async def test_run(body: TestRunBody, background_tasks: BackgroundTasks):
    """Chạy thử pipeline bằng text dán trực tiếp, không cần truyện/chương."""
    if not body.text.strip(): raise HTTPException(400, "Text test đang rỗng.")
    if body.aspect not in {"9:16", "16:9"}: raise HTTPException(400, "Khổ video không hợp lệ.")
    job_id = audio_workflow.create("Test Workflow Audio", "Nội dung test")
    background_tasks.add_task(audio_workflow.run, job_id, "Test Workflow Audio", "Nội dung test", body.text.strip(), body.voice_id, body.aspect)
    return {"job_id": job_id}

@router.get("/jobs/{job_id}")
def job(job_id: str):
    item = audio_workflow.AUDIO_JOBS.get(job_id)
    if not item: raise HTTPException(404, "Không tìm thấy tiến trình Audio.")
    return item

@router.get("/outputs")
def outputs(): return audio_workflow.list_outputs()

@router.get("/outputs/{filename}")
def output(filename: str):
    path = audio_workflow.AUDIO_DIR / Path(filename).name
    if path.parent != audio_workflow.AUDIO_DIR or not path.exists(): raise HTTPException(404, "Không tìm thấy video Audio.")
    # inline để trình duyệt mở trình phát khi người dùng bấm xem;
    # FileResponse mặc định dùng attachment nên bị tải xuống ngay.
    # Header HTTP phải là Latin-1; dùng filename* để truyền tên tiếng Việt theo UTF-8.
    encoded_name = quote(path.name, safe="")
    headers = {"Content-Disposition": f'inline; filename="audio-video.mp4"; filename*=UTF-8\'\'{encoded_name}'}
    return FileResponse(path, media_type="video/mp4", headers=headers)
