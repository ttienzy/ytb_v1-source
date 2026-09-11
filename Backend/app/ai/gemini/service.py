from datetime import datetime, timezone

from fastapi import HTTPException
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from app.core.config import settings
from app.core.storage import read_config, write_config


AUTH_COOKIE_NAMES = {"SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"}
LOGIN_TIMEOUT_SECONDS = 60


def login_and_save_cookie() -> dict:
    """Mở Chrome thật để đăng nhập Gemini rồi lưu cookies.

    - Ưu tiên chế độ Fast Silent Refresh (3-5s): Mở trực tiếp https://gemini.google.com/app.
      Nếu profile Chrome đã đăng nhập Google sẵn, session được nhận diện ngay lập tức.
    - Quét đa tab (multi-tab): Duyệt qua toàn bộ context.pages, không bị kẹt ở tab newtab/blank.
    - Lọc cookie chuẩn domain https://gemini.google.com (loại trừ cookie trùng lặp gây CookieMismatch).
    - Nếu chưa đăng nhập, cho phép người dùng đăng nhập trong tối đa 60 giây.
    """
    import subprocess
    import time
    import urllib.request

    if not settings.chrome_executable.exists():
        raise HTTPException(status_code=503, detail=f"Không tìm thấy Chrome: {settings.chrome_executable}")

    settings.chrome_profile_dir.mkdir(parents=True, exist_ok=True)
    cdp_port = 9224
    cdp_url = f"http://127.0.0.1:{cdp_port}"

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

    try:
        cdp_up = False
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"{cdp_url}/json/version", timeout=2) as response:
                    if response.status == 200:
                        cdp_up = True
                        break
            except Exception:
                time.sleep(1)

        if not cdp_up:
            raise HTTPException(
                status_code=504,
                detail=f"Chrome không mở CDP tại {cdp_url}. Hãy đóng toàn bộ Chrome rồi thử lại.",
            )

        cookies: list = []
        user_agent: str = ""
        with sync_playwright() as playwright:
            browser = None
            for _ in range(20):
                try:
                    browser = playwright.chromium.connect_over_cdp(cdp_url)
                    break
                except Exception:
                    time.sleep(1)
            if browser is None:
                raise HTTPException(status_code=504, detail="Không kết nối được Chrome qua CDP.")

            context = browser.contexts[0] if browser.contexts else browser.new_context()

            # Đảm bảo có ít nhất 1 tab điều hướng tới Gemini nếu tất cả đều là newtab/blank
            for _ in range(LOGIN_TIMEOUT_SECONDS):
                if proc.poll() is not None:
                    raise HTTPException(
                        status_code=408,
                        detail="Trình duyệt Chrome đã bị đóng trước khi hoàn tất lấy cookie.",
                    )

                pages = context.pages
                # Tìm tab gemini hoặc accounts
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

                # Nếu chưa có tab nào mở gemini hoặc accounts, điều hướng tab đầu tiên tới Gemini
                if not gemini_page and not accounts_page and pages:
                    try:
                        pages[0].goto("https://gemini.google.com/app")
                    except Exception:
                        pass

                # 1. Trích xuất cookies chuẩn riêng cho https://gemini.google.com (tránh CookieMismatch)
                try:
                    current_cookies = context.cookies(["https://gemini.google.com"])
                except Exception:
                    current_cookies = []

                # 2. Kiểm tra các cookie xác thực quan trọng
                has_auth = any(c["name"] in AUTH_COOKIE_NAMES for c in current_cookies)

                if has_auth:
                    cookies = current_cookies
                    target_page = gemini_page or (pages[0] if pages else None)
                    if target_page:
                        try:
                            user_agent = target_page.evaluate("() => navigator.userAgent")
                        except Exception:
                            user_agent = ""
                    break

                time.sleep(1)

            if not any(c["name"] in AUTH_COOKIE_NAMES for c in cookies):
                raise HTTPException(
                    status_code=408,
                    detail=f"Chưa hoàn tất đăng nhập Gemini sau {LOGIN_TIMEOUT_SECONDS} giây.",
                )

            # Chờ 1 giây để cookie ghi ổn định
            time.sleep(1)
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

