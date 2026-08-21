"""SQL model cho voice clone (lưu metadata trong ``Data/app.db`` — DB chung).

ref_path trỏ tới file ref audio ở voice-service (``data/voices/{voice_id}.*``), chỉ dùng
để tham chiếu/backup — engine state thật sự nằm trong ``voices.json`` của voice-service.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Voice(Base):
    __tablename__ = "voices"

    voice_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    ref_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    tags: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
