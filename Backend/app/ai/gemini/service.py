import re
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from typing import Callable

import httpx
from fastapi import HTTPException
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from app.core.config import settings
from app.core.storage import read_config, write_config


AUTH_COOKIE_NAMES = {"SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"}
# Thời gian tối đa chờ NGƯỜI DÙNG đăng nhập trong cửa sổ Chrome (chỉ dùng khi profile chưa/hết đăng nhập).
LOGIN_TIMEOUT_SECONDS = 60
CDP_START_TIMEOUT_SECONDS = 20     # Chrome mở cổng debug (thường < 1s; khởi động nguội vài giây)
CDP_CONNECT_TIMEOUT_SECONDS = 10   # Playwright nối vào Chrome
POLL_INTERVAL_SECONDS = 0.5
_FALLBACK_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
)


def _session_valid(cookie_header: str, user_agent: str) -> bool | None:
    """Cookie này vào được Gemini không? ``True``/``False``; ``None`` = không xác định (lỗi mạng/5xx)."""
    try:
        with httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=True) as client:
            r = client.get(
                "https://gemini.google.com/app",
                headers={"User-Agent": user_agent or _FALLBACK_UA, "Cookie": cookie_header},
            )
    except httpx.HTTPError:
        return None
    if r.status_code >= 500:
        return None
    return bool(re.search(r'"SNlM0e":"(.*?)"', r.text))


def login_and_save_cookie(
    on_step: Callable[[str], None] | None = None,
    login_timeout: int = LOGIN_TIMEOUT_SECONDS,
) -> dict:
    """Mở Chrome thật (profile riêng) để lấy cookie Gemini còn hiệu lực rồi lưu vào config.

    - Profile đã đăng nhập sẵn: lấy cookie và KIỂM TRA nó vào được Gemini rồi mới lưu (~2s).
    - Chưa/hết đăng nhập: chờ người dùng đăng nhập trong cửa sổ Chrome tối đa ``login_timeout`` giây,
      đếm ngược qua ``on_step``.
    - Thất bại sớm, đúng lý do: Chrome tắt ngay (profile bị Chrome khác giữ), không nối được CDP, Chrome bị đóng.
    - ``on_step(text)``: báo bước đang làm (giao diện hiển thị để người dùng biết không bị treo).
    """
    if not settings.chrome_executable.exists():
        raise HTTPException(status_code=503, detail=f"Không tìm thấy Chrome: {settings.chrome_executable}")

    settings.chrome_profile_dir.mkdir(parents=True, exist_ok=True)
    cdp_port = 9224
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
                f"--user-data-dir={settings.chrome_profile_dir}",
                f"--remote-debugging-port={cdp_port}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--disable-default-apps",
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
                        f"Vào Cài đặt → Đăng nhập Gemini (Chrome) rồi thử lại.",
                    )
                time.sleep(2.0 if not needs_login else POLL_INTERVAL_SECONDS)

            _mark("session_verified")
            _step("Lưu cookie")
            # Cookie vừa được kiểm tra hợp lệ nên không cần chờ thêm; đọc lại 1 lần để lấy giá trị mới nhất.
            try:
                refreshed = context.cookies(["https://gemini.google.com"])
                if any(c["name"] in AUTH_COOKIE_NAMES for c in refreshed):
                    cookies = refreshed
            except Exception:
                pass

            config = read_config()
            gemini_update = {
                "cookies": "; ".join(f"{cookie['name']}={cookie['value']}" for cookie in cookies),
                "cookie_count": len(cookies),
                "saved_at": datetime.now(timezone.utc).isoformat(),
            }
            if user_agent:
                gemini_update["user_agent"] = user_agent

            config["gemini"].update(gemini_update)
            write_config(config)
            _mark("config_written")
            try:
                browser.close()
            except Exception:
                pass
            return {"ok": True, "has_cookie": True, "cookie_count": len(cookies)}
    except HTTPException:
        raise
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail="Gemini không phản hồi trong thời gian chờ") from error
    except Exception as error:
        raise HTTPException(status_code=409, detail=f"Lỗi khi đọc cookie Gemini: {error}") from error
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        _mark("chrome_closed")
        print(f"[Gemini cookie] thoi gian cac buoc (s): {steps}", flush=True)
