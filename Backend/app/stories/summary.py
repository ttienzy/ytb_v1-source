"""Tóm tắt cốt truyện bằng Gemini (web, cùng cookie với Recap).

Mục đích duy nhất: để người dùng hiểu truyện nói về gì trước khi chọn chương làm Audio. Vì vậy:
  * Cả truyện được gửi dưới dạng FILE đính kèm (không nhét vào prompt), kèm một câu lệnh ngắn.
  * Tạo MỘT lần rồi lưu DB; lần sau chỉ đọc lại (không gọi Gemini nữa) trừ khi người dùng bấm "Tạo lại".
  * Gemini web mất vài chục giây tới vài phút nên chạy nền; giao diện hỏi trạng thái định kỳ.
"""
from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.stories.models import CrawledChapter, CrawledStory, StorySummary

# Truyện dài nhất hiện có ~370 nghìn ký tự; ngưỡng này chỉ để phòng truyện khổng lồ vượt giới hạn tệp/ngữ cảnh của Gemini web.
MAX_SOURCE_CHARS = 900_000
MIN_SUMMARY_CHARS = 120

SUMMARY_QUERY = (
    "File đính kèm là nội dung truyện \"{name}\" ({count} chương{note}). Hãy đọc và viết bản TÓM TẮT CỐT TRUYỆN bằng tiếng Việt "
    "để người đọc nắm được truyện nói về gì (được phép kể cả diễn biến và kết cục).\n"
    "Trình bày bằng văn bản thuần, KHÔNG dùng markdown (không dấu *, #, ```), gồm các phần, mỗi phần bắt đầu bằng một dòng tiêu đề viết hoa:\n"
    "GIỚI THIỆU — thể loại, bối cảnh, nhân vật chính (2–4 câu).\n"
    "DIỄN BIẾN CHÍNH — các mốc chính theo thứ tự, mỗi mốc một dòng bắt đầu bằng \"- \" và ghi rõ khoảng chương nếu xác định được.\n"
    "ĐIỂM NỔI BẬT — điều khiến truyện đáng nghe/đọc (2–3 câu).\n"
    "Tổng độ dài khoảng 300–600 từ. Chỉ dựa vào nội dung trong file; nếu truyện chưa kết thúc ở chương cuối thì nói rõ \"chưa hết\"."
)


class StoryNotFound(LookupError):
    pass


_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()
# Gemini web: gửi một tệp lớn tại một thời điểm, các yêu cầu khác xếp hàng (tránh bị giới hạn tốc độ).
_GEMINI_GATE = threading.Lock()
_session_factory: Callable[[], Session] = SessionLocal


# ── Xử lý văn bản ────────────────────────────────────────────────────────────

def build_story_document(name: str, chapters: list[tuple[int, str, str]], max_chars: int = MAX_SOURCE_CHARS) -> tuple[str, bool]:
    """Ghép các chương thành MỘT tài liệu văn bản. Quá `max_chars` thì cắt đều từng chương (giữ phần đầu) để vẫn phủ cả truyện.

    Trả (văn bản, có_bị_cắt)."""
    heads = [f"=== Chương {number}: {title} ===\n" for number, title, _ in chapters]
    body_total = sum(len(paragraph.strip()) for _, _, paragraph in chapters)
    overhead = sum(len(h) for h in heads) + len(name) + 40
    truncated = body_total + overhead > max_chars
    cap = max(200, (max_chars - overhead) // max(1, len(chapters))) if truncated else None
    parts = [f"TRUYỆN: {name}\n\n"]
    for head, (_, _, paragraph) in zip(heads, chapters):
        text = paragraph.strip()
        if cap is not None and len(text) > cap:
            text = text[:cap].rstrip() + " […]"
        parts.append(f"{head}{text}\n\n")
    return "".join(parts), truncated


def extract_stream_text(raw: str) -> str:
    """Lấy văn bản trả lời cuối cùng từ stream StreamGenerate (các frame mang nội dung cộng dồn → lấy bản dài nhất)."""
    from app.ai.gemini.recap import _parse_stream_frames  # import muộn: module này kéo nhiều phụ thuộc

    best = ""
    for payload in _parse_stream_frames(raw):
        try:
            for candidate in payload[4]:
                if isinstance(candidate, list) and len(candidate) >= 2 and isinstance(candidate[1], list) and candidate[1]:
                    text = candidate[1][0]
                    if isinstance(text, str) and len(text) > len(best):
                        best = text
        except (IndexError, TypeError):
            continue
    return best


def clean_summary(text: str) -> str:
    """Gemini hay chèn markdown dù đã dặn không: bỏ ** / # / ``` và đổi gạch đầu dòng * thành "-"."""
    out = text.replace("\r\n", "\n")
    out = re.sub(r"```[a-zA-Z]*\n?", "", out)
    out = out.replace("**", "").replace("__", "")
    out = re.sub(r"^\s{0,3}#{1,6}\s*", "", out, flags=re.MULTILINE)
    out = re.sub(r"^(\s*)[*•]\s+", r"\1- ", out, flags=re.MULTILINE)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


# ── Trạng thái / lưu trữ ─────────────────────────────────────────────────────

def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _saved(db: Session, slug: str) -> dict[str, Any] | None:
    row = db.get(StorySummary, slug)
    if row is None:
        return None
    current = db.query(CrawledChapter.chapter_number).filter(CrawledChapter.story_slug == slug).count()
    return {
        "status": "done", "summary": row.summary, "chapters_count": row.chapters_count, "current_chapters": current,
        "truncated": bool(row.truncated), "updated_at": _iso(row.updated_at),
        # Truyện được crawl thêm chương sau khi tóm tắt → gợi ý tạo lại.
        "stale": current > row.chapters_count,
    }


def get_summary(db: Session, slug: str) -> dict[str, Any]:
    with _JOBS_LOCK:
        job = _JOBS.get(slug)
        job = dict(job) if job else None
    if job and job["status"] in ("queued", "running"):
        return {"status": job["status"], "message": job.get("message", "")}
    saved = _saved(db, slug)
    if saved:
        return saved
    if job and job["status"] == "error":
        return {"status": "error", "error": job.get("error", "")}
    return {"status": "none"}


def _set_job(slug: str, **values: Any) -> None:
    with _JOBS_LOCK:
        _JOBS.setdefault(slug, {}).update(values)


def start_summary(slug: str, force: bool = False) -> dict[str, Any]:
    with _session_factory() as db:
        if db.query(CrawledStory.story_slug).filter(CrawledStory.story_slug == slug).first() is None:
            raise StoryNotFound("Không tìm thấy truyện đã crawl.")
        if not force:
            saved = _saved(db, slug)
            if saved:
                return saved
    with _JOBS_LOCK:
        job = _JOBS.get(slug)
        if job and job["status"] in ("queued", "running"):
            return {"status": job["status"], "message": job.get("message", "")}
        _JOBS[slug] = {"status": "queued", "message": "Đang xếp hàng…"}
    threading.Thread(target=_run, args=(slug,), daemon=True, name=f"story-summary-{slug[:40]}").start()
    return {"status": "queued", "message": "Đang xếp hàng…"}


def _friendly_error(exc: Exception) -> str:
    from app.ai.gemini import recap

    if isinstance(exc, recap.RecapConfigError):
        return "Chưa đăng nhập Gemini. Vào Cài đặt → Gemini để đăng nhập rồi thử lại."
    if isinstance(exc, recap.GeminiAuthError):
        return f"Phiên Gemini không hợp lệ hoặc đã hết hạn: {exc}"
    if isinstance(exc, recap.GeminiRateLimitError):
        return "Gemini đang giới hạn tốc độ. Hãy thử lại sau vài phút."
    if isinstance(exc, recap.GeminiTransientError):
        return f"Lỗi mạng khi gọi Gemini: {exc}"
    return str(exc) or exc.__class__.__name__


def _status_message(status: str) -> str:
    if status == "refreshing_cookie":
        return "Đang làm mới phiên Gemini qua Chrome…"
    if status.startswith("rate_limited:"):
        return f"Gemini đang giới hạn tốc độ, chờ {status.split(':', 1)[1]} giây rồi thử lại…"
    if status == "network_retry":
        return "Mạng chập chờn, đang thử lại…"
    return "Đang chờ Gemini đọc truyện và viết tóm tắt (có thể mất 1–3 phút)…"


def _run(slug: str) -> None:
    try:
        with _GEMINI_GATE:
            _set_job(slug, status="running", message=_status_message("running"))
            _generate(slug)
    except Exception as exc:  # noqa: BLE001 - mọi lỗi phải thành thông báo cho người dùng, không được treo "đang chạy"
        _set_job(slug, status="error", error=_friendly_error(exc), message="")
    else:
        with _JOBS_LOCK:
            _JOBS.pop(slug, None)


def _generate(slug: str) -> None:
    from app.ai.gemini.recap import _call_gemini_stream

    with _session_factory() as db:
        story = db.query(CrawledStory.name).filter(CrawledStory.story_slug == slug).first()
        if story is None:
            raise StoryNotFound("Không tìm thấy truyện đã crawl.")
        rows = (
            db.query(CrawledChapter.chapter_number, CrawledChapter.title, CrawledChapter.paragraph)
            .filter(CrawledChapter.story_slug == slug)
            .order_by(CrawledChapter.chapter_number)
            .all()
        )
        name = story.name
    chapters = [(number, title, paragraph) for number, title, paragraph in rows if (paragraph or "").strip()]
    if not chapters:
        raise ValueError("Truyện chưa có chương nào có nội dung để tóm tắt.")

    document, truncated = build_story_document(name, chapters)
    note = " — đã cắt bớt phần cuối mỗi chương vì quá dài" if truncated else ""
    query = SUMMARY_QUERY.format(name=name, count=len(chapters), note=note)

    text = ""
    for _attempt in range(2):  # một lần thử lại nếu Gemini trả rỗng/quá ngắn
        raw = _call_gemini_stream(
            prompt_text=document,
            filename=f"{slug[:60]}.txt",
            query_text=query,
            status_callback=lambda status: _set_job(slug, message=_status_message(status)),
        )
        text = clean_summary(extract_stream_text(raw))
        if len(text) >= MIN_SUMMARY_CHARS:
            break
    if len(text) < MIN_SUMMARY_CHARS:
        raise ValueError("Gemini không trả về bản tóm tắt hợp lệ (nội dung rỗng hoặc quá ngắn). Thử lại sau.")

    now = datetime.now(timezone.utc)
    with _session_factory() as db:
        row = db.get(StorySummary, slug)
        if row is None:
            row = StorySummary(story_slug=slug, created_at=now)
            db.add(row)
        row.summary = text
        row.chapters_count = len(chapters)
        row.source_chars = len(document)
        row.truncated = truncated
        row.updated_at = now
        db.commit()
