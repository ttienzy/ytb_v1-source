from fastapi import APIRouter, File, UploadFile

from app.externals.youtube import service
from app.externals.youtube.schemas import (
    YouTubeAuthUrlResponse,
    YouTubeBulkScheduleRequest,
    YouTubeBulkScheduleResponse,
    YouTubeCategoryItem,
    YouTubeCredentialsInput,
    YouTubeExchangeCodeRequest,
    YouTubePublishRequest,
    YouTubePublishResponse,
    YouTubeSettingsUpdateRequest,
    YouTubeStatusOut,
    YouTubeTaskOut,
)

router = APIRouter(prefix="/api/youtube", tags=["YouTube"])


@router.get("/status", response_model=YouTubeStatusOut)
def get_status():
    """Lấy trạng thái kết nối, thông tin kênh và cấu hình YouTube."""
    return service.get_status()


@router.get("/categories", response_model=list[YouTubeCategoryItem])
def get_categories():
    """Lấy danh sách các danh mục video trên YouTube."""
    return service.get_categories()


@router.post("/credentials", response_model=YouTubeStatusOut)
def save_credentials(payload: YouTubeCredentialsInput):
    """Lưu Google OAuth Client ID & Secret hoặc nội dung file credentials.json."""
    return service.save_credentials(payload)


@router.get("/auth-url", response_model=YouTubeAuthUrlResponse)
def get_auth_url(redirect_uri: str = "http://localhost:8080/"):
    """Lấy đường dẫn URL đăng nhập Google OAuth 2.0 cho YouTube."""
    return service.get_auth_url(redirect_uri=redirect_uri)


@router.post("/exchange-code", response_model=YouTubeStatusOut)
def exchange_code(payload: YouTubeExchangeCodeRequest):
    """Xác thực Authorization Code từ Google để đăng nhập YouTube."""
    return service.exchange_code(payload)


@router.post("/login", response_model=YouTubeStatusOut)
def login_youtube():
    """Khởi chạy đăng nhập Google OAuth 2.0 (mở trình duyệt cấp quyền YouTube)."""
    return service.login_oauth_flow()


@router.put("/settings", response_model=YouTubeStatusOut)
def update_settings(payload: YouTubeSettingsUpdateRequest):
    """Cập nhật cài đặt mặc định khi đăng tải video lên YouTube."""
    return service.update_settings(payload)


@router.post("/disconnect")
def disconnect_youtube():
    """Ngắt kết nối tài khoản YouTube."""
    return service.disconnect()


@router.post("/publish", response_model=YouTubePublishResponse)
def publish_single_video(payload: YouTubePublishRequest):
    """Tải lên hoặc lên lịch đăng 1 video lên YouTube."""
    return service.publish_single_video(payload)


@router.post("/bulk-schedule", response_model=YouTubeBulkScheduleResponse)
def bulk_schedule_videos(payload: YouTubeBulkScheduleRequest):
    """Lên lịch đăng hàng loạt video lên YouTube."""
    return service.bulk_schedule_videos(payload)


@router.get("/tasks", response_model=list[YouTubeTaskOut])
def get_tasks():
    """Lấy lịch sử các video đã đăng hoặc đã lên lịch trên YouTube."""
    return service.get_saved_tasks()


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    """Xóa 1 task khỏi danh sách lịch sử."""
    ok = service.delete_task_record(task_id)
    return {"ok": ok}


@router.post("/upload-file")
async def upload_file(file: UploadFile = File(...)):
    """Tải file video từ client lên server để lấy đường dẫn file local."""
    return await service.save_uploaded_file(file)

