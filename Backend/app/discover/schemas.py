"""Discover Module Pydantic Schemas."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class RecommendRequest(BaseModel):
    query: str = Field(default="", description="Search query in English or Vietnamese")
    category: str | None = Field(default=None, description="Category slug filter")


class ChannelVideoRequest(BaseModel):
    channel_url: str = Field(..., description="YouTube channel URL or @handle")
    limit: int = Field(default=24, ge=5, le=50, description="Max videos to extract")
    offset: int = Field(default=0, ge=0, le=500, description="Bỏ qua N video mới nhất (dùng cho 'Tải thêm')")


class SaveChannelRequest(BaseModel):
    name: str | None = None
    handle: str
    channel_url: str | None = None
    avatar_url: str | None = None
    subscribers: str | None = None
    category: str | None = "custom"
    category_label: str | None = "Kênh đã lưu"
    description: str | None = None
    tags: list[str] = Field(default_factory=list)


class ChannelOut(BaseModel):
    id: str | None = None
    name: str
    handle: str
    channel_url: str
    avatar_url: str | None = None
    subscribers: str | None = None
    category: str | None = None
    category_label: str | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    is_saved: bool = False


class VideoOut(BaseModel):
    id: str
    title: str
    url: str
    duration_sec: float | int | None = None
    duration_formatted: str
    is_golden_duration: bool = False
    view_count: int | None = None
    view_count_formatted: str
    thumbnail_url: str
    upload_date: str = ""
    published_at: str = ""
    published_exact: bool = False
    published_label: str = ""
    is_new: bool = False


class ChannelVideosResponse(BaseModel):
    channel_name: str
    channel_id: str
    channel_url: str
    avatar_url: str | None = None
    subscribers: str | None = None
    video_count: int
    offset: int = 0
    next_offset: int = 0
    has_more: bool = False
    new_in_scan: int = 0
    first_scan: bool = False
    previous_scan_at: int | None = None
    scanned_at: int = 0
    videos: list[VideoOut]
