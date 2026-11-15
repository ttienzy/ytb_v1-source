"""Thư viện ảnh (Canvas AI → "Thư Viện Ảnh"): nơi giữ ảnh đã tạo / tải lên để dùng lại.

- Chỉ mục: DATA_DIR/image_library.json  {"items": [...]}
- Ảnh tải lên: DATA_DIR/media/image_library/
- Ảnh Muse tạo (vd. node "Tách áo quần"): DATA_DIR/media/muse_outputs/ — được ghi vào chỉ mục ngay khi tải về
  (kèm prompt, ảnh vào…); file nào có trong thư mục mà chưa có trong chỉ mục thì lần liệt kê sau tự thêm.
Item chỉ trỏ tới file, không sao chép ảnh Muse.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from app.core.config import DATA_DIR

INDEX_FILE = DATA_DIR / "image_library.json"
UPLOAD_DIR = DATA_DIR / "media" / "image_library"
MUSE_OUTPUT_DIR = DATA_DIR / "media" / "muse_outputs"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
SOURCES = ("muse", "upload")

_lock = threading.RLock()


def _managed_dirs() -> list[Path]:
    """Thư mục app quản lý — chỉ file trong đây mới được xóa khi xóa khỏi thư viện."""
    return [UPLOAD_DIR.resolve(), MUSE_OUTPUT_DIR.resolve()]


def _load() -> dict[str, Any]:
    if not INDEX_FILE.exists():
        return {"items": []}
    try:
        data = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            return data
    except (ValueError, OSError):
        pass
    return {"items": []}


def _save(data: dict[str, Any]) -> None:
    INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = INDEX_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, INDEX_FILE)


def _dimensions(path: Path) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(path) as im:
            return int(im.width), int(im.height)
    except Exception:
        return 0, 0


def _public(item: dict[str, Any]) -> dict[str, Any]:
    return {**item, "preview_url": f"/api/workflow/images/{item['id']}/file"}


def _new_item(path: Path, source: str, label: str = "", meta: Optional[dict] = None, created_at: Optional[float] = None) -> dict:
    w, h = _dimensions(path)
    return {
        "id": uuid.uuid4().hex[:12],
        "file_name": path.name,
        "path": str(path.resolve()),
        "source": source,
        "label": (label or path.stem)[:120],
        "favorite": False,
        "tags": [],
        "created_at": created_at or time.time(),
        "size": path.stat().st_size,
        "width": w,
        "height": h,
        "meta": meta or {},
    }


def _sync(data: dict[str, Any]) -> bool:
    """Thêm ảnh Muse chưa có trong chỉ mục; bỏ item mà file đã mất. Trả True nếu có thay đổi."""
    changed = False
    items = data["items"]
    alive = [it for it in items if Path(it.get("path", "")).exists()]
    if len(alive) != len(items):
        changed = True
    known = {str(Path(it["path"]).resolve()).lower() for it in alive}
    if MUSE_OUTPUT_DIR.exists():
        for f in MUSE_OUTPUT_DIR.iterdir():
            if f.is_file() and f.suffix.lower() in IMAGE_EXT and str(f.resolve()).lower() not in known:
                alive.append(_new_item(f, "muse", created_at=f.stat().st_mtime))
                changed = True
    data["items"] = alive
    return changed


def list_images(q: str = "", source: str = "", favorite: bool = False) -> list[dict[str, Any]]:
    with _lock:
        data = _load()
        if _sync(data):
            _save(data)
        items = data["items"]
    ql = q.strip().lower()
    out = []
    for it in items:
        if source and it.get("source") != source:
            continue
        if favorite and not it.get("favorite"):
            continue
        if ql:
            hay = " ".join(
                [it.get("label", ""), it.get("file_name", ""), " ".join(it.get("tags", [])),
                 str((it.get("meta") or {}).get("chat_title", "")), str((it.get("meta") or {}).get("prompt", ""))[:400]]
            ).lower()
            if ql not in hay:
                continue
        out.append(_public(it))
    out.sort(key=lambda it: it.get("created_at", 0), reverse=True)
    return out


def get_image(image_id: str) -> Optional[dict[str, Any]]:
    with _lock:
        return next((it for it in _load()["items"] if it["id"] == image_id), None)


def add_file(path: str | Path, source: str = "muse", label: str = "", meta: Optional[dict] = None) -> dict[str, Any]:
    """Ghi một file ảnh có sẵn vào thư viện (không sao chép). File đã có thì cập nhật nhãn/meta."""
    p = Path(path).resolve()
    if not p.exists():
        raise FileNotFoundError(str(p))
    with _lock:
        data = _load()
        key = str(p).lower()
        for it in data["items"]:
            if str(Path(it["path"]).resolve()).lower() == key:
                if label:
                    it["label"] = label[:120]
                if meta:
                    it["meta"] = {**(it.get("meta") or {}), **meta}
                _save(data)
                return _public(it)
        item = _new_item(p, source if source in SOURCES else "upload", label, meta)
        data["items"].append(item)
        _save(data)
        return _public(item)


def save_upload(filename: str, content: bytes, label: str = "") -> dict[str, Any]:
    ext = Path(filename or "").suffix.lower()
    if ext not in IMAGE_EXT:
        raise ValueError("Chỉ nhận ảnh PNG, JPG, WebP hoặc GIF.")
    if not content:
        raise ValueError("File rỗng.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("Ảnh lớn hơn 25 MB.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stem = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in Path(filename).stem)[:60] or "image"
    dest = UPLOAD_DIR / f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
    dest.write_bytes(content)
    return add_file(dest, "upload", label or Path(filename).stem)


def update_image(image_id: str, label: Optional[str] = None, favorite: Optional[bool] = None,
                 tags: Optional[list[str]] = None) -> dict[str, Any]:
    with _lock:
        data = _load()
        for it in data["items"]:
            if it["id"] != image_id:
                continue
            if label is not None:
                label = label.strip()
                if not label:
                    raise ValueError("Tên ảnh không được để trống.")
                it["label"] = label[:120]
            if favorite is not None:
                it["favorite"] = bool(favorite)
            if tags is not None:
                it["tags"] = sorted({t.strip()[:30] for t in tags if t and t.strip()})[:20]
            _save(data)
            return _public(it)
    raise KeyError(image_id)


def delete_image(image_id: str, delete_file: bool = True) -> bool:
    """Xóa khỏi thư viện; chỉ xóa file nếu file nằm trong thư mục app quản lý."""
    with _lock:
        data = _load()
        item = next((it for it in data["items"] if it["id"] == image_id), None)
        if not item:
            return False
        data["items"] = [it for it in data["items"] if it["id"] != image_id]
        _save(data)
    if delete_file:
        p = Path(item["path"]).resolve()
        if any(d in p.parents for d in _managed_dirs()):
            p.unlink(missing_ok=True)
    return True


def open_folder() -> str:
    folder = UPLOAD_DIR if not MUSE_OUTPUT_DIR.exists() else MUSE_OUTPUT_DIR
    folder.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        os.startfile(str(folder))  # type: ignore[attr-defined]
    elif shutil.which("xdg-open"):
        subprocess.Popen(["xdg-open", str(folder)])
    return str(folder)
