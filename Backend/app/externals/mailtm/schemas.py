from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, Field


class MailDomainOut(BaseModel):
    id: str
    domain: str
    is_active: bool = True


class MailAccountCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=64, description="Tên người dùng tùy chọn (không kèm @domain)")
    domain: str = Field(..., description="Tên miền (chọn từ danh sách domain của Mail.tm)")
    password: str = Field(..., min_length=6, description="Mật khẩu tùy ý cho tài khoản")


class MailBatchCreate(BaseModel):
    prefix: str = Field("user", min_length=1, max_length=32, description="Tiền tố cho username")
    domain: str = Field(..., description="Tên miền (chọn từ danh sách domain của Mail.tm)")
    password: str = Field(..., min_length=6, description="Mật khẩu chung cho các tài khoản tạo mới")
    count: int = Field(3, ge=1, le=20, description="Số lượng tài khoản cần tạo (1 - 20)")


class MailAccountOut(BaseModel):
    id: str
    address: str
    password: str
    token: str | None = None
    created_at: str
    status: str = "active"


class MailMessageSummary(BaseModel):
    id: str
    from_addr: str
    from_name: str = ""
    subject: str
    intro: str = ""
    seen: bool = False
    created_at: str
    otp_code: str | None = None


class MailMessageDetail(BaseModel):
    id: str
    from_addr: str
    from_name: str = ""
    subject: str
    intro: str = ""
    text: str = ""
    html: list[str] | str = ""
    created_at: str
    otp_code: str | None = None
