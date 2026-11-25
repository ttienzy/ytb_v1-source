import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from app.core.config import TOOLS_DIR
from app.core.storage import read_config, write_config
from app.externals.pippit import client, sources
from app.externals.pippit.client import PippitAuthError, PippitClient, PippitError
from app.externals.pippit.schemas import (
    FacebookPageSlot,
    TikTokChannelSlot,
    PippitAccountOut,
    PippitBulkScheduleItem,
    PippitBulkScheduleRequest,
    PippitBulkScheduleResponse,
    PippitBulkScheduleResultItem,
    PippitLoginSyncRequest,
    PippitPublishRequest,
    PippitPublishResponse,
    PippitScheduleTaskOut,
)

PIPPIT_TASKS_FILE = TOOLS_DIR / "Backend" / "Data" / "pippit_tasks.json"

# Mọi thao tác đọc-sửa-ghi pippit_tasks.json đi qua lock này (FastAPI chạy các
# endpoint sync trong threadpool, đăng bài và đồng bộ có thể chạy cùng lúc).
_TASKS_LOCK = threading.RLock()
_SYNC_WORKERS = 4

# Trường lấy từ Pippit (nguồn sự thật về trạng thái) khi task có trong kết quả live.
_LIVE_STATUS_FIELDS = ("status", "published", "failed_reason")
# Trường live chỉ dùng để lấp chỗ trống, không ghi đè dữ liệu local (tiêu đề gốc...).
_LIVE_FILL_FIELDS = ("post_url", "post_id", "page_name", "handle", "cover_url", "platform", "page_id", "schedule_time_ms")


def _get_saved_tasks() -> list[dict]:
    """Đọc lịch sử các task đã đăng/lên lịch từ pippit_tasks.json."""
    if not PIPPIT_TASKS_FILE.exists():
        return []
    try:
        data = json.loads(PIPPIT_TASKS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_tasks(tasks: list[dict]) -> None:
    """Ghi nguyên tử (file tạm + replace) để không để lại JSON hỏng khi bị ngắt giữa chừng."""
    PIPPIT_TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = PIPPIT_TASKS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, PIPPIT_TASKS_FILE)


def _save_task_record(task_data: dict) -> None:
    """Lưu 1 task bài đăng vào pippit_tasks.json."""
    with _TASKS_LOCK:
        tasks = _get_saved_tasks()
        tid = task_data.get("task_id")
        idx = next((i for i, t in enumerate(tasks) if t.get("task_id") == tid), -1) if tid else -1
        if idx >= 0:
            tasks[idx].update(task_data)
        else:
            tasks.insert(0, task_data)
        try:
            _write_tasks(tasks)
        except Exception as exc:
            print(f"[Pippit] Không thể lưu task record: {exc}")


def compose_final_caption(title: str, caption: str, prepend_title: bool = False) -> str:
    """Nội dung bài đăng cuối cùng.

    Mặc định tôn trọng đúng `caption` người dùng đã soạn (không nhồi tiêu đề/tên file lên đầu); chỉ dùng tiêu đề khi
    caption rỗng, hoặc khi `prepend_title=True` (hành vi cũ của luồng đăng lẻ).
    """
    title_clean = (title or "").strip()
    caption_clean = (caption or "").strip()
    if not caption_clean:
        return title_clean
    if prepend_title and title_clean and not caption_clean.startswith(title_clean):
        return f"{title_clean}\n\n{caption_clean}"
    return caption_clean


def get_saved_pippit_accounts() -> list[dict]:
    """Lấy danh sách các tài khoản Pippit đã lưu trong config.json."""
    config = read_config()
    return config.get("pippit", {}).get("accounts", [])


def _save_pippit_accounts(accounts: list[dict]) -> None:
    """Lưu danh sách tài khoản Pippit vào config.json."""
    config = read_config()
    if "pippit" not in config:
        config["pippit"] = {}
    config["pippit"]["accounts"] = accounts
    write_config(config)


def _format_facebook_slots(real_pages: list[dict]) -> list[dict]:
    """Định dạng danh sách Facebook Pages thành 3 slot quản lý chuẩn."""
    slots = []
    for i, p in enumerate(real_pages[:3]):
        page_id = str(p.get("platform_user_id") or p.get("id") or "")
        name = p.get("nickname") or p.get("name") or p.get("page_name") or f"Page {i+1}"
        avatar = p.get("avatar_url") or p.get("avatar") or ""
        un_expired = p.get("un_expired", True)
        slots.append({
            "page_id": page_id,
            "page_name": name,
            "avatar_url": avatar,
            "status": "connected" if page_id else "empty",
            "un_expired": un_expired,
        })

    while len(slots) < 3:
        idx = len(slots) + 1
        slots.append({
            "page_id": "",
            "page_name": f"Slot {idx} (Chưa gán Fanpage)",
            "avatar_url": "",
            "status": "empty",
            "un_expired": True,
        })
    return slots


def _format_tiktok_slots(real_channels: list[dict]) -> list[dict]:
    """Định dạng danh sách TikTok Channels thành danh sách slot quản lý."""
    slots = []
    for i, c in enumerate(real_channels):
        channel_id = str(c.get("platform_user_id") or c.get("id") or "")
        name = c.get("nickname") or c.get("name") or c.get("username") or f"TikTok {i+1}"
        handle = c.get("handle") or c.get("unique_id") or ""
        avatar = c.get("avatar_url") or c.get("avatar") or ""
        un_expired = c.get("un_expired", True)
        slots.append({
            "channel_id": channel_id,
            "nickname": name,
            "handle": handle,
            "avatar_url": avatar,
            "status": "connected" if channel_id else "empty",
            "un_expired": un_expired,
        })
    return slots


def login_and_sync_account(payload: PippitLoginSyncRequest) -> PippitAccountOut:
    """Đăng nhập Pure HTTP bằng email + mật khẩu, lấy workspace_id và kéo Real Facebook & TikTok."""
    clean_email = payload.email.strip().lower()
    password = payload.password.strip()
    proxy = payload.proxy.strip()

    try:
        auth_data = client.login(clean_email, password, proxy=proxy)
    except PippitAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi đăng nhập Pippit: {exc}") from exc

    cookies = auth_data["cookies"]
    workspace_id = auth_data["workspace_id"]
    user_id = auth_data["user_id"]

    # Kéo Real Facebook Pages & TikTok Channels
    c = PippitClient(cookies=cookies, workspace_id=workspace_id, proxy=proxy)
    try:
        bound = c.bound_accounts()
        real_pages = bound.get("facebook", [])
        real_tiktoks = bound.get("tiktok", [])
    except Exception as exc:
        print(f"[Pippit] Không thể kéo bound accounts ({exc}), sử dụng slots rỗng.")
        real_pages = []
        real_tiktoks = []

    fb_slots = _format_facebook_slots(real_pages)
    tt_slots = _format_tiktok_slots(real_tiktoks)

    accounts = get_saved_pippit_accounts()
    account_id = f"pip_{clean_email.split('@')[0]}"

    existing_idx = next(
        (i for i, a in enumerate(accounts) if a.get("id") == account_id or a.get("email", "").lower() == clean_email),
        -1,
    )

    acc_record = {
        "id": account_id,
        "mailtm_id": payload.mailtm_id,
        "email": clean_email,
        "password": password,
        "user_id": user_id,
        "workspace_id": workspace_id,
        "cookies": cookies,
        "proxy": proxy,
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "facebook_pages": fb_slots,
        "tiktok_channels": tt_slots,
    }

    if existing_idx != -1:
        accounts[existing_idx] = acc_record
    else:
        accounts.insert(0, acc_record)

    _save_pippit_accounts(accounts)

    return PippitAccountOut(
        id=acc_record["id"],
        mailtm_id=acc_record["mailtm_id"],
        email=acc_record["email"],
        password=acc_record["password"],
        user_id=acc_record["user_id"],
        workspace_id=acc_record["workspace_id"],
        proxy=acc_record["proxy"],
        status=acc_record["status"],
        created_at=acc_record["created_at"],
        facebook_pages=[FacebookPageSlot(**p) for p in acc_record["facebook_pages"]],
        tiktok_channels=[TikTokChannelSlot(**t) for t in acc_record.get("tiktok_channels", [])],
    )


def refresh_account_pages(account_id: str) -> PippitAccountOut:
    """Quét lại danh sách Real Facebook Pages và TikTok Channels từ Pippit."""
    accounts = get_saved_pippit_accounts()
    acc = next((a for a in accounts if a.get("id") == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Pippit.")

    cookies = acc.get("cookies", "")
    workspace_id = acc.get("workspace_id", "")
    proxy = acc.get("proxy", "")
    email = acc.get("email", "")
    password = acc.get("password", "")

    c = PippitClient(cookies=cookies, workspace_id=workspace_id, proxy=proxy)
    try:
        bound = c.bound_accounts()
        real_pages = bound.get("facebook", [])
        real_tiktoks = bound.get("tiktok", [])
    except PippitAuthError:
        if email and password:
            try:
                auth = client.login(email, password, proxy=proxy)
                cookies = auth["cookies"]
                workspace_id = auth["workspace_id"]
                acc["cookies"] = cookies
                acc["workspace_id"] = workspace_id
                c = PippitClient(cookies=cookies, workspace_id=workspace_id, proxy=proxy)
                bound = c.bound_accounts()
                real_pages = bound.get("facebook", [])
                real_tiktoks = bound.get("tiktok", [])
            except Exception as exc:
                raise HTTPException(status_code=401, detail=f"Tự động đăng nhập lại thất bại: {exc}") from exc
        else:
            raise HTTPException(status_code=401, detail="Cookie hết hạn và không có mật khẩu để tự đăng nhập lại.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi quét tài khoản liên kết: {exc}") from exc

    acc["facebook_pages"] = _format_facebook_slots(real_pages)
    acc["tiktok_channels"] = _format_tiktok_slots(real_tiktoks)
    _save_pippit_accounts(accounts)

    return PippitAccountOut(
        id=acc["id"],
        mailtm_id=acc.get("mailtm_id"),
        email=acc["email"],
        password=acc.get("password", ""),
        user_id=acc.get("user_id"),
        workspace_id=acc.get("workspace_id"),
        proxy=acc.get("proxy", ""),
        status=acc.get("status", "active"),
        created_at=acc.get("created_at", ""),
        facebook_pages=[FacebookPageSlot(**p) for p in acc["facebook_pages"]],
        tiktok_channels=[TikTokChannelSlot(**t) for t in acc.get("tiktok_channels", [])],
    )


def publish_video_to_page(payload: PippitPublishRequest) -> PippitPublishResponse:
    """Quy trình upload file video lên Pippit Cloud và lên lịch đăng bài cho Facebook Page hoặc TikTok."""
    if not os.path.exists(payload.video_path):
        raise HTTPException(status_code=400, detail=f"File video không tồn tại: {payload.video_path}")

    accounts = get_saved_pippit_accounts()
    acc = next((a for a in accounts if a.get("id") == payload.account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Pippit.")

    cookies = acc.get("cookies", "")
    workspace_id = acc.get("workspace_id", "")
    proxy = acc.get("proxy", "")
    user_id = acc.get("user_id", "")

    if not cookies:
        raise HTTPException(status_code=400, detail="Tài khoản Pippit chưa có session cookies hợp lệ.")

    c = PippitClient(cookies=cookies, workspace_id=workspace_id, proxy=proxy, user_id=user_id)

    # 1. Upload video 5 bước
    try:
        upload_res = c.upload(payload.video_path)
    except PippitError as exc:
        raise HTTPException(status_code=500, detail=f"Upload video lên Cloud thất bại: {exc}") from exc

    asset_id = upload_res["asset_id"]

    # 2. Tính thời gian hẹn giờ (ms) làm tròn theo phút chẵn
    minutes = max(1, payload.when_minutes_ahead)
    now_sec = int(time.time())
    schedule_time_sec = ((now_sec // 60) + minutes) * 60
    schedule_time_ms = schedule_time_sec * 1000

    # 3. Chuẩn bị Tiêu đề & Caption
    title_clean = (payload.title or "").strip()
    caption_clean = (payload.caption or "").strip()

    if title_clean:
        if not caption_clean.startswith(title_clean):
            final_caption = f"{title_clean}\n\n{caption_clean}" if caption_clean else title_clean
        else:
            final_caption = caption_clean
    else:
        final_caption = caption_clean

    # 4. Xác định nền tảng (Facebook hay TikTok)
    target_platform = (payload.platform or "facebook").lower()
    target_name = ""

    # Kiểm tra target_id có trong tiktok_channels hay facebook_pages không
    is_tiktok = target_platform == "tiktok"
    if not is_tiktok:
        for t in acc.get("tiktok_channels", []):
            if str(t.get("channel_id")) == str(payload.page_id):
                is_tiktok = True
                target_name = t.get("nickname", "")
                break

    if is_tiktok:
        # Lên lịch TikTok
        try:
            task_id = c.schedule_tiktok(
                asset_id=asset_id,
                platform_user_id=str(payload.page_id),
                schedule_time_ms=schedule_time_ms,
                description=final_caption,
                title=title_clean,
                privacy_level=payload.privacy_level,
                allow_comment=payload.allow_comment,
                allow_duet=payload.allow_duet,
                allow_stitch=payload.allow_stitch,
            )
        except PippitError as exc:
            raise HTTPException(status_code=500, detail=f"Lên lịch TikTok thất bại: {exc}") from exc
        
        if not target_name:
            for t in acc.get("tiktok_channels", []):
                if str(t.get("channel_id")) == str(payload.page_id):
                    target_name = t.get("nickname", "")
                    break

        _save_task_record({
            "task_id": task_id,
            "asset_id": asset_id,
            "job_id": payload.job_id,
            "account_id": payload.account_id,
            "account_email": acc.get("email", ""),
            "page_id": str(payload.page_id),
            "page_name": target_name or f"TikTok {payload.page_id}",
            "platform": "tiktok",
            "title": title_clean,
            "description": final_caption,
            "schedule_time_ms": schedule_time_ms,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": 1,
            "published": False,
        })

        return PippitPublishResponse(
            ok=True,
            task_id=task_id,
            asset_id=asset_id,
            schedule_time_ms=schedule_time_ms,
            platform="tiktok",
            message=f"Đã lên lịch đăng video lên TikTok thành công (hẹn giờ sau +{minutes} phút)!",
        )

    # Lên lịch Facebook
    try:
        task_id = c.schedule_facebook(
            asset_id=asset_id,
            platform_user_id=str(payload.page_id),
            schedule_time_ms=schedule_time_ms,
            description=final_caption,
            title=title_clean,
        )
    except PippitError as exc:
        raise HTTPException(status_code=500, detail=f"Lên lịch Facebook thất bại: {exc}") from exc

    for p in acc.get("facebook_pages", []):
        if str(p.get("page_id")) == str(payload.page_id):
            target_name = p.get("page_name", "")
            break

    _save_task_record({
        "task_id": task_id,
        "asset_id": asset_id,
        "job_id": payload.job_id,
        "account_id": payload.account_id,
        "account_email": acc.get("email", ""),
        "page_id": str(payload.page_id),
        "page_name": target_name or f"Page {payload.page_id}",
        "platform": "facebook",
        "title": title_clean,
        "description": final_caption,
        "schedule_time_ms": schedule_time_ms,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": 1,
        "published": False,
    })

    return PippitPublishResponse(
        ok=True,
        task_id=task_id,
        asset_id=asset_id,
        schedule_time_ms=schedule_time_ms,
        platform="facebook",
        message=f"Đã lên lịch đăng bài lên Facebook Page thành công (hẹn giờ sau +{minutes} phút)!",
    )


def list_account_tasks(account_id: str) -> list[PippitScheduleTaskOut]:
    """Tra cứu danh sách các bài đăng đã lên lịch trên Pippit."""
    accounts = get_saved_pippit_accounts()
    acc = next((a for a in accounts if a.get("id") == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Pippit.")

    fb_ids, tt_ids = _account_target_ids(acc)
    try:
        tasks = _account_client(acc).list_schedule_tasks(page_ids=fb_ids, tiktok_ids=tt_ids)
        return [PippitScheduleTaskOut(**t) for t in tasks]
    except PippitAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lấy danh sách tasks thất bại: {exc}") from exc


# ---------------------------------------------------------------------------
# Đồng bộ lịch sử bài đăng (local cache pippit_tasks.json ⇄ Pippit live)
# ---------------------------------------------------------------------------
def _account_target_ids(acc: dict) -> tuple[list[str], list[str]]:
    fb_ids = [str(p.get("page_id")) for p in acc.get("facebook_pages", []) if p.get("page_id")]
    tt_ids = [str(t.get("channel_id")) for t in acc.get("tiktok_channels", []) if t.get("channel_id")]
    return fb_ids, tt_ids


def _account_client(acc: dict) -> PippitClient:
    return PippitClient(
        cookies=acc.get("cookies", ""),
        workspace_id=acc.get("workspace_id", ""),
        proxy=acc.get("proxy", ""),
        user_id=acc.get("user_id", ""),
    )


def _platform_index(accounts: list[dict]) -> dict[str, dict]:
    """page_id/channel_id -> {platform, name, handle, account_id, account_email} từ config."""
    idx: dict[str, dict] = {}
    for a in accounts:
        for p in a.get("facebook_pages", []):
            pid = str(p.get("page_id") or "").strip()
            if pid:
                idx[pid] = {
                    "platform": "facebook",
                    "name": p.get("page_name", ""),
                    "handle": "",
                    "account_id": a.get("id"),
                    "account_email": a.get("email"),
                }
        for t in a.get("tiktok_channels", []):
            cid = str(t.get("channel_id") or "").strip()
            if cid:
                idx[cid] = {
                    "platform": "tiktok",
                    "name": t.get("nickname", ""),
                    "handle": t.get("handle", ""),
                    "account_id": a.get("id"),
                    "account_email": a.get("email"),
                }
    return idx


def merge_task_lists(
    local_tasks: list[dict],
    live_tasks: dict[str, dict],
    accounts: list[dict],
    synced_at: str | None = None,
    synced_account_ids: set[str] | None = None,
    now_ms: int | None = None,
) -> list[dict]:
    """Gộp cache local với kết quả live (hàm thuần, không I/O).

    - Task có trong live: trạng thái lấy theo Pippit; các trường hiển thị chỉ lấp chỗ trống.
    - Task chỉ có live (đăng từ web Pippit): thêm mới.
    - Task cũ thiếu `platform`: suy ra từ page_id trong config tài khoản hoặc từ task khác cùng page.
    - Tài khoản trong `synced_account_ids` đồng bộ thành công mà Pippit không trả task (trong
      cửa sổ ±180 ngày Pippit quét) → `missing_on_pippit = True`.
    """
    pindex = _platform_index(accounts)
    synced_ids = synced_account_ids or set()
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    window_ms = 180 * 86400 * 1000
    merged: list[dict] = []
    seen: set[str] = set()

    for lt in local_tasks:
        t = dict(lt)
        tid = str(t.get("task_id") or "")
        if tid:
            if tid in seen:
                continue
            seen.add(tid)
        live = live_tasks.get(tid) if tid else None
        if not live and t.get("account_id") in synced_ids:
            sched = t.get("schedule_time_ms") or 0
            if not sched or abs(sched - now) < window_ms:
                t["missing_on_pippit"] = True
        if live:
            t.pop("missing_on_pippit", None)
            for f in _LIVE_STATUS_FIELDS:
                if f in live:
                    t[f] = live[f]
            for f in _LIVE_FILL_FIELDS:
                if live.get(f) and not t.get(f):
                    t[f] = live[f]
            # Link live luôn mới hơn (vd. link TikTok đã được sửa handle).
            if live.get("post_url"):
                t["post_url"] = live["post_url"]
            for f in ("account_id", "account_email"):
                if live.get(f) and not t.get(f):
                    t[f] = live[f]
            if synced_at:
                t["synced_at"] = synced_at
        merged.append(t)

    for tid, live in live_tasks.items():
        if tid and tid not in seen:
            t = dict(live)
            if synced_at:
                t["synced_at"] = synced_at
            merged.append(t)

    page_platform = {
        str(t.get("page_id")): t["platform"] for t in merged if t.get("page_id") and t.get("platform")
    }
    for t in merged:
        pid = str(t.get("page_id") or "")
        if not t.get("platform") and pid in page_platform:
            t["platform"] = page_platform[pid]
        info = pindex.get(pid)
        if info:
            if not t.get("platform"):
                t["platform"] = info["platform"]
            if not t.get("handle") and info["handle"]:
                t["handle"] = info["handle"]
            if not t.get("page_name") and info["name"]:
                t["page_name"] = info["name"]
            for f in ("account_id", "account_email"):
                if not t.get(f) and info.get(f):
                    t[f] = info[f]

    merged.sort(key=lambda x: x.get("schedule_time_ms") or 0, reverse=True)
    return merged


def _relogin_account(acc: dict) -> None:
    """Đăng nhập lại bằng mật khẩu đã lưu; cập nhật cookies/workspace_id trong `acc` (chưa ghi config)."""
    auth = client.login(acc.get("email", ""), acc.get("password", ""), proxy=acc.get("proxy", ""))
    acc["cookies"] = auth["cookies"]
    acc["workspace_id"] = auth["workspace_id"]
    if auth.get("user_id"):
        acc["user_id"] = auth["user_id"]


def _historic_target_ids(acc: dict, local_tasks: list[dict]) -> tuple[list[str], list[str]]:
    """Page/kênh từng đăng bằng tài khoản này theo cache local.

    Pippit vẫn trả task của page đã gỡ liên kết nếu hỏi đúng page_id (đã thử thật 11/2026),
    nên không chỉ hỏi các page đang gán trong config.
    """
    fb: list[str] = []
    tt: list[str] = []
    for t in local_tasks:
        if t.get("account_id") != acc.get("id"):
            continue
        pid = str(t.get("page_id") or "").strip()
        if not pid:
            continue
        target = tt if t.get("platform") == "tiktok" else fb
        if pid not in target:
            target.append(pid)
    return fb, tt


def _fetch_account_live_tasks(acc: dict, local_tasks: list[dict] | None = None) -> dict:
    """Lấy task live của một tài khoản. Không ném lỗi: trả về {tasks, ok, error, relogged}."""
    result = {
        "account_id": acc.get("id", ""),
        "account_email": acc.get("email", ""),
        "ok": False,
        "error": "",
        "relogged": False,
        "task_count": 0,
        "tasks": [],
    }
    fb_ids, tt_ids = _account_target_ids(acc)
    hist_fb, hist_tt = _historic_target_ids(acc, local_tasks or [])
    tt_ids += [i for i in hist_tt if i not in tt_ids]
    fb_ids += [i for i in hist_fb if i not in fb_ids and i not in tt_ids]
    if not fb_ids and not tt_ids:
        result["ok"] = True
        return result

    def _fetch() -> list[dict]:
        if not acc.get("cookies"):
            raise PippitAuthError("Tài khoản chưa có cookie đăng nhập.")
        return _account_client(acc).list_schedule_tasks(page_ids=fb_ids, tiktok_ids=tt_ids)

    try:
        try:
            tasks = _fetch()
        except PippitAuthError:
            if not (acc.get("email") and acc.get("password")):
                raise PippitAuthError("Cookie hết hạn và không có mật khẩu để tự đăng nhập lại.")
            _relogin_account(acc)
            result["relogged"] = True
            tasks = _fetch()
    except PippitAuthError as exc:
        result["error"] = f"Phiên đăng nhập Pippit hết hạn: {exc}"
        return result
    except Exception as exc:
        result["error"] = f"Không đồng bộ được: {exc}"
        return result

    for t in tasks:
        t["account_id"] = acc.get("id")
        t["account_email"] = acc.get("email")
    result.update(ok=True, tasks=tasks, task_count=len(tasks))
    return result


def _persist_relogged_cookies(relogged: list[dict]) -> None:
    """Ghi cookie mới cho các tài khoản vừa đăng nhập lại (đọc config mới nhất, chỉ vá đúng tài khoản)."""
    if not relogged:
        return
    fresh = get_saved_pippit_accounts()
    by_id = {a.get("id"): a for a in relogged}
    for a in fresh:
        src = by_id.get(a.get("id"))
        if src:
            for f in ("cookies", "workspace_id", "user_id"):
                if src.get(f):
                    a[f] = src[f]
    _save_pippit_accounts(fresh)


def sync_all_tasks() -> dict:
    """Đồng bộ live mọi tài khoản (song song), gộp với cache rồi ghi lại pippit_tasks.json."""
    accounts = get_saved_pippit_accounts()
    synced_at = datetime.now(timezone.utc).isoformat()

    local_snapshot = _get_saved_tasks()
    results: list[dict] = []
    if accounts:
        with ThreadPoolExecutor(max_workers=min(_SYNC_WORKERS, len(accounts))) as pool:
            results = list(pool.map(lambda a: _fetch_account_live_tasks(a, local_snapshot), accounts))

    try:
        _persist_relogged_cookies([a for a, r in zip(accounts, results) if r["relogged"] and r["ok"]])
    except Exception as exc:
        print(f"[Pippit] Không lưu được cookie mới sau khi đăng nhập lại: {exc}")

    live_map: dict[str, dict] = {}
    for r in results:
        for t in r["tasks"]:
            tid = str(t.get("task_id") or "")
            if tid:
                live_map[tid] = t

    with _TASKS_LOCK:
        merged = merge_task_lists(
            _get_saved_tasks(),
            live_map,
            accounts,
            synced_at=synced_at,
            synced_account_ids={r["account_id"] for r in results if r["ok"]},
        )
        try:
            _write_tasks(merged)
        except Exception as exc:
            print(f"[Pippit] Không thể ghi pippit_tasks.json sau đồng bộ: {exc}")

    return {
        "tasks": merged,
        "accounts": [{k: v for k, v in r.items() if k != "tasks"} for r in results],
        "synced_at": synced_at,
    }


def get_tasks_overview(sync: bool = False) -> dict:
    """Dữ liệu cho tab Lịch sử: `sync=False` đọc cache (nhanh), `sync=True` đồng bộ live."""
    if sync:
        return sync_all_tasks()
    accounts = get_saved_pippit_accounts()
    tasks = merge_task_lists(_get_saved_tasks(), {}, accounts)
    last = max((t.get("synced_at") or "" for t in tasks), default="") or None
    return {"tasks": tasks, "accounts": [], "synced_at": last}


def list_all_saved_accounts_tasks() -> list[dict]:
    """Lấy toàn bộ tasks (local cache + live sync từ Pippit); kết quả được ghi lại vào cache."""
    return sync_all_tasks()["tasks"]


def delete_pippit_account(account_id: str) -> dict:
    """Xóa tài khoản Pippit khỏi config.json."""
    accounts = get_saved_pippit_accounts()
    acc = next((a for a in accounts if a.get("id") == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Pippit để xóa.")

    new_accounts = [a for a in accounts if a.get("id") != account_id]
    _save_pippit_accounts(new_accounts)
    return {"ok": True, "message": f"Đã xóa tài khoản Pippit {acc.get('email')}"}


def get_all_active_facebook_pages() -> list[dict]:
    """Lấy danh sách tất cả các Facebook Page đang active trên toàn bộ tài khoản Pippit."""
    accounts = get_saved_pippit_accounts()
    active_pages = []
    seen_ids = set()
    for acc in accounts:
        for p in acc.get("facebook_pages", []):
            pid = str(p.get("page_id") or "").strip()
            pname = p.get("page_name", "")
            if pid and pid not in seen_ids and not pname.startswith("Slot "):
                seen_ids.add(pid)
                active_pages.append({
                    "page_id": pid,
                    "page_name": pname or f"Page {pid}",
                    "avatar_url": p.get("avatar_url", ""),
                    "status": p.get("status", "connected"),
                    "platform": "facebook",
                    "account_id": acc.get("id", ""),
                    "account_email": acc.get("email", ""),
                    "un_expired": p.get("un_expired", True),
                })
    return active_pages


def get_all_active_tiktok_channels() -> list[dict]:
    """Lấy danh sách tất cả các TikTok Channel đang active trên toàn bộ tài khoản Pippit."""
    accounts = get_saved_pippit_accounts()
    active_channels = []
    seen_ids = set()
    for acc in accounts:
        for t in acc.get("tiktok_channels", []):
            cid = str(t.get("channel_id") or "").strip()
            cname = t.get("nickname", "")
            if cid and cid not in seen_ids:
                seen_ids.add(cid)
                active_channels.append({
                    "channel_id": cid,
                    "nickname": cname or f"TikTok {cid}",
                    "handle": t.get("handle", ""),
                    "avatar_url": t.get("avatar_url", ""),
                    "status": t.get("status", "connected"),
                    "platform": "tiktok",
                    "account_id": acc.get("id", ""),
                    "account_email": acc.get("email", ""),
                    "un_expired": t.get("un_expired", True),
                })
    return active_channels


def get_all_active_channels() -> dict[str, list[dict]]:
    """Lấy danh sách tất cả kênh (Facebook + TikTok) đã kết nối trên Pippit."""
    return {
        "facebook_pages": get_all_active_facebook_pages(),
        "tiktok_channels": get_all_active_tiktok_channels(),
    }


def bulk_schedule_videos(payload: PippitBulkScheduleRequest) -> PippitBulkScheduleResponse:
    """Lên lịch hàng loạt video ngắn lên Facebook / TikTok qua Pippit."""
    accounts = get_saved_pippit_accounts()
    if not accounts:
        raise HTTPException(status_code=400, detail="Chưa có tài khoản Pippit nào được cấu hình.")

    clients_by_account: dict[str, PippitClient] = {}
    target_to_account: dict[str, dict] = {}
    target_name_map: dict[str, str] = {}
    target_platform_map: dict[str, str] = {}

    for a in accounts:
        for p in a.get("facebook_pages", []):
            pid = str(p.get("page_id") or "").strip()
            if pid:
                target_to_account[pid] = a
                target_name_map[pid] = p.get("page_name", f"Page {pid}")
                target_platform_map[pid] = "facebook"
        for t in a.get("tiktok_channels", []):
            cid = str(t.get("channel_id") or "").strip()
            if cid:
                target_to_account[cid] = a
                target_name_map[cid] = t.get("nickname", f"TikTok {cid}")
                target_platform_map[cid] = "tiktok"

    default_acc = next((a for a in accounts if a["id"] == payload.account_id), accounts[0])

    def _get_client_for_target(target_id: str) -> tuple[PippitClient, dict]:
        target_acc = target_to_account.get(str(target_id)) or default_acc
        acc_id = target_acc.get("id", "default")
        if acc_id not in clients_by_account:
            if not target_acc.get("cookies", ""):
                raise ValueError(f"Tài khoản {target_acc.get('email')} thiếu cookie đăng nhập.")
            # Cần workspace_id + user_id (consumer_uid) giống luồng đăng lẻ.
            clients_by_account[acc_id] = _account_client(target_acc)
        return clients_by_account[acc_id], target_acc

    results: list[PippitBulkScheduleResultItem] = []
    success_count = 0
    failed_count = 0

    from app.externals.gdrive import service as gdrive_service

    for item in payload.items:
        plat = target_platform_map.get(str(item.page_id), item.platform or "facebook")
        res_item = PippitBulkScheduleResultItem(
            file_name=item.file_name,
            page_id=str(item.page_id),
            page_name=target_name_map.get(str(item.page_id), f"{plat.capitalize()} {item.page_id}"),
            platform=plat,
            schedule_time_ms=item.schedule_time_ms,
        )

        local_file: Path | None = None
        is_temp = False

        try:
            c, acc = _get_client_for_target(str(item.page_id))

            if item.file_path:
                local_file = sources.assert_allowed_video_path(item.file_path)
            elif item.file_id:
                local_file = gdrive_service.download_video_temp(item.file_id, custom_name=item.file_name)
                is_temp = True
            else:
                raise ValueError("Thiếu file_id hoặc file_path hợp lệ.")

            if not local_file or not local_file.exists() or local_file.stat().st_size == 0:
                raise ValueError(f"Không thể đọc file video: {item.file_name}")

            title_clean = (item.title or "").strip()
            final_caption = compose_final_caption(title_clean, item.caption, item.prepend_title)

            def _upload_and_schedule(client_: PippitClient) -> tuple[str, str]:
                asset = client_.upload(str(local_file))["asset_id"]
                res_item.asset_id = asset
                if plat == "tiktok":
                    tid = client_.schedule_tiktok(
                        asset_id=asset,
                        platform_user_id=str(item.page_id),
                        schedule_time_ms=item.schedule_time_ms,
                        description=final_caption,
                        title=title_clean,
                        privacy_level=item.privacy_level,
                        allow_comment=item.allow_comment,
                        allow_duet=item.allow_duet,
                        allow_stitch=item.allow_stitch,
                    )
                else:
                    tid = client_.schedule_facebook(
                        asset_id=asset,
                        platform_user_id=str(item.page_id),
                        schedule_time_ms=item.schedule_time_ms,
                        description=final_caption,
                        title=title_clean,
                    )
                return asset, tid

            try:
                asset_id, task_id = _upload_and_schedule(c)
            except PippitAuthError:
                # Cookie hết hạn giữa lượt: đăng nhập lại ĐÚNG MỘT lần rồi làm lại video này (upload chưa tạo task nên không trùng).
                if not (acc.get("email") and acc.get("password")):
                    raise
                _relogin_account(acc)
                _persist_relogged_cookies([acc])
                clients_by_account[acc.get("id", "default")] = c = _account_client(acc)
                asset_id, task_id = _upload_and_schedule(c)

            if not task_id:
                # Không lưu bản ghi "mồ côi"; nếu Pippit thật ra đã tạo task, lần đồng bộ sau sẽ kéo về.
                raise ValueError(
                    "Pippit không trả task id nên chưa xác nhận được lịch. "
                    "Bấm Đồng bộ ở tab Lịch đã đặt để kiểm tra trước khi đặt lại."
                )

            res_item.task_id = task_id
            res_item.ok = True
            success_count += 1

            _save_task_record({
                "task_id": task_id,
                "asset_id": asset_id,
                "job_id": None,
                "account_id": acc.get("id") or payload.account_id,
                "account_email": acc.get("email", ""),
                "page_id": str(item.page_id),
                "page_name": res_item.page_name,
                "platform": plat,
                "title": title_clean,
                "description": final_caption,
                "schedule_time_ms": item.schedule_time_ms,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": 1,
                "published": False,
                "source": "bulk",
                # Để Drive / kho video AI nhận diện chính xác video đã đăng (thay vì đoán theo tiêu đề).
                "drive_file_id": item.file_id or "",
                "source_type": item.source_type,
                "source_id": item.source_id,
                "local_path": str(local_file) if not is_temp else "",
                "file_name": item.file_name,
            })

        except Exception as exc:
            failed_count += 1
            res_item.ok = False
            res_item.error = str(exc)
        finally:
            if is_temp and local_file and local_file.exists():
                try:
                    os.remove(local_file)
                except Exception:
                    pass

        results.append(res_item)

    return PippitBulkScheduleResponse(
        ok=failed_count == 0,
        total=len(payload.items),
        success_count=success_count,
        failed_count=failed_count,
        results=results,
        message=f"Đã lên lịch thành công {success_count}/{len(payload.items)} video!",
    )
