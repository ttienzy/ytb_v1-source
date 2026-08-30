from pydantic import BaseModel, Field


class YouTubeStatusOut(BaseModel):
    connected: bool = False
    auth_type: str = "oauth2"
    email: str = ""
    name: str = ""
    avatar_url: str = ""
    channel_id: str = ""
    channel_title: str = ""
    channel_custom_url: str = ""
    channel_avatar_url: str = ""
    subscriber_count: int = 0
    video_count: int = 0
    default_privacy: str = "private"  # "private", "unlisted", "public"
    default_tags: str = ""
    auto_upload: bool = False
    has_credentials: bool = False
    client_id: str = ""
    message: str = ""


class YouTubeCredentialsInput(BaseModel):
    client_id: str | None = Field(default=None, description="Google OAuth Client ID")
    client_secret: str | None = Field(default=None, description="Google OAuth Client Secret")
    credentials_json: str | None = Field(default=None, description="Nội dung file credentials.json từ Google Cloud")


class YouTubeAuthUrlResponse(BaseModel):
    auth_url: str
    redirect_uri: str


class YouTubeExchangeCodeRequest(BaseModel):
    code: str = Field(..., description="Authorization code hoặc link redirect từ Google sau khi đăng nhập")
    redirect_uri: str | None = Field(default=None, description="Redirect URI đã dùng khi tạo URL")


class YouTubeSettingsUpdateRequest(BaseModel):
    default_privacy: str | None = Field(default=None, description="Chế độ riêng tư mặc định: private, unlisted, public")
    default_tags: str | None = Field(default=None, description="Tags mặc định phân cách bằng dấu phẩy")
    auto_upload: bool | None = Field(default=None, description="Tự động upload lên YouTube")
    client_id: str | None = None
    client_secret: str | None = None


class YouTubeCategoryItem(BaseModel):
    id: str
    title: str


class YouTubePublishRequest(BaseModel):
    file_path: str | None = Field(default=None, description="Đường dẫn file local (nếu source là local)")
    drive_file_id: str | None = Field(default=None, description="ID file trên Google Drive (nếu source là gdrive)")
    source_type: str = Field(default="local", description="Loại nguồn: local hoặc gdrive")
    title: str = Field(..., description="Tiêu đề video YouTube")
    description: str = Field(default="", description="Mô tả video YouTube")
    tags: list[str] | str = Field(default=[], description="Danh sách tags hoặc chuỗi tags phân cách bởi dấu phẩy")
    category_id: str = Field(default="24", description="YouTube Category ID (mặc định 24 - Entertainment)")
    privacy_status: str = Field(default="public", description="public, unlisted, private, hoặc scheduled")
    publish_at: str | None = Field(default=None, description="Thời gian hẹn giờ xuất bản theo chuẩn ISO 8601 (UTC)")
    made_for_kids: bool = Field(default=False, description="Đánh dấu video dành cho trẻ em")


class YouTubePublishResponse(BaseModel):
    ok: bool = True
    video_id: str = ""
    youtube_url: str = ""
    title: str = ""
    status: str = "published"  # "published", "scheduled", "failed"
    message: str = ""


class YouTubeScheduleSlot(BaseModel):
    id: str
    source_type: str = "gdrive"  # "gdrive" | "local"
    file_path: str | None = None
    drive_file_id: str | None = None
    file_name: str
    title: str
    description: str = ""
    tags: str = ""
    category_id: str = "24"
    privacy_status: str = "public"  # "public" | "unlisted" | "private" | "scheduled"
    publish_at: str | None = None
    thumbnail_url: str | None = None


class YouTubeBulkScheduleRequest(BaseModel):
    slots: list[YouTubeScheduleSlot]


class YouTubeBulkScheduleResultItem(BaseModel):
    slot_id: str
    ok: bool
    video_id: str | None = None
    youtube_url: str | None = None
    title: str = ""
    status: str = ""
    error: str | None = None


class YouTubeBulkScheduleResponse(BaseModel):
    total: int = 0
    succeeded: int = 0
    failed: int = 0
    results: list[YouTubeBulkScheduleResultItem] = []


class YouTubeTaskOut(BaseModel):
    task_id: str
    video_id: str | None = None
    youtube_url: str | None = None
    file_name: str
    title: str
    description: str = ""
    tags: str = ""
    category_id: str = "24"
    privacy_status: str = "public"
    publish_at: str | None = None
    status: str = "published"  # "published" | "scheduled" | "failed" | "uploading"
    error_message: str | None = None
    thumbnail_url: str | None = None
    created_at: str = ""
