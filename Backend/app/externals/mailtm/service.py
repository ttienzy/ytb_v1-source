import random
import re
import string
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.storage import read_config, write_config
from app.externals.mailtm.client import MailTmClient, MailTmError
from app.externals.mailtm.schemas import (
    MailAccountCreate,
    MailAccountOut,
    MailBatchCreate,
    MailDomainOut,
    MailMessageDetail,
    MailMessageSummary,
)

client = MailTmClient()


def _extract_otp(text: str, intro: str = "", subject: str = "") -> str | None:
    """Trích xuất mã xác nhận OTP (4-8 ký tự số/chữ) từ email."""
    corpus = f"{subject} \n {intro} \n {text}"
    # Pattern 1: Tìm theo từ khóa (Code, OTP, Mã xác nhận: 123456)
    keyword_match = re.search(
        r"(?:code|mã|xác nhận|verification|verify|otp|pin)[\s\:\-]+([0-9]{4,8}|[A-Z0-9]{4,8})\b",
        corpus,
        re.IGNORECASE,
    )
    if keyword_match:
        return keyword_match.group(1).strip()

    # Pattern 2: Tìm chuỗi 6 chữ số độc lập (rất phổ biến cho OTP)
    digits_6 = re.findall(r"\b(\d{6})\b", corpus)
    if digits_6:
        return digits_6[0]

    # Pattern 3: Tìm chuỗi 4 hoặc 5 chữ số
    digits_4_5 = re.findall(r"\b(\d{4,5})\b", corpus)
    if digits_4_5:
        return digits_4_5[0]

    return None


async def get_domains() -> list[MailDomainOut]:
    """Lấy danh sách các domain khả dụng."""
    try:
        domains = await client.get_domains()
        return [MailDomainOut(**d) for d in domains]
    except MailTmError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


def get_saved_accounts() -> list[dict]:
    """Lấy danh sách tài khoản đã lưu trong config.json."""
    config = read_config()
    return config.get("mailtm", {}).get("accounts", [])


def _save_accounts(accounts: list[dict]) -> None:
    """Lưu danh sách tài khoản vào config.json."""
    config = read_config()
    if "mailtm" not in config:
        config["mailtm"] = {}
    config["mailtm"]["accounts"] = accounts
    write_config(config)


async def create_account(payload: MailAccountCreate) -> dict:
    """Tạo 1 tài khoản Mail.tm tùy chỉnh và lưu vào config.json."""
    clean_username = payload.username.strip().lower()
    clean_domain = payload.domain.strip().lower().lstrip("@")
    address = f"{clean_username}@{clean_domain}"
    password = payload.password.strip()

    accounts = get_saved_accounts()
    if any(acc.get("address", "").lower() == address for acc in accounts):
        raise HTTPException(status_code=400, detail=f"Email '{address}' đã tồn tại trong cấu hình.")

    try:
        acc_info = await client.create_account(address, password)
        token = await client.get_token(address, password)
    except MailTmError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    new_acc = {
        "id": acc_info.get("id"),
        "address": address,
        "password": password,
        "token": token,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "active",
    }

    # Thêm vào đầu danh sách
    accounts.insert(0, new_acc)
    _save_accounts(accounts)
    return new_acc


async def batch_create_accounts(payload: MailBatchCreate) -> list[dict]:
    """Tạo hàng loạt tài khoản Mail.tm và lưu vào config.json."""
    clean_prefix = payload.prefix.strip().lower()
    clean_domain = payload.domain.strip().lower().lstrip("@")
    password = payload.password.strip()
    count = payload.count

    created_accounts: list[dict] = []
    accounts = get_saved_accounts()

    for i in range(count):
        # Sinh chuỗi ngẫu nhiên 4 ký tự cho mỗi username
        rand_suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
        username = f"{clean_prefix}_{rand_suffix}"
        address = f"{username}@{clean_domain}"

        try:
            acc_info = await client.create_account(address, password)
            token = await client.get_token(address, password)
            new_acc = {
                "id": acc_info.get("id"),
                "address": address,
                "password": password,
                "token": token,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "active",
            }
            created_accounts.append(new_acc)
            accounts.insert(0, new_acc)
        except Exception as exc:
            print(f"[Mail.tm] Lỗi tạo tài khoản {address}: {exc}")
            continue

    if not created_accounts:
        raise HTTPException(status_code=500, detail="Không tạo được tài khoản nào. Vui lòng kiểm tra lại domain hoặc thử lại.")

    _save_accounts(accounts)
    return created_accounts


async def _refresh_account_token(acc: dict) -> str:
    """Buộc làm mới token từ email và password, lưu lại vào config.json."""
    address = acc["address"]
    password = acc["password"]
    try:
        new_token = await client.get_token(address, password)
        acc["token"] = new_token
        accounts = get_saved_accounts()
        for item in accounts:
            if item.get("id") == acc.get("id") or item.get("address", "").lower() == address.lower():
                item["token"] = new_token
                break
        _save_accounts(accounts)
        return new_token
    except MailTmError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=f"Không thể làm mới token cho {address}: {exc.message}",
        ) from exc


async def _ensure_token(acc: dict) -> str:
    """Đảm bảo tài khoản có Bearer token hợp lệ, tự refresh nếu chưa có."""
    token = acc.get("token")
    if token:
        return token
    return await _refresh_account_token(acc)


async def _call_with_token_retry(acc: dict, func, *args, **kwargs):
    """Thực thi một API call yêu cầu token.

    Nếu gặp lỗi 401 (token hết hạn/invalid), tự động làm mới token và retry lại 1 lần.
    """
    token = await _ensure_token(acc)
    try:
        return await func(token, *args, **kwargs)
    except MailTmError as exc:
        if exc.status_code == 401:
            # Token hết hạn hoặc không hợp lệ -> Force refresh token mới và retry lại
            token = await _refresh_account_token(acc)
            try:
                return await func(token, *args, **kwargs)
            except MailTmError as retry_exc:
                raise HTTPException(status_code=retry_exc.status_code, detail=retry_exc.message) from retry_exc
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


async def get_messages_for_account(account_id: str) -> list[MailMessageSummary]:
    """Lấy danh sách thư cho 1 tài khoản theo account_id (tự động retry nếu token hết hạn)."""
    accounts = get_saved_accounts()
    acc = next((a for a in accounts if a.get("id") == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản trong cấu hình.")

    raw_msgs = await _call_with_token_retry(acc, client.get_messages)

    results: list[MailMessageSummary] = []
    for m in raw_msgs:
        sender = m.get("from", {})
        from_addr = sender.get("address", "")
        from_name = sender.get("name", "")
        subject = m.get("subject", "")
        intro = m.get("intro", "")
        otp = _extract_otp("", intro=intro, subject=subject)

        results.append(
            MailMessageSummary(
                id=m.get("id", ""),
                from_addr=from_addr,
                from_name=from_name,
                subject=subject,
                intro=intro,
                seen=m.get("seen", False),
                created_at=m.get("createdAt", ""),
                otp_code=otp,
            )
        )
    return results


async def get_message_detail_for_account(account_id: str, message_id: str) -> MailMessageDetail:
    """Lấy chi tiết email bao gồm nội dung HTML/text và mã OTP (tự động retry nếu token hết hạn)."""
    accounts = get_saved_accounts()
    acc = next((a for a in accounts if a.get("id") == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản trong cấu hình.")

    m = await _call_with_token_retry(acc, client.get_message_detail, message_id=message_id)

    sender = m.get("from", {})
    text_content = m.get("text", "")
    html_content = m.get("html", "")
    subject = m.get("subject", "")
    intro = m.get("intro", "")

    otp = _extract_otp(text_content, intro=intro, subject=subject)

    return MailMessageDetail(
        id=m.get("id", ""),
        from_addr=sender.get("address", ""),
        from_name=sender.get("name", ""),
        subject=subject,
        intro=intro,
        text=text_content,
        html=html_content,
        created_at=m.get("createdAt", ""),
        otp_code=otp,
    )


async def delete_account(account_id: str) -> dict:
    """Xóa tài khoản khỏi config.json và hủy trên Mail.tm nếu được (tự động retry nếu token hết hạn)."""
    accounts = get_saved_accounts()
    acc = next((a for a in accounts if a.get("id") == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản để xóa.")

    # Cố gắng xóa trên server mail.tm với cơ chế auto-retry token
    try:
        await _call_with_token_retry(acc, client.delete_account, account_id=account_id)
    except Exception:
        pass

    # Xóa khỏi config.json
    new_accounts = [a for a in accounts if a.get("id") != account_id]
    _save_accounts(new_accounts)
    return {"ok": True, "message": f"Đã xóa tài khoản {acc.get('address')}"}

