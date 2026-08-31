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
from app.publisher_monitor.schemas import ChannelDailyStatus, PublisherDailySummaryResponse

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
