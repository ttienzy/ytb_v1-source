from fastapi import APIRouter

from app.externals.mailtm.schemas import (
    MailAccountCreate,
    MailAccountOut,
    MailBatchCreate,
    MailDomainOut,
    MailMessageDetail,
    MailMessageSummary,
)
from app.externals.mailtm import service

router = APIRouter(prefix="/api/mailtm", tags=["Mail.tm"])


@router.get("/domains", response_model=list[MailDomainOut])
async def get_domains():
    """Lấy danh sách các domain Mail.tm khả dụng."""
    return await service.get_domains()


@router.get("/accounts", response_model=list[MailAccountOut])
def get_accounts():
    """Lấy danh sách các tài khoản Mail.tm đã lưu trong config.json."""
    return service.get_saved_accounts()


@router.post("/accounts", response_model=MailAccountOut)
async def create_account(payload: MailAccountCreate):
    """Tạo 1 tài khoản Mail.tm tùy chỉnh và lưu vào config.json."""
    return await service.create_account(payload)


@router.post("/accounts/batch", response_model=list[MailAccountOut])
async def batch_create_accounts(payload: MailBatchCreate):
    """Tạo hàng loạt tài khoản Mail.tm tự động và lưu vào config.json."""
    return await service.batch_create_accounts(payload)


@router.get("/accounts/{account_id}/messages", response_model=list[MailMessageSummary])
async def get_account_messages(account_id: str):
    """Lấy danh sách thư trong hòm thư của một tài khoản."""
    return await service.get_messages_for_account(account_id)


@router.get("/accounts/{account_id}/messages/{message_id}", response_model=MailMessageDetail)
async def get_message_detail(account_id: str, message_id: str):
    """Lấy nội dung chi tiết của một email và mã OTP (nếu có)."""
    return await service.get_message_detail_for_account(account_id, message_id)


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str):
    """Xóa tài khoản khỏi cấu hình config.json."""
    return await service.delete_account(account_id)
