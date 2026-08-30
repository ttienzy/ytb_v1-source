import json
import logging
import os
import tempfile
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from fastapi import HTTPException, UploadFile
from google_auth_oauthlib.flow import InstalledAppFlow

from app.core.config import TOOLS_DIR
from app.core.storage import read_config, write_config
from app.externals.gdrive.service import get_client as get_gdrive_client
from app.externals.youtube.client import DEFAULT_CATEGORIES, SCOPES, YouTubeClient
from app.externals.youtube.schemas import (
    YouTubeAuthUrlResponse,
    YouTubeBulkScheduleRequest,
    YouTubeBulkScheduleResponse,
    YouTubeBulkScheduleResultItem,
    YouTubeCategoryItem,
    YouTubeCredentialsInput,
    YouTubeExchangeCodeRequest,
    YouTubePublishRequest,
    YouTubePublishResponse,
    YouTubeSettingsUpdateRequest,
    YouTubeStatusOut,
    YouTubeTaskOut,
)

logger = logging.getLogger(__name__)

os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
os.environ["OAUTHLIB_IGNORE_TLS"] = "1"

YOUTUBE_TASKS_FILE = TOOLS_DIR / "Backend" / "Data" / "youtube_tasks.json"


def get_youtube_config() -> dict[str, Any]:
    """Đọc cấu hình YouTube từ config.json."""
    config = read_config()
    return config.get("youtube_oauth", {})


def save_youtube_config(cfg: dict[str, Any]) -> None:
    """Lưu cấu hình YouTube vào config.json."""
    config = read_config()
    config["youtube_oauth"] = cfg
    write_config(config)


def parse_auth_code(raw: str) -> str:
    """Trích xuất authorization code từ chuỗi code hoặc full URL redirect."""
    s = (raw or "").strip()
    if not s:
        return ""
    if "code=" in s:
        parsed = urllib.parse.urlparse(s)
        params = urllib.parse.parse_qs(parsed.query)
        if "code" in params:
            return params["code"][0]
    return s


def _on_token_refreshed(new_tokens: dict[str, Any]) -> None:
    """Callback khi access_token được refresh tự động."""
    cfg = get_youtube_config()
    tokens = cfg.get("tokens", {})
    tokens.update(new_tokens)
    cfg["tokens"] = tokens
    save_youtube_config(cfg)
    logger.info("[YouTube] Đã lưu refreshed token vào config.json")


def get_client() -> YouTubeClient | None:
    """Khởi tạo YouTubeClient từ tokens đã lưu trong config.json."""
    cfg = get_youtube_config()
    tokens = cfg.get("tokens")
    if not tokens or not (tokens.get("token") or tokens.get("access_token")):
        return None
    try:
        return YouTubeClient(tokens, on_token_refreshed=_on_token_refreshed)
    except Exception as exc:
        logger.warning("[YouTube] Không thể khởi tạo YouTubeClient: %s", exc)
        return None


def get_status() -> YouTubeStatusOut:
    """Kiểm tra trạng thái kết nối YouTube hiện tại."""
    cfg = get_youtube_config()
    tokens = cfg.get("tokens")
    has_creds = bool(cfg.get("client_id") and cfg.get("client_secret"))

    if not tokens:
        return YouTubeStatusOut(
            connected=False,
            auto_upload=cfg.get("auto_upload", False),
            default_privacy=cfg.get("default_privacy", "private"),
            default_tags=cfg.get("default_tags", ""),
            has_credentials=has_creds,
            client_id=cfg.get("client_id", ""),
            message="Chưa kết nối tài khoản YouTube. Vui lòng đăng nhập để bắt đầu.",
        )

    client = get_client()
    if not client:
        return YouTubeStatusOut(
            connected=False,
            auto_upload=cfg.get("auto_upload", False),
            default_privacy=cfg.get("default_privacy", "private"),
            default_tags=cfg.get("default_tags", ""),
            has_credentials=has_creds,
            client_id=cfg.get("client_id", ""),
            message="Token YouTube không hợp lệ hoặc đã hết hạn.",
        )

    return YouTubeStatusOut(
        connected=True,
        email=cfg.get("email", ""),
        name=cfg.get("name", ""),
        avatar_url=cfg.get("avatar_url", ""),
        channel_id=cfg.get("channel_id", ""),
        channel_title=cfg.get("channel_title", ""),
        channel_custom_url=cfg.get("channel_custom_url", ""),
        channel_avatar_url=cfg.get("channel_avatar_url", ""),
        subscriber_count=cfg.get("subscriber_count", 0),
        video_count=cfg.get("video_count", 0),
        default_privacy=cfg.get("default_privacy", "private"),
        default_tags=cfg.get("default_tags", ""),
        auto_upload=cfg.get("auto_upload", False),
        has_credentials=has_creds,
        client_id=cfg.get("client_id", ""),
        message="Tài khoản YouTube đã kết nối và sẵn sàng!",
    )


def save_credentials(payload: YouTubeCredentialsInput) -> YouTubeStatusOut:
    """Lưu Client ID / Secret hoặc nội dung file credentials.json từ Google Cloud."""
    cfg = get_youtube_config()

    if payload.credentials_json and payload.credentials_json.strip():
        try:
            parsed = json.loads(payload.credentials_json.strip())
            data = parsed.get("installed") or parsed.get("web") or parsed
            cid = data.get("client_id")
            csec = data.get("client_secret")
            if not cid or not csec:
                raise ValueError("Không tìm thấy client_id hoặc client_secret trong file JSON.")
            cfg["client_id"] = cid.strip()
            cfg["client_secret"] = csec.strip()
            cfg["client_config"] = parsed
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"File credentials.json không hợp lệ: {exc}") from exc
    else:
        if payload.client_id:
            cfg["client_id"] = payload.client_id.strip()
        if payload.client_secret:
            cfg["client_secret"] = payload.client_secret.strip()

    save_youtube_config(cfg)
    return get_status()


def get_auth_url(redirect_uri: str = "http://localhost:8080/") -> YouTubeAuthUrlResponse:
    """Tạo đường link Google OAuth 2.0 Authorization URL cho YouTube."""
    cfg = get_youtube_config()
    client_id = cfg.get("client_id")
    if not client_id:
        raise HTTPException(
            status_code=400,
            detail="Chưa cấu hình Google Client ID. Vui lòng nhập Client ID & Secret từ Google Cloud Console.",
        )

    scope_str = " ".join(SCOPES)
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope_str,
        "access_type": "offline",
        "prompt": "consent",
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    return YouTubeAuthUrlResponse(auth_url=url, redirect_uri=redirect_uri)


def exchange_code(payload: YouTubeExchangeCodeRequest) -> YouTubeStatusOut:
    """Đổi Authorization Code lấy Access & Refresh Token và lưu cấu hình."""
    cfg = get_youtube_config()
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")

    if not client_id or not client_secret:
        raise HTTPException(
            status_code=400,
            detail="Thiếu Client ID hoặc Client Secret trong cấu hình.",
        )

    code = parse_auth_code(payload.code)
    if not code:
        raise HTTPException(status_code=400, detail="Mã Authorization Code không hợp lệ.")

    redirect_uri = payload.redirect_uri or "http://localhost:8080/"
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }

    try:
        r = requests.post(token_url, data=data, timeout=15)
        res_data = r.json()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi kết nối tới Google OAuth Token API: {exc}") from exc

    if not r.ok or "access_token" not in res_data:
        err_msg = res_data.get("error_description") or res_data.get("error") or str(res_data)
        raise HTTPException(status_code=400, detail=f"Xác thực thất bại từ Google: {err_msg}")

    tokens = {
        "token": res_data.get("access_token"),
        "refresh_token": res_data.get("refresh_token"),
        "token_uri": token_url,
        "client_id": client_id,
        "client_secret": client_secret,
        "scopes": SCOPES,
    }

    client = YouTubeClient(tokens, on_token_refreshed=_on_token_refreshed)
    user_info = client.get_user_info()
    channel_info = client.get_channel_info()

    cfg["enabled"] = True
    cfg["auth_type"] = "oauth2"
    cfg["tokens"] = tokens
    cfg["email"] = user_info.get("email", "")
    cfg["name"] = user_info.get("name", "")
    cfg["avatar_url"] = user_info.get("avatar_url", "")
    cfg["channel_id"] = channel_info.get("channel_id", "")
    cfg["channel_title"] = channel_info.get("channel_title", "")
    cfg["channel_custom_url"] = channel_info.get("channel_custom_url", "")
    cfg["channel_avatar_url"] = channel_info.get("channel_avatar_url", "")
    cfg["subscriber_count"] = channel_info.get("subscriber_count", 0)
    cfg["video_count"] = channel_info.get("video_count", 0)

    save_youtube_config(cfg)
    return get_status()


def login_oauth_flow() -> YouTubeStatusOut:
    """Chạy luồng Google OAuth 2.0 mở trình duyệt tự động cho YouTube."""
    cfg = get_youtube_config()
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")

    if not client_id or not client_secret:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng nhập Client ID & Client Secret (hoặc dán file credentials.json) từ Google Cloud Console trước khi kết nối.",
        )

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "redirect_uris": ["http://localhost:8080/", "http://localhost", "urn:ietf:wg:oauth:2.0:oob"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
    creds = None
    last_exc = None
    candidate_ports = [8080, 8085, 0]

    for p in candidate_ports:
        try:
            creds = flow.run_local_server(
                port=p,
                authorization_prompt_message="Đang mở trình duyệt để đăng nhập YouTube...",
                success_message="Đăng nhập YouTube thành công! Bạn có thể đóng tab này và quay lại ứng dụng.",
                open_browser=True,
                timeout_seconds=90,
            )
            if creds:
                break
        except OSError as sock_err:
            last_exc = sock_err
            logger.warning("[YouTube] Cổng %s bị bận (%s), thử cổng tiếp theo...", p, sock_err)
            continue
        except Exception as exc:
            last_exc = exc
            logger.warning("[YouTube] Quá trình xác thực bị hủy hoặc quá hạn: %s", exc)
            break

    if not creds:
        logger.warning("[YouTube] run_local_server thất bại: %s", last_exc)
        raise HTTPException(
            status_code=500,
            detail=f"Xác thực tự động chưa hoàn thành ({last_exc}). Hãy thử lại hoặc dùng cách Đăng nhập thủ công qua liên kết bên dưới.",
        ) from last_exc

    tokens = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }

    client = YouTubeClient(tokens, on_token_refreshed=_on_token_refreshed)
    user_info = client.get_user_info()
    channel_info = client.get_channel_info()

    cfg["enabled"] = True
    cfg["auth_type"] = "oauth2"
    cfg["tokens"] = tokens
    cfg["email"] = user_info.get("email", "")
    cfg["name"] = user_info.get("name", "")
    cfg["avatar_url"] = user_info.get("avatar_url", "")
    cfg["channel_id"] = channel_info.get("channel_id", "")
    cfg["channel_title"] = channel_info.get("channel_title", "")
    cfg["channel_custom_url"] = channel_info.get("channel_custom_url", "")
    cfg["channel_avatar_url"] = channel_info.get("channel_avatar_url", "")
    cfg["subscriber_count"] = channel_info.get("subscriber_count", 0)
    cfg["video_count"] = channel_info.get("video_count", 0)

    save_youtube_config(cfg)
    return get_status()


def update_settings(payload: YouTubeSettingsUpdateRequest) -> YouTubeStatusOut:
    """Cập nhật cài đặt mặc định cho YouTube."""
    cfg = get_youtube_config()

    if payload.default_privacy is not None:
        cfg["default_privacy"] = payload.default_privacy
    if payload.default_tags is not None:
        cfg["default_tags"] = payload.default_tags
    if payload.auto_upload is not None:
        cfg["auto_upload"] = payload.auto_upload
    if payload.client_id is not None:
        cfg["client_id"] = payload.client_id
    if payload.client_secret is not None:
        cfg["client_secret"] = payload.client_secret

    save_youtube_config(cfg)
    return get_status()


def disconnect() -> dict[str, Any]:
    """Ngắt kết nối tài khoản YouTube và xoá token."""
    cfg = get_youtube_config()
    cfg.pop("tokens", None)
    cfg["enabled"] = False
    cfg["email"] = ""
    cfg["name"] = ""
    cfg["avatar_url"] = ""
    cfg["channel_id"] = ""
    cfg["channel_title"] = ""
    cfg["channel_custom_url"] = ""
    cfg["channel_avatar_url"] = ""
    cfg["subscriber_count"] = 0
    cfg["video_count"] = 0

    save_youtube_config(cfg)
    return {"ok": True, "message": "Đã ngắt kết nối tài khoản YouTube."}


# ── Tasks Management ──


def get_saved_tasks() -> list[dict[str, Any]]:
    """Lấy danh sách các task YouTube đã lưu."""
    if not YOUTUBE_TASKS_FILE.exists():
        return []
    try:
        return json.loads(YOUTUBE_TASKS_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("[YouTube] Không thể đọc youtube_tasks.json: %s", exc)
        return []


def save_task_record(task: dict[str, Any]) -> None:
    """Lưu 1 record task vào youtube_tasks.json."""
    tasks = get_saved_tasks()
    # Kiểm tra nếu task_id đã có thì update, chưa có thì insert đầu
    for i, t in enumerate(tasks):
        if t.get("task_id") == task.get("task_id"):
            tasks[i] = task
            break
    else:
        tasks.insert(0, task)

    try:
        YOUTUBE_TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
        YOUTUBE_TASKS_FILE.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("[YouTube] Không thể lưu youtube_tasks.json: %s", exc)


def delete_task_record(task_id: str) -> bool:
    """Xóa 1 task khỏi youtube_tasks.json."""
    tasks = get_saved_tasks()
    new_tasks = [t for t in tasks if t.get("task_id") != task_id]
    if len(new_tasks) != len(tasks):
        try:
            YOUTUBE_TASKS_FILE.write_text(json.dumps(new_tasks, ensure_ascii=False, indent=2), encoding="utf-8")
            return True
        except Exception:
            return False
    return False


def get_categories() -> list[YouTubeCategoryItem]:
    """Lấy danh sách categories."""
    client = get_client()
    if client:
        cats = client.get_video_categories("VN")
        return [YouTubeCategoryItem(id=c["id"], title=c["title"]) for c in cats]
    return [YouTubeCategoryItem(id=c["id"], title=c["title"]) for c in DEFAULT_CATEGORIES]


# ── Publishing & Scheduling ──


def publish_single_video(payload: YouTubePublishRequest) -> YouTubePublishResponse:
    """Upload và lên lịch xuất bản 1 video lên YouTube."""
    client = get_client()
    if not client:
        raise HTTPException(
            status_code=400,
            detail="Chưa kết nối tài khoản YouTube hoặc token đã hết hạn. Vui lòng vào Cài đặt để đăng nhập lại.",
        )

    task_id = f"yt_{uuid.uuid4().hex[:10]}"
    temp_dir = None
    local_file: Path | None = None

    # Phân giải danh sách tags
    tags_list: list[str] = []
    if isinstance(payload.tags, list):
        tags_list = payload.tags
    elif isinstance(payload.tags, str):
        tags_list = [t.strip() for t in payload.tags.split(",") if t.strip()]

    try:
        if payload.source_type == "gdrive" and payload.drive_file_id:
            g_client = get_gdrive_client()
            if not g_client:
                raise HTTPException(status_code=400, detail="Không thể kết nối Google Drive để tải video.")
            temp_dir = tempfile.mkdtemp(prefix="yt_upload_")
            temp_path = Path(temp_dir) / f"{task_id}.mp4"
            logger.info("[YouTube] Đang tải video từ Google Drive (ID: %s)...", payload.drive_file_id)
            local_file = g_client.download_file(payload.drive_file_id, temp_path)
        elif payload.file_path:
            local_file = Path(payload.file_path)
            if not local_file.exists():
                raise HTTPException(status_code=400, detail=f"Không tìm thấy file video local: {payload.file_path}")
        else:
            raise HTTPException(status_code=400, detail="Thiếu nguồn file video (file_path hoặc drive_file_id).")

        logger.info("[YouTube] Bắt đầu upload video: %s lên YouTube...", payload.title)
        res = client.upload_video(
            file_path=local_file,
            title=payload.title,
            description=payload.description,
            tags=tags_list,
            category_id=payload.category_id,
            privacy_status=payload.privacy_status,
            publish_at=payload.publish_at,
            made_for_kids=payload.made_for_kids,
        )

        task_record = {
            "task_id": task_id,
            "video_id": res.get("video_id"),
            "youtube_url": res.get("youtube_url"),
            "file_name": local_file.name,
            "file_path": payload.file_path,
            "drive_file_id": payload.drive_file_id,
            "source_type": payload.source_type,
            "title": payload.title,
            "description": payload.description,
            "tags": ", ".join(tags_list),
            "category_id": payload.category_id,
            "privacy_status": payload.privacy_status,
            "publish_at": payload.publish_at,
            "status": res.get("status", "published"),
            "error_message": None,
            "thumbnail_url": f"https://i.ytimg.com/vi/{res.get('video_id')}/hqdefault.jpg" if res.get("video_id") else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        save_task_record(task_record)

        return YouTubePublishResponse(
            ok=True,
            video_id=res.get("video_id", ""),
            youtube_url=res.get("youtube_url", ""),
            title=payload.title,
            status=res.get("status", "published"),
            message="Đăng video lên YouTube thành công!" if not payload.publish_at else f"Lên lịch video thành công lúc {payload.publish_at}!",
        )

    except Exception as exc:
        err_msg = str(exc)
        logger.error("[YouTube] Lỗi đăng tải video lên YouTube: %s", err_msg)
        task_record = {
            "task_id": task_id,
            "video_id": None,
            "youtube_url": None,
            "file_name": payload.file_path or payload.drive_file_id or "unknown.mp4",
            "file_path": payload.file_path,
            "drive_file_id": payload.drive_file_id,
            "source_type": payload.source_type,
            "title": payload.title,
            "description": payload.description,
            "tags": ", ".join(tags_list),
            "category_id": payload.category_id,
            "privacy_status": payload.privacy_status,
            "publish_at": payload.publish_at,
            "status": "failed",
            "error_message": err_msg,
            "thumbnail_url": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        save_task_record(task_record)
        raise HTTPException(status_code=500, detail=f"Lỗi đăng tải YouTube: {err_msg}") from exc

    finally:
        if temp_dir and os.path.exists(temp_dir):
            try:
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass


def bulk_schedule_videos(payload: YouTubeBulkScheduleRequest) -> YouTubeBulkScheduleResponse:
    """Lên lịch đăng hàng loạt video lên YouTube."""
    results: list[YouTubeBulkScheduleResultItem] = []
    succeeded = 0
    failed = 0

    for slot in payload.slots:
        try:
            req = YouTubePublishRequest(
                file_path=slot.file_path,
                drive_file_id=slot.drive_file_id,
                source_type=slot.source_type,
                title=slot.title,
                description=slot.description,
                tags=slot.tags,
                category_id=slot.category_id,
                privacy_status=slot.privacy_status,
                publish_at=slot.publish_at,
            )
            res = publish_single_video(req)
            results.append(
                YouTubeBulkScheduleResultItem(
                    slot_id=slot.id,
                    ok=True,
                    video_id=res.video_id,
                    youtube_url=res.youtube_url,
                    title=res.title,
                    status=res.status,
                )
            )
            succeeded += 1
        except Exception as exc:
            err_msg = exc.detail if hasattr(exc, "detail") else str(exc)
            results.append(
                YouTubeBulkScheduleResultItem(
                    slot_id=slot.id,
                    ok=False,
                    title=slot.title,
                    error=err_msg,
                    status="failed",
                )
            )
            failed += 1

    return YouTubeBulkScheduleResponse(
        total=len(payload.slots),
        succeeded=succeeded,
        failed=failed,
        results=results,
    )


async def save_uploaded_file(file: UploadFile) -> dict[str, str]:
    """Lưu file video upload từ client vào thư mục tạm của server."""
    upload_dir = TOOLS_DIR / "Backend" / "Data" / "youtube_uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = file.filename or "video.mp4"
    dest_path = upload_dir / f"{uuid.uuid4().hex[:8]}_{safe_name}"

    content = await file.read()
    dest_path.write_bytes(content)

    return {
        "file_path": str(dest_path),
        "file_name": safe_name,
    }

