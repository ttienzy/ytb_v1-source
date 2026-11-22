"""Auto-heal ChatGPT: mở lại Chrome profile ẤM (đã login) không tương tác → cookie + header oai-* tươi."""
from __future__ import annotations

import threading
import time

_LAST: dict[str, float] = {}  # profile_dir → lần thử gần nhất
_LOCK = threading.Lock()
_COOLDOWN = 60  # giây, tính RIÊNG từng profile (trước đây dùng chung → tài khoản thứ 2 lỗi cùng lúc bị bỏ qua)


def capture(profile_dir: str) -> dict | None:
    if not profile_dir:
        return None
    with _LOCK:
        now = time.time()
        if now - _LAST.get(profile_dir, 0.0) < _COOLDOWN:
            return None
        _LAST[profile_dir] = now

    from app.ai.image_gen.service import chatgpt_capture
    try:
        return chatgpt_capture(profile_dir)
    except Exception:
        return None
