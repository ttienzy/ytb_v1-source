"""Muse Canvas → Google Flow: kiểm tra project Flow trước khi node Clip tạo video.

Project Flow thuộc về MỘT tài khoản Google. Đổi tài khoản trên tab Flow (vd. hết credit) thì project cũ không mở được:
Flow đẩy tab về trang chủ, nơi không có reCAPTCHA, và job hỏng với "reCAPTCHA is not loaded on the home page"
(CAPTCHA_FAILED — trước khi gửi lệnh tạo video, không mất credit). Nút "Kiểm tra" làm việc đó trước, không tốn gì:
nhờ extension mở tab project rồi đọc URL tab trong heartbeat kế tiếp (heartbeat ~30 s/lần).
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field

HEARTBEAT_WAIT_SECONDS = 45.0
SWITCH_WAIT_SECONDS = 25.0
POLL_SECONDS = 1.5


class FlowProjectCheckRequest(BaseModel):
    project_id: str = Field(..., min_length=1, max_length=64)


def _veo():
    from app.veo import service

    return service


def _bridge():
    from app.veo import bridge

    return bridge


def _parse_ts(value: Any) -> Optional[float]:
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return None


def flow_accounts() -> list[dict[str, Any]]:
    """Tài khoản Google Labs extension đã thấy (mới nhất trước) — để người dùng biết tab Flow đang ở tài khoản nào."""
    pool = _bridge().get_credentials_pool() or {}
    rows = []
    for email, cred in pool.items():
        rows.append({
            "email": email,
            "credits": cred.get("credit"),
            "seen_at": cred.get("last_updated") or cred.get("pushed_at") or "",
        })
    rows.sort(key=lambda r: _parse_ts(r["seen_at"]) or 0, reverse=True)
    return rows


def check_project(project_id: str, *, now: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep) -> dict[str, Any]:
    """Mở project trên tab Flow và xác nhận tab thật sự ở trang project đó.

    state: open | redirected | missing | no_extension | unknown. Không gửi lệnh tạo video nào.
    """
    veo, bridge = _veo(), _bridge()
    proj = veo.get_project(project_id)
    base = {"project_id": project_id, "accounts": flow_accounts()}
    if proj is None:
        return {**base, "ok": False, "state": "missing", "message": "Project không còn trong app — chọn hoặc tạo project khác."}
    info = {"name": proj.name, "flow_project_id": proj.flow_project_id, "account_email": proj.account_email}
    if not bridge.is_bridge_running() or not bridge.get_extension_info().get("connected"):
        return {**base, **info, "ok": False, "state": "no_extension",
                "message": "Extension Flow chưa kết nối — mở Chrome có extension và tab Google Flow."}
    pid = proj.flow_project_id

    started = now()
    rid = bridge.request_switch_project(pid, proj.account_email or "")
    if rid:
        res = bridge.wait_switch_result(rid, timeout=SWITCH_WAIT_SECONDS)
        if res is None:
            bridge.cancel_request(rid)
        elif not res.get("ok"):
            return {**base, **info, "ok": False, "state": "redirected",
                    "message": f"Extension không mở được project: {res.get('error') or 'lỗi không rõ'}."}

    deadline = started + HEARTBEAT_WAIT_SECONDS
    while True:
        ext = bridge.get_extension_info()
        beat = _parse_ts(ext.get("last_heartbeat"))
        tabs = ext.get("tabs") or []
        if any(pid in (t.get("url") or "") for t in tabs):
            return {**base, **info, "ok": True, "state": "open", "message": "Tab Flow đang mở đúng project này."}
        # heartbeat SAU lúc chuyển tab mà vẫn không có tab project -> Flow đã đẩy về trang khác
        if beat is not None and beat > started + 2 and tabs:
            return {**base, **info, "ok": False, "state": "redirected",
                    "message": "Flow không mở được project này với tài khoản Google đang đăng nhập (thường do đã đổi tài khoản). "
                               "Tạo project mới cho tài khoản đang dùng."}
        if now() >= deadline:
            return {**base, **info, "ok": False, "state": "unknown",
                    "message": "Chưa xác nhận được (extension chưa gửi tín hiệu mới). Thử lại sau vài giây."}
        sleep(POLL_SECONDS)
