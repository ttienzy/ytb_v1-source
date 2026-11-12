"""SQLAlchemy models cho dữ liệu truyện đã cào."""

from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class CrawledStory(Base):
    __tablename__ = "crawled_stories"

    story_slug: Mapped[str] = mapped_column(String(255), primary_key=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    author_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    team_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_chapter: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_view: Mapped[int | None] = mapped_column(Integer, nullable=True)
    following: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_updated_at: Mapped[str | None] = mapped_column(String(100), nullable=True)
    raw_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    categories: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class CrawledChapter(Base):
    __tablename__ = "crawled_chapters"

    chapter_key: Mapped[str] = mapped_column(String(320), primary_key=True)
    story_slug: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    paragraph: Mapped[str] = mapped_column(Text, nullable=False)
    source_updated_at: Mapped[str | None] = mapped_column(String(100), nullable=True)
    crawled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


class StorySummary(Base):
    """Bản tóm tắt cốt truyện do Gemini viết. Tạo một lần rồi lưu lại — chỉ để người dùng nắm cốt truyện."""

    __tablename__ = "story_summaries"

    story_slug: Mapped[str] = mapped_column(String(255), primary_key=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    chapters_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # số chương đã gửi cho Gemini
    source_chars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    truncated: Mapped[bool] = mapped_column(nullable=False, default=False)  # nội dung bị cắt bớt vì quá dài
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
