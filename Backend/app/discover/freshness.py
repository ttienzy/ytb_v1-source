"""Ngày đăng & đánh dấu video "mới" cho Discover.

yt-dlp ở chế độ --flat-playlist không trả ngày đăng, nên:
  * Ngày CHÍNH XÁC lấy từ RSS của kênh (15 video mới nhất, có `published`).
  * Các video cũ hơn dùng ngày XẤP XỈ của yt-dlp (`youtubetab:approximate_date`, độ chính xác theo ngày/tháng).

"Mới" = video lần đầu xuất hiện trong một lần quét SAU lần quét đầu tiên của kênh đó
(lần quét đầu chỉ lập mốc, không có video nào bị coi là mới) và chưa quá NEW_WINDOW_SECONDS.
Sổ ghi nhớ nằm ở Backend/Data/discover_seen.json.
"""
from __future__ import annotations

import json
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

from app.core.config import TOOLS_DIR
from app.discover.history import format_relative_time

SEEN_FILE = TOOLS_DIR / "Backend" / "Data" / "discover_seen.json"
NEW_WINDOW_SECONDS = 7 * 86400
MAX_SEEN_PER_CHANNEL = 600
RSS_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={cid}"

_ATOM = "{http://www.w3.org/2005/Atom}"
_YT = "{http://www.youtube.com/xml/schemas/2015}"


# ── Ngày đăng ────────────────────────────────────────────────────────────────

def _parse_iso(value: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except Exception:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_rss_published(xml_text: str) -> dict[str, str]:
    """video_id -> ISO `published` từ nội dung feed Atom của YouTube."""
    out: dict[str, str] = {}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for entry in root.iter(f"{_ATOM}entry"):
        vid = (entry.findtext(f"{_YT}videoId") or "").strip()
        published = (entry.findtext(f"{_ATOM}published") or "").strip()
        if vid and published and _parse_iso(published):
            out[vid] = published
    return out


def fetch_rss_published(channel_id: str, timeout: float = 8.0) -> dict[str, str]:
    """Lấy ngày đăng chính xác của ~15 video mới nhất. Lỗi mạng -> {} (không chặn việc quét)."""
    if not channel_id:
        return {}
    try:
        req = urllib.request.Request(
            RSS_URL.format(cid=channel_id), headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return parse_rss_published(resp.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        print(f"[Discover] RSS published dates unavailable: {exc}")
        return {}


def resolve_published(
    video_id: str, rss_map: dict[str, str], approx_timestamp: int | float | None
) -> tuple[str, bool]:
    """(ISO, exact). Ưu tiên RSS; không có thì dùng timestamp xấp xỉ của yt-dlp; không có nữa -> ("", False)."""
    if video_id in rss_map:
        return rss_map[video_id], True
    if approx_timestamp:
        try:
            return datetime.fromtimestamp(float(approx_timestamp), timezone.utc).isoformat(), False
        except (OverflowError, OSError, ValueError):
            pass
    return "", False


def published_label(iso: str, exact: bool, now: datetime | None = None) -> str:
    """Nhãn thân thiện. Ngày xấp xỉ có tiền tố "~" và chỉ chính xác tới ngày."""
    if not iso:
        return ""
    if exact:
        return format_relative_time(iso)
    dt = _parse_iso(iso)
    if not dt:
        return ""
    days = max(0, ((now or datetime.now(timezone.utc)) - dt).days)
    if days == 0:
        return "~Hôm nay"
    if days < 30:
        return f"~{days} ngày trước"
    if days < 365:
        return f"~{days // 30} tháng trước"
    return f"~{days // 365} năm trước"


def to_upload_date(iso: str) -> str:
    """ISO -> YYYYMMDD (cùng định dạng upload_date của yt-dlp)."""
    dt = _parse_iso(iso) if iso else None
    return dt.strftime("%Y%m%d") if dt else ""


# ── Sổ video đã thấy ─────────────────────────────────────────────────────────

def _read() -> dict[str, Any]:
    if not SEEN_FILE.exists():
        return {}
    try:
        data = json.loads(SEEN_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _write(store: dict[str, Any]) -> None:
    SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    SEEN_FILE.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")


def register_scan(
    channel_key: str,
    video_ids: list[str],
    *,
    record: bool,
    now: int | None = None,
) -> dict[str, Any]:
    """Đối chiếu danh sách video vừa quét với sổ đã thấy.

    record=False (ví dụ "Tải thêm" các video cũ) chỉ đọc, không ghi sổ — nếu không video cũ
    sẽ bị gắn nhãn mới nhầm.

    Trả về: new_ids (set), new_in_scan, first_scan, previous_scan_at.
    """
    ts_now = int(now if now is not None else time.time())
    store = _read()
    rec = store.get(channel_key)
    first = rec is None
    if first:
        rec = {"last_scan_at": None, "videos": {}}
    videos: dict[str, int] = rec.setdefault("videos", {})
    previous = rec.get("last_scan_at")
    new_in_scan = 0

    if record:
        for vid in video_ids:
            if vid and vid not in videos:
                # 0 = video có sẵn ở lần quét đầu (mốc) → không bao giờ là "mới".
                videos[vid] = 0 if first else ts_now
                if not first:
                    new_in_scan += 1
        rec["last_scan_at"] = ts_now
        if len(videos) > MAX_SEEN_PER_CHANNEL:
            keep = sorted(videos.items(), key=lambda kv: kv[1], reverse=True)[:MAX_SEEN_PER_CHANNEL]
            rec["videos"] = dict(keep)
            videos = rec["videos"]
        store[channel_key] = rec
        _write(store)

    new_ids = {
        vid for vid in video_ids
        if videos.get(vid, 0) and ts_now - videos[vid] <= NEW_WINDOW_SECONDS
    }
    return {
        "new_ids": new_ids,
        "new_in_scan": new_in_scan,
        "first_scan": first and record,
        "previous_scan_at": previous,
    }
