"""
Veo Media Registry
Quản lý ánh xạ mã băm (SHA-256) của file ảnh/video với Google Flow mediaId theo từng Project.
Chống upload trùng lặp lên cùng một project trên Google Flow.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).resolve().parent.parent.parent  # Backend/
_REGISTRY_FILE = _BASE_DIR / "Data" / "veo_media_registry.json"

_registry_lock = threading.Lock()
_registry_cache: Optional[dict[str, dict[str, Any]]] = None


def compute_file_sha256(file_path: Path | str) -> str:
    """Tính SHA-256 của file bằng streaming chunk để tránh tràn bộ nhớ RAM."""
    p = Path(file_path)
    if not p.is_file():
        raise FileNotFoundError(f"File không tồn tại để tính mã băm: {p}")
    hasher = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def compute_bytes_sha256(data: bytes) -> str:
    """Tính SHA-256 của chuỗi bytes."""
    return hashlib.sha256(data).hexdigest()


def _load_registry() -> dict[str, dict[str, Any]]:
    """Tải registry từ đĩa (thread-safe)."""
    global _registry_cache
    if _registry_cache is not None:
        return _registry_cache

    with _registry_lock:
        if _registry_cache is not None:
            return _registry_cache
        if not _REGISTRY_FILE.exists():
            _registry_cache = {}
            return _registry_cache

        try:
            content = _REGISTRY_FILE.read_text(encoding="utf-8")
            _registry_cache = json.loads(content) if content.strip() else {}
        except Exception as e:
            logger.warning("Không thể đọc veo_media_registry.json, khởi tạo rỗng: %s", e)
            _registry_cache = {}
        return _registry_cache


def _save_registry() -> None:
    """Lưu registry xuống đĩa (thread-safe)."""
    global _registry_cache
    if _registry_cache is None:
        return

    try:
        _REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
        temp_file = _REGISTRY_FILE.with_suffix(".tmp")
        temp_file.write_text(
            json.dumps(_registry_cache, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temp_file.replace(_REGISTRY_FILE)
    except Exception as e:
        logger.error("Không thể ghi file veo_media_registry.json: %s", e)


def make_registry_key(project_id: str, file_hash: str) -> str:
    """Tạo khóa phân biệt theo project_id và sha256_hash."""
    clean_pid = (project_id or "default").strip().lower()
    clean_hash = (file_hash or "").strip().lower()
    return f"{clean_pid}:{clean_hash}"


def get_cached_media_id(project_id: str, file_hash: str) -> Optional[str]:
    """
    Tra cứu media_id trong Registry theo project_id và file_hash.
    Trả về media_id nếu đã tồn tại, ngược lại trả về None.
    """
    if not project_id or not file_hash:
        return None
    reg = _load_registry()
    key = make_registry_key(project_id, file_hash)
    item = reg.get(key)
    if item and item.get("media_id"):
        return str(item["media_id"]).strip()
    return None


def get_media_info_by_id(media_id: str) -> Optional[dict[str, Any]]:
    """Tra cứu thông tin media trong Registry theo media_id."""
    if not media_id:
        return None
    clean_id = str(media_id).strip()
    reg = _load_registry()
    for item in reg.values():
        if item.get("media_id") == clean_id:
            return item
    return None


def register_media(
    project_id: str,
    file_hash: str,
    media_id: str,
    filename: str = "",
    mime_type: str = "",
    kind: str = "image",
    file_size: int = 0,
    duration: float = 0.0,
    local_filename: str = "",
) -> None:
    """
    Lưu vết media_id vừa upload thành công vào Registry.
    """
    if not project_id or not file_hash or not media_id:
        return

    with _registry_lock:
        reg = _load_registry()
        key = make_registry_key(project_id, file_hash)
        reg[key] = {
            "media_id": str(media_id).strip(),
            "project_id": str(project_id).strip(),
            "file_hash": str(file_hash).strip(),
            "filename": filename or "",
            "mime_type": mime_type or "",
            "kind": kind,
            "file_size": file_size,
            "duration": float(duration or 0.0),
            "local_filename": local_filename or "",
            "created_at": int(time.time()),
        }
        _save_registry()
        logger.info(
            "[MediaRegistry] Đã lưu cache: project=%s, hash=%s... -> media_id=%s (%s, dur=%.2fs)",
            project_id,
            file_hash[:8],
            media_id,
            filename or kind,
            float(duration or 0.0),
        )


def clear_registry_for_test() -> None:
    """Xóa bộ nhớ đệm phục vụ cho unit tests."""
    global _registry_cache
    with _registry_lock:
        _registry_cache = {}
        if _REGISTRY_FILE.exists():
            try:
                _REGISTRY_FILE.unlink()
            except Exception:
                pass
