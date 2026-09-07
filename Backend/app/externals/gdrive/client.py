import io
import json
import logging
import os
from pathlib import Path
from typing import Any, Callable

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

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
                    fields="id, name, mimeType, webViewLink, trashed, parents",
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

    def rename_folder(self, folder_id: str, folder_name: str) -> dict[str, str]:
        """Đổi tên một folder Google Drive mà không thay đổi vị trí hoặc ID."""
        self._ensure_valid_token()
        f = self.service.files().update(
            fileId=folder_id,
            body={"name": folder_name.strip()},
            fields="id, name, webViewLink",
        ).execute()
        return {
            "id": f.get("id", folder_id),
            "name": f.get("name", folder_name),
            "url": f.get("webViewLink", f"https://drive.google.com/drive/folders/{folder_id}"),
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

    def list_folders(
        self,
        parent_id: str = "root",
        search: str = "",
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """Lấy danh sách thư mục trong một cấp cha (mặc định là thư mục gốc 'root' của Drive)."""
        self._ensure_valid_token()
        clauses = [
            "mimeType = 'application/vnd.google-apps.folder'",
            "trashed = false",
        ]
        if parent_id and parent_id.strip():
            clauses.append(f"'{parent_id.strip()}' in parents")
            if parent_id.strip() == "root":
                clauses.append("'me' in owners")
        if search and search.strip():
            clean = search.strip().replace("'", "\\'")
            clauses.append(f"name contains '{clean}'")

        query = " and ".join(clauses)
        res = self.service.files().list(
            q=query,
            spaces="drive",
            fields="files(id, name, webViewLink, modifiedTime, parents)",
            pageSize=page_size,
            orderBy="name",
        ).execute()

        out = []
        for f in res.get("files", []):
            name = f.get("name", "")
            if not search and (name.startswith(".") or "node_modules" in name or ".git" in name):
                continue
            out.append({
                "id": f.get("id", ""),
                "name": name,
                "url": f.get("webViewLink", f"https://drive.google.com/drive/folders/{f.get('id')}"),
                "modified_time": f.get("modifiedTime", ""),
            })
        return out

    def list_videos(
        self,
        folder_id: str | None = None,
        search: str = "",
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """Lấy danh sách file video trong một thư mục Google Drive."""
        self._ensure_valid_token()
        clauses = ["trashed = false", "(mimeType contains 'video/' or name contains '.mp4')"]
        if folder_id:
            clauses.append(f"'{folder_id}' in parents")
        if search and search.strip():
            clean_search = search.strip().replace("'", "\\'")
            clauses.append(f"name contains '{clean_search}'")

        query = " and ".join(clauses)
        res = self.service.files().list(
            q=query,
            spaces="drive",
            fields="files(id, name, size, mimeType, webViewLink, thumbnailLink, createdTime, videoMediaMetadata)",
            pageSize=page_size,
            orderBy="createdTime desc",
        ).execute()

        out = []
        for f in res.get("files", []):
            vmeta = f.get("videoMediaMetadata") or {}
            dur_ms = vmeta.get("durationMillis")
            dur_sec = max(1, round(float(dur_ms) / 1000)) if dur_ms else 10  # Làm tròn chuẩn xác (9.6s-9.9s -> 10s)

            out.append({
                "id": f.get("id", ""),
                "name": f.get("name", ""),
                "size_bytes": int(f.get("size", 0)),
                "mime_type": f.get("mimeType", "video/mp4"),
                "web_view_link": f.get("webViewLink", f"https://drive.google.com/file/d/{f.get('id')}/view"),
                "thumbnail_link": f.get("thumbnailLink", ""),
                "created_time": f.get("createdTime", ""),
                "duration_seconds": dur_sec,
                "width": vmeta.get("width"),
                "height": vmeta.get("height"),
            })
        return out

    def download_file(self, file_id: str, dest_path: str | Path) -> Path:
        """Tải một file từ Google Drive về đường dẫn local."""
        self._ensure_valid_token()
        dest = Path(dest_path)
        dest.parent.mkdir(parents=True, exist_ok=True)

        request = self.service.files().get_media(fileId=file_id)
        with open(dest, "wb") as fh:
            downloader = MediaIoBaseDownload(fh, request, chunksize=10 * 1024 * 1024)
            done = False
            while not done:
                _, done = downloader.next_chunk()
        return dest

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

        try:
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
        except Exception as exc:
            # Nếu thư mục cha bị xóa/không tìm thấy (404), tự động tạo lại thư mục mặc định và upload lại
            if folder_id and ("File not found" in str(exc) or "notFound" in str(exc) or "404" in str(exc)):
                logger.warning("[GDrive] Folder ID '%s' không tồn tại trên Drive. Đang tự tạo lại thư mục mới...", folder_id)
                new_folder = self.create_folder("AI_Clean_Videos")
                return self.upload_file_resumable(
                    file_path=file_path,
                    folder_id=new_folder["id"],
                    custom_name=custom_name,
                    progress_callback=progress_callback,
                    skip_if_exists=False,
                )
            raise
