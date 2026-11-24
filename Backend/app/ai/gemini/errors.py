"""Lỗi của luồng Gemini web. Tách riêng để kho tài khoản (accounts/pool) và recap.py cùng dùng mà không import vòng.

recap.py re-export các tên này, nên code cũ `from app.ai.gemini.recap import GeminiAuthError…` vẫn chạy.
"""


class RecapConfigError(RuntimeError):
    """Thiếu cấu hình Gemini để gọi được (lớp cha; hiện chỉ còn trường hợp chưa có tài khoản)."""


class GeminiNotLoggedInError(RecapConfigError):
    """Chưa có tài khoản Gemini nào: người dùng phải thêm một tài khoản (Cài đặt → Gemini → “(+) Thêm account
    Gemini”). Là lỗi đăng nhập như ``GeminiAuthError`` (giao diện gợi ý làm mới), khác với lỗi mạng/Google."""


class GeminiAuthError(RuntimeError):
    """Phiên/cookie Gemini không hợp lệ THẬT SỰ (Google trả trang không có token, 401/403).

    Chỉ lỗi này mới đáng mở Chrome refresh cookie. Đã refresh mà vẫn lỗi → đánh dấu tài khoản lỗi và thử tài khoản khác
    (hết tài khoản → dừng hẳn, vòng ngoài không retry).
    """


class GeminiTransientError(RuntimeError):
    """Lỗi tạm thời (mạng đứt/timeout, Google 5xx) — thử lại nhanh, TUYỆT ĐỐI không mở Chrome refresh."""


class GeminiRateLimitError(RuntimeError):
    """Bị giới hạn tốc độ (429): còn tài khoản khác thì chuyển ngay, hết thì chờ/dừng và báo rõ."""
