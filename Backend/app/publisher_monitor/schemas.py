from typing import Literal
from pydantic import BaseModel


class ChannelDailyStatus(BaseModel):
    channel_id: str
    channel_name: str
    platform: Literal["youtube", "tiktok", "facebook"]
    account_email: str | None = None
    avatar_url: str | None = None
    status: Literal["unposted", "warning", "healthy"]
    today_count: int = 0
    tomorrow_count: int = 0
    upcoming_total: int = 0
    latest_published_at: str | None = None
    next_publish_at: str | None = None
    buffer_days: int = 0


class PublisherDailySummaryResponse(BaseModel):
    date: str
    total_channels: int
    unposted_count: int
    warning_count: int
    healthy_count: int
    channels: list[ChannelDailyStatus]


class CalendarEvent(BaseModel):
    id: str
    title: str
    platform: Literal["youtube", "tiktok", "facebook", "studio"]
    channel_name: str
    channel_id: str | None = None
    account_email: str | None = None
    avatar_url: str | None = None
    publish_at: str | None = None
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    status: Literal["scheduled", "published", "failed", "draft"] = "scheduled"
    post_url: str | None = None
    thumbnail_url: str | None = None
    failed_reason: str | None = None
    file_name: str | None = None
    raw_time_ms: int | None = None


class CalendarEventsResponse(BaseModel):
    month: str
    total_events: int
    scheduled_count: int
    published_count: int
    failed_count: int
    channels_list: list[dict]
    events: list[CalendarEvent]
