"""Khung request StreamGenerate của Gemini web ("inner template", 97 trường) — bản đóng gói sẵn + làm sạch.

Gọi Gemini web cần một mảng 97 trường y như trang gemini.google.com gửi; app thay trường 0 (prompt + ảnh) cho mỗi lần
gọi. Trước 2026-11-24 template chỉ có khi chạy tay `capture.py` → mọi máy cài mới báo "Chưa có inner_template".
Nay app mang theo bản đã làm sạch ở `resources/gemini/inner_template.json` (không gắn tài khoản: idx 3/4/59 = null);
`config.json` có bản capture mới hơn thì dùng bản đó. Gemini đổi giao thức → Cài đặt → "Cập nhật template Gemini".
"""
from __future__ import annotations

import copy
import json
import sys
from functools import lru_cache
from pathlib import Path

from app.core.config import RESOURCES_DIR

# idx 3 = relate-token (!...), idx 4 = conversation/response-id (32 hex), idx 59 = client request UUID.
# Prompt 1 lần không cần thừa kế hội thoại → null cho template "hội thoại mới", không gắn tài khoản.
SANITIZE_INDICES = (3, 4, 59)
TEMPLATE_LENGTH = 97
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
)
_RELATIVE = Path("resources") / "gemini" / "inner_template.json"


def bundled_template_path() -> Path:
    """Bản đóng gói: thư mục giải nén của PyInstaller (backend.spec đưa cả `resources/`); dev: Backend/resources."""
    direct = RESOURCES_DIR / "gemini" / "inner_template.json"
    if direct.is_file():
        return direct
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle and (Path(bundle) / _RELATIVE).is_file():
        return Path(bundle) / _RELATIVE
    return Path(__file__).resolve().parents[3] / _RELATIVE


@lru_cache(maxsize=1)
def _load_bundled() -> tuple:
    data = json.loads(bundled_template_path().read_text(encoding="utf-8"))
    if not isinstance(data, list) or len(data) != TEMPLATE_LENGTH:
        raise RuntimeError(f"Template Gemini đóng gói hỏng: cần mảng {TEMPLATE_LENGTH} phần tử ({bundled_template_path()}).")
    return tuple(data)


def load_bundled_inner_template() -> list:
    """Bản sao (sửa thoải mái) của template đóng gói sẵn."""
    return copy.deepcopy(list(_load_bundled()))


def sanitize_inner(inner: list) -> list:
    """Bản sao của `inner` với các trường gắn hội thoại/tài khoản = null."""
    out = copy.deepcopy(inner)
    for i in SANITIZE_INDICES:
        if i < len(out):
            out[i] = None
    return out
