from pydantic import BaseModel, Field


class GDriveStatusOut(BaseModel):
    connected: bool = False
    auth_type: str = "oauth2"
    email: str = ""
    name: str = ""
    avatar_url: str = ""
    folder_id: str = ""
    folder_name: str = ""
    folder_url: str = ""
    storage_used_bytes: int = 0
    storage_total_bytes: int = 0
    auto_upload: bool = True
    has_credentials: bool = False
    client_id: str = ""
    message: str = ""


class GDriveCredentialsInput(BaseModel):
    client_id: str | None = Field(default=None, description="Google OAuth Client ID")
    client_secret: str | None = Field(default=None, description="Google OAuth Client Secret")
    credentials_json: str | None = Field(default=None, description="Nội dung file credentials.json")


class GDriveAuthUrlResponse(BaseModel):
    auth_url: str
    redirect_uri: str


class GDriveExchangeCodeRequest(BaseModel):
    code: str = Field(..., description="Authorization code hoặc link redirect từ Google sau khi đăng nhập")
    redirect_uri: str | None = Field(default=None, description="Redirect URI đã dùng khi tạo URL")


class GDriveFolderUpdateRequest(BaseModel):
    folder_id: str = Field(..., description="ID hoặc link của thư mục Google Drive")
    folder_name: str = Field(default="", description="Tên hiển thị của thư mục")


class GDriveSettingsUpdateRequest(BaseModel):
    auto_upload: bool = Field(default=True, description="Tự động upload sau khi xóa watermark")
    client_id: str | None = None
    client_secret: str | None = None


class GDriveUploadRequest(BaseModel):
    file_path: str = Field(..., description="Đường dẫn file video local cần upload")
    custom_name: str = Field(default="", description="Tên file khi lưu trên Drive")
    folder_id: str | None = Field(default=None, description="Folder ID ghi đè nếu có")


class GDriveUploadResponse(BaseModel):
    ok: bool = True
    file_id: str
    file_name: str
    web_view_link: str
    size_bytes: int = 0
    message: str = ""


class GDriveFolderItem(BaseModel):
    id: str
    name: str
    url: str = ""
    modified_time: str = ""


class GDriveVideoItem(BaseModel):
    id: str
    name: str
    size_bytes: int = 0
    mime_type: str = "video/mp4"
    web_view_link: str = ""
    thumbnail_link: str = ""
    created_time: str = ""
    duration_seconds: int = 10
    width: int | None = None
    height: int | None = None


class GDriveVideoListResponse(BaseModel):
    folder_id: str
    folder_name: str = ""
    videos: list[GDriveVideoItem] = []
    total: int = 0
