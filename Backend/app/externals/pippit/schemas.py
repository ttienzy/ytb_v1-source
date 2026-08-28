from pydantic import BaseModel, Field


class FacebookPageSlot(BaseModel):
    page_id: str = Field(default="", description="ID của Fanpage Facebook (platform_user_id)")
    page_name: str = Field(default="", description="Tên hiển thị của Fanpage (nickname)")
    avatar_url: str = Field(default="", description="Avatar của Fanpage")
    status: str = Field(default="empty", description="Trạng thái slot: connected | empty | expired")
    un_expired: bool = Field(default=True, description="Token ủy quyền còn hạn hay không")


class PippitAccountOut(BaseModel):
    id: str
    mailtm_id: str | None = None
    email: str
    password: str = ""
    user_id: str | None = None
    workspace_id: str | None = None
    proxy: str = ""
    status: str = "active"
    created_at: str
    facebook_pages: list[FacebookPageSlot] = Field(default_factory=list)


class PippitLoginSyncRequest(BaseModel):
    email: str = Field(..., description="Email tài khoản Pippit")
    password: str = Field(..., description="Mật khẩu tài khoản Pippit")
    proxy: str = Field(default="", description="Proxy riêng dạng host:port hoặc user:pass@host:port")
    mailtm_id: str | None = Field(default=None, description="ID liên kết từ bảng Mail.tm nếu có")


class PippitUpdateFbPagesRequest(BaseModel):
    facebook_pages: list[FacebookPageSlot]


class PippitPublishRequest(BaseModel):
    account_id: str = Field(..., description="ID tài khoản Pippit trong config")
    page_id: str = Field(..., description="ID Facebook Page (platform_user_id)")
    video_path: str = Field(..., description="Đường dẫn file video local cần upload và đăng")
    caption: str = Field(default="", description="Nội dung mô tả bài viết")
    title: str = Field(default="", description="Tiêu đề bài viết (tùy chọn)")
    when_minutes_ahead: int = Field(default=1, description="Hẹn giờ đăng sau bao nhiêu phút (tối thiểu 1)")
    job_id: str | None = Field(default=None, description="ID của Video Studio Job liên kết nếu có")



class PippitPublishResponse(BaseModel):
    ok: bool = True
    task_id: str
    asset_id: str
    schedule_time_ms: int
    message: str


class PippitScheduleTaskOut(BaseModel):
    task_id: str | None = None
    status: int | None = None
    published: bool = False
    post_id: str = ""
    post_url: str = ""
    page_id: str = ""
    page_name: str = ""
    schedule_time_ms: int = 0
    title: str = ""
    description: str = ""
    failed_reason: str = ""
