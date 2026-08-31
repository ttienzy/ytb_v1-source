from fastapi import APIRouter
from app.publisher_monitor.schemas import PublisherDailySummaryResponse
from app.publisher_monitor.service import get_daily_publishing_summary

router = APIRouter(prefix="/api/publisher-monitor", tags=["publisher-monitor"])


@router.get("/daily-status", response_model=PublisherDailySummaryResponse)
def get_daily_status(sync: bool = False) -> PublisherDailySummaryResponse:
    """Lấy báo cáo tổng hợp trạng thái đăng bài hôm nay của tất cả kênh YouTube, TikTok, Facebook (sync=true để đồng bộ live từ Pippit)."""
    return get_daily_publishing_summary(force_sync=sync)
