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

os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
os.environ["OAUTHLIB_IGNORE_TLS"] = "1"

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

DEFAULT_CATEGORIES = [
    {"id": "1", "title": "Phim & Hoạt hình (Film & Animation)"},
    {"id": "2", "title": "Ô tô & Xe cộ (Autos & Vehicles)"},
    {"id": "10", "title": "Âm nhạc (Music)"},
    {"id": "15", "title": "Thú cưng & Động vật (Pets & Animals)"},
    {"id": "17", "title": "Thể thao (Sports)"},
    {"id": "20", "title": "Trò chơi (Gaming)"},
    {"id": "22", "title": "Mọi người & Blog (People & Blogs)"},
    {"id": "23", "title": "Hài kịch (Comedy)"},
    {"id": "24", "title": "Giải trí (Entertainment)"},
    {"id": "25", "title": "Tin tức & Chính trị (News & Politics)"},
    {"id": "26", "title": "Hướng dẫn & Phong cách (Howto & Style)"},
    {"id": "27", "title": "Giáo dục (Education)"},
    {"id": "28", "title": "Khoa học & Công nghệ (Science & Technology)"},
]


class YouTubeClient:
    def __init__(self, token_data: dict, on_token_refreshed: Callable[[dict], None] | None = None):
        self.on_token_refreshed = on_token_refreshed
        self.creds = self._build_credentials(token_data)
        self._ensure_valid_token()
        self.service = build("youtube", "v3", credentials=self.creds, cache_discovery=False)

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
                logger.info("[YouTube] Refreshing expired access token...")
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
            logger.warning("[YouTube] Không thể lấy userinfo: %s", exc)
        return {"email": "", "name": "", "avatar_url": ""}

    def get_channel_info(self) -> dict[str, Any]:
        """Lấy thông tin kênh YouTube của tài khoản hiện tại."""
        self._ensure_valid_token()
        try:
            res = self.service.channels().list(mine=True, part="snippet,statistics").execute()
            items = res.get("items", [])
            if not items:
                return {}
            channel = items[0]
            snippet = channel.get("snippet", {})
            stats = channel.get("statistics", {})
            thumbs = snippet.get("thumbnails", {})
            avatar = (
                thumbs.get("high", {}).get("url")
                or thumbs.get("medium", {}).get("url")
                or thumbs.get("default", {}).get("url")
                or ""
            )

            return {
                "channel_id": channel.get("id", ""),
                "channel_title": snippet.get("title", ""),
                "channel_custom_url": snippet.get("customUrl", ""),
                "channel_avatar_url": avatar,
                "subscriber_count": int(stats.get("subscriberCount", 0)),
                "video_count": int(stats.get("videoCount", 0)),
            }
        except Exception as exc:
            logger.warning("[YouTube] Không thể lấy thông tin kênh YouTube: %s", exc)
            return {}

    def get_video_categories(self, region_code: str = "VN") -> list[dict[str, str]]:
        """Lấy danh sách các danh mục video (Video Categories) từ YouTube."""
        self._ensure_valid_token()
        try:
            res = self.service.videoCategories().list(part="snippet", regionCode=region_code).execute()
            items = res.get("items", [])
            categories = []
            for item in items:
                if item.get("snippet", {}).get("assignable", False):
                    categories.append({
                        "id": item.get("id", ""),
                        "title": item.get("snippet", {}).get("title", ""),
                    })
            if categories:
                return categories
        except Exception as exc:
            logger.warning("[YouTube] Không thể lấy video categories: %s. Dùng danh mục mặc định.", exc)
        return DEFAULT_CATEGORIES

    def upload_video(
        self,
        file_path: str | Path,
        title: str,
        description: str = "",
        tags: list[str] | None = None,
        category_id: str = "24",
        privacy_status: str = "public",
        publish_at: str | None = None,
        made_for_kids: bool = False,
        chunksize: int = 5 * 1024 * 1024,
    ) -> dict[str, Any]:
        """Thực hiện Resumable Upload file video lên YouTube."""
        self._ensure_valid_token()
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File video không tồn tại: {file_path}")

        status_dict: dict[str, Any] = {
            "selfDeclaredMadeForKids": made_for_kids,
        }

        # Nếu có hẹn giờ (publish_at), bắt buộc privacyStatus phải là "private"
        if publish_at and publish_at.strip():
            status_dict["privacyStatus"] = "private"
            status_dict["publishAt"] = publish_at.strip()
        else:
            clean_privacy = privacy_status.lower() if privacy_status else "public"
            if clean_privacy not in ["public", "unlisted", "private"]:
                clean_privacy = "public"
            status_dict["privacyStatus"] = clean_privacy

        body = {
            "snippet": {
                "title": title[:100],  # YouTube giới hạn tiêu đề tối đa 100 ký tự
                "description": description[:5000],  # Mô tả tối đa 5000 ký tự
                "tags": [t.strip() for t in tags if t.strip()][:500] if tags else [],
                "categoryId": str(category_id or "24"),
            },
            "status": status_dict,
        }

        media = MediaFileUpload(
            str(path),
            chunksize=chunksize,
            resumable=True,
            mimetype="video/*",
        )

        insert_request = self.service.videos().insert(
            part="snippet,status",
            body=body,
            media_body=media,
        )

        response = None
        while response is None:
            status, response = insert_request.next_chunk()
            if status:
                logger.info("[YouTube] Uploading %s: %.1f%%", path.name, status.progress() * 100)

        video_id = response.get("id", "")
        return {
            "video_id": video_id,
            "youtube_url": f"https://youtu.be/{video_id}" if video_id else "",
            "title": response.get("snippet", {}).get("title", title),
            "status": "scheduled" if (publish_at and publish_at.strip()) else status_dict.get("privacyStatus", "published"),
            "raw": response,
        }
