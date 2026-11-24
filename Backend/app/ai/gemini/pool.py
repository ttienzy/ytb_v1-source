"""Chọn tài khoản Gemini + xoay khi lỗi (giống pool ChatGPT). Mọi đường gọi Gemini web đi qua `failover`.

- `select(exclude)`: tài khoản dùng được tốt nhất (active trước, rồi dùng lâu nhất) không nằm trong `exclude`.
- `account_config(acc)`: cookie + UA + template cho một tài khoản (template chung: bản capture trong config.json, không thì
  bản đóng gói sẵn — không gắn tài khoản).
- `failover(attempt)`: chạy `attempt(exclude)`; lỗi đăng nhập (đã làm mới mà vẫn hỏng) → đánh dấu "error", lỗi giới hạn
  tốc độ → "exhausted"; rồi thử tài khoản kế. Hết tài khoản → ném lại lỗi cuối.
"""
from __future__ import annotations

from typing import Callable, TypeVar

from app.ai.gemini.accounts import get_store
from app.ai.gemini.errors import GeminiAuthError, GeminiNotLoggedInError, GeminiRateLimitError
from app.ai.gemini.template import DEFAULT_UA, load_bundled_inner_template
from app.core.storage import read_config

T = TypeVar("T")

NO_ACCOUNT_MSG = ("Chưa có tài khoản Gemini: vào Cài đặt → Gemini & YouTube → “(+) Thêm account Gemini” "
                  "(đăng nhập Google một lần trong cửa sổ Chrome).")
NO_USABLE_MSG = ("Không có tài khoản Gemini nào dùng được (hết phiên hoặc đang bị giới hạn). Vào Cài đặt → Gemini & YouTube "
                 "để làm mới / đăng nhập lại hoặc thêm account khác.")
AUTH_MESSAGE = "Cookie hết hạn — đăng nhập lại"


def select(exclude: frozenset[str] = frozenset()) -> tuple[dict | None, int]:
    """(tài khoản tốt nhất, số tài khoản dùng được còn lại sau nó). None nếu hết."""
    usable = [a for a in get_store().usable_accounts() if a["id"] not in exclude]
    return (usable[0], len(usable) - 1) if usable else (None, 0)


def account_config(acc: dict, alternatives: int = 0) -> dict:
    captured = read_config().get("gemini", {}).get("inner_template")
    return {
        "account_id": acc["id"],
        "label": acc.get("email") or acc["id"],
        "cookies": acc["cookies"],
        "user_agent": acc.get("ua") or DEFAULT_UA,
        "inner_template": captured or load_bundled_inner_template(),
        "template_source": "captured" if captured else "bundled",
        "alternatives": alternatives,
    }


def config_for(account_id: str, exclude: frozenset[str] = frozenset()) -> dict:
    """Cấu hình MỚI NHẤT của đúng một tài khoản (đọc lại sau khi làm mới cookie)."""
    store = get_store()
    acc = store.get_account(account_id)
    if not acc or not acc.get("cookies"):
        raise GeminiNotLoggedInError(NO_ACCOUNT_MSG)
    alternatives = len([a for a in store.usable_accounts() if a["id"] != account_id and a["id"] not in exclude])
    return account_config(acc, alternatives)


def current_config(exclude: frozenset[str] = frozenset()) -> dict:
    """Cấu hình của tài khoản sẽ dùng cho lần gọi kế tiếp."""
    store = get_store()
    if not store.list_raw():
        raise GeminiNotLoggedInError(NO_ACCOUNT_MSG)
    acc, alternatives = select(exclude)
    if acc is None:
        raise GeminiAuthError(NO_USABLE_MSG)
    return account_config(acc, alternatives)


def mark_ok(account_id: str) -> None:
    """Gọi thành công: ghi nhận đã dùng và đưa account (đang "error" nhưng cookie còn tốt) về sẵn sàng."""
    store = get_store()
    acc = store.get_account(account_id)
    if acc and acc.get("status") != "active":
        store.set_status(account_id, "active", "")
    store.touch(account_id)


def failover(attempt: Callable[[frozenset[str]], T], log: Callable[[str], None] = lambda _m: None) -> T:
    """Chạy `attempt(exclude)`; lỗi gắn `account_id` (do attempt đặt) → đánh dấu rồi thử tài khoản kế."""
    exclude: set[str] = set()
    while True:
        try:
            return attempt(frozenset(exclude))
        except (GeminiAuthError, GeminiRateLimitError) as exc:
            account_id = getattr(exc, "account_id", None)
            if not account_id:
                raise
            store = get_store()
            if isinstance(exc, GeminiAuthError):
                store.set_status(account_id, "error", AUTH_MESSAGE)
            else:
                store.set_status(account_id, "exhausted", f"Đụng giới hạn: {str(exc)[:100]}")
            exclude.add(account_id)
            if select(frozenset(exclude))[0] is None:
                raise
            log(f"[Gemini] Tài khoản {account_id} lỗi ({type(exc).__name__}) → chuyển tài khoản khác.")


def tag_account(exc: Exception, account_id: str) -> Exception:
    """Gắn tài khoản vừa lỗi vào ngoại lệ để `failover` biết đánh dấu tài khoản nào."""
    exc.account_id = account_id  # type: ignore[attr-defined]
    return exc
