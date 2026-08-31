from fastapi import APIRouter
from app.publisher_monitor.schemas import CalendarEventsResponse, PublisherDailySummaryResponse
from app.publisher_monitor.service import get_calendar_events, get_daily_publishing_summary

router = APIRouter(prefix="/api/publisher-monitor", tags=["publisher-monitor"])


@router.get("/daily-status", response_model=PublisherDailySummaryResponse)
def get_daily_status(sync: bool = False) -> PublisherDailySummaryResponse:
    """Lấy báo cáo tổng hợp trạng thái đăng bài hôm nay của tất cả kênh YouTube, TikTok, Facebook (sync=true để đồng bộ live từ Pippit)."""
    return get_daily_publishing_summary(force_sync=sync)


@router.get("/calendar-events", response_model=CalendarEventsResponse)
def get_calendar_events_endpoint(month: str | None = None, sync: bool = False) -> CalendarEventsResponse:
    """Lấy toàn bộ sự kiện lịch phát sóng đa kênh phục vụ hiển thị lịch tổng quan (month=YYYY-MM hoặc all)."""
    return get_calendar_events(month=month, force_sync=sync)
