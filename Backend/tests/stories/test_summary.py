import json
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.db import get_db
from app.stories import summary
from app.stories.models import CrawledChapter, CrawledStory, StorySummary

GOOD = (
    "GIỚI THIỆU\nTruyện ngôn tình hiện đại về cô gái trọng sinh trở về trước ngày đính hôn để thay đổi số phận.\n\n"
    "DIỄN BIẾN CHÍNH\n- Chương 1–3: nữ chính trọng sinh, hủy hôn.\n- Chương 4–9: đối đầu gia tộc và tìm ra chân tướng.\n\n"
    "ĐIỂM NỔI BẬT\nNhịp nhanh, nhiều phản chuyển bất ngờ."
)


def stream(*texts: str) -> str:
    """Giả lập response StreamGenerate: mỗi frame mang nội dung cộng dồn."""
    lines = []
    for text in texts:
        payload = [None, None, None, None, [["rc_1", [text]]]]
        lines.append(json.dumps([["wrb.fr", None, json.dumps(payload)]]))
    return "\n".join(lines)


@pytest.fixture()
def db_env(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        db.add(CrawledStory(story_slug="s1", name="Ta Là Tạ Uyển"))
        db.add_all([CrawledChapter(chapter_key=f"s1:{n}", story_slug="s1", chapter_number=n, title=f"C{n}", paragraph=f"Nội dung chương {n}. " * 20) for n in (1, 2, 3)])
        db.commit()
    monkeypatch.setattr(summary, "_session_factory", Session)
    summary._JOBS.clear()
    yield Session
    summary._JOBS.clear()


def wait_for(Session, slug, want, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        with Session() as db:
            got = summary.get_summary(db, slug)
        if got["status"] in want:
            return got
        time.sleep(0.02)
    raise AssertionError(f"quá hạn, trạng thái cuối: {got}")


# ── xử lý văn bản ────────────────────────────────────────────────────────────

def test_build_story_document_keeps_chapters_in_order():
    doc, truncated = summary.build_story_document("Truyện", [(2, "B", "bbb"), (5, "E", " eee ")])
    assert not truncated
    assert doc.startswith("TRUYỆN: Truyện") and doc.index("Chương 2: B") < doc.index("Chương 5: E") and "\neee\n" in doc


def test_build_story_document_truncates_evenly_but_covers_every_chapter():
    chapters = [(n, f"T{n}", "x" * 1000) for n in (1, 2, 3)]
    doc, truncated = summary.build_story_document("X", chapters, max_chars=1500)
    assert truncated and len(doc) <= 1500 + 50
    assert all(f"Chương {n}: T{n}" in doc for n in (1, 2, 3)), "không được mất hẳn chương nào"
    assert doc.count("[…]") == 3


def test_extract_stream_text_takes_longest_cumulative_frame():
    assert summary.extract_stream_text(stream("Xin", "Xin chào", "Xin chào bạn")) == "Xin chào bạn"
    assert summary.extract_stream_text("không phải stream") == ""


def test_clean_summary_strips_markdown():
    raw = "## GIỚI THIỆU\n**Truyện** hay\n\n\n\n* ý một\n  * ý hai\n```text\nx\n```"
    out = summary.clean_summary(raw)
    assert "#" not in out and "**" not in out and "```" not in out
    assert "- ý một" in out and "  - ý hai" in out and "\n\n\n" not in out


# ── luồng tạo + lưu ──────────────────────────────────────────────────────────

def test_generate_saves_once_and_does_not_call_gemini_again(db_env, monkeypatch):
    from app.ai.gemini import recap
    calls = []

    def fake(prompt_text, filename, query_text="", **kw):
        calls.append((prompt_text, filename, query_text))
        return stream("GIỚI", GOOD)

    monkeypatch.setattr(recap, "_call_gemini_stream", fake)
    first = summary.start_summary("s1")
    assert first["status"] in ("queued", "running")
    done = wait_for(db_env, "s1", {"done", "error"})
    assert done["status"] == "done" and done["summary"].startswith("GIỚI THIỆU")
    assert done["chapters_count"] == 3 and done["stale"] is False

    prompt_text, filename, query = calls[0]
    assert "Chương 1: C1" in prompt_text and "Chương 3: C3" in prompt_text, "cả truyện đi qua FILE đính kèm"
    assert filename.endswith(".txt") and "Ta Là Tạ Uyển" in query and "3 chương" in query and len(query) < 1500, "câu lệnh ngắn"

    again = summary.start_summary("s1")  # đã có bản lưu → không gọi lại
    assert again["status"] == "done" and len(calls) == 1
    summary.start_summary("s1", force=True)
    wait_for(db_env, "s1", {"done"})
    time.sleep(0.1)
    assert len(calls) == 2


def test_saved_summary_flags_stale_when_more_chapters_crawled(db_env):
    with db_env() as db:
        db.add(StorySummary(story_slug="s1", summary=GOOD, chapters_count=2))
        db.commit()
        got = summary.get_summary(db, "s1")
    assert got["status"] == "done" and got["current_chapters"] == 3 and got["stale"] is True


@pytest.mark.parametrize("exc_name,expected", [
    ("RecapConfigError", "Chưa đăng nhập Gemini"),
    ("GeminiAuthError", "hết hạn"),
    ("GeminiRateLimitError", "giới hạn tốc độ"),
    ("GeminiTransientError", "Lỗi mạng"),
])
def test_gemini_errors_become_friendly_messages(db_env, monkeypatch, exc_name, expected):
    from app.ai.gemini import recap

    def boom(*a, **k):
        raise getattr(recap, exc_name)("chi tiết")

    monkeypatch.setattr(recap, "_call_gemini_stream", boom)
    summary.start_summary("s1")
    got = wait_for(db_env, "s1", {"error"})
    assert expected in got["error"]
    with db_env() as db:
        assert db.get(StorySummary, "s1") is None, "lỗi thì không được lưu gì"


def test_short_answer_retried_once_then_error(db_env, monkeypatch):
    from app.ai.gemini import recap
    calls = []
    monkeypatch.setattr(recap, "_call_gemini_stream", lambda *a, **k: (calls.append(1), stream("Không rõ"))[1])
    summary.start_summary("s1")
    got = wait_for(db_env, "s1", {"error"})
    assert len(calls) == 2 and "không trả về bản tóm tắt hợp lệ" in got["error"]


def test_error_then_retry_succeeds(db_env, monkeypatch):
    from app.ai.gemini import recap
    state = {"fail": True}

    def flaky(*a, **k):
        if state["fail"]:
            raise recap.GeminiRateLimitError("x")
        return stream(GOOD)

    monkeypatch.setattr(recap, "_call_gemini_stream", flaky)
    summary.start_summary("s1")
    wait_for(db_env, "s1", {"error"})
    state["fail"] = False
    summary.start_summary("s1")
    assert wait_for(db_env, "s1", {"done"})["status"] == "done"


def test_unknown_story(db_env):
    with pytest.raises(summary.StoryNotFound):
        summary.start_summary("khong-co")


# ── HTTP ─────────────────────────────────────────────────────────────────────

def test_http_endpoints(db_env, monkeypatch):
    from app.ai.gemini import recap
    from app.stories.router import router

    monkeypatch.setattr(recap, "_call_gemini_stream", lambda *a, **k: stream(GOOD))
    app = FastAPI()
    app.include_router(router)

    def override():
        with db_env() as db:
            yield db

    app.dependency_overrides[get_db] = override
    client = TestClient(app)
    assert client.get("/api/stories/s1/summary").json() == {"status": "none"}
    assert client.post("/api/stories/khong-co/summary").status_code == 404
    assert client.post("/api/stories/s1/summary").status_code == 202
    wait_for(db_env, "s1", {"done"})
    data = client.get("/api/stories/s1/summary").json()
    assert data["status"] == "done" and data["summary"].startswith("GIỚI THIỆU")
    assert client.post("/api/stories/s1/summary", json={"force": False}).json()["status"] == "done"
