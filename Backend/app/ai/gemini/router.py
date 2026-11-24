"""Cài đặt Gemini: nhiều tài khoản như ChatGPT (danh sách + “(+) Thêm account” + làm mới / đăng nhập lại / xóa)."""
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.ai.gemini import pool
from app.ai.gemini.accounts import get_store
from app.ai.gemini.capture import GeminiTemplateCaptureError, capture_template
from app.ai.gemini.service import add_account, refresh_account
from app.core.storage import read_config

router = APIRouter(prefix="/api/settings/gemini", tags=["Gemini"])


class LoginRequest(BaseModel):
    account_id: Optional[str] = None  # có = đăng nhập lại tài khoản này; không = thêm tài khoản mới


@router.get("")
def get_settings() -> dict:
    accounts = get_store().list_accounts()
    active = sum(1 for a in accounts if a.get("status") == "active")
    g = read_config().get("gemini", {})
    captured = bool(g.get("inner_template"))
    return {
        "accounts": accounts,
        "active_accounts_count": active,
        "total_accounts_count": len(accounts),
        "has_cookie": active > 0,
        # "captured" = bản bắt trên máy này; "bundled" = bản đóng gói sẵn theo app.
        "template_source": "captured" if captured else "bundled",
        "template_saved_at": g.get("template_saved_at") if captured else None,
    }


@router.post("/accounts/login")
async def login(body: LoginRequest | None = None) -> dict:
    """Mở Chrome để đăng nhập Google: thêm tài khoản mới, hoặc (kèm account_id) đăng nhập lại tài khoản đã có."""
    account_id = body.account_id if body else None
    if account_id:
        account = await run_in_threadpool(refresh_account, account_id, None, True)
    else:
        account = await run_in_threadpool(add_account)
    return {"ok": True, "account": account}


@router.post("/accounts/{account_id}/refresh")
async def refresh(account_id: str) -> dict:
    """Làm mới cookie bằng profile Chrome ấm (ngầm). Hết phiên → báo đăng nhập lại."""
    account = await run_in_threadpool(refresh_account, account_id)
    return {"ok": True, "account": account}


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str) -> dict:
    if not get_store().delete_account(account_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản để xóa")
    return {"ok": True, "deleted": True}


@router.post("/capture-template")
async def capture_gemini_template() -> dict:
    """Bắt lại khung request Gemini từ profile của một tài khoản đã đăng nhập (khi Gemini đổi giao thức)."""
    acc, _ = pool.select()
    if acc is None or not acc.get("partition"):
        raise HTTPException(status_code=409, detail=pool.NO_ACCOUNT_MSG)
    try:
        return await run_in_threadpool(capture_template, acc["partition"])
    except GeminiTemplateCaptureError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
