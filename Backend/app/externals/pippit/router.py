from fastapi import APIRouter

from app.externals.pippit import service
from app.externals.pippit.schemas import (
    PippitAccountOut,
    PippitBulkScheduleRequest,
    PippitBulkScheduleResponse,
    PippitLoginSyncRequest,
    PippitPublishRequest,
    PippitPublishResponse,
    PippitScheduleTaskOut,
)

router = APIRouter(prefix="/api/pippit", tags=["Pippit AI"])


@router.get("/accounts", response_model=list[PippitAccountOut])
def get_accounts():
    """Lấy danh sách các tài khoản Pippit đã lưu trong config.json."""
    return service.get_saved_pippit_accounts()


@router.get("/active-pages")
def get_active_pages():
    """Lấy danh sách tất cả các Facebook Page đang active (đã liên kết) trên toàn bộ tài khoản Pippit."""
    return service.get_all_active_facebook_pages()


@router.post("/accounts/login-sync", response_model=PippitAccountOut)
def login_and_sync(payload: PippitLoginSyncRequest):
    """Đăng nhập Pure HTTP bằng email + mật khẩu và tự động kéo toàn bộ Real Facebook Pages về."""
    return service.login_and_sync_account(payload)


@router.post("/accounts/{account_id}/refresh-pages", response_model=PippitAccountOut)
def refresh_pages(account_id: str):
    """Quét lại danh sách Real Facebook Pages từ Pippit cho tài khoản đã lưu."""
    return service.refresh_account_pages(account_id)


@router.get("/accounts/{account_id}/tasks", response_model=list[PippitScheduleTaskOut])
def get_tasks(account_id: str):
    """Tra cứu danh sách các bài đăng đã lên lịch trên Pippit."""
    return service.list_account_tasks(account_id)


@router.get("/all-tasks")
def get_all_tasks():
    """Lấy danh sách tất cả các bài đăng đã lên lịch trên toàn bộ tài khoản Pippit."""
    return service.list_all_saved_accounts_tasks()


@router.post("/publish", response_model=PippitPublishResponse)
def publish_video(payload: PippitPublishRequest):
    """Upload video 5 bước lên Pippit Cloud và lên lịch đăng bài cho Facebook Page."""
    return service.publish_video_to_page(payload)


@router.post("/bulk-schedule", response_model=PippitBulkScheduleResponse)
def bulk_schedule(payload: PippitBulkScheduleRequest):
    """Lên lịch đăng bài hàng loạt video ngắn qua Pippit."""
    return service.bulk_schedule_videos(payload)


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str):
    """Xóa tài khoản Pippit khỏi config.json."""
    return service.delete_pippit_account(account_id)
