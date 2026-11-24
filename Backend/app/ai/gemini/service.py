import re
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Callable

import httpx
from fastapi import HTTPException
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from app.ai.gemini.accounts import get_store, profiles_dir
from app.ai.gemini.template import DEFAULT_UA
from app.core.chrome import close_chrome_gracefully, find_free_cdp_port
from app.core.config import settings


AUTH_COOKIE_NAMES = {"SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"}
# Thời gian tối đa chờ NGƯỜI DÙNG đăng nhập trong cửa sổ Chrome (thêm account / đăng nhập lại).
LOGIN_TIMEOUT_SECONDS = 300
# Làm mới ngầm bằng profile ấm: chưa đăng nhập thì thất bại nhanh, không chờ người dùng.
REFRESH_LOGIN_TIMEOUT_SECONDS = 12
GEMINI_CDP_START_PORT = 9400       # Muse dùng 9300–9399, ChatGPT từ 9228: dải riêng cho Gemini
CDP_START_TIMEOUT_SECONDS = 20     # Chrome mở cổng debug (thường < 1s; khởi động nguội vài giây)
CDP_CONNECT_TIMEOUT_SECONDS = 10   # Playwright nối vào Chrome
POLL_INTERVAL_SECONDS = 0.5
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def _session_valid(cookie_header: str, user_agent: str) -> bool | None:
    """Cookie này vào được Gemini không? ``True``/``False``; ``None`` = không xác định (lỗi mạng/5xx)."""
    try:
        with httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=True) as client:
            r = client.get(
                "https://gemini.google.com/app",
                headers={"User-Agent": user_agent or DEFAULT_UA, "Cookie": cookie_header},
            )
    except httpx.HTTPError:
        return None
    if r.status_code >= 500:
        return None
    return bool(re.search(r'"SNlM0e":"(.*?)"', r.text))


def _page_email(page) -> str:
    """Email tài khoản Google đang đăng nhập (nút avatar có aria-label "Google Account: Tên (email)"); rỗng nếu không thấy."""
    try:
        label = page.evaluate(
            "() => { const a = document.querySelector('a[aria-label*=\"@\"], button[aria-label*=\"@\"]');"
            " return a ? (a.getAttribute('aria-label') || '') : '' }")
    except Exception:  # noqa: BLE001
        return ""
    m = _EMAIL_RE.search(label or "") if isinstance(label, str) else None
    return m.group(0) if m else ""


def capture_session(
    profile_dir: Path | str,
    on_step: Callable[[str], None] | None = None,
    login_timeout: int = LOGIN_TIMEOUT_SECONDS,
    visible: bool = True,
    cdp_port: int | None = None,
) -> dict:
    """Mở Chrome thật với profile `profile_dir`, lấy phiên Gemini còn hiệu lực: {cookies, user_agent, email}.

    - Profile đã đăng nhập sẵn: lấy cookie và KIỂM TRA nó vào được Gemini (~2s).
    - Chưa/hết đăng nhập: chờ người dùng đăng nhập trong cửa sổ Chrome tối đa ``login_timeout`` giây (đếm ngược qua
      ``on_step``). ``visible=False`` đặt cửa sổ ngoài màn hình (làm mới ngầm).
    - Thất bại sớm, đúng lý do: Chrome tắt ngay (profile bị Chrome khác giữ), không nối được CDP, Chrome bị đóng.
    - Chrome được đóng ÊM (app.core.chrome) để profile ghi cookie xuống đĩa. Không ghi gì vào kho tài khoản.
    """
    if not settings.chrome_executable.exists():
        raise HTTPException(status_code=503, detail=f"Không tìm thấy Chrome: {settings.chrome_executable}")

    profile_dir = Path(profile_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)
    cdp_port = cdp_port or find_free_cdp_port(GEMINI_CDP_START_PORT)
    cdp_url = f"http://127.0.0.1:{cdp_port}"

    # Đo từng bước (giây từ lúc bắt đầu); in 1 dòng ở cuối để biết thời gian refresh đi đâu.
    t0 = time.perf_counter()
    steps: dict[str, float] = {}

    def _mark(name: str) -> None:
        steps[name] = round(time.perf_counter() - t0, 1)

    last_step = [""]

    def _step(msg: str) -> None:
        if on_step is None or msg == last_step[0]:
            return
        last_step[0] = msg
        try:
            on_step(msg)
        except Exception:
            pass

    _step("Mở Chrome (profile Gemini)")
    try:
        # Chrome thật — không qua Playwright launch — để Google không gắn nhãn
        # phiên đăng nhập là automation. Khởi động thẳng vào gemini.google.com/app.
        proc = subprocess.Popen(
            [
                str(settings.chrome_executable),
                f"--user-data-dir={profile_dir}",
                f"--remote-debugging-port={cdp_port}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--disable-default-apps",
                *([] if visible else ["--window-position=-2400,-2400", "--window-size=560,820"]),
                "https://gemini.google.com/app",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as error:
        raise HTTPException(status_code=409, detail=f"Không thể mở Chrome thật: {error}") from error

    _mark("chrome_launched")
    try:
        # 1) Chờ cổng CDP. Kiểm tra CDP TRƯỚC khi kết luận Chrome đã thoát (nếu đã có một Chrome của app đang
        #    chạy, tiến trình mới sẽ giao việc cho nó rồi thoát nhưng CDP vẫn dùng được).
        deadline = time.monotonic() + CDP_START_TIMEOUT_SECONDS
        cdp_up = False
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(f"{cdp_url}/json/version", timeout=2) as response:
                    if response.status == 200:
                        cdp_up = True
                        break
            except Exception:
                pass
            if proc.poll() is not None:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Chrome tắt ngay khi mở: profile Gemini đang được một cửa sổ Chrome khác giữ. "
                        "Đóng cửa sổ Chrome của app đang mở rồi thử lại."
                    ),
                )
            time.sleep(POLL_INTERVAL_SECONDS)

        if not cdp_up:
            raise HTTPException(
                status_code=504,
                detail=f"Chrome không mở CDP tại {cdp_url} sau {CDP_START_TIMEOUT_SECONDS} giây. Hãy đóng toàn bộ Chrome rồi thử lại.",
            )

        _mark("cdp_ready")
        own_chrome = proc.poll() is None  # False = đang dùng một Chrome có sẵn → không coi "tiến trình đã thoát" là lỗi
        cookies: list = []
        user_agent: str = ""
        with sync_playwright() as playwright:
            _step("Kết nối Chrome")
            browser = None
            deadline = time.monotonic() + CDP_CONNECT_TIMEOUT_SECONDS
            while browser is None and time.monotonic() < deadline:
                try:
                    browser = playwright.chromium.connect_over_cdp(cdp_url)
                except Exception:
                    time.sleep(POLL_INTERVAL_SECONDS)
            if browser is None:
                raise HTTPException(status_code=504, detail="Không kết nối được Chrome qua CDP.")

            try:
                context = browser.contexts[0] if browser.contexts else browser.new_context()
                _mark("playwright_connected")

                _step("Đọc phiên đăng nhập")
                login_deadline = time.monotonic() + login_timeout
                while True:
                    if own_chrome and proc.poll() is not None:
                        raise HTTPException(
                            status_code=408,
                            detail="Trình duyệt Chrome đã bị đóng trước khi hoàn tất lấy cookie.",
                        )

                    # Quét đa tab: tìm tab gemini hoặc accounts; chưa có thì đưa tab đầu tới Gemini.
                    pages = context.pages
                    gemini_page = None
                    accounts_page = None
                    for p in pages:
                        try:
                            u = p.url
                            if "gemini.google.com" in u:
                                gemini_page = p
                                break
                            elif "accounts.google.com" in u:
                                accounts_page = p
                        except Exception:
                            pass
                    if not gemini_page and not accounts_page and pages:
                        try:
                            pages[0].goto("https://gemini.google.com/app")
                        except Exception:
                            pass

                    # Cookie chuẩn riêng cho https://gemini.google.com (tránh CookieMismatch)
                    try:
                        current_cookies = context.cookies(["https://gemini.google.com"])
                    except Exception:
                        current_cookies = []

                    needs_login = True
                    if any(c["name"] in AUTH_COOKIE_NAMES for c in current_cookies):
                        target_page = gemini_page or (pages[0] if pages else None)
                        ua = ""
                        if target_page:
                            try:
                                ua = target_page.evaluate("() => navigator.userAgent")
                            except Exception:
                                ua = ""
                        header = "; ".join(f"{c['name']}={c['value']}" for c in current_cookies)
                        valid = _session_valid(header, ua)
                        # False = có cookie nhưng Google không nhận (hết hạn/đã đăng xuất). None = không xác định được
                        # (mạng) → không chặn, lưu luôn; việc gọi Gemini sau đó sẽ báo lỗi mạng rõ ràng nếu có.
                        if valid is not False:
                            cookies, user_agent = current_cookies, ua
                            break
                        needs_login = accounts_page is not None

                    remaining = max(0, int(login_deadline - time.monotonic()))
                    if needs_login:
                        _step(f"Chưa đăng nhập: hãy đăng nhập Google trong cửa sổ Chrome (còn {remaining}s)")
                    else:
                        _step(f"Chờ Gemini xác nhận phiên đăng nhập (còn {remaining}s)")
                    if time.monotonic() >= login_deadline:
                        raise HTTPException(
                            status_code=408,
                            detail=f"Chưa đăng nhập được Gemini sau {login_timeout} giây. "
                            f"Bấm “(+) Thêm account Gemini” hoặc “Đăng nhập lại” trong Cài đặt rồi thử lại.",
                        )
                    time.sleep(2.0 if not needs_login else POLL_INTERVAL_SECONDS)

                _mark("session_verified")
                _step("Đọc tài khoản")
                # Cookie vừa được kiểm tra hợp lệ nên không cần chờ thêm; đọc lại 1 lần để lấy giá trị mới nhất.
                try:
                    refreshed = context.cookies(["https://gemini.google.com"])
                    if any(c["name"] in AUTH_COOKIE_NAMES for c in refreshed):
                        cookies = refreshed
                except Exception:
                    pass

                email_page = gemini_page or (context.pages[0] if context.pages else None)
                email = _page_email(email_page) if email_page else ""
                _mark("session_captured")
                return {
                    "cookies": "; ".join(f"{c['name']}={c['value']}" for c in cookies),
                    "cookie_count": len(cookies),
                    "user_agent": user_agent or DEFAULT_UA,
                    "email": email,
                }
            finally:
                # Đóng ÊM để profile ghi cookie đăng nhập/xoay vòng xuống đĩa (app.core.chrome). Chrome có sẵn (không do
                # app mở) thì chỉ ngắt kết nối, không tắt.
                if own_chrome:
                    close_chrome_gracefully(browser, proc)
                else:
                    try:
                        browser.close()
                    except Exception:
                        pass
    except HTTPException:
        raise
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail="Gemini không phản hồi trong thời gian chờ") from error
    except Exception as error:
        raise HTTPException(status_code=409, detail=f"Lỗi khi đọc cookie Gemini: {error}") from error
    finally:
        # Lỗi trước khi nối được CDP (Chrome chưa mở xong / profile bị giữ): chưa có cookie nào để mất → tắt luôn.
        # Đường bình thường đã đóng êm ở trên nên tới đây proc đã thoát.
        close_chrome_gracefully(None, proc, wait_seconds=0)
        _mark("chrome_closed")
        print(f"[Gemini cookie] thoi gian cac buoc (s): {steps}", flush=True)


def add_account(on_step: Callable[[str], None] | None = None, login_timeout: int = LOGIN_TIMEOUT_SECONDS) -> dict:
    """“(+) Thêm account Gemini”: profile Chrome mới → người dùng đăng nhập Google → lưu account (trùng email = cập nhật)."""
    profile = profiles_dir() / f"gemini-{int(time.time() * 1000)}"
    session = capture_session(profile, on_step=on_step, login_timeout=login_timeout, visible=True)
    return get_store().add_account(email=session["email"], cookies=session["cookies"], ua=session["user_agent"],
                                   partition=str(profile))


def refresh_account(
    account_id: str,
    on_step: Callable[[str], None] | None = None,
    interactive: bool = False,
) -> dict:
    """Làm mới cookie của một account bằng profile Chrome ấm của nó.

    Mặc định ngầm (cửa sổ ngoài màn hình, chưa đăng nhập thì thất bại nhanh); ``interactive=True`` = “Đăng nhập lại”
    (cửa sổ hiện, chờ người dùng đăng nhập)."""
    store = get_store()
    acc = store.get_account(account_id)
    if not acc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản Gemini.")
    if not acc.get("partition"):
        raise HTTPException(status_code=400, detail="Tài khoản không có profile Chrome lưu sẵn — hãy thêm lại tài khoản.")
    try:
        session = capture_session(
            acc["partition"], on_step=on_step, visible=interactive,
            login_timeout=LOGIN_TIMEOUT_SECONDS if interactive else REFRESH_LOGIN_TIMEOUT_SECONDS)
    except HTTPException as exc:
        if exc.status_code == 408:
            store.set_status(account_id, "error", "Hết phiên đăng nhập — bấm “Đăng nhập lại”")
        raise
    updated = store.update_account(account_id, cookies=session["cookies"], ua=session["user_agent"], status="active", message="")
    return updated or {}
