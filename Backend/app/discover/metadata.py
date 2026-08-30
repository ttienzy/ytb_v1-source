"""Live YouTube Metadata Extractor and 24h Caching System."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from typing import Any

from app.core.config import TOOLS_DIR

CHANNELS_CACHE_FILE = TOOLS_DIR / "Backend" / "Data" / "channels_cache.json"
CACHE_TTL_SECONDS = 86400  # 24 Hours


def read_cache() -> dict[str, Any]:
    if not CHANNELS_CACHE_FILE.exists():
        return {}
    try:
        data = json.loads(CHANNELS_CACHE_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def write_cache(cache: dict[str, Any]) -> None:
    CHANNELS_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHANNELS_CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def format_subscribers(subs: int | float | None) -> str:
    if not subs or subs <= 0:
        return ""
    s = int(subs)
    if s >= 1_000_000:
        val = s / 1_000_000
        return f"{val:.1f}M".replace(".0M", "M")
    if s >= 1_000:
        return f"{s / 1_000:.0f}K"
    return str(s)


def format_duration(seconds: int | float | None) -> str:
    if not seconds or seconds <= 0:
        return "—"
    sec = int(seconds)
    m, s = divmod(sec, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def format_views(views: int | float | None) -> str:
    if not views or views <= 0:
        return "—"
    v = int(views)
    if v >= 1_000_000:
        val = v / 1_000_000
        return f"{val:.1f}M lượt xem".replace(".0M", "M")
    if v >= 1_000:
        return f"{v / 1_000:.0f}K lượt xem"
    return f"{v} lượt xem"


def fetch_live_channel_metadata(handle_or_url: str) -> dict[str, Any]:
    """Quét metadata thực tế 100% từ YouTube thông qua yt-dlp (Không tốn quota)."""
    raw = handle_or_url.strip()
    if not raw.startswith("http"):
        handle = raw if raw.startswith("@") else f"@{raw}"
        url = f"https://www.youtube.com/{handle}/videos"
    else:
        url = raw.rstrip("/")
        if not url.endswith("/videos"):
            url = f"{url}/videos"

    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-end",
        "1",
        "--no-warnings",
        url,
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
        if proc.returncode == 0 and proc.stdout:
            data = json.loads(proc.stdout)
            name = data.get("channel") or data.get("uploader") or data.get("title") or handle_or_url
            channel_id = data.get("channel_id") or data.get("id") or ""
            subs_count = data.get("channel_follower_count")
            avatar_url = ""
            for thumb in reversed(data.get("thumbnails") or []):
                if thumb.get("id") == "avatar_uncropped" or thumb.get("id") == "7" or (thumb.get("width") == thumb.get("height") and thumb.get("width", 0) > 80):
                    avatar_url = thumb.get("url")
                    break

            return {
                "name": name,
                "channel_id": channel_id,
                "avatar_url": avatar_url,
                "subscribers": format_subscribers(subs_count),
                "subscribers_count": subs_count,
                "verified": data.get("channel_is_verified", False),
                "fetched_at": int(time.time()),
            }
    except Exception as exc:
        print(f"[Discover Metadata] Fetch live metadata failed for {handle_or_url}: {exc}")

    return {}
