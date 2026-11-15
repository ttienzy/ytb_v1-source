"""Lệnh Chrome DevTools Protocol tối thiểu (WebSocket thô, không dùng Playwright).

Chỉ dùng ở bước đăng nhập Muse: người dùng đăng nhập trong cửa sổ Chrome do app mở
(`--remote-debugging-port`), app đọc cookie muse.ai rồi đóng Chrome êm.
"""
from __future__ import annotations

import itertools
import json
import urllib.request
from typing import Any, Optional

from websockets.sync.client import connect as ws_connect

_ids = itertools.count(1)


def browser_info(port: int, timeout: float = 2.0) -> Optional[dict]:
    """/json/version của Chrome (có webSocketDebuggerUrl, User-Agent), None nếu cổng không sống."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def call(port: int, method: str, params: Optional[dict] = None, timeout: float = 10.0) -> Any:
    """Gửi một lệnh tới target trình duyệt và trả `result`."""
    info = browser_info(port)
    if not info or not info.get("webSocketDebuggerUrl"):
        raise RuntimeError(f"Chrome không mở cổng debug {port}")
    msg_id = next(_ids)
    with ws_connect(info["webSocketDebuggerUrl"], open_timeout=timeout, close_timeout=2, max_size=None) as ws:
        ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        while True:
            data = json.loads(ws.recv(timeout=timeout))
            if data.get("id") != msg_id:
                continue  # sự kiện không liên quan
            if "error" in data:
                raise RuntimeError(f"CDP {method}: {data['error'].get('message')}")
            return data.get("result", {})


def muse_cookies(port: int) -> tuple[str, str]:
    """(chuỗi cookie muse.ai, User-Agent) của Chrome ở `port`."""
    info = browser_info(port) or {}
    res = call(port, "Storage.getCookies")
    parts = [
        f"{c['name']}={c['value']}"
        for c in res.get("cookies", [])
        if str(c.get("domain", "")).lstrip(".").endswith("muse.ai")
    ]
    return "; ".join(parts), str(info.get("User-Agent") or "")


def close_browser(port: int) -> None:
    """Đóng Chrome êm (Browser.close) để profile ghi xong cookie xuống đĩa."""
    try:
        call(port, "Browser.close", timeout=5)
    except Exception:
        pass  # Chrome thường cắt kết nối ngay khi đóng
