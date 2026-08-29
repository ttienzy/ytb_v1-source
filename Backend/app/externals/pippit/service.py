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
        "job_id": payload.job_id,
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

    page_ids = [str(p.get("page_id")) for p in acc.get("facebook_pages", []) if p.get("page_id")]
    c = PippitClient(
        cookies=acc.get("cookies", ""),
        workspace_id=acc.get("workspace_id", ""),
        proxy=acc.get("proxy", ""),
        user_id=acc.get("user_id", ""),
    )
    try:
        tasks = c.list_schedule_tasks(page_ids=page_ids)
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
        page_ids = [str(p.get("page_id")) for p in acc.get("facebook_pages", []) if p.get("page_id")]
        try:
            c = PippitClient(
                cookies=cookies,
                workspace_id=acc.get("workspace_id", ""),
                proxy=acc.get("proxy", ""),
                user_id=acc.get("user_id", ""),
            )
            fetched = c.list_schedule_tasks(page_ids=page_ids)
            for t in fetched:
                tid = t.get("task_id")
                if tid:
                    t["account_id"] = acc.get("id")
                    t["account_email"] = acc.get("email")
                    live_tasks_map[tid] = t
        except Exception:
            pass

    # Merge live status vào local tasks
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


def get_all_active_facebook_pages() -> list[dict]:
    """Lấy danh sách tất cả các Facebook Page đang active (đã liên kết) trên toàn bộ tài khoản Pippit."""
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
                    "account_id": acc.get("id", ""),
                    "account_email": acc.get("email", ""),
                    "un_expired": p.get("un_expired", True),
                })
    return active_pages


def bulk_schedule_videos(payload: PippitBulkScheduleRequest) -> PippitBulkScheduleResponse:
    """Lên lịch hàng loạt video ngắn từ Google Drive lên Facebook Page qua Pippit."""
    accounts = get_saved_pippit_accounts()
    if not accounts:
        raise HTTPException(status_code=400, detail="Chưa có tài khoản Pippit nào được cấu hình.")

    clients_by_account: dict[str, PippitClient] = {}
    page_to_account: dict[str, dict] = {}
    page_name_map: dict[str, str] = {}

    for a in accounts:
        for p in a.get("facebook_pages", []):
            pid = str(p.get("page_id") or "").strip()
            if pid:
                page_to_account[pid] = a
                page_name_map[pid] = p.get("page_name", f"Page {pid}")

    default_acc = next((a for a in accounts if a["id"] == payload.account_id), accounts[0])

    def _get_client_for_page(page_id: str) -> tuple[PippitClient, dict]:
        target_acc = page_to_account.get(str(page_id)) or default_acc
        acc_id = target_acc.get("id", "default")
        if acc_id not in clients_by_account:
            cookies = target_acc.get("cookies", "")
            if not cookies:
                raise ValueError(f"Tài khoản {target_acc.get('email')} thiếu cookie đăng nhập.")
            clients_by_account[acc_id] = PippitClient(cookies=cookies)
        return clients_by_account[acc_id], target_acc

    results: list[PippitBulkScheduleResultItem] = []
    success_count = 0
    failed_count = 0

    from app.externals.gdrive import service as gdrive_service

    for item in payload.items:
        res_item = PippitBulkScheduleResultItem(
            file_name=item.file_name,
            page_id=str(item.page_id),
            page_name=page_name_map.get(str(item.page_id), f"Page {item.page_id}"),
            schedule_time_ms=item.schedule_time_ms,
        )

        local_file: Path | None = None
        is_temp = False

        try:
            c, acc = _get_client_for_page(str(item.page_id))

            # 1. Xác định đường dẫn file video
            if item.file_path and os.path.exists(item.file_path):
                local_file = Path(item.file_path)
            elif item.file_id:
                # Tải từ Google Drive về thư mục tạm
                local_file = gdrive_service.download_video_temp(item.file_id, custom_name=item.file_name)
                is_temp = True
            else:
                raise ValueError("Thiếu file_id hoặc file_path hợp lệ.")

            if not local_file or not local_file.exists() or local_file.stat().st_size == 0:
                raise ValueError(f"Không thể đọc file video: {item.file_name}")

            # 2. Upload video lên Pippit Cloud
            upload_res = c.upload(str(local_file))
            asset_id = upload_res["asset_id"]
            res_item.asset_id = asset_id

            # 3. Chuẩn bị caption & title
            title_clean = (item.title or "").strip()
            caption_clean = (item.caption or "").strip()
            if title_clean:
                if not caption_clean.startswith(title_clean):
                    final_caption = f"{title_clean}\n\n{caption_clean}" if caption_clean else title_clean
                else:
                    final_caption = caption_clean
            else:
                final_caption = caption_clean

            # 4. Hẹn giờ đăng Facebook Page
            task_id = c.schedule_facebook(
                asset_id=asset_id,
                platform_user_id=str(item.page_id),
                schedule_time_ms=item.schedule_time_ms,
                description=final_caption,
                title=title_clean,
            )
            res_item.task_id = task_id
            res_item.ok = True
            success_count += 1

            # 5. Lưu record vào pippit_tasks.json
            _save_task_record({
                "task_id": task_id,
                "asset_id": asset_id,
                "job_id": None,
                "account_id": payload.account_id,
                "account_email": acc.get("email", ""),
                "page_id": str(item.page_id),
                "page_name": res_item.page_name,
                "title": title_clean,
                "description": final_caption,
                "schedule_time_ms": item.schedule_time_ms,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": 1,
                "published": False,
                "source": "gdrive_bulk",
            })

        except Exception as exc:
            failed_count += 1
            res_item.ok = False
            res_item.error = str(exc)
        finally:
            # Dọn dẹp file tạm sau khi upload xong
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
