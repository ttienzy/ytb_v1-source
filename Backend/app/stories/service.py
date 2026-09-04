"""Client và nghiệp vụ cào truyện từ các API public của daotruyen.me."""

from __future__ import annotations

import json
import secrets
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import TOOLS_DIR
from app.core.database import SessionLocal
from app.stories.models import CrawledChapter, CrawledStory

BASE_URL = "https://daotruyen.me/api/public/v2"
REQUEST_DELAY_SECONDS = 1.0
# Giống tham số trong samples/getStoriesByCategory.js; các trang tiếp theo
# được tải tuần tự cho tới khi API trả next=false.
DEFAULT_PAGE_SIZE = 20
_RATE_LIMIT_LOCK = threading.Lock()
_LAST_GLOBAL_REQUEST_AT = 0.0


class StoryCrawlerError(RuntimeError):
    """Lỗi khi đọc API truyện hoặc dữ liệu API không hợp lệ."""


@dataclass
class CrawlJob:
    job_id: str
    story_slug: str
    chapter_number: int | None
    kind: str = "single"
    category_ids: list[int] = field(default_factory=list)
    recrawl_full: bool = False
    status: str = "queued"
    total: int = 0
    done: int = 0
    current_chapter: int | None = None
    chapters: list[dict[str, Any]] = field(default_factory=list)
    total_stories: int = 0
    completed_stories: int = 0
    current_story: str | None = None
    stories: list[dict[str, Any]] = field(default_factory=list)
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


_JOBS_LOCK = threading.Lock()
_CRAWL_JOBS: dict[str, CrawlJob] = {}


def create_crawl_job(story_slug: str, chapter_number: int | None) -> CrawlJob:
    job = CrawlJob(
        job_id=secrets.token_hex(8),
        story_slug=story_slug,
        chapter_number=chapter_number,
    )
    with _JOBS_LOCK:
        _CRAWL_JOBS[job.job_id] = job
    return job


def create_bulk_crawl_job(category_ids: list[int], recrawl_full: bool = False) -> CrawlJob:
    job = CrawlJob(
        job_id=secrets.token_hex(8),
        story_slug="",
        chapter_number=None,
        kind="bulk",
        category_ids=category_ids,
        recrawl_full=recrawl_full,
    )
    with _JOBS_LOCK:
        _CRAWL_JOBS[job.job_id] = job
    return job


def _job_to_dict(job: CrawlJob) -> dict[str, Any]:
    return {
        "job_id": job.job_id,
        "story_slug": job.story_slug,
        "chapter_number": job.chapter_number,
        "kind": job.kind,
        "category_ids": job.category_ids,
        "recrawl_full": job.recrawl_full,
        "status": job.status,
        "total": job.total,
        "done": job.done,
        "current_chapter": job.current_chapter,
        "chapters": job.chapters,
        "total_stories": job.total_stories,
        "completed_stories": job.completed_stories,
        "current_story": job.current_story,
        "stories": job.stories,
        "result": job.result,
        "error": job.error,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
    }


def get_crawl_job(job_id: str) -> dict[str, Any] | None:
    with _JOBS_LOCK:
        job = _CRAWL_JOBS.get(job_id)
        return _job_to_dict(job) if job else None


def _update_crawl_job(job_id: str, **fields: Any) -> None:
    with _JOBS_LOCK:
        job = _CRAWL_JOBS.get(job_id)
        if job is None:
            return
        for key, value in fields.items():
            setattr(job, key, value)
        job.updated_at = datetime.now(timezone.utc)


def _job_progress(job_id: str, event: dict[str, Any]) -> None:
    with _JOBS_LOCK:
        job = _CRAWL_JOBS.get(job_id)
        if job is None:
            return
        event_type = event.get("type")
        if event_type == "prepared":
            job.total = int(event.get("total") or 0)
            job.chapters = event.get("chapters") or []
        elif event_type == "chapter":
            number = int(event["chapter_number"])
            for chapter in job.chapters:
                if chapter.get("chapter_number") == number:
                    chapter.update({key: value for key, value in event.items() if key != "type"})
                    break
            job.done = sum(chapter.get("status") == "crawled" for chapter in job.chapters)
            job.current_chapter = number if event.get("status") == "running" else None
        job.updated_at = datetime.now(timezone.utc)


def run_crawl_job(job_id: str) -> None:
    job_data = get_crawl_job(job_id)
    if job_data is None:
        return
    _update_crawl_job(job_id, status="running")
    db = SessionLocal()
    try:
        result = crawl_story(
            db,
            job_data["story_slug"],
            job_data["chapter_number"],
            progress_callback=lambda event: _job_progress(job_id, event),
        )
        _update_crawl_job(
            job_id,
            status="completed" if not result["failed_count"] else "completed_with_errors",
            done=result["crawled_count"],
            current_chapter=None,
            result=result,
        )
    except StoryCrawlerError as error:
        db.rollback()
        _update_crawl_job(job_id, status="error", current_chapter=None, error=str(error))
    except Exception as error:  # noqa: BLE001 — job phải chuyển sang error thay vì bị treo
        db.rollback()
        _update_crawl_job(job_id, status="error", current_chapter=None, error=f"Lỗi lưu dữ liệu: {error}")
    finally:
        db.close()


def start_crawl_job(job_id: str) -> None:
    """Khởi chạy job ngoài request để POST trả job_id ngay lập tức."""
    thread = threading.Thread(target=run_crawl_job, args=(job_id,), daemon=True)
    thread.start()


def _collect_stories_for_categories(category_ids: list[int]) -> list[dict[str, Any]]:
    """Lấy và hợp nhất truyện theo slug từ nhiều thể loại, giữ thứ tự gặp đầu tiên."""
    stories: list[dict[str, Any]] = []
    seen_slugs: set[str] = set()
    for category_id in category_ids:
        page_result = list_stories_by_category(category_id)
        for story in page_result["stories"]:
            slug = str(story.get("url") or "").strip()
            if slug and slug not in seen_slugs:
                seen_slugs.add(slug)
                stories.append(story)
    return stories


def _bulk_job_progress(job_id: str, story_index: int, event: dict[str, Any]) -> None:
    with _JOBS_LOCK:
        job = _CRAWL_JOBS.get(job_id)
        if job is None or story_index >= len(job.stories):
            return
        item = job.stories[story_index]
        event_type = event.get("type")
        if event_type == "prepared":
            item["total"] = int(event.get("total") or 0)
            item["done"] = 0
            item["chapters"] = event.get("chapters") or []
        elif event_type == "chapter":
            number = int(event["chapter_number"])
            for chapter in item.get("chapters", []):
                if chapter.get("chapter_number") == number:
                    chapter.update({key: value for key, value in event.items() if key != "type"})
                    break
            item["done"] = sum(chapter.get("status") == "crawled" for chapter in item.get("chapters", []))
            job.current_chapter = number if event.get("status") == "running" else None
        job.current_story = item.get("story_slug")
        job.updated_at = datetime.now(timezone.utc)


def _stored_chapter_numbers(db: Session, story_slug: str) -> set[int]:
    return set(
        db.scalars(
            select(CrawledChapter.chapter_number).where(CrawledChapter.story_slug == story_slug)
        )
    )


def _chapter_index(metadata: dict[str, Any]) -> dict[int, dict[str, Any]]:
    available: dict[int, dict[str, Any]] = {}
    for item in metadata.get("chapters") or []:
        if not isinstance(item, dict) or item.get("chapterNumber") is None:
            continue
        try:
            number = int(item["chapterNumber"])
        except (TypeError, ValueError) as error:
            raise StoryCrawlerError("Metadata có số thứ tự chương không hợp lệ.") from error
        if number < 1:
            raise StoryCrawlerError("Metadata có số thứ tự chương nhỏ hơn 1.")
        if number in available:
            raise StoryCrawlerError(f"Metadata bị trùng số chương {number}; đã dừng để tránh cào sai thứ tự.")
        available[number] = item
    return available


def _is_fully_crawled(db: Session, story_slug: str, metadata: dict[str, Any]) -> bool:
    expected = set(_chapter_index(metadata))
    return bool(expected) and expected.issubset(_stored_chapter_numbers(db, story_slug))


def run_bulk_crawl_job(job_id: str) -> None:
    job_data = get_crawl_job(job_id)
    if job_data is None:
        return
    _update_crawl_job(job_id, status="running")
    db = SessionLocal()
    try:
        source_stories = _collect_stories_for_categories(job_data["category_ids"])
        progress_stories = [
            {
                "story_slug": str(story["url"]),
                "name": story.get("name") or story["url"],
                "status": "pending",
                "total": int(story.get("totalChapter") or 0),
                "done": 0,
                "chapters": [],
            }
            for story in source_stories
        ]
        _update_crawl_job(
            job_id,
            total_stories=len(progress_stories),
            completed_stories=0,
            stories=progress_stories,
        )

        for index, source_story in enumerate(source_stories):
            slug = str(source_story["url"])
            _update_crawl_job(job_id, current_story=slug, current_chapter=None)
            with _JOBS_LOCK:
                if job_id in _CRAWL_JOBS:
                    _CRAWL_JOBS[job_id].stories[index]["status"] = "running"
            try:
                # Lấy metadata một lần để kiểm tra full trước khi tạo crawl job con.
                with DaoTruyenClient() as client:
                    metadata = client.story_metadata(slug)
                story = _upsert_story(db, metadata)
                db.commit()
                chapters = _chapter_index(metadata)
                with _JOBS_LOCK:
                    if job_id in _CRAWL_JOBS:
                        _CRAWL_JOBS[job_id].stories[index]["total"] = len(chapters)

                if _is_fully_crawled(db, slug, metadata) and not job_data.get("recrawl_full", False):
                    _update_bulk_story(job_id, index, status="skipped", done=len(chapters), total=len(chapters))
                else:
                    result = crawl_story(
                        db,
                        slug,
                        progress_callback=lambda event, i=index: _bulk_job_progress(job_id, i, event),
                    )
                    _update_bulk_story(
                        job_id,
                        index,
                        status="completed" if not result["failed_count"] else "completed_with_errors",
                        done=result["crawled_count"],
                        total=result["requested_count"],
                    )
            except StoryCrawlerError as error:
                db.rollback()
                _update_bulk_story(job_id, index, status="error", error=str(error))
            except Exception as error:  # noqa: BLE001 — bulk job không được treo vô thời hạn
                db.rollback()
                _update_bulk_story(job_id, index, status="error", error=f"Lỗi lưu dữ liệu: {error}")
            finally:
                current = get_crawl_job(job_id)
                if current is not None:
                    _update_crawl_job(job_id, completed_stories=current["completed_stories"] + 1)

        final = get_crawl_job(job_id) or {}
        has_errors = any(item.get("status") in {"error", "completed_with_errors"} for item in final.get("stories", []))
        _update_crawl_job(
            job_id,
            status="completed_with_errors" if has_errors else "completed",
            current_story=None,
            current_chapter=None,
            result={
                "mode": "bulk",
                "category_ids": job_data["category_ids"],
                "requested_stories": len(source_stories),
                "completed_stories": sum(item.get("status") in {"completed", "skipped"} for item in final.get("stories", [])),
                "skipped_stories": sum(item.get("status") == "skipped" for item in final.get("stories", [])),
                "failed_stories": sum(item.get("status") in {"error", "completed_with_errors"} for item in final.get("stories", [])),
            },
        )
    except StoryCrawlerError as error:
        db.rollback()
        _update_crawl_job(job_id, status="error", current_story=None, error=str(error))
    except Exception as error:  # noqa: BLE001
        db.rollback()
        _update_crawl_job(job_id, status="error", current_story=None, error=f"Lỗi cào hàng loạt: {error}")
    finally:
        db.close()


def _update_bulk_story(job_id: str, story_index: int, **fields: Any) -> None:
    with _JOBS_LOCK:
        job = _CRAWL_JOBS.get(job_id)
        if job is None or story_index >= len(job.stories):
            return
        job.stories[story_index].update(fields)
        job.updated_at = datetime.now(timezone.utc)


def start_bulk_crawl_job(job_id: str) -> None:
    thread = threading.Thread(target=run_bulk_crawl_job, args=(job_id,), daemon=True)
    thread.start()


class DaoTruyenClient:
    """HTTP client có giới hạn tốc độ giữa mọi request."""

    def __init__(self, delay: float = REQUEST_DELAY_SECONDS) -> None:
        self.delay = max(0.0, delay)
        self._last_request_at = 0.0
        self._client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=15.0),
            follow_redirects=True,
            headers={
                # Giữ nguyên các header fetch trong samples/get*.js.
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
            },
        )

    def __enter__(self) -> "DaoTruyenClient":
        return self

    def __exit__(self, *_args: object) -> None:
        self._client.close()

    def get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        referer: str | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        global _LAST_GLOBAL_REQUEST_AT
        # Khoá dùng chung giữa các request/client để người dùng bấm liên tiếp
        # các chương riêng lẻ cũng không tạo burst request lên nguồn.
        with _RATE_LIMIT_LOCK:
            now = time.monotonic()
            # Phải chờ theo mốc gần nhất: cả client riêng lẫn toàn hệ thống
            # đều cách request trước tối thiểu delay.
            elapsed = min(now - self._last_request_at, now - _LAST_GLOBAL_REQUEST_AT)
            if elapsed < self.delay:
                time.sleep(self.delay - elapsed)

            headers = {"Referer": referer} if referer else {}
            if extra_headers:
                headers.update(extra_headers)
            try:
                response = self._client.get(
                    f"{BASE_URL}/{path.lstrip('/')}", params=params, headers=headers
                )
                self._last_request_at = time.monotonic()
                _LAST_GLOBAL_REQUEST_AT = self._last_request_at
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, json.JSONDecodeError) as error:
                raise StoryCrawlerError(f"Không thể tải dữ liệu truyện: {error}") from error

    def category_page(
        self,
        category_id: int,
        page_no: int = 0,
        page_size: int = DEFAULT_PAGE_SIZE,
        category_url: str = "",
    ) -> dict[str, Any]:
        data = self.get(
            f"stories-by-category/{category_id}",
            params={"pageNo": page_no, "pageSize": page_size},
            referer=f"https://daotruyen.me/category/{category_url}" if category_url else "https://daotruyen.me/",
            extra_headers={"Priority": "u=0"},
        )
        if not isinstance(data, dict):
            raise StoryCrawlerError("API danh sách truyện trả về dữ liệu không hợp lệ.")
        return data

    def story_metadata(self, story_slug: str) -> dict[str, Any]:
        data = self.get(
            story_slug,
            referer=f"https://daotruyen.me/{story_slug}",
            extra_headers={"Priority": "u=4"},
        )
        if not isinstance(data, dict) or not isinstance(data.get("story"), dict):
            raise StoryCrawlerError("API metadata truyện trả về dữ liệu không hợp lệ.")
        return data

    def story_chapter(self, story_slug: str, chapter_number: int) -> dict[str, Any]:
        data = self.get(
            f"{story_slug}/{chapter_number}",
            referer=f"https://daotruyen.me/{story_slug}/chuong-{chapter_number}.html",
            extra_headers={
                "Request-Token": "e692416db5704ab604092026160650",
                "Priority": "u=4",
            },
        )
        if not isinstance(data, dict) or not isinstance(data.get("chapter"), dict):
            raise StoryCrawlerError("API nội dung chương trả về dữ liệu không hợp lệ.")
        return data


def _resource_dir() -> Path:
    """Tìm resources ở cả source tree và thư mục bundle PyInstaller."""
    candidates = [
        TOOLS_DIR / "Backend" / "resources",
        Path(__file__).resolve().parents[2] / "resources",
    ]
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        candidates.insert(0, Path(bundle_root) / "resources")
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def list_categories() -> list[dict[str, Any]]:
    path = _resource_dir() / "daotruyen-categories.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise StoryCrawlerError(f"Không đọc được danh sách thể loại: {error}") from error

    categories = []
    for item in data if isinstance(data, list) else []:
        category_name = str(item.get("categoryName") or "").strip() if isinstance(item, dict) else ""
        if not isinstance(item, dict) or not category_name or category_name == "..." or item.get("id") is None:
            continue
        categories.append(
            {
                "id": int(item["id"]),
                "categoryName": category_name,
                "url": str(item.get("url") or "").strip(),
            }
        )
    return categories


def _load_system_stories() -> list[dict[str, Any]]:
    path = _resource_dir() / "story-list.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return [item for item in data if isinstance(item, dict) and item.get("url")] if isinstance(data, list) else []


def get_story_statistics(db: Session) -> dict[str, int]:
    """Thống kê snapshot truyện trong hệ thống và nội dung đã lưu thật trong DB."""
    total_stories = len(_load_system_stories())
    crawled_stories = int(
        db.scalar(select(func.count(func.distinct(CrawledChapter.story_slug)))) or 0
    )
    crawled_chapters = int(db.scalar(select(func.count(CrawledChapter.chapter_key))) or 0)
    metadata_stories = int(db.scalar(select(func.count(CrawledStory.story_slug))) or 0)
    return {
        "total_stories": total_stories,
        "metadata_stories": metadata_stories,
        "crawled_stories": crawled_stories,
        "uncrawled_stories": max(total_stories - crawled_stories, 0),
        "crawled_chapters": crawled_chapters,
    }


def list_crawled_stories(db: Session) -> list[dict[str, Any]]:
    """Danh sách mọi truyện có ít nhất một chương đã lưu trong SQLite."""
    counts = {
        story_slug: (int(count), latest)
        for story_slug, count, latest in db.execute(
            select(
                CrawledChapter.story_slug,
                func.count(CrawledChapter.chapter_key),
                func.max(CrawledChapter.crawled_at),
            )
            .group_by(CrawledChapter.story_slug)
            .order_by(func.max(CrawledChapter.crawled_at).desc())
        )
    }
    if not counts:
        return []

    stories = db.scalars(
        select(CrawledStory).where(CrawledStory.story_slug.in_(counts.keys()))
    )
    snapshots = {item.get("url"): item for item in _load_system_stories() if item.get("url")}
    result = []
    for story in stories:
        chapter_count, latest = counts[story.story_slug]
        snapshot = snapshots.get(story.story_slug) or {}
        total_chapters = story.total_chapter or 0
        result.append(
            {
                "id": story.source_id,
                "url": story.story_slug,
                "storySlug": story.story_slug,
                "name": story.name,
                "authorName": story.author_name,
                "teamName": story.team_name or snapshot.get("teamName"),
                "image": story.image,
                "totalChapter": total_chapters,
                "totalView": story.total_view if story.total_view is not None else snapshot.get("totalView"),
                "following": story.following if story.following is not None else snapshot.get("following"),
                "lastChapterUpdatedAt": story.source_updated_at or snapshot.get("lastChapterUpdatedAt"),
                "categories": story.categories,
                "crawledChapterCount": chapter_count,
                "progressPercent": round(chapter_count / total_chapters * 100) if total_chapters else 0,
                "lastCrawledAt": latest.isoformat() if latest else None,
                "importedAt": story.created_at.isoformat() if story.created_at else None,
            }
        )
    result.sort(key=lambda item: item["lastCrawledAt"] or "", reverse=True)
    return result


def list_stories_by_category(category_id: int) -> dict[str, Any]:
    stories: list[dict[str, Any]] = []
    seen_ids: set[Any] = set()
    snapshots = {item.get("url"): item for item in _load_system_stories() if item.get("url")}
    page_no = 0
    category_url = next(
        (category["url"] for category in list_categories() if category["id"] == category_id),
        "",
    )

    with DaoTruyenClient() as client:
        while page_no < 100:
            page = client.category_page(category_id, page_no, category_url=category_url)
            content = page.get("content") or []
            if not isinstance(content, list):
                raise StoryCrawlerError("API danh sách truyện trả về content không hợp lệ.")
            for story in content:
                if not isinstance(story, dict) or not story.get("url"):
                    continue
                key = story.get("id") or story["url"]
                if key not in seen_ids:
                    seen_ids.add(key)
                    snapshot = snapshots.get(story["url"]) or {}
                    # API danh sách thường thiếu following/lastChapterUpdatedAt;
                    # chỉ bổ sung các giá trị thiếu từ snapshot, không ghi đè dữ liệu live.
                    stories.append({
                        **snapshot,
                        **{field: value for field, value in story.items() if value is not None},
                    })
            if not page.get("next") or not content:
                break
            page_no += 1

    return {"category_id": category_id, "stories": stories, "next": False, "page_count": page_no + 1}


def _upsert_story(db: Session, metadata: dict[str, Any]) -> CrawledStory:
    source = metadata.get("story") or {}
    slug = str(source.get("url") or "").strip()
    if not slug:
        raise StoryCrawlerError("Metadata không có story url.")

    snapshot = next((item for item in _load_system_stories() if item.get("url") == slug), {})

    row = db.get(CrawledStory, slug)
    if row is None:
        row = CrawledStory(story_slug=slug, name=str(source.get("name") or slug))
        db.add(row)
    row.source_id = source.get("id") or snapshot.get("id")
    row.name = str(source.get("name") or row.name or slug)
    row.author_name = source.get("authorName")
    translate = metadata.get("translate") or {}
    row.team_name = source.get("teamName") or translate.get("teamName") or snapshot.get("teamName")
    row.image = source.get("image") or snapshot.get("image")
    row.description = source.get("description")
    row.total_chapter = source.get("totalChapter") or snapshot.get("totalChapter") or len(metadata.get("chapters") or [])
    row.total_view = source.get("totalView") if source.get("totalView") is not None else snapshot.get("totalView")
    row.following = source.get("following") if source.get("following") is not None else snapshot.get("following")
    row.source_updated_at = (
        source.get("updatedAt")
        or source.get("lastChapterUpdatedAt")
        or snapshot.get("lastChapterUpdatedAt")
    )
    row.raw_metadata = metadata
    row.categories = metadata.get("categories") or []
    row.updated_at = datetime.now(timezone.utc)
    return row


def _chapter_status(db: Session, story_slug: str) -> dict[int, CrawledChapter]:
    rows = db.scalars(select(CrawledChapter).where(CrawledChapter.story_slug == story_slug))
    return {row.chapter_number: row for row in rows}


def _metadata_response(db: Session, metadata: dict[str, Any]) -> dict[str, Any]:
    story = _upsert_story(db, metadata)
    db.commit()
    saved = _chapter_status(db, story.story_slug)
    chapters = []
    for item in metadata.get("chapters") or []:
        if not isinstance(item, dict) or item.get("chapterNumber") is None:
            continue
        chapter_number = int(item["chapterNumber"])
        chapters.append({**item, "crawled": chapter_number in saved})
    # API thường trả sẵn thứ tự, nhưng không phụ thuộc vào thứ tự JSON để
    # giao diện và mọi thao tác chọn chương luôn theo số chương thực tế.
    chapters.sort(key=lambda item: item["chapterNumber"])
    return {
        **metadata,
        "story": {**metadata["story"], "storySlug": story.story_slug},
        "chapters": chapters,
    }


def get_story_metadata(db: Session, story_slug: str) -> dict[str, Any]:
    try:
        with DaoTruyenClient() as client:
            metadata = client.story_metadata(story_slug)
    except StoryCrawlerError:
        # Cho phép mở truyện đã cào ngay cả khi nguồn tạm thời trả 403/rate-limit.
        # raw_metadata được lưu cùng lúc import story, nên vẫn đủ danh sách chương
        # và trạng thái đã lưu để hiển thị UI; lần cào mới vẫn sẽ báo lỗi nếu nguồn chưa mở lại.
        stored_story = db.get(CrawledStory, story_slug)
        if stored_story is None or not isinstance(stored_story.raw_metadata, dict) or not stored_story.raw_metadata.get("story"):
            raise
        metadata = stored_story.raw_metadata
    return _metadata_response(db, metadata)


def get_saved_story(db: Session, story_slug: str) -> dict[str, Any] | None:
    """Đọc metadata và toàn bộ nội dung đã cào từ SQLite, không gọi nguồn ngoài."""
    story = db.get(CrawledStory, story_slug)
    if story is None:
        return None
    chapters = db.scalars(
        select(CrawledChapter)
        .where(CrawledChapter.story_slug == story_slug)
        .order_by(CrawledChapter.chapter_number)
    )
    return {
        "story": {
            "id": story.source_id,
            "url": story.story_slug,
            "storySlug": story.story_slug,
            "name": story.name,
            "authorName": story.author_name,
            "teamName": story.team_name,
            "image": story.image,
            "description": story.description,
            "totalChapter": story.total_chapter,
            "totalView": story.total_view,
            "following": story.following,
            "updatedAt": story.source_updated_at,
        },
        "categories": story.categories,
        "chapters": [
            {
                "id": chapter.source_id,
                "title": chapter.title,
                "chapterNumber": chapter.chapter_number,
                "paragraph": chapter.paragraph,
                "updatedAt": chapter.source_updated_at,
                "crawledAt": chapter.crawled_at.isoformat(),
            }
            for chapter in chapters
        ],
    }


def _upsert_chapter(
    db: Session,
    story_slug: str,
    expected_number: int,
    chapter: dict[str, Any],
) -> CrawledChapter:
    response_number = chapter.get("chapterNumber")
    try:
        response_number = int(response_number)
    except (TypeError, ValueError) as error:
        raise StoryCrawlerError("API chương không trả về số thứ tự hợp lệ.") from error
    if response_number != expected_number:
        raise StoryCrawlerError(
            f"API trả về chương {response_number}, nhưng đang yêu cầu chương {expected_number}; đã bỏ qua để tránh lệch mạch truyện."
        )
    number = expected_number
    key = f"{story_slug}:{number}"
    row = db.get(CrawledChapter, key)
    if row is None:
        row = CrawledChapter(
            chapter_key=key,
            story_slug=story_slug,
            chapter_number=number,
            title=str(chapter.get("title") or f"Chương {number}"),
            paragraph=str(chapter.get("paragraph") or ""),
        )
        db.add(row)
    row.source_id = chapter.get("id")
    row.title = str(chapter.get("title") or f"Chương {number}")
    row.paragraph = str(chapter.get("paragraph") or "")
    row.source_updated_at = chapter.get("updatedAt")
    row.crawled_at = datetime.now(timezone.utc)
    return row


def crawl_story(
    db: Session,
    story_slug: str,
    chapter_number: int | None = None,
    progress_callback: Any | None = None,
) -> dict[str, Any]:
    """Cào một chương hoặc toàn bộ chương; commit độc lập sau mỗi chương."""
    with DaoTruyenClient() as client:
        metadata = client.story_metadata(story_slug)
        story = _upsert_story(db, metadata)
        db.commit()

        available: dict[int, dict[str, Any]] = {}
        for item in metadata.get("chapters") or []:
            if not isinstance(item, dict) or item.get("chapterNumber") is None:
                continue
            try:
                number = int(item["chapterNumber"])
            except (TypeError, ValueError) as error:
                raise StoryCrawlerError("Metadata có số thứ tự chương không hợp lệ.") from error
            if number < 1:
                raise StoryCrawlerError("Metadata có số thứ tự chương nhỏ hơn 1.")
            if number in available:
                raise StoryCrawlerError(f"Metadata bị trùng số chương {number}; đã dừng để tránh cào sai thứ tự.")
            available[number] = item
        if chapter_number is not None:
            if chapter_number not in available:
                raise StoryCrawlerError(f"Không tìm thấy chương {chapter_number} trong truyện.")
            targets = [chapter_number]
        else:
            targets = sorted(available)

        if progress_callback:
            progress_callback(
                {
                    "type": "prepared",
                    "total": len(targets),
                    "chapters": [
                        {
                            "chapter_number": number,
                            "title": available[number].get("title") or f"Chương {number}",
                            "status": "pending",
                        }
                        for number in targets
                    ],
                }
            )

        results: list[dict[str, Any]] = []
        for number in targets:
            if progress_callback:
                progress_callback(
                    {
                        "type": "chapter",
                        "chapter_number": number,
                        "title": available[number].get("title") or f"Chương {number}",
                        "status": "running",
                    }
                )
            try:
                payload = client.story_chapter(story_slug, number)
                chapter = payload.get("chapter") or {}
                if not chapter.get("paragraph"):
                    raise StoryCrawlerError("Chương không có nội dung.")
                row = _upsert_chapter(db, story_slug, number, chapter)
                db.commit()
                results.append({"chapter_number": number, "title": row.title, "status": "crawled"})
                if progress_callback:
                    progress_callback(
                        {
                            "type": "chapter",
                            "chapter_number": number,
                            "title": row.title,
                            "status": "crawled",
                        }
                    )
            except StoryCrawlerError as error:
                db.rollback()
                results.append({"chapter_number": number, "status": "error", "error": str(error)})
                if progress_callback:
                    progress_callback(
                        {
                            "type": "chapter",
                            "chapter_number": number,
                            "title": available[number].get("title") or f"Chương {number}",
                            "status": "error",
                            "error": str(error),
                        }
                    )

    succeeded = [item for item in results if item["status"] == "crawled"]
    failed = [item for item in results if item["status"] == "error"]
    return {
        "story": {**metadata["story"], "storySlug": story.story_slug},
        "mode": "chapter" if chapter_number is not None else "all",
        "requested_count": len(targets),
        "crawled_count": len(succeeded),
        "failed_count": len(failed),
        "chapters": results,
    }
