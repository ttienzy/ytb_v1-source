"""Discover Service — Orchestrates Presets, Saved Channels, Live Metadata, and Video Scraping."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from typing import Any

from fastapi import HTTPException

from app.core.config import TOOLS_DIR
from app.discover.freshness import (
    fetch_rss_published,
    published_label,
    register_scan,
    resolve_published,
    to_upload_date,
)
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


def get_channel_videos(channel_url: str, limit: int = 24, offset: int = 0) -> dict[str, Any]:
    """Trích xuất video của kênh (mới nhất trước) bằng yt-dlp flat playlist và cập nhật cache.

    offset=0 là lần quét "làm mới": ghi sổ video đã thấy để gắn nhãn MỚI. offset>0 là "Tải thêm"
    video cũ hơn — chỉ đọc sổ, không ghi.
    """
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
    start_idx = max(0, offset)
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-start",
        str(start_idx + 1),
        "--playlist-end",
        str(start_idx + bounded_limit),
        # Flat mode không có ngày đăng; cờ này cho timestamp xấp xỉ (theo ngày/tháng) để hiển thị.
        "--extractor-args",
        "youtubetab:approximate_date",
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
            timeout=45,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Quá thời gian tải danh sách video từ kênh (Timeout 45s).")

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

    entries = [it for it in (data.get("entries") or []) if it]
    processed_map = get_processed_video_map()

    # Ngày đăng chính xác (RSS, ~15 video mới nhất) + sổ "đã thấy" để gắn nhãn MỚI.
    rss_map = fetch_rss_published(channel_id) if start_idx == 0 else {}
    entry_ids = [it.get("id") or "" for it in entries]
    scan = register_scan(channel_id or url, entry_ids, record=start_idx == 0)

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
        published_iso, published_exact = resolve_published(v_id, rss_map, it.get("timestamp"))

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
            "upload_date": it.get("upload_date") or to_upload_date(published_iso),
            "published_at": published_iso,
            "published_exact": published_exact,
            "published_label": published_label(published_iso, published_exact),
            "is_new": v_id in scan["new_ids"],
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
        "offset": start_idx,
        "next_offset": start_idx + len(entries),
        "has_more": len(entries) >= bounded_limit,
        "new_in_scan": scan["new_in_scan"],
        "first_scan": scan["first_scan"],
        "previous_scan_at": scan["previous_scan_at"],
        "scanned_at": int(time.time()),
        "videos": videos,
    }
