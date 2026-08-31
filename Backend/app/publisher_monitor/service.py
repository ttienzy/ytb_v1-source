import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.core.config import TOOLS_DIR
from app.core.storage import read_config
from app.externals.pippit.service import (
    _get_saved_tasks as get_pippit_saved_tasks,
    list_all_saved_accounts_tasks,
)
from app.externals.youtube.service import (
    get_saved_tasks as get_youtube_saved_tasks,
    get_status as get_youtube_status,
)
from app.publisher_monitor.schemas import (
    CalendarEvent,
    CalendarEventsResponse,
    ChannelDailyStatus,
    PublisherDailySummaryResponse,
)

logger = logging.getLogger(__name__)

# Múi giờ Việt Nam GMT+7
VN_TZ = timezone(timedelta(hours=7))
PIPPIT_TASKS_FILE = TOOLS_DIR / "Backend" / "Data" / "pippit_tasks.json"


def _parse_to_vn_date(val: Any) -> tuple[str | None, datetime | None]:
    """Chuyển đổi linh hoạt mọi định dạng thời gian (epoch ms, epoch sec, ISO string) sang ngày YYYY-MM-DD theo giờ VN."""
    if val is None or val == "":
        return None, None
    try:
        # Nếu là số nguyên / số thực (epoch ms hoặc epoch s)
        if isinstance(val, (int, float)):
            ts = val / 1000.0 if val > 1e11 else float(val)
            dt = datetime.fromtimestamp(ts, tz=VN_TZ)
            return dt.strftime("%Y-%m-%d"), dt

        val_str = str(val).strip()
        # Chuỗi thuần số (epoch ms / s dạng text)
        if val_str.isdigit():
            num = int(val_str)
            ts = num / 1000.0 if num > 1e11 else float(num)
            dt = datetime.fromtimestamp(ts, tz=VN_TZ)
            return dt.strftime("%Y-%m-%d"), dt

        # Chuỗi ISO 8601
        clean_str = val_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_vn = dt.astimezone(VN_TZ)
        return dt_vn.strftime("%Y-%m-%d"), dt_vn
    except Exception:
        val_str = str(val)
        if len(val_str) >= 10 and val_str[4] == "-" and val_str[7] == "-":
            return val_str[:10], None
        return None, None


def get_daily_publishing_summary(force_sync: bool = False) -> PublisherDailySummaryResponse:
    """Quét toàn bộ các kênh YouTube, TikTok và Facebook Fanpage để báo cáo trạng thái đăng bài hôm nay."""
    now_vn = datetime.now(VN_TZ)
    today_str = now_vn.strftime("%Y-%m-%d")
    tomorrow_str = (now_vn + timedelta(days=1)).strftime("%Y-%m-%d")

    channels_status: list[ChannelDailyStatus] = []

    # ──────────────────────────────────────────────────────────────────────────
    # 1. Quét Kênh YouTube
    # ──────────────────────────────────────────────────────────────────────────
    yt_status = get_youtube_status()
    if yt_status and yt_status.connected:
        yt_tasks = get_youtube_saved_tasks()
        valid_yt_tasks = [
            t for t in yt_tasks
            if t.get("status") in ["scheduled", "published", "public"]
        ]

        today_count = 0
        tomorrow_count = 0
        upcoming_total = 0
        dates_scheduled = set()
        next_dt: datetime | None = None
        latest_dt: datetime | None = None

        for t in valid_yt_tasks:
            pub_at = t.get("publish_at") or t.get("created_at")
            d_str, dt_vn = _parse_to_vn_date(pub_at)
            if not d_str:
                continue

            if d_str == today_str:
                today_count += 1
            elif d_str == tomorrow_str:
                tomorrow_count += 1

            if d_str >= today_str:
                upcoming_total += 1
                dates_scheduled.add(d_str)
                if dt_vn and dt_vn >= now_vn:
                    if next_dt is None or dt_vn < next_dt:
                        next_dt = dt_vn

            if dt_vn and (latest_dt is None or dt_vn > latest_dt):
                latest_dt = dt_vn

        buffer_days = len([d for d in dates_scheduled if d >= today_str])
        if today_count == 0:
            status = "unposted"
        elif upcoming_total <= 1 or buffer_days <= 1:
            status = "warning"
        else:
            status = "healthy"

        channels_status.append(
            ChannelDailyStatus(
                channel_id=yt_status.channel_id or "yt_main",
                channel_name=yt_status.channel_title or "Kênh YouTube",
                platform="youtube",
                account_email=yt_status.email,
                avatar_url=yt_status.channel_avatar_url or yt_status.avatar_url,
                status=status,
                today_count=today_count,
                tomorrow_count=tomorrow_count,
                upcoming_total=upcoming_total,
                latest_published_at=latest_dt.isoformat() if latest_dt else None,
                next_publish_at=next_dt.isoformat() if next_dt else None,
                buffer_days=buffer_days,
            )
        )

    # ──────────────────────────────────────────────────────────────────────────
    # 2. Quét Kênh TikTok & Fanpage Facebook qua Pippit (Có hỗ trợ Live Sync)
    # ──────────────────────────────────────────────────────────────────────────
    config = read_config()
    pippit_accounts = config.get("pippit", {}).get("accounts", [])

    if force_sync:
        try:
            # Đồng bộ trực tiếp với Pippit API từ máy chủ
            pippit_tasks = list_all_saved_accounts_tasks()
            # Lưu lại vào cache
            PIPPIT_TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
            PIPPIT_TASKS_FILE.write_text(json.dumps(pippit_tasks, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            logger.warning("[PublisherMonitor] Không thể live sync tasks từ Pippit API: %s", exc)
            pippit_tasks = get_pippit_saved_tasks()
    else:
        # Đọc từ cache (hoặc sync nhẹ nếu cache rỗng)
        pippit_tasks = get_pippit_saved_tasks()
        if not pippit_tasks:
            try:
                pippit_tasks = list_all_saved_accounts_tasks()
                PIPPIT_TASKS_FILE.write_text(json.dumps(pippit_tasks, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass

    # Tasks hợp lệ trong pippit: status in [1, 2, 3, "scheduled", "published", "success", "pending"]
    # (Loại trừ 4 = failed, 6 = cancelled)
    valid_pippit_tasks = [
        t for t in pippit_tasks
        if t.get("status") not in [4, 6, "4", "6", "failed", "cancelled", "error"]
    ]

    for acc in pippit_accounts:
        acc_email = acc.get("email")
        
        # 2A. TikTok Channels
        for tt in acc.get("tiktok_channels", []):
            ch_id = str(tt.get("channel_id") or tt.get("page_id") or "").strip()
            ch_name = tt.get("nickname") or tt.get("name") or "Kênh TikTok"
            ch_avatar = tt.get("avatar_url")
            ch_status = tt.get("status")

            if not ch_id or ch_status == "empty":
                continue

            today_count = 0
            tomorrow_count = 0
            upcoming_total = 0
            dates_scheduled = set()
            next_dt: datetime | None = None
            latest_dt: datetime | None = None

            for t in valid_pippit_tasks:
                t_plat = t.get("platform")
                t_pid = str(t.get("page_id") or t.get("channel_id") or "").strip()
                t_pname = (t.get("page_name") or "").strip().lower()

                if t_plat == "tiktok" and (t_pid == ch_id or t_pname == ch_name.lower()):
                    raw_time = t.get("schedule_time_ms") or t.get("publish_at") or t.get("created_at") or t.get("create_time_ms")
                    d_str, dt_vn = _parse_to_vn_date(raw_time)
                    if not d_str:
                        continue

                    if d_str == today_str:
                        today_count += 1
                    elif d_str == tomorrow_str:
                        tomorrow_count += 1

                    if d_str >= today_str:
                        upcoming_total += 1
                        dates_scheduled.add(d_str)
                        if dt_vn and dt_vn >= now_vn:
                            if next_dt is None or dt_vn < next_dt:
                                next_dt = dt_vn

                    if dt_vn and (latest_dt is None or dt_vn > latest_dt):
                        latest_dt = dt_vn

            buffer_days = len([d for d in dates_scheduled if d >= today_str])
            if today_count == 0:
                status = "unposted"
            elif upcoming_total <= 1 or buffer_days <= 1:
                status = "warning"
            else:
                status = "healthy"

            channels_status.append(
                ChannelDailyStatus(
                    channel_id=ch_id,
                    channel_name=ch_name,
                    platform="tiktok",
                    account_email=acc_email,
                    avatar_url=ch_avatar,
                    status=status,
                    today_count=today_count,
                    tomorrow_count=tomorrow_count,
                    upcoming_total=upcoming_total,
                    latest_published_at=latest_dt.isoformat() if latest_dt else None,
                    next_publish_at=next_dt.isoformat() if next_dt else None,
                    buffer_days=buffer_days,
                )
            )

        # 2B. Facebook Fanpages
        for fb in acc.get("facebook_pages", acc.get("pages", [])):
            page_id = str(fb.get("page_id") or "").strip()
            page_name = fb.get("page_name") or fb.get("name") or "Facebook Fanpage"
            page_avatar = fb.get("avatar_url")
            page_status = fb.get("status")

            if not page_id or page_status == "empty" or "Chưa gán" in page_name:
                continue

            today_count = 0
            tomorrow_count = 0
            upcoming_total = 0
            dates_scheduled = set()
            next_dt: datetime | None = None
            latest_dt: datetime | None = None

            for t in valid_pippit_tasks:
                t_plat = t.get("platform")
                t_pid = str(t.get("page_id") or "").strip()
                t_pname = (t.get("page_name") or "").strip().lower()

                if (t_plat == "facebook" or not t_plat or t_plat != "tiktok") and (t_pid == page_id or t_pname == page_name.lower()):
                    raw_time = t.get("schedule_time_ms") or t.get("publish_at") or t.get("created_at") or t.get("create_time_ms")
                    d_str, dt_vn = _parse_to_vn_date(raw_time)
                    if not d_str:
                        continue

                    if d_str == today_str:
                        today_count += 1
                    elif d_str == tomorrow_str:
                        tomorrow_count += 1

                    if d_str >= today_str:
                        upcoming_total += 1
                        dates_scheduled.add(d_str)
                        if dt_vn and dt_vn >= now_vn:
                            if next_dt is None or dt_vn < next_dt:
                                next_dt = dt_vn

                    if dt_vn and (latest_dt is None or dt_vn > latest_dt):
                        latest_dt = dt_vn

            buffer_days = len([d for d in dates_scheduled if d >= today_str])
            if today_count == 0:
                status = "unposted"
            elif upcoming_total <= 1 or buffer_days <= 1:
                status = "warning"
            else:
                status = "healthy"

            channels_status.append(
                ChannelDailyStatus(
                    channel_id=page_id,
                    channel_name=page_name,
                    platform="facebook",
                    account_email=acc_email,
                    avatar_url=page_avatar,
                    status=status,
                    today_count=today_count,
                    tomorrow_count=tomorrow_count,
                    upcoming_total=upcoming_total,
                    latest_published_at=latest_dt.isoformat() if latest_dt else None,
                    next_publish_at=next_dt.isoformat() if next_dt else None,
                    buffer_days=buffer_days,
                )
            )

    unposted_count = sum(1 for c in channels_status if c.status == "unposted")
    warning_count = sum(1 for c in channels_status if c.status == "warning")
    healthy_count = sum(1 for c in channels_status if c.status == "healthy")

    return PublisherDailySummaryResponse(
        date=today_str,
        total_channels=len(channels_status),
        unposted_count=unposted_count,
        warning_count=warning_count,
        healthy_count=healthy_count,
        channels=channels_status,
    )


def get_calendar_events(month: str | None = None, force_sync: bool = False) -> CalendarEventsResponse:
    """Tổng hợp toàn bộ sự kiện lịch phát sóng từ TikTok, Facebook, YouTube và Studio."""
    if force_sync:
        try:
            pippit_tasks = list_all_saved_accounts_tasks()
            PIPPIT_TASKS_FILE.write_text(json.dumps(pippit_tasks, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pippit_tasks = get_pippit_saved_tasks()
    else:
        pippit_tasks = get_pippit_saved_tasks()
        if not pippit_tasks:
            try:
                pippit_tasks = list_all_saved_accounts_tasks()
                PIPPIT_TASKS_FILE.write_text(json.dumps(pippit_tasks, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass

    yt_tasks = get_youtube_saved_tasks()
    yt_status = get_youtube_status()
    default_yt_channel_name = getattr(yt_status, "channel_title", None) or "YouTube"

    now_vn = datetime.now(VN_TZ)
    all_events: list[CalendarEvent] = []
    seen_channels: dict[str, dict] = {}

    # 1. Pippit Tasks (TikTok + Facebook)
    for t in pippit_tasks:
        raw_time = t.get("schedule_time_ms") or t.get("publish_at") or t.get("created_at") or t.get("create_time_ms")
        d_str, dt_vn = _parse_to_vn_date(raw_time)
        if not d_str:
            continue

        plat = t.get("platform") or "facebook"
        if plat not in ["tiktok", "facebook"]:
            plat = "facebook"
        pname = t.get("page_name") or t.get("page_id") or ("TikTok" if plat == "tiktok" else "Facebook Fanpage")
        pid = str(t.get("page_id") or t.get("channel_id") or "")
        tid = str(t.get("task_id") or id(t))

        # Status normalizer (có kiểm tra mốc thời gian thực hiện tại theo giờ VN)
        if t.get("status") in [4, 6, "4", "6", "failed", "cancelled", "error"] or t.get("failed_reason"):
            st = "failed"
        elif dt_vn and dt_vn > now_vn:
            st = "scheduled"
        else:
            if t.get("published") or t.get("status") in [3, "3", "published"]:
                st = "published"
            else:
                st = "published" if t.get("status") in [1, "1"] else "scheduled"

        ch_key = f"{plat}_{pname}"
        if ch_key not in seen_channels:
            seen_channels[ch_key] = {
                "key": ch_key,
                "platform": plat,
                "name": pname,
                "id": pid,
            }

        all_events.append(
            CalendarEvent(
                id=tid,
                title=t.get("title") or t.get("file_name") or f"Video {pname}",
                platform=plat,
                channel_name=pname,
                channel_id=pid,
                account_email=t.get("account_email"),
                publish_at=dt_vn.isoformat() if dt_vn else None,
                date=d_str,
                time=dt_vn.strftime("%H:%M") if dt_vn else "00:00",
                status=st,
                post_url=t.get("post_url"),
                thumbnail_url=t.get("cover_url") or t.get("thumbnail_url"),
                failed_reason=t.get("failed_reason"),
                file_name=t.get("file_name"),
                raw_time_ms=int(t.get("schedule_time_ms") or 0) if t.get("schedule_time_ms") else None,
            )
        )

    # 2. YouTube Tasks
    for t in yt_tasks:
        raw_time = t.get("publish_at") or t.get("created_at")
        d_str, dt_vn = _parse_to_vn_date(raw_time)
        if not d_str:
            continue

        pname = t.get("channel_title") or default_yt_channel_name
        tid = str(t.get("task_id") or t.get("id") or id(t))

        # Status normalizer (chỉ coi là published khi mốc publish_at đã trôi qua trong quá khứ)
        if t.get("status") in ["failed", "error"] or t.get("error"):
            st = "failed"
        elif dt_vn and dt_vn > now_vn:
            st = "scheduled"
        else:
            st = "published"

        ch_key = f"youtube_{pname}"
        if ch_key not in seen_channels:
            seen_channels[ch_key] = {
                "key": ch_key,
                "platform": "youtube",
                "name": pname,
                "id": str(t.get("video_id") or ""),
            }

        all_events.append(
            CalendarEvent(
                id=tid,
                title=t.get("title") or t.get("file_name") or "YouTube Short Video",
                platform="youtube",
                channel_name=pname,
                channel_id=str(t.get("video_id") or ""),
                account_email=None,
                publish_at=dt_vn.isoformat() if dt_vn else None,
                date=d_str,
                time=dt_vn.strftime("%H:%M") if dt_vn else "00:00",
                status=st,
                post_url=t.get("youtube_url"),
                thumbnail_url=t.get("thumbnail_url"),
                failed_reason=t.get("error"),
                file_name=t.get("file_name"),
                raw_time_ms=None,
            )
        )

    # Sắp xếp và Khử trùng lặp (Deduplicate events)
    # Khóa nhận diện trùng: (platform, channel_name, date, time, title) hoặc (platform, channel_name, video_id/task_id)
    dedup_map: dict[str, CalendarEvent] = {}
    for ev in all_events:
        t_clean = ev.title.strip().lower()
        dedup_key = f"{ev.platform}_{ev.channel_name}_{ev.date}_{ev.time}_{t_clean}"
        if dedup_key not in dedup_map:
            dedup_map[dedup_key] = ev
        else:
            # Ưu tiên scheduled/published hơn là failed
            existing = dedup_map[dedup_key]
            if existing.status == "failed" and ev.status != "failed":
                dedup_map[dedup_key] = ev

    clean_events = list(dedup_map.values())
    clean_events.sort(key=lambda x: f"{x.date} {x.time}")

    # Lọc theo tháng nếu có yêu cầu
    filtered_events = clean_events
    if month and month != "all" and len(month) == 7:
        filtered_events = [e for e in clean_events if e.date.startswith(month)]

    scheduled_count = sum(1 for e in filtered_events if e.status == "scheduled")
    published_count = sum(1 for e in filtered_events if e.status == "published")
    failed_count = sum(1 for e in filtered_events if e.status == "failed")

    return CalendarEventsResponse(
        month=month or "all",
        total_events=len(filtered_events),
        scheduled_count=scheduled_count,
        published_count=published_count,
        failed_count=failed_count,
        channels_list=list(seen_channels.values()),
        events=filtered_events,
    )
