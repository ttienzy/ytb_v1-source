"""REST API cho giao diện cào truyện."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.db import Base, engine, get_db
from app.stories import service, summary as story_summary
from app.stories.models import CrawledChapter, CrawledStory, StorySummary
from app.stories.schemas import BulkCrawlRequest, CrawlRequest

router = APIRouter(prefix="/api/stories", tags=["Stories"])


@router.on_event("startup")
def ensure_story_tables() -> None:
    """Cho phép bản cài mới dùng được ngay; migration vẫn là nguồn quản lý schema."""
    Base.metadata.create_all(
        bind=engine,
        tables=[CrawledStory.__table__, CrawledChapter.__table__, StorySummary.__table__],
    )
    # create_all không bổ sung cột cho bảng đã tồn tại. Bản cài cũ có thể đã
    # tạo crawled_stories trước khi các trường hiển thị được thêm vào.
    existing_columns = {
        column["name"] for column in inspect(engine).get_columns("crawled_stories")
    }
    missing_columns = {
        "team_name": "VARCHAR(255)",
        "following": "INTEGER",
        "source_updated_at": "VARCHAR(100)",
    }
    with engine.begin() as connection:
        for column_name, column_type in missing_columns.items():
            if column_name not in existing_columns:
                connection.execute(
                    text(f"ALTER TABLE crawled_stories ADD COLUMN {column_name} {column_type}")
                )


@router.get("/categories")
def list_categories() -> list[dict]:
    try:
        return service.list_categories()
    except service.StoryCrawlerError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.get("/stats")
def story_stats(db: Session = Depends(get_db)) -> dict[str, int]:
    return service.get_story_statistics(db)


@router.get("/catalog")
def system_story_catalog() -> list[dict]:
    """Danh sách toàn bộ truyện snapshot có sẵn trong hệ thống (3.226 truyện)."""
    return service.get_system_catalog()


@router.get("/crawled")
def crawled_stories(
    category_ids: list[int] | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict]:
    stories = service.list_crawled_stories(db)
    if not category_ids:
        return stories
    wanted = set(category_ids)
    filtered = []
    for story in stories:
        for category in story.get("categories") or []:
            if not isinstance(category, dict):
                continue
            try:
                category_id = int(category.get("id"))
            except (TypeError, ValueError):
                continue
            if category_id in wanted:
                filtered.append(story)
                break
    return filtered


@router.get("/categories/{category_id}/stories")
def list_stories(category_id: int) -> dict:
    try:
        return service.list_stories_by_category(category_id)
    except service.StoryCrawlerError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/crawl-jobs/{job_id}")
def bulk_crawl_job_status(job_id: str) -> dict:
    job = service.get_crawl_job(job_id)
    if job is None or job["kind"] != "bulk":
        raise HTTPException(status_code=404, detail="Không tìm thấy tiến trình cào hàng loạt.")
    return job


@router.post("/categories/crawl")
def bulk_crawl_stories(request: BulkCrawlRequest) -> dict:
    category_ids = list(dict.fromkeys(request.category_ids))
    job = service.create_bulk_crawl_job(category_ids, request.recrawl_full)
    service.start_bulk_crawl_job(job.job_id)
    return {
        "job_id": job.job_id,
        "status": job.status,
        "kind": job.kind,
        "category_ids": category_ids,
        "recrawl_full": job.recrawl_full,
    }


@router.get("/{story_slug}/metadata")
def story_metadata(story_slug: str, db: Session = Depends(get_db)) -> dict:
    try:
        return service.get_story_metadata(db, story_slug)
    except service.StoryCrawlerError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/{story_slug}/saved")
def saved_story(story_slug: str, db: Session = Depends(get_db)) -> dict:
    saved = service.get_saved_story(db, story_slug)
    if saved is None:
        raise HTTPException(status_code=404, detail="Truyện chưa có dữ liệu được cào.")
    return saved


@router.post("/{story_slug}/crawl")
def crawl_story(
    story_slug: str,
    request: CrawlRequest,
) -> dict:
    job = service.create_crawl_job(story_slug, request.chapter_number)
    service.start_crawl_job(job.job_id)
    return {
        "job_id": job.job_id,
        "status": job.status,
        "chapter_number": job.chapter_number,
    }


@router.get("/{story_slug}/crawl-jobs/{job_id}")
def crawl_job_status(story_slug: str, job_id: str) -> dict:
    job = service.get_crawl_job(job_id)
    if job is None or job["story_slug"] != story_slug:
        raise HTTPException(status_code=404, detail="Không tìm thấy tiến trình cào.")
    return job


class SummaryRequest(BaseModel):
    force: bool = False  # True = tạo lại dù đã có bản lưu (vd bản cũ kém hoặc truyện vừa crawl thêm chương)


@router.get("/{story_slug}/summary")
def get_story_summary(story_slug: str, db: Session = Depends(get_db)) -> dict:
    """Bản tóm tắt cốt truyện đã lưu (hoặc tiến trình đang tạo)."""
    return story_summary.get_summary(db, story_slug)


@router.post("/{story_slug}/summary", status_code=202)
def create_story_summary(story_slug: str, body: SummaryRequest | None = None) -> dict:
    """Gửi cả truyện (dạng file đính kèm) cho Gemini để tóm tắt. Đã có bản lưu thì trả luôn, không gọi Gemini lại (trừ khi force)."""
    try:
        return story_summary.start_summary(story_slug, force=bool(body and body.force))
    except story_summary.StoryNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
