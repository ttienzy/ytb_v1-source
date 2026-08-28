from fastapi import APIRouter

from app.externals.gdrive import service
from app.externals.gdrive.schemas import (
    GDriveAuthUrlResponse,
    GDriveCredentialsInput,
    GDriveExchangeCodeRequest,
    GDriveFolderUpdateRequest,
    GDriveSettingsUpdateRequest,
    GDriveStatusOut,
    GDriveUploadRequest,
    GDriveUploadResponse,
)

router = APIRouter(prefix="/api/gdrive", tags=["Google Drive"])


@router.get("/status", response_model=GDriveStatusOut)
def get_status():
    """Lấy trạng thái kết nối, thông tin tài khoản và thư mục Google Drive."""
    return service.get_status()


@router.post("/credentials", response_model=GDriveStatusOut)
def save_credentials(payload: GDriveCredentialsInput):
    """Lưu Google OAuth Client ID & Secret hoặc nội dung file credentials.json."""
    return service.save_credentials(payload)


@router.get("/auth-url", response_model=GDriveAuthUrlResponse)
def get_auth_url(redirect_uri: str = "http://localhost:8080/"):
    """Lấy đường dẫn URL đăng nhập Google OAuth 2.0."""
    return service.get_auth_url(redirect_uri=redirect_uri)


@router.post("/exchange-code", response_model=GDriveStatusOut)
def exchange_code(payload: GDriveExchangeCodeRequest):
    """Xác thực Authorization Code từ Google để đăng nhập."""
    return service.exchange_code(payload)


@router.post("/login", response_model=GDriveStatusOut)
def login_google_drive():
    """Khởi chạy đăng nhập Google OAuth 2.0 (mở trình duyệt cấp quyền)."""
    return service.login_oauth_flow()


@router.post("/folder", response_model=GDriveStatusOut)
def update_folder(payload: GDriveFolderUpdateRequest):
    """Cập nhật hoặc đổi thư mục lưu trữ video trên Google Drive."""
    return service.update_folder(payload)


@router.post("/folder/create", response_model=GDriveStatusOut)
def create_folder(folder_name: str = "AI_Clean_Videos"):
    """Tạo mới một thư mục lưu trữ trên Google Drive."""
    return service.create_new_folder(folder_name)


@router.put("/settings", response_model=GDriveStatusOut)
def update_settings(payload: GDriveSettingsUpdateRequest):
    """Cập nhật cài đặt tự động upload hoặc Client ID/Secret riêng."""
    return service.update_settings(payload)


@router.post("/upload", response_model=GDriveUploadResponse)
def upload_video(payload: GDriveUploadRequest):
    """Upload thủ công một video lên Google Drive."""
    return service.upload_clean_video(payload)


@router.post("/disconnect")
def disconnect_drive():
    """Ngắt kết nối tài khoản Google Drive."""
    return service.disconnect()
