from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException

from app.ai.image_gen.schemas import (
    ChatgptAccountView,
    ImageGenStatusResponse,
    TestImageGenRequest,
    TestImageGenResponse,
)
from app.ai.image_gen.service import (
    chatgpt_login,
    get_account_store,
    get_image_settings,
    test_generate_image,
)

logger = logging.getLogger("ai.image_gen.router")

router = APIRouter(prefix="/api/settings/image-gen", tags=["Image Generation (ChatGPT Plus)"])


@router.get("", response_model=ImageGenStatusResponse)
def get_settings():
    """Lấy cấu hình hiện tại và danh sách tài khoản ChatGPT Plus."""
    cfg = get_image_settings()
    store = get_account_store()
    accounts = store.list_accounts()
    active_count = sum(1 for a in accounts if a.get("status") == "active")

    return ImageGenStatusResponse(
        provider="chatgpt",
        saved_at=cfg.get("saved_at"),
        accounts=[ChatgptAccountView(**a) for a in accounts],
        active_accounts_count=active_count,
        total_accounts_count=len(accounts),
    )


@router.post("/chatgpt/login")
def login_chatgpt():
    """Mở Chrome để người dùng đăng nhập ChatGPT Plus, lấy session & token."""
    try:
        acc = chatgpt_login(timeout_seconds=420)
        return {"ok": True, "account": acc}
    except Exception as e:
        logger.error(f"Lỗi đăng nhập ChatGPT: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/chatgpt/refresh/{account_id}")
def refresh_chatgpt_account(account_id: str):
    """Làm mới cookie session cho tài khoản ChatGPT bằng Chrome profile ấm."""
    store = get_account_store()
    acc = store.get_account(account_id)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    partition = acc.get("partition")
    if not partition:
        raise HTTPException(status_code=400, detail="Tài khoản không có profile Chrome lưu sẵn")

    from app.ai.image_gen.service import chatgpt_capture
    cap = chatgpt_capture(partition, timeout_seconds=90)
    if not cap or not cap.get("cookies"):
        store.set_status(account_id, "error", "Hết phiên đăng nhập — vui lòng đăng nhập lại")
        raise HTTPException(status_code=400, detail="Không thể làm mới phiên đăng nhập. Vui lòng thêm lại tài khoản.")

    updated = store.update_account(
        account_id,
        cookies=cap.get("cookies"),
        ua=cap.get("ua"),
        client_version=cap.get("client_version"),
        client_build=cap.get("client_build"),
        oai_is=cap.get("oai_is"),
        device_id=cap.get("device_id"),
        status="active",
        message="",
    )
    return {"ok": True, "account": updated}


@router.delete("/chatgpt/accounts/{account_id}")
def delete_chatgpt_account(account_id: str):
    """Xóa tài khoản ChatGPT Plus khỏi danh sách."""
    store = get_account_store()
    deleted = store.delete_account(account_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản để xóa")
    return {"ok": True, "deleted": True}


@router.post("/test", response_model=TestImageGenResponse)
def test_generation(body: TestImageGenRequest):
    """Thử nghiệm tạo 1 ảnh với tài khoản ChatGPT Plus."""
    try:
        res = test_generate_image(prompt=body.prompt, aspect_ratio=body.aspect_ratio)
        return TestImageGenResponse(
            ok=True,
            saved_path=res["saved_path"],
            relative_url=res["relative_url"],
            elapsed_seconds=res["elapsed_seconds"],
        )
    except Exception as e:
        logger.error(f"Lỗi tạo ảnh test: {e}")
        raise HTTPException(status_code=500, detail=f"Lỗi tạo ảnh: {e}")
