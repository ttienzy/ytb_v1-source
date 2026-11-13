"""Motion Control — node tùy chọn "Tạo ảnh nhân vật mới": ảnh người + ảnh trang phục -> MỘT ảnh tham chiếu nhân vật (ChatGPT ảnh).

Dùng lại đúng mẫu prompt `system:look_sheet` của Chiến dịch AI (Image 1 = nhân dạng, Image 2 = trang phục), nên prompt chỉ có
một nguồn. Kết quả lưu như asset workflow (kind "model") để ô Nhân Vật của Motion Control dùng ngay bằng `backend_path`.
Không gọi Google Flow, không tốn credit Flow; chỉ dùng lượt tạo ảnh của tài khoản ChatGPT.
"""
from __future__ import annotations

import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

TEMPLATE_ID = "system:look_sheet"
ASPECT = "16:9"                 # mẫu look sheet ghi cứng "16:9" trong prompt
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
MAX_CHANGES = 600

_lock = threading.Lock()        # một lượt tạo mỗi lúc: chặn bấm đúp, không tranh tài khoản ChatGPT với chính node này


class CharacterSheetError(ValueError):
    """Đầu vào không hợp lệ (hiện nguyên văn cho người dùng)."""


class CharacterSheetBusy(RuntimeError):
    """Đang có một lượt tạo ảnh nhân vật khác."""


def _prompts():
    from app.campaign.prompts import PromptLibrary
    from app.core.database import SessionLocal
    return PromptLibrary(SessionLocal)


def _client():
    from app.ai.image_gen.service import get_image_client
    return get_image_client()


def _image_file(raw: Any, label: str) -> Path:
    text = str(raw or "").strip()
    if not text:
        raise CharacterSheetError(f"Thiếu {label}.")
    path = Path(text)
    if path.suffix.lower() not in IMAGE_SUFFIXES:
        raise CharacterSheetError(f"{label.capitalize()} phải là PNG, JPG hoặc WebP: {path.name}")
    if not path.is_file():
        raise CharacterSheetError(f"Không tìm thấy {label} trên máy: {path.name}. Hãy tải ảnh lên lại.")
    return path


def _sniff_ext(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "png"


def build_request(identity_path: Any, outfit_path: Any, changes: str = "") -> dict[str, Any]:
    """Prompt cuối cùng + thứ tự ảnh (nhân vật rồi trang phục). Dùng chung cho lúc chạy và cho test."""
    identity = _image_file(identity_path, "ảnh nhân vật")
    outfit = _image_file(outfit_path, "ảnh trang phục")
    clean_changes = " ".join(str(changes or "").split())[:MAX_CHANGES]
    rendered = _prompts().render(TEMPLATE_ID, changes=clean_changes, ref_paths=[str(identity), str(outfit)])
    rendered["aspect"] = ASPECT
    return rendered


def generate(identity_path: Any, outfit_path: Any, changes: str = "") -> dict[str, Any]:
    """Tạo một ảnh nhân vật mới (thường 40–70 giây) và lưu thành asset workflow. Không tự thử lại."""
    req = build_request(identity_path, outfit_path, changes)
    if not _lock.acquire(blocking=False):
        raise CharacterSheetBusy("Đang tạo một ảnh nhân vật khác; đợi lượt đó xong rồi bấm lại.")
    started = time.time()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "character_sheet.png"
            _client().generate(prompt=req["prompt"], dest=str(dest), ref_paths=[s["path"] for s in req["ref_order"]],
                               aspect=req["aspect"])
            data = dest.read_bytes() if dest.is_file() else b""
    finally:
        _lock.release()
    if not data:
        raise RuntimeError("ChatGPT không trả về ảnh.")

    from app.workflow.service import save_workflow_asset
    asset = save_workflow_asset(data, f"nhan-vat-moi-{uuid.uuid4().hex[:6]}.{_sniff_ext(data)}", kind="model")
    return {
        "asset": asset,
        "prompt": req["prompt"],
        "template": req["template"],
        "seconds": round(time.time() - started, 1),
    }
