from pathlib import Path
import asyncio
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db import get_db
from app.stories.models import CrawledStory, CrawledChapter
from app.media import audio_workflow

router = APIRouter(prefix="/api/audio", tags=["Audio workflow"])

class RunBody(BaseModel):
    story_slug: str
    chapter_number: int
    voice_id: str
    aspect: str = "9:16"

class TestRunBody(BaseModel):
    text: str
    voice_id: str = "Adam"
    aspect: str = "9:16"

@router.get("/stories")
def stories(db: Session = Depends(get_db)):
    return [{"story_slug": s.story_slug, "name": s.name, "chapters": [{"chapter_number": c.chapter_number, "title": c.title} for c in db.query(CrawledChapter).filter_by(story_slug=s.story_slug).order_by(CrawledChapter.chapter_number).all()]} for s in db.query(CrawledStory).order_by(CrawledStory.name).all()]

@router.post("/run", status_code=202)
async def run(body: RunBody, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if body.aspect not in {"9:16", "16:9"}: raise HTTPException(400, "Khổ video không hợp lệ.")
    story = db.get(CrawledStory, body.story_slug)
    chapter = db.query(CrawledChapter).filter_by(story_slug=body.story_slug, chapter_number=body.chapter_number).first()
    if not story or not chapter: raise HTTPException(404, "Không tìm thấy truyện hoặc chương đã crawl.")
    if not chapter.paragraph.strip(): raise HTTPException(400, "Nội dung chương đang rỗng.")
    job_id = audio_workflow.create(story.name, chapter.title)
    background_tasks.add_task(audio_workflow.run, job_id, story.name, chapter.title, chapter.paragraph, body.voice_id, body.aspect)
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
    return FileResponse(path, media_type="video/mp4", headers={"Content-Disposition": f'inline; filename="{path.name}"'})
