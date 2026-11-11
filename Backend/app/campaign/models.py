"""Bảng SQLite của Campaign engine (docs/PLAN_ai_workflow_campaign.md §3.2)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def new_id(n: int = 12) -> str:
    return uuid.uuid4().hex[:n]


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    niche: Mapped[str] = mapped_column(String(64), default="fashion", nullable=False)
    platform: Mapped[str] = mapped_column(String(64), default="tiktok", nullable=False)
    credit_cap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class CampaignStep(Base):
    """Tham số người dùng + artifact đang chọn. element_key rỗng = cấp bước; khác rỗng = phần tử của bước map."""
    __tablename__ = "campaign_steps"
    __table_args__ = (UniqueConstraint("campaign_id", "step_key", "element_key", name="uq_campaign_step_element"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    campaign_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    step_key: Mapped[str] = mapped_column(String(64), nullable=False)
    element_key: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    params_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    selected_artifact_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Artifact(Base):
    """Bất biến: tạo xong không sửa. Sửa = tạo artifact mới."""
    __tablename__ = "campaign_artifacts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id(16))
    campaign_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)  # tương đối so với thư mục gốc campaigns
    meta_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    step_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    element_key: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    fingerprint: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    parts_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)  # thành phần tạo nên vân tay (để giải thích "cũ")
    parent_ids_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


class Run(Base):
    """Sổ chạy. state: queued|running|done|cached|error|cancelled|unknown."""
    __tablename__ = "campaign_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id(16))
    campaign_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    step_key: Mapped[str] = mapped_column(String(64), nullable=False)
    element_key: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    fingerprint: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    state: Mapped[str] = mapped_column(String(16), default="queued", nullable=False, index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    credit_est: Mapped[int | None] = mapped_column(Integer, nullable=True)
    credit_actual: Mapped[int | None] = mapped_column(Integer, nullable=True)
    external_ref: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    artifact_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Gate(Base):
    """Cổng duyệt gắn artifact cụ thể. state: approved|rejected."""
    __tablename__ = "campaign_gates"
    __table_args__ = (UniqueConstraint("campaign_id", "step_key", "element_key", name="uq_campaign_gate"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    campaign_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    step_key: Mapped[str] = mapped_column(String(64), nullable=False)
    element_key: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    artifact_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    state: Mapped[str] = mapped_column(String(16), default="approved", nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class PromptTemplate(Base):
    """Mẫu prompt của người dùng. Mỗi lần sửa = một dòng version mới. Mẫu hệ thống nằm trong file, không ở DB."""
    __tablename__ = "campaign_prompt_templates"
    __table_args__ = (UniqueConstraint("template_id", "version", name="uq_prompt_template_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    ref_slots_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    base_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


class CastLibraryItem(Base):
    """Thư viện nhân vật dùng lại giữa các chiến dịch. File nằm ở <root>/cast_library/."""
    __tablename__ = "campaign_cast_library"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id(12))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


ALL_TABLES = [
    Campaign.__table__,
    CampaignStep.__table__,
    Artifact.__table__,
    Run.__table__,
    Gate.__table__,
    PromptTemplate.__table__,
    CastLibraryItem.__table__,
]
