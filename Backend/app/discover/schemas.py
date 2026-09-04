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


class ChannelVideosResponse(BaseModel):
    channel_name: str
    channel_id: str
    channel_url: str
    avatar_url: str | None = None
    subscribers: str | None = None
    video_count: int
    videos: list[VideoOut]


class ScoutVideosRequest(BaseModel):
    query: str = Field(default="", description="Search query or prompt for niche videos")
    custom_prompt: str | None = Field(default=None, description="Optional extra custom instructions")
    urls: list[str] | None = Field(default=None, description="Optional list of direct YouTube URLs")


class ScoutedVideoItem(BaseModel):
    title: str
    url: str
    video_id: str | None = None
    channel_name: str | None = None
    channel_url: str | None = None
    thumbnail_url: str | None = None
    duration_approx: str | None = None
    niche_topic: str | None = None
    reason: str | None = None


class ScoutVideosResponse(BaseModel):
    query: str
    results: list[ScoutedVideoItem]


class DriveUploadItem(BaseModel):
    url: str
    custom_name: str | None = None
    title: str | None = None


class DriveUploadBatchRequest(BaseModel):
    items: list[DriveUploadItem]
    folder_id: str | None = None


class DriveUploadTaskOut(BaseModel):
    task_id: str
    url: str
    title: str = ""
    custom_name: str = ""
    status: str = "pending"  # pending | downloading | uploading | done | error
    progress_percent: int = 0
    error: str | None = None
    file_id: str | None = None
    web_view_link: str | None = None
    size_bytes: int | None = None
    created_at: str = ""

