"""Processed Videos History Tracker.

Maintains a permanent, ultra-lightweight JSON registry of all processed YouTube videos
at Backend/Data/processed_history.json.

Key guarantees:
  1. Permanent Memory: Even if a user deletes media files in Downloads/{job_id}/,
     the record in processed_history.json is KEPT (marked with is_disk_cleaned: true).
  2. Robust Identification: Extracts standard 11-char YouTube video_id from any URL format
     (watch?v=, youtu.be/, shorts/, embed/).
  3. O(1) Quick Lookup for Discover / Studio checking.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import TOOLS_DIR

PROCESSED_HISTORY_FILE = TOOLS_DIR / "Backend" / "Data" / "processed_history.json"


def extract_youtube_video_id(url_or_id: str) -> str:
    """Trích xuất mã video_id 11 ký tự từ bất kỳ định dạng link YouTube nào."""
    if not url_or_id:
        return ""
    raw = url_or_id.strip()
    if len(raw) == 11 and re.match(r"^[A-Za-z0-9_-]{11}$", raw):
        return raw

    patterns = [
        r"(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/|\/watch\?v=|\&v=)([A-Za-z0-9_-]{11})",
        r"^([A-Za-z0-9_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, raw)
        if m:
            return m.group(1)
    return raw


def _read_history() -> dict[str, dict[str, Any]]:
    if not PROCESSED_HISTORY_FILE.exists():
        return {}
    try:
        data = json.loads(PROCESSED_HISTORY_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _write_history(data: dict[str, dict[str, Any]]) -> None:
    PROCESSED_HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROCESSED_HISTORY_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def format_relative_time(iso_str: str | None) -> str:
    """Format thời gian ISO thành chuỗi thân thiện: 'Hôm nay', '2 ngày trước', v.v."""
    if not iso_str:
        return ""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = now - dt
        seconds = int(diff.total_seconds())

        if seconds < 60:
            return "Vừa xong"
        if seconds < 3600:
            return f"{seconds // 60} phút trước"
        if seconds < 86400:
            return f"{seconds // 3600} giờ trước"
        days = seconds // 86400
        if days == 1:
            return "Hôm qua"
        if days < 30:
            return f"{days} ngày trước"
        if days < 365:
            return f"{days // 30} tháng trước"
        return f"{days // 365} năm trước"
    except Exception:
        return ""


# ── Core Lifecycle Hooks ─────────────────────────────────────────────────────

def record_job_start(youtube_url: str, job_id: str, title: str | None = None) -> None:
    """Ghi nhận video bắt đầu chạy pipeline (status: processing)."""
    vid = extract_youtube_video_id(youtube_url)
    if not vid:
        return

    history = _read_history()
    now_iso = datetime.now(timezone.utc).isoformat()

    existing = history.get(vid, {})
    history[vid] = {
        **existing,
        "video_id": vid,
        "url": youtube_url,
        "title": title or existing.get("title") or f"YouTube Video ({vid})",
        "job_id": job_id,
        "status": "processing",
        "created_at": existing.get("created_at") or now_iso,
        "updated_at": now_iso,
        "is_disk_cleaned": False,
    }
    _write_history(history)


def record_job_metadata(job_id: str, title: str, scenes_count: int = 0, caption: dict | None = None) -> None:
    """Cập nhật tiêu đề và tóm tắt sau khi Gemini hoàn thành kịch bản."""
    history = _read_history()
    updated = False
    for vid, item in history.items():
        if item.get("job_id") == job_id:
            item["title"] = title or item.get("title")
            item["scenes_count"] = scenes_count
            if caption and isinstance(caption, dict):
                item["caption_title"] = caption.get("title")
            item["updated_at"] = datetime.now(timezone.utc).isoformat()
            updated = True
            break
    if updated:
        _write_history(history)


def record_job_completed(job_id: str, video_path: str | None = None) -> None:
    """Đánh dấu video đã hoàn tất thành phẩm (status: completed)."""
    history = _read_history()
    updated = False
    now_iso = datetime.now(timezone.utc).isoformat()
    for vid, item in history.items():
        if item.get("job_id") == job_id:
            item["status"] = "completed"
            item["completed_at"] = now_iso
            item["updated_at"] = now_iso
            if video_path:
                item["output_video_path"] = str(video_path)
            updated = True
            break
    if updated:
        _write_history(history)


def record_job_failed(job_id: str, error_message: str) -> None:
    """Đánh dấu video gặp lỗi trong quá trình xử lý (status: error)."""
    history = _read_history()
    updated = False
    now_iso = datetime.now(timezone.utc).isoformat()
    for vid, item in history.items():
        if item.get("job_id") == job_id:
            item["status"] = "error"
            item["error"] = str(error_message)[:300]
            item["updated_at"] = now_iso
            updated = True
            break
    if updated:
        _write_history(history)


def mark_disk_cleaned(job_id: str) -> None:
    """Đánh dấu file trên ổ đĩa đã được xóa, NHƯNG bản ghi trong DB vẫn giữ nguyên vẹn."""
    history = _read_history()
    updated = False
    for vid, item in history.items():
        if item.get("job_id") == job_id:
            item["is_disk_cleaned"] = True
            item["output_video_path"] = None
            item["updated_at"] = datetime.now(timezone.utc).isoformat()
            updated = True
            break
    if updated:
        _write_history(history)


def remove_from_history(video_id_or_url: str) -> bool:
    """Xóa hoàn toàn video khỏi DB nếu người dùng muốn 'quên' video này để làm lại từ đầu."""
    vid = extract_youtube_video_id(video_id_or_url)
    history = _read_history()
    if vid in history:
        del history[vid]
        _write_history(history)
        return True
    return False


def get_processed_video_map() -> dict[str, dict[str, Any]]:
    """Lấy map video_id -> thông tin xử lý (cho phép tra cứu tức thì O(1))."""
    raw = _read_history()
    result = {}
    for vid, item in raw.items():
        created_at = item.get("completed_at") or item.get("created_at")
        result[vid] = {
            "video_id": vid,
            "status": item.get("status", "completed"),
            "job_id": item.get("job_id"),
            "title": item.get("title"),
            "created_at": created_at,
            "formatted_date": format_relative_time(created_at),
            "is_disk_cleaned": item.get("is_disk_cleaned", False),
        }
    return result
