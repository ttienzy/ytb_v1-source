import json
import logging
import os
from pathlib import Path
from typing import Any, Callable

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

logger = logging.getLogger(__name__)

# Cho phép Google tự động bổ sung openid scope mà không gây lỗi ScopeChangedError
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
os.environ["OAUTHLIB_IGNORE_TLS"] = "1"

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]




class GDriveClient:
    def __init__(self, token_data: dict, on_token_refreshed: Callable[[dict], None] | None = None):
        self.on_token_refreshed = on_token_refreshed
        self.creds = self._build_credentials(token_data)
        self._ensure_valid_token()
        self.service = build("drive", "v3", credentials=self.creds, cache_discovery=False)

    def _build_credentials(self, token_data: dict) -> Credentials:
        return Credentials(
            token=token_data.get("token") or token_data.get("access_token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=token_data.get("client_id"),
            client_secret=token_data.get("client_secret"),
            scopes=token_data.get("scopes", SCOPES),
        )

    def _ensure_valid_token(self) -> None:
        """Kiểm tra và tự động refresh token nếu hết hạn."""
        if not self.creds.valid:
            if self.creds.expired and self.creds.refresh_token:
                logger.info("[GDrive] Refreshing expired access token...")
                self.creds.refresh(Request())
                if self.on_token_refreshed:
                    new_token_data = {
                        "token": self.creds.token,
                        "refresh_token": self.creds.refresh_token,
                        "token_uri": self.creds.token_uri,
                        "client_id": self.creds.client_id,
                        "client_secret": self.creds.client_secret,
                        "scopes": self.creds.scopes,
                    }
                    self.on_token_refreshed(new_token_data)

    def get_user_info(self) -> dict[str, str]:
        """Lấy thông tin người dùng Google (email, tên, avatar)."""
        self._ensure_valid_token()
        try:
            r = requests.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {self.creds.token}"},
                timeout=15,
            )
            if r.ok:
                data = r.json()
                return {
                    "email": data.get("email", ""),
                    "name": data.get("name", ""),
                    "avatar_url": data.get("picture", ""),
                }
        except Exception as exc:
            logger.warning("[GDrive] Không thể lấy userinfo: %s", exc)
        return {"email": "", "name": "", "avatar_url": ""}

    def get_storage_quota(self) -> dict[str, int]:
        """Lấy dung lượng lưu trữ của Google Drive."""
        self._ensure_valid_token()
        try:
            about = self.service.about().get(fields="storageQuota,user").execute()
            quota = about.get("storageQuota", {})
            return {
                "used": int(quota.get("usage", 0)),
                "total": int(quota.get("limit", 0)),
            }
        except Exception as exc:
            logger.warning("[GDrive] Không thể lấy storageQuota: %s", exc)
            return {"used": 0, "total": 0}

    def get_folder_info(self, folder_id: str) -> dict[str, Any] | None:
        """Lấy thông tin của 1 thư mục."""
        self._ensure_valid_token()
        try:
            f = (
                self.service.files()
                .get(
                    fileId=folder_id,
                    fields="id, name, mimeType, webViewLink, trashed",
                )
                .execute()
            )
            if f.get("trashed"):
                return None
            return f
        except Exception:
            return None

    def create_folder(self, folder_name: str, parent_id: str | None = None) -> dict[str, str]:
        """Tạo một thư mục mới trên Google Drive."""
        self._ensure_valid_token()
        meta: dict[str, Any] = {
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        if parent_id:
            meta["parents"] = [parent_id]

        f = self.service.files().create(body=meta, fields="id, name, webViewLink").execute()
        return {
            "id": f.get("id", ""),
            "name": f.get("name", folder_name),
            "url": f.get("webViewLink", f"https://drive.google.com/drive/folders/{f.get('id')}"),
        }

    def get_or_create_default_folder(self, folder_name: str = "AI_Clean_Videos") -> dict[str, str]:
        """Tìm thư mục mặc định hoặc tạo mới nếu chưa có."""
        self._ensure_valid_token()
        query = (
            f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        )
        res = self.service.files().list(q=query, spaces="drive", fields="files(id, name, webViewLink)").execute()
        files = res.get("files", [])
        if files:
            first = files[0]
            return {
                "id": first["id"],
                "name": first.get("name", folder_name),
                "url": first.get("webViewLink", f"https://drive.google.com/drive/folders/{first['id']}"),
            }

        return self.create_folder(folder_name)

    def find_file_in_folder(self, file_name: str, folder_id: str | None = None) -> dict[str, Any] | None:
        """Tìm xem file đã tồn tại trong folder Google Drive hay chưa."""
        self._ensure_valid_token()
        query = f"name = '{file_name}' and trashed = false"
        if folder_id:
            query += f" and '{folder_id}' in parents"
        try:
            res = self.service.files().list(
                q=query,
                spaces="drive",
                fields="files(id, name, webViewLink, size)",
                pageSize=1,
            ).execute()
            files = res.get("files", [])
            if files:
                first = files[0]
                return {
                    "file_id": first["id"],
                    "file_name": first.get("name", file_name),
                    "web_view_link": first.get("webViewLink", f"https://drive.google.com/file/d/{first['id']}/view"),
                    "size_bytes": int(first.get("size", 0)),
                }
        except Exception as exc:
            logger.warning("[GDrive] Lỗi khi kiểm tra file tồn tại: %s", exc)
        return None

    def upload_file_resumable(
        self,
        file_path: str | Path,
        folder_id: str | None = None,
        custom_name: str | None = None,
        progress_callback: Callable[[int, int], None] | None = None,
        skip_if_exists: bool = True,
    ) -> dict[str, Any]:
        """Upload file video lên Google Drive dạng Resumable Chunked Upload (10MB chunks)."""
        self._ensure_valid_token()
        p = Path(file_path)
        if not p.exists():
            raise FileNotFoundError(f"File không tồn tại: {file_path}")

        file_name = custom_name or p.name
        file_size = p.stat().st_size

        # Kiểm tra file đã tồn tại trên Drive hay chưa để tránh upload trùng lặp
        if skip_if_exists:
            existing = self.find_file_in_folder(file_name, folder_id)
            if existing:
                logger.info("[GDrive] File %s đã tồn tại trên Drive (ID: %s). Bỏ qua upload mới.", file_name, existing["file_id"])
                return existing

        meta: dict[str, Any] = {"name": file_name}
        if folder_id:
            meta["parents"] = [folder_id]


        # 10MB chunk size
        chunk_size = 10 * 1024 * 1024
        media = MediaFileUpload(
            str(p),
            mimetype="video/mp4",
            chunksize=chunk_size,
            resumable=True,
        )

        request = self.service.files().create(
            body=meta,
            media_body=media,
            fields="id, name, webViewLink, size",
        )

        response = None
        while response is None:
            status, response = request.next_chunk()
            if status and progress_callback:
                progress_callback(int(status.resumable_progress), int(status.total_size or file_size))

        return {
            "file_id": response.get("id", ""),
            "file_name": response.get("name", file_name),
            "web_view_link": response.get("webViewLink", f"https://drive.google.com/file/d/{response.get('id')}/view"),
            "size_bytes": int(response.get("size", file_size)),
        }
