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
