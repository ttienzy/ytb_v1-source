"""SQL model cho BGM track — metadata trong ``app.db``.

Mirror ``app.voices.models.Voice``. ``file_path`` trỏ tới file audio trong
``Backend/Data/media/bgm/{track_id}.{ext}`` (absolute, DB local). ``description`` lưu
credit text đầy đủ (CC BY...) cho các track cần attribution — FE show để user dán
lên mô tả YouTube.

Watermark (drawtext) đã bỏ — burn-in text buộc re-encode video (chậm), user quyết định
không cần. Bảng ``watermarks`` (migration 0004) giữ lại dead trong DB.
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class BgmTrack(Base):
    __tablename__ = "bgm_tracks"

    track_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    needs_attribution: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_sec: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
