"""SQLAlchemy models cho Veo Studio Projects."""

from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class VeoProject(Base):
    __tablename__ = "veo_projects"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        default=lambda: str(uuid.uuid4())[:12],
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    flow_project_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    account_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    video_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class VeoImage(Base):
    __tablename__ = "veo_images"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        default=lambda: str(uuid.uuid4())[:12],
    )
    prompt: Mapped[str] = mapped_column(String(2000), nullable=False)
    model_display_name: Mapped[str] = mapped_column(String(100), default="Nano Banana Pro")
    model_key: Mapped[str] = mapped_column(String(100), default="GEM_PIX_2")
    aspect_ratio: Mapped[str] = mapped_column(String(20), default="16:9")
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    media_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    image_url: Mapped[str] = mapped_column(String(2000), nullable=False)
    local_path: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    project_id: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
