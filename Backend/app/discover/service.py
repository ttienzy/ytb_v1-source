"""Discover Service — Orchestrates Presets, Saved Channels, Live Metadata, and Video Scraping."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from typing import Any

from fastapi import HTTPException

from app.core.config import TOOLS_DIR
from app.discover.history import get_processed_video_map
from app.discover.metadata import (
    fetch_live_channel_metadata,
    format_duration,
    format_subscribers,
    format_views,
    read_cache,
    write_cache,
)
from app.discover.scout import scout_channels_with_gemini
from app.discover.seed import SEED_CHANNELS

SAVED_CHANNELS_FILE = TOOLS_DIR / "Backend" / "Data" / "saved_channels.json"


def read_saved_channels() -> list[dict[str, Any]]:
    if not SAVED_CHANNELS_FILE.exists():
        return []
    try:
        data = json.loads(SAVED_CHANNELS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def write_saved_channels(channels: list[dict[str, Any]]) -> None:
    SAVED_CHANNELS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SAVED_CHANNELS_FILE.write_text(json.dumps(channels, ensure_ascii=False, indent=2), encoding="utf-8")


def get_preset_channels() -> list[dict[str, Any]]:
    """Lấy danh sách kênh đề xuất (Tự động cập nhật Live Avatar & Subs từ Cache)."""
    cache = read_cache()
    results = []
    for seed in SEED_CHANNELS:
        handle = seed.get("handle") or ""
        cached = cache.get(handle)
        if cached and cached.get("avatar_url"):
            results.append({**seed, **cached})
        else:
            live = fetch_live_channel_metadata(seed["channel_url"])
            if live:
                cache[handle] = live
                results.append({**seed, **live})
            else:
                results.append(seed)

    write_cache(cache)
    return results


def get_saved_channels() -> list[dict[str, Any]]:
    """Lấy danh sách kênh yêu thích người dùng đã lưu."""
    return read_saved_channels()


def save_channel(
    handle: str,
    name: str | None = None,
    channel_url: str | None = None,
    avatar_url: str | None = None,
    subscribers: str | None = None,
    category: str | None = "custom",
    category_label: str | None = "Kênh đã lưu",
    description: str | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Lưu kênh mới (Tự động trích xuất metadata thật từ YouTube)."""
    current = read_saved_channels()
    clean_handle = handle.strip()
    if not clean_handle.startswith("@") and not clean_handle.startswith("http"):
        clean_handle = f"@{clean_handle}"

    url = channel_url or (clean_handle if clean_handle.startswith("http") else f"https://www.youtube.com/{clean_handle}")

    # Fetch live metadata from YouTube
    live = fetch_live_channel_metadata(url)
    resolved_name = name or live.get("name") or clean_handle
    resolved_avatar = live.get("avatar_url") or avatar_url or ""
    resolved_subs = live.get("subscribers") or subscribers or ""

    # Remove if exists (update)
    filtered = [c for c in current if c.get("handle") != clean_handle and c.get("channel_url") != url]
    new_item = {
        "id": f"chan_{int(time.time())}",
        "name": resolved_name,
        "handle": clean_handle,
        "channel_url": url,
        "avatar_url": resolved_avatar,
        "subscribers": resolved_subs,
        "category": category or "custom",
        "category_label": category_label or "Kênh đã lưu",
        "description": description or f"Kênh YouTube ẩm thực ({resolved_subs} người theo dõi)",
        "tags": tags or ["Custom", "User Added"],
    }
    filtered.insert(0, new_item)
    write_saved_channels(filtered)

    # Also update cache
    if live:
        cache = read_cache()
        cache[clean_handle] = live
        write_cache(cache)

    return {"ok": True, "channel": new_item, "saved_count": len(filtered)}


def delete_saved_channel(handle_or_id: str) -> dict[str, Any]:
    """Xóa kênh khỏi danh sách theo dõi."""
    current = read_saved_channels()
    filtered = [
        c for c in current
        if c.get("handle") != handle_or_id
        and c.get("id") != handle_or_id
        and c.get("handle") != f"@{handle_or_id}"
    ]
    write_saved_channels(filtered)
    return {"ok": True, "saved_count": len(filtered)}


def recommend_channels(query: str = "", category: str | None = None) -> list[dict[str, Any]]:
    """Gợi ý kênh ẩm thực bằng Gemini AI hoặc lọc theo chủ đề."""
    q = query.strip()
    presets = get_preset_channels()

    if not q and category:
        filtered = [c for c in presets if c.get("category") == category]
        return filtered or presets

    if not q:
        return presets

    # Try Gemini recommendation
    ai_results = scout_channels_with_gemini(q)
    if ai_results:
        cache = read_cache()
        for r in ai_results:
            h = r.get("handle") or ""
            if h in cache and cache[h].get("avatar_url"):
                r["avatar_url"] = cache[h]["avatar_url"]
                if not r.get("subscribers"):
                    r["subscribers"] = cache[h].get("subscribers")
        return ai_results

    # Fallback search locally
    all_channels = [*presets, *read_saved_channels()]
    q_low = q.lower()
    matches = []
    for c in all_channels:
        text = f"{c.get('name', '')} {c.get('description', '')} {' '.join(c.get('tags', []))} {c.get('category_label', '')}".lower()
        if any(term in text for term in q_low.split()):
            matches.append(c)

    return matches if matches else presets


def get_channel_videos(channel_url: str, limit: int = 24) -> dict[str, Any]:
    """Trích xuất 20-30 video mới nhất của kênh YouTube bằng yt-dlp flat playlist và cập nhật cache."""
    url = channel_url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Thiếu channel_url.")

    if not url.startswith("http"):
        if url.startswith("@"):
            url = f"https://www.youtube.com/{url}"
        else:
            url = f"https://www.youtube.com/@{url}"

    target_url = url.rstrip("/")
    if not target_url.endswith("/videos"):
        target_url = f"{target_url}/videos"

    bounded_limit = max(5, min(limit, 50))
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-end",
        str(bounded_limit),
        "--no-warnings",
        target_url,
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Quá thời gian tải danh sách video từ kênh (Timeout 30s).")

    if proc.returncode != 0:
        err = proc.stderr or proc.stdout or "Không thể tải playlist kênh"
        raise HTTPException(status_code=502, detail=f"Lỗi yt-dlp: {err[-400:]}")

    try:
        data = json.loads(proc.stdout)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không parse được dữ liệu kênh: {exc}")

    channel_name = data.get("channel") or data.get("uploader") or data.get("title") or "Kênh YouTube"
    channel_id = data.get("channel_id") or data.get("id") or ""
    subs_count = data.get("channel_follower_count")
    avatar_url = ""
    for thumb in reversed(data.get("thumbnails") or []):
        if thumb.get("id") == "avatar_uncropped" or thumb.get("id") == "7" or (thumb.get("width") == thumb.get("height") and thumb.get("width", 0) > 80):
            avatar_url = thumb.get("url")
            break

    # Update cache
    handle = data.get("uploader_id") or url.split("/")[-1]
    if handle and avatar_url:
        cache = read_cache()
        cache[handle] = {
            "name": channel_name,
            "channel_id": channel_id,
            "avatar_url": avatar_url,
            "subscribers": format_subscribers(subs_count),
            "subscribers_count": subs_count,
            "fetched_at": int(time.time()),
        }
        write_cache(cache)

    entries = data.get("entries") or []
    processed_map = get_processed_video_map()
    videos = []
    for it in entries:
        if not it:
            continue
        v_id = it.get("id") or ""
        v_url = it.get("url") or f"https://www.youtube.com/watch?v={v_id}"
        v_title = it.get("title") or "Video không tiêu đề"
        dur_sec = it.get("duration")
        view_cnt = it.get("view_count")

        best_thumb = ""
        thumbs = it.get("thumbnails") or []
        if thumbs:
            best_thumb = thumbs[-1].get("url") or ""

        p_info = processed_map.get(v_id)

        videos.append({
            "id": v_id,
            "title": v_title,
            "url": v_url,
            "duration_sec": dur_sec,
            "duration_formatted": format_duration(dur_sec),
            "is_golden_duration": bool(dur_sec and 300 <= dur_sec <= 1080),
            "view_count": view_cnt,
            "view_count_formatted": format_views(view_cnt),
            "thumbnail_url": best_thumb,
            "upload_date": it.get("upload_date") or "",
            "processed_status": p_info.get("status") if p_info else None,
            "processed_date": p_info.get("formatted_date") if p_info else None,
            "processed_job_id": p_info.get("job_id") if p_info else None,
            "is_disk_cleaned": p_info.get("is_disk_cleaned", False) if p_info else False,
        })

    return {
        "channel_name": channel_name,
        "channel_id": channel_id,
        "channel_url": url,
        "avatar_url": avatar_url,
        "subscribers": format_subscribers(subs_count),
        "video_count": len(videos),
        "videos": videos,
    }


# ── Niche Video Scout & Google Drive Upload Pipeline ──────────────────────────

from pathlib import Path
import asyncio
import secrets
import shutil
from datetime import datetime, timezone

from app.core.config import DATA_DIR, settings
from app.discover.scout import scout_videos_with_gemini
from app.discover.schemas import DriveUploadItem

_DRIVE_UPLOAD_TASKS: dict[str, dict[str, Any]] = {}


def scout_niche_videos(
    query: str,
    custom_prompt: str | None = None,
    urls: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Gọi Gemini Scout để gợi ý danh sách video YouTube theo ngách."""
    return scout_videos_with_gemini(query=query, custom_prompt=custom_prompt, urls=urls)


def get_drive_upload_tasks() -> list[dict[str, Any]]:
    """Lấy danh sách task tải video & upload Google Drive."""
    tasks = list(_DRIVE_UPLOAD_TASKS.values())
    tasks.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return tasks


def _sync_download_and_upload(task_id: str, url: str, custom_name: str | None, folder_id: str | None) -> None:
    """Xử lý đồng bộ 1 task: tải bằng yt-dlp và upload lên Google Drive."""
    from app.externals.gdrive.service import upload_clean_video
    from app.externals.gdrive.schemas import GDriveUploadRequest

    task = _DRIVE_UPLOAD_TASKS.get(task_id)
    if not task:
        return

    temp_dir = DATA_DIR / "temp_gdrive_downloads" / task_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        task["status"] = "downloading"
        task["progress_percent"] = 25

        # Dùng yt-dlp tải video full (Video + Audio)
        cmd = [
            sys.executable,
            "-m",
            "yt_dlp",
            "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "--output", str(temp_dir / "%(title)s.%(ext)s"),
            "--no-playlist",
            "--no-warnings",
        ]

        if settings.yt_cookies_file.exists() and settings.yt_cookies_file.stat().st_size > 0:
            cmd.extend(["--cookies", str(settings.yt_cookies_file)])

        cmd.append(url)

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=900,  # 15 phút
        )

        if proc.returncode != 0:
            err_msg = proc.stderr.strip() or proc.stdout.strip() or f"yt-dlp exited with code {proc.returncode}"
            # Rút gọn message nếu quá dài
            if len(err_msg) > 300:
                err_msg = err_msg[-300:]
            raise RuntimeError(f"Tải video YouTube thất bại: {err_msg}")

        # Tìm file mp4 đã tải về
        mp4_files = list(temp_dir.glob("*.mp4"))
        if not mp4_files:
            # Fallback tìm file media bất kỳ
            any_files = [f for f in temp_dir.iterdir() if f.is_file()]
            if not any_files:
                raise RuntimeError("Không tìm thấy file video sau khi tải về.")
            downloaded_file = any_files[0]
        else:
            downloaded_file = mp4_files[0]

        task["title"] = downloaded_file.stem
        task["status"] = "uploading"
        task["progress_percent"] = 65

        # Xác định tên file upload
        target_name = (custom_name or "").strip()
        if not target_name:
            target_name = downloaded_file.name
        elif not target_name.lower().endswith(".mp4"):
            target_name += ".mp4"

        task["custom_name"] = target_name

        # Gọi service Google Drive Resumable Upload
        upload_res = upload_clean_video(GDriveUploadRequest(
            file_path=str(downloaded_file),
            folder_id=folder_id,
            custom_name=target_name,
        ))

        task["status"] = "done"
        task["progress_percent"] = 100
        task["file_id"] = upload_res.file_id
        task["web_view_link"] = upload_res.web_view_link
        task["size_bytes"] = upload_res.size_bytes

    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)
    finally:
        # Dọn dẹp thư mục tạm
        shutil.rmtree(temp_dir, ignore_errors=True)


async def _async_worker_drive_upload(task_id: str, url: str, custom_name: str | None, folder_id: str | None):
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _sync_download_and_upload, task_id, url, custom_name, folder_id)


def start_drive_upload_batch(items: list[DriveUploadItem], folder_id: str | None = None) -> list[dict[str, Any]]:
    """Khởi chạy hàng đợi tải video & upload Google Drive."""
    created_tasks = []
    for item in items:
        u = (item.url or "").strip()
        if not u:
            continue
        tid = secrets.token_hex(6)
        task_info = {
            "task_id": tid,
            "url": u,
            "title": item.title or "",
            "custom_name": item.custom_name or "",
            "status": "pending",
            "progress_percent": 0,
            "error": None,
            "file_id": None,
            "web_view_link": None,
            "size_bytes": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _DRIVE_UPLOAD_TASKS[tid] = task_info
        created_tasks.append(task_info)

        # Kích hoạt worker chạy ngầm
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_async_worker_drive_upload(tid, u, item.custom_name, folder_id))
        except RuntimeError:
            # Fallback nếu gọi từ thread ngoài không có running loop
            import threading
            t = threading.Thread(target=_sync_download_and_upload, args=(tid, u, item.custom_name, folder_id), daemon=True)
            t.start()

    return created_tasks

