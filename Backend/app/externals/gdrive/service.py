import json
import logging
import os
import re
import urllib.parse
from pathlib import Path
from typing import Any

import requests
from fastapi import HTTPException
from google_auth_oauthlib.flow import InstalledAppFlow

from app.core.storage import read_config, write_config
from app.externals.gdrive.client import SCOPES, GDriveClient
from app.externals.gdrive.schemas import (
    GDriveAuthUrlResponse,
    GDriveCredentialsInput,
    GDriveExchangeCodeRequest,
    GDriveFolderUpdateRequest,
    GDriveSettingsUpdateRequest,
    GDriveStatusOut,
    GDriveUploadRequest,
    GDriveUploadResponse,
)

logger = logging.getLogger(__name__)

os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
os.environ["OAUTHLIB_IGNORE_TLS"] = "1"



def get_gdrive_config() -> dict[str, Any]:
    """Đọc cấu hình Google Drive từ config.json."""
    config = read_config()
    return config.get("google_drive", {})


def save_gdrive_config(cfg: dict[str, Any]) -> None:
    """Lưu cấu hình Google Drive vào config.json."""
    config = read_config()
    config["google_drive"] = cfg
    write_config(config)


def parse_folder_id(raw: str) -> str:
    """Trích xuất folder_id từ URL hoặc chuỗi ID."""
    s = (raw or "").strip()
    if not s:
        return ""
    m = re.search(r"folders/([a-zA-Z0-9_-]+)", s)
    if m:
        return m.group(1)
    m2 = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", s)
    if m2:
        return m2.group(1)
    return s


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
    cfg = get_gdrive_config()
    tokens = cfg.get("tokens", {})
    tokens.update(new_tokens)
    cfg["tokens"] = tokens
    save_gdrive_config(cfg)
    logger.info("[GDrive] Đã lưu refreshed token vào config.json")


def get_client() -> GDriveClient | None:
    """Khởi tạo GDriveClient từ tokens đã lưu trong config.json."""
    cfg = get_gdrive_config()
    tokens = cfg.get("tokens")
    if not tokens or not (tokens.get("token") or tokens.get("access_token")):
        return None
    try:
        return GDriveClient(tokens, on_token_refreshed=_on_token_refreshed)
    except Exception as exc:
        logger.warning("[GDrive] Không thể khởi tạo GDriveClient: %s", exc)
        return None


def get_status() -> GDriveStatusOut:
    """Kiểm tra trạng thái kết nối Google Drive hiện tại."""
    cfg = get_gdrive_config()
    tokens = cfg.get("tokens")
    has_creds = bool(cfg.get("client_id") and cfg.get("client_secret"))

    if not tokens:
        return GDriveStatusOut(
            connected=False,
            auto_upload=cfg.get("auto_upload", True),
            has_credentials=has_creds,
            client_id=cfg.get("client_id", ""),
            message="Chưa kết nối tài khoản Google Drive. Vui lòng đăng nhập để bắt đầu.",
        )

    client = get_client()
    if not client:
        return GDriveStatusOut(
            connected=False,
            auto_upload=cfg.get("auto_upload", True),
            has_credentials=has_creds,
            client_id=cfg.get("client_id", ""),
            message="Token Google Drive không hợp lệ hoặc đã hết hạn.",
        )

    quota = client.get_storage_quota()
    folder_id = cfg.get("folder_id", "")
    folder_name = cfg.get("folder_name", "")
    folder_url = f"https://drive.google.com/drive/folders/{folder_id}" if folder_id else ""

    return GDriveStatusOut(
        connected=True,
        email=cfg.get("email", ""),
        name=cfg.get("name", ""),
        avatar_url=cfg.get("avatar_url", ""),
        folder_id=folder_id,
        folder_name=folder_name,
        folder_url=folder_url,
        storage_used_bytes=quota.get("used", 0),
        storage_total_bytes=quota.get("total", 0),
        auto_upload=cfg.get("auto_upload", True),
        has_credentials=has_creds,
        client_id=cfg.get("client_id", ""),
        message="Google Drive đã kết nối và sẵn sàng hoạt động!",
    )


def save_credentials(payload: GDriveCredentialsInput) -> GDriveStatusOut:
    """Lưu Client ID / Secret hoặc nội dung file credentials.json từ Google Cloud."""
    cfg = get_gdrive_config()

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

    save_gdrive_config(cfg)
    return get_status()


def get_auth_url(redirect_uri: str = "http://localhost:8080/") -> GDriveAuthUrlResponse:
    """Tạo đường link Google OAuth 2.0 Authorization URL."""
    cfg = get_gdrive_config()
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
    return GDriveAuthUrlResponse(auth_url=url, redirect_uri=redirect_uri)


def exchange_code(payload: GDriveExchangeCodeRequest) -> GDriveStatusOut:
    """Đổi Authorization Code lấy Access & Refresh Token và lưu vào hệ thống."""
    cfg = get_gdrive_config()
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

    client = GDriveClient(tokens, on_token_refreshed=_on_token_refreshed)
    user_info = client.get_user_info()

    # Tạo hoặc lấy thư mục mặc định AI_Clean_Videos (bọc try/except an toàn)
    folder_id = ""
    folder_name = "AI_Clean_Videos"
    try:
        folder = client.get_or_create_default_folder("AI_Clean_Videos")
        folder_id = folder.get("id", "")
        folder_name = folder.get("name", "AI_Clean_Videos")
    except Exception as folder_exc:
        logger.warning("[GDrive] Chưa thể tự động tạo folder: %s", folder_exc)

    cfg["enabled"] = True
    cfg["auth_type"] = "oauth2"
    cfg["tokens"] = tokens
    cfg["email"] = user_info.get("email", "")
    cfg["name"] = user_info.get("name", "")
    cfg["avatar_url"] = user_info.get("avatar_url", "")
    cfg["folder_id"] = folder_id
    cfg["folder_name"] = folder_name
    if "auto_upload" not in cfg:
        cfg["auto_upload"] = True

    save_gdrive_config(cfg)
    return get_status()


def login_oauth_flow() -> GDriveStatusOut:
    """Chạy luồng Google OAuth 2.0 mở trình duyệt tự động."""
    cfg = get_gdrive_config()
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")

    if not client_id or not client_secret:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng nhập Client ID & Client Secret (hoặc tải file credentials.json) từ Google Cloud Console trước khi kết nối.",
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

    try:
        flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
        creds = flow.run_local_server(
            port=8080,
            authorization_prompt_message="Đang mở trình duyệt để đăng nhập Google Drive...",
            success_message="Đăng nhập Google Drive thành công! Bạn có thể đóng tab này và quay lại ứng dụng.",
            open_browser=True,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Quá trình xác thực Google OAuth thất bại: {exc}",
        ) from exc

    tokens = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }

    client = GDriveClient(tokens, on_token_refreshed=_on_token_refreshed)
    user_info = client.get_user_info()

    # Tạo hoặc lấy thư mục mặc định AI_Clean_Videos (bọc try/except an toàn)
    folder_id = ""
    folder_name = "AI_Clean_Videos"
    try:
        folder = client.get_or_create_default_folder("AI_Clean_Videos")
        folder_id = folder.get("id", "")
        folder_name = folder.get("name", "AI_Clean_Videos")
    except Exception as folder_exc:
        logger.warning("[GDrive] Chưa thể tự động tạo folder: %s", folder_exc)

    cfg["enabled"] = True
    cfg["auth_type"] = "oauth2"
    cfg["tokens"] = tokens
    cfg["email"] = user_info.get("email", "")
    cfg["name"] = user_info.get("name", "")
    cfg["avatar_url"] = user_info.get("avatar_url", "")
    cfg["folder_id"] = folder_id
    cfg["folder_name"] = folder_name
    if "auto_upload" not in cfg:
        cfg["auto_upload"] = True

    save_gdrive_config(cfg)
    return get_status()



def update_folder(payload: GDriveFolderUpdateRequest) -> GDriveStatusOut:
    """Cập nhật hoặc kiểm tra thư mục lưu video trên Drive."""
    client = get_client()
    if not client:
        raise HTTPException(status_code=400, detail="Google Drive chưa được kết nối.")

    clean_id = parse_folder_id(payload.folder_id)
    if not clean_id:
        raise HTTPException(status_code=400, detail="Folder ID hoặc link thư mục không hợp lệ.")

    folder_info = client.get_folder_info(clean_id)
    if not folder_info:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy thư mục trên Google Drive hoặc bạn không có quyền truy cập.",
        )

    folder_name = payload.folder_name or folder_info.get("name", "Thư mục Drive")

    cfg = get_gdrive_config()
    cfg["folder_id"] = clean_id
    cfg["folder_name"] = folder_name
    save_gdrive_config(cfg)
    return get_status()


def create_new_folder(folder_name: str = "AI_Clean_Videos") -> GDriveStatusOut:
    """Tạo mới một thư mục trên Google Drive và đặt làm thư mục lưu trữ mặc định."""
    client = get_client()
    if not client:
        raise HTTPException(status_code=400, detail="Google Drive chưa được kết nối.")

    folder = client.create_folder(folder_name.strip() or "AI_Clean_Videos")
    cfg = get_gdrive_config()
    cfg["folder_id"] = folder["id"]
    cfg["folder_name"] = folder["name"]
    save_gdrive_config(cfg)
    return get_status()


def update_settings(payload: GDriveSettingsUpdateRequest) -> GDriveStatusOut:
    """Cập nhật cài đặt Google Drive."""
    cfg = get_gdrive_config()
    cfg["auto_upload"] = payload.auto_upload
    if payload.client_id is not None:
        cfg["client_id"] = payload.client_id.strip()
    if payload.client_secret is not None:
        cfg["client_secret"] = payload.client_secret.strip()
    save_gdrive_config(cfg)
    return get_status()


def disconnect() -> dict[str, Any]:
    """Ngắt kết nối tài khoản Google Drive."""
    cfg = get_gdrive_config()
    cfg.pop("tokens", None)
    cfg.pop("email", None)
    cfg.pop("name", None)
    cfg.pop("avatar_url", None)
    cfg["enabled"] = False
    save_gdrive_config(cfg)
    return {"ok": True, "message": "Đã ngắt kết nối Google Drive thành công."}


def upload_clean_video(payload: GDriveUploadRequest) -> GDriveUploadResponse:
    """Upload một file video lên Google Drive."""
    client = get_client()
    if not client:
        raise HTTPException(status_code=400, detail="Google Drive chưa được kết nối.")

    p = Path(payload.file_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"File video không tồn tại: {payload.file_path}")

    cfg = get_gdrive_config()
    target_folder_id = payload.folder_id or cfg.get("folder_id")

    try:
        res = client.upload_file_resumable(
            file_path=p,
            folder_id=target_folder_id,
            custom_name=payload.custom_name or p.name,
        )
        return GDriveUploadResponse(
            ok=True,
            file_id=res["file_id"],
            file_name=res["file_name"],
            web_view_link=res["web_view_link"],
            size_bytes=res["size_bytes"],
            message="Tải video lên Google Drive thành công!",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Upload lên Google Drive thất bại: {exc}",
        ) from exc
