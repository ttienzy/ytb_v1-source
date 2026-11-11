"""Auto-heal ChatGPT: mở lại Chrome profile ẤM (đã login) không tương tác → cookie + header oai-* tươi."""
from __future__ import annotations

import time

_LAST = [0.0]
_COOLDOWN = 60  # giây


def capture(profile_dir: str) -> dict | None:
    if not profile_dir:
        return None
    if time.time() - _LAST[0] < _COOLDOWN:
        return None
    _LAST[0] = time.time()

    from app.ai.image_gen.service import chatgpt_capture
    try:
        return chatgpt_capture(profile_dir)
    except Exception:
        return None
