import httpx
from typing import Any


class MailTmError(Exception):
    """Lỗi phát sinh khi tương tác với Mail.tm API."""
    def __init__(self, message: str, status_code: int = 500, detail: Any = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.detail = detail


class MailTmClient:
    BASE_URL = "https://api.mail.tm"

    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout

    async def get_domains(self) -> list[dict]:
        """Lấy danh sách các domain khả dụng của Mail.tm."""
        async with httpx.AsyncClient(base_url=self.BASE_URL, timeout=self.timeout) as client:
            try:
                res = await client.get("/domains")
                if res.status_code != 200:
                    raise MailTmError(f"Không thể lấy danh sách domain: HTTP {res.status_code}", res.status_code, res.text)
                data = res.json()
                members = data.get("hydra:member", [])
                return [
                    {
                        "id": d.get("id"),
                        "domain": d.get("domain"),
                        "is_active": d.get("isActive", True),
                    }
                    for d in members
                    if d.get("isActive", True)
                ]
            except httpx.RequestError as exc:
                raise MailTmError(f"Lỗi kết nối tới Mail.tm: {exc}") from exc

    async def create_account(self, address: str, password: str) -> dict:
        """Tạo tài khoản mới với địa chỉ và mật khẩu tùy chỉnh."""
        async with httpx.AsyncClient(base_url=self.BASE_URL, timeout=self.timeout) as client:
            try:
                res = await client.post(
                    "/accounts",
                    json={"address": address, "password": password},
                    headers={"Content-Type": "application/json"},
                )
                if res.status_code == 201:
                    return res.json()
                elif res.status_code in (409, 422):
                    raise MailTmError(f"Tên email '{address}' đã tồn tại hoặc không hợp lệ.", 422, res.text)
                else:
                    raise MailTmError(f"Tạo tài khoản thất bại: HTTP {res.status_code}", res.status_code, res.text)
            except httpx.RequestError as exc:
                raise MailTmError(f"Lỗi kết nối tới Mail.tm: {exc}") from exc

    async def get_token(self, address: str, password: str) -> str:
        """Lấy Bearer Token (JWT) cho tài khoản."""
        async with httpx.AsyncClient(base_url=self.BASE_URL, timeout=self.timeout) as client:
            try:
                res = await client.post(
                    "/token",
                    json={"address": address, "password": password},
                    headers={"Content-Type": "application/json"},
                )
                if res.status_code == 200:
                    data = res.json()
                    token = data.get("token")
                    if not token:
                        raise MailTmError("Không nhận được token từ Mail.tm", 500)
                    return token
                elif res.status_code in (401, 403):
                    raise MailTmError("Sai email hoặc mật khẩu Mail.tm.", 401, res.text)
                else:
                    raise MailTmError(f"Lấy token thất bại: HTTP {res.status_code}", res.status_code, res.text)
            except httpx.RequestError as exc:
                raise MailTmError(f"Lỗi kết nối tới Mail.tm: {exc}") from exc

    async def get_messages(self, token: str, page: int = 1) -> list[dict]:
        """Lấy danh sách thư trong hộp thư."""
        async with httpx.AsyncClient(base_url=self.BASE_URL, timeout=self.timeout) as client:
            try:
                res = await client.get(
                    "/messages",
                    params={"page": page},
                    headers={"Authorization": f"Bearer {token}"},
                )
                if res.status_code == 200:
                    data = res.json()
                    return data.get("hydra:member", [])
                elif res.status_code == 401:
                    raise MailTmError("Token hết hạn hoặc không hợp lệ.", 401)
                else:
                    raise MailTmError(f"Lấy danh sách tin nhắn thất bại: HTTP {res.status_code}", res.status_code, res.text)
            except httpx.RequestError as exc:
                raise MailTmError(f"Lỗi kết nối tới Mail.tm: {exc}") from exc

    async def get_message_detail(self, token: str, message_id: str) -> dict:
        """Lấy chi tiết một email (nội dung text, html, attachments)."""
        async with httpx.AsyncClient(base_url=self.BASE_URL, timeout=self.timeout) as client:
            try:
                res = await client.get(
                    f"/messages/{message_id}",
                    headers={"Authorization": f"Bearer {token}"},
                )
                if res.status_code == 200:
                    return res.json()
                elif res.status_code == 401:
                    raise MailTmError("Token hết hạn hoặc không hợp lệ.", 401)
                elif res.status_code == 404:
                    raise MailTmError("Không tìm thấy tin nhắn.", 404)
                else:
                    raise MailTmError(f"Đọc tin nhắn thất bại: HTTP {res.status_code}", res.status_code, res.text)
            except httpx.RequestError as exc:
                raise MailTmError(f"Lỗi kết nối tới Mail.tm: {exc}") from exc

    async def delete_account(self, token: str, account_id: str) -> bool:
        """Xóa tài khoản trên hệ thống Mail.tm."""
        async with httpx.AsyncClient(base_url=self.BASE_URL, timeout=self.timeout) as client:
            try:
                res = await client.delete(
                    f"/accounts/{account_id}",
                    headers={"Authorization": f"Bearer {token}"},
                )
                return res.status_code in (200, 204)
            except httpx.RequestError as exc:
                raise MailTmError(f"Lỗi kết nối tới Mail.tm: {exc}") from exc
