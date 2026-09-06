from datetime import datetime, timezone

from fastapi import HTTPException
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from app.core.config import settings
from app.core.storage import read_config, write_config


AUTH_COOKIE_NAMES = {"SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"}
LOGIN_TIMEOUT_SECONDS = 180


def login_and_save_cookie() -> dict:
    """Mở Chrome thật để đăng nhập Gemini rồi lưu cookies.

    Không dùng ``launch_persistent_context`` ở đây: Playwright thêm các dấu
    hiệu automation (như ``--enable-automation``/``navigator.webdriver``), và
    Google có thể từ chối đăng nhập với thông báo trình duyệt không an toàn.
    Chrome được khởi động trực tiếp, sau đó Playwright chỉ kết nối qua CDP để
    đọc cookies.
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
        # phiên đăng nhập là automation. Thêm --disable-extensions để chặn McAfee
        # hoặc các extension bên ngoài can thiệp làm che/lỗi đăng nhập.
        proc = subprocess.Popen(
            [
                str(settings.chrome_executable),
                f"--user-data-dir={settings.chrome_profile_dir}",
                f"--remote-debugging-port={cdp_port}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--disable-default-apps",
                "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp&service=cl",
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
            for _ in range(LOGIN_TIMEOUT_SECONDS):
                # Nếu người dùng tự tắt cửa sổ Chrome trước khi xong
                if proc.poll() is not None:
                    raise HTTPException(
                        status_code=408,
                        detail="Trình duyệt Chrome đã bị đóng trước khi hoàn tất đăng nhập.",
                    )

                pages = context.pages
                page = pages[0] if pages else None
                current_url = page.url if page else ""

                # 1. Nếu còn ở màn hình accounts.google.com (nhập email/mật khẩu/2FA) -> tiếp tục chờ
                if "accounts.google.com" in current_url:
                    time.sleep(1)
                    continue

                # 2. Phải chuyển hướng về gemini.google.com
                if not current_url.startswith("https://gemini.google.com"):
                    time.sleep(1)
                    continue

                # 3. Kiểm tra xem đã thực sự đăng nhập trên giao diện Gemini chưa (tránh Guest mode)
                is_authenticated = False
                try:
                    is_authenticated = page.evaluate("""() => {
                        // Kiểm tra token xác thực phiên SNlM0e
                        if (window.WIZ_global_data && window.WIZ_global_data.SNlM0e) {
                            return true;
                        }
                        // Kiểm tra xem có nút Sign In / Đăng nhập (Guest Mode)
                        const text = document.body ? document.body.innerText : '';
                        if (text.includes('Sign in to save') || text.includes('Đăng nhập để lưu')) {
                            return false;
                        }
                        const signInBtn = document.querySelector(
                            'a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/signin"]'
                        );
                        if (signInBtn) {
                            return false;
                        }
                        // Kiểm tra avatar tài khoản / profile
                        return Boolean(
                            document.querySelector('a[href*="SignOutOptions"]') ||
                            document.querySelector('button[aria-label*="Google"]') ||
                            document.querySelector('button[aria-label*="Tài khoản"]') ||
                            document.querySelector('img[alt*="Google Account"]') ||
                            document.querySelector('div[data-user-email]')
                        );
                    }""")
                except Exception:
                    is_authenticated = False

                if not is_authenticated:
                    time.sleep(1)
                    continue

                # 4. Đã xác nhận đăng nhập thật sự, đọc cookies xác thực
                try:
                    cookies = context.cookies(["https://gemini.google.com", "https://google.com"])
                except Exception:
                    cookies = []

                if any(cookie["name"] in AUTH_COOKIE_NAMES for cookie in cookies):
                    try:
                        user_agent = page.evaluate("() => navigator.userAgent")
                    except Exception:
                        user_agent = ""
                    break

                time.sleep(1)

            if not any(cookie["name"] in AUTH_COOKIE_NAMES for cookie in cookies):
                raise HTTPException(
                    status_code=408,
                    detail=f"Chưa hoàn tất đăng nhập Gemini sau {LOGIN_TIMEOUT_SECONDS} giây.",
                )

            time.sleep(3)
            try:
                cookies = context.cookies(["https://gemini.google.com", "https://google.com"])
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
            proc.wait(timeout=8)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
