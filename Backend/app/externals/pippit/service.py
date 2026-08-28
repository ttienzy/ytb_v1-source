import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from app.core.config import TOOLS_DIR
from app.core.storage import read_config, write_config
from app.externals.pippit import client
from app.externals.pippit.client import PippitAuthError, PippitClient, PippitError
from app.externals.pippit.schemas import (
    FacebookPageSlot,
    PippitAccountOut,
    PippitLoginSyncRequest,
    PippitPublishRequest,
    PippitPublishResponse,
    PippitScheduleTaskOut,
)

PIPPIT_TASKS_FILE = TOOLS_DIR / "Backend" / "Data" / "pippit_tasks.json"


def _get_saved_tasks() -> list[dict]:
    """Đọc lịch sử các task đã đăng/lên lịch từ pippit_tasks.json."""
    if not PIPPIT_TASKS_FILE.exists():
        return []
    try:
        return json.loads(PIPPIT_TASKS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_task_record(task_data: dict) -> None:
    """Lưu 1 task bài đăng vào pippit_tasks.json."""
    tasks = _get_saved_tasks()
    tid = task_data.get("task_id")
    idx = next((i for i, t in enumerate(tasks) if t.get("task_id") == tid), -1) if tid else -1
    if idx >= 0:
        tasks[idx].update(task_data)
    else:
        tasks.insert(0, task_data)
    try:
        PIPPIT_TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
        PIPPIT_TASKS_FILE.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        print(f"[Pippit] Không thể lưu task record: {exc}")



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

    # Đảm bảo luôn có đủ tối thiểu 3 slots
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


def login_and_sync_account(payload: PippitLoginSyncRequest) -> PippitAccountOut:
    """Đăng nhập Pure HTTP bằng email + mật khẩu, lấy workspace_id và kéo Real Facebook Pages."""
    clean_email = payload.email.strip().lower()
    password = payload.password.strip()
    proxy = payload.proxy.strip()

    # 1. Đăng nhập Pure HTTP lấy Cookies & Workspace ID
    try:
        auth_data = client.login(clean_email, password, proxy=proxy)
    except PippitAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi đăng nhập Pippit: {exc}") from exc

    cookies = auth_data["cookies"]
    workspace_id = auth_data["workspace_id"]
    user_id = auth_data["user_id"]

    # 2. Kéo danh sách Real Facebook Pages đang liên kết trên Pippit
    c = PippitClient(cookies=cookies, workspace_id=workspace_id, proxy=proxy)
    try:
        real_pages = c.facebook_accounts()
    except Exception as exc:
        print(f"[Pippit] Không thể kéo Facebook Pages ({exc}), sử dụng slots rỗng.")
        real_pages = []

    fb_slots = _format_facebook_slots(real_pages)

    # 3. Lưu tài khoản vào config.json
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
    )


def refresh_account_pages(account_id: str) -> PippitAccountOut:
    """Quét lại danh sách Real Facebook Pages từ Pippit cho tài khoản đã lưu."""
    accounts = get_saved_pippit_accounts()
    acc = next((a for a in accounts if a.get("id") == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Pippit.")

    cookies = acc.get("cookies", "")
    workspace_id = acc.get("workspace_id", "")
    proxy = acc.get("proxy", "")
    email = acc.get("email", "")
    password = acc.get("password", "")

    # Thử gọi bằng cookies hiện tại, nếu hết hạn thì tự động re-login
    c = PippitClient(cookies=cookies, workspace_id=workspace_id, proxy=proxy)
    try:
        real_pages = c.facebook_accounts()
    except PippitAuthError:
        if email and password:
            try:
                auth = client.login(email, password, proxy=proxy)
                cookies = auth["cookies"]
                workspace_id = auth["workspace_id"]
                acc["cookies"] = cookies
                acc["workspace_id"] = workspace_id
                c = PippitClient(cookies=cookies, workspace_id=workspace_id, proxy=proxy)
                real_pages = c.facebook_accounts()
            except Exception as exc:
                raise HTTPException(status_code=401, detail=f"Tự động đăng nhập lại thất bại: {exc}") from exc
        else:
            raise HTTPException(status_code=401, detail="Cookie hết hạn và không có mật khẩu để tự đăng nhập lại.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi quét Fanpages: {exc}") from exc

    acc["facebook_pages"] = _format_facebook_slots(real_pages)
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
    )


def publish_video_to_page(payload: PippitPublishRequest) -> PippitPublishResponse:
    """Quy trình upload file video lên Pippit Cloud và lên lịch đăng bài cho Facebook Page."""
    if not os.path.exists(payload.video_path):
        raise HTTPException(status_code=400, detail=f"File video không tồn tại: {payload.video_path}")

    accounts = get_saved_pippit_accounts()
    acc = next((a for a in accounts if a.get("id") == payload.account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Pippit.")

    cookies = acc.get("cookies", "")
    workspace_id = acc.get("workspace_id", "")
    proxy = acc.get("proxy", "")

    if not cookies:
        raise HTTPException(status_code=400, detail="Tài khoản Pippit chưa có session cookies hợp lệ.")

    c = PippitClient(cookies=cookies, workspace_id=workspace_id, proxy=proxy)

    # 1. Upload video 5 bước
    try:
        upload_res = c.upload(payload.video_path)
    except PippitError as exc:
        raise HTTPException(status_code=500, detail=f"Upload video lên Cloud thất bại: {exc}") from exc

    asset_id = upload_res["asset_id"]

    # 2. Tính thời gian hẹn giờ (ms)
    minutes = max(1, payload.when_minutes_ahead)
    schedule_time_ms = int(time.time() * 1000) + (minutes * 60 * 1000)

    # 3. Gộp Tiêu đề vào đầu Caption (Facebook post video hiển thị description làm nội dung bài viết chính)
    title_clean = (payload.title or "").strip()
    caption_clean = (payload.caption or "").strip()

    if title_clean:
        if not caption_clean.startswith(title_clean):
            final_caption = f"{title_clean}\n\n{caption_clean}" if caption_clean else title_clean
        else:
            final_caption = caption_clean
    else:
        final_caption = caption_clean

    # 4. Lên lịch bài đăng Facebook Page
    try:
        task_id = c.schedule_facebook(
            asset_id=asset_id,
            platform_user_id=payload.page_id,
            schedule_time_ms=schedule_time_ms,
            description=final_caption,
            title=title_clean,
        )
    except PippitError as exc:
        raise HTTPException(status_code=500, detail=f"Lên lịch đăng bài thất bại: {exc}") from exc

    # 5. Lưu lại task vào lịch sử cục bộ
    page_name = ""
    for p in acc.get("facebook_pages", []):
        if str(p.get("page_id")) == str(payload.page_id):
            page_name = p.get("page_name", "")
            break

    _save_task_record({
        "task_id": task_id,
        "asset_id": asset_id,
        "account_id": payload.account_id,
        "account_email": acc.get("email", ""),
        "page_id": str(payload.page_id),
        "page_name": page_name or f"Page {payload.page_id}",
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
        message=f"Đã lên lịch đăng bài lên Facebook Page thành công (hẹn giờ sau +{minutes} phút)!",
    )


def list_account_tasks(account_id: str) -> list[PippitScheduleTaskOut]:
    """Tra cứu danh sách các bài đăng đã lên lịch trên Pippit."""
    accounts = get_saved_pippit_accounts()
    acc = next((a for a in accounts if a.get("id") == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Pippit.")

    c = PippitClient(cookies=acc.get("cookies", ""), workspace_id=acc.get("workspace_id", ""), proxy=acc.get("proxy", ""))
    try:
        tasks = c.list_schedule_tasks()
        return [PippitScheduleTaskOut(**t) for t in tasks]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lấy danh sách tasks thất bại: {exc}") from exc


def list_all_saved_accounts_tasks() -> list[dict]:
    """Lấy toàn bộ tasks đã lên lịch từ local cache + live sync từ Pippit."""
    local_tasks = _get_saved_tasks()
    accounts = get_saved_pippit_accounts()

    # Quét live từ các tài khoản Pippit
    live_tasks_map = {}
    for acc in accounts:
        cookies = acc.get("cookies", "")
        if not cookies:
            continue
        try:
            c = PippitClient(
                cookies=cookies,
                workspace_id=acc.get("workspace_id", ""),
                proxy=acc.get("proxy", ""),
            )
            fetched = c.list_schedule_tasks()
            for t in fetched:
                tid = t.get("task_id")
                if tid:
                    t["account_id"] = acc.get("id")
                    t["account_email"] = acc.get("email")
                    live_tasks_map[tid] = t
        except Exception:
            pass

    # Merge live status vào local tasks
    now_ms = int(time.time() * 1000)
    merged = []
    seen_ids = set()

    for lt in local_tasks:
        tid = lt.get("task_id")
        if tid:
            seen_ids.add(tid)
        if tid and tid in live_tasks_map:
            live = live_tasks_map[tid]
            lt["status"] = live.get("status", lt.get("status"))
            lt["published"] = live.get("published", lt.get("published"))
            if live.get("post_url"):
                lt["post_url"] = live.get("post_url")
            if live.get("failed_reason"):
                lt["failed_reason"] = live.get("failed_reason")
        else:
            # Nếu đã quá giờ hẹn và không có lỗi, đánh dấu status published
            sched_ms = lt.get("schedule_time_ms") or 0
            if sched_ms > 0 and sched_ms <= now_ms and not lt.get("failed_reason"):
                lt["published"] = True
                lt["status"] = 3
        merged.append(lt)

    # Thêm các task mới lấy được từ live API mà chưa có trong local
    for tid, live in live_tasks_map.items():
        if tid not in seen_ids:
            merged.append(live)

    # Sắp xếp mới nhất lên đầu theo schedule_time_ms desc
    merged.sort(key=lambda x: x.get("schedule_time_ms") or 0, reverse=True)
    return merged




def delete_pippit_account(account_id: str) -> dict:
    """Xóa tài khoản Pippit khỏi config.json."""
    accounts = get_saved_pippit_accounts()
    acc = next((a for a in accounts if a.get("id") == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Pippit để xóa.")

    new_accounts = [a for a in accounts if a.get("id") != account_id]
    _save_pippit_accounts(new_accounts)
    return {"ok": True, "message": f"Đã xóa tài khoản Pippit {acc.get('email')}"}
