from datetime import datetime, timezone

from fastapi import HTTPException
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from app.core.config import settings
from app.core.storage import read_config, write_config


AUTH_COOKIE_NAMES = {"SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"}
LOGIN_TIMEOUT_SECONDS = 60


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
        # phiên đăng nhập là automation.
        proc = subprocess.Popen(
            [
                str(settings.chrome_executable),
                f"--user-data-dir={settings.chrome_profile_dir}",
                f"--remote-debugging-port={cdp_port}",
                "--no-first-run",
                "--no-default-browser-check",
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
        with sync_playwright() as playwright:
            browser = None
            for _ in range(15):
                try:
                    browser = playwright.chromium.connect_over_cdp(cdp_url)
                    break
                except Exception:
                    time.sleep(1)
            if browser is None:
                raise HTTPException(status_code=504, detail="Không kết nối được Chrome qua CDP.")

            context = browser.contexts[0] if browser.contexts else browser.new_context()
            for _ in range(LOGIN_TIMEOUT_SECONDS):
                try:
                    cookies = context.cookies(["https://gemini.google.com", "https://google.com"])
                except Exception:
                    cookies = []
                if any(cookie["name"] in AUTH_COOKIE_NAMES for cookie in cookies):
                    break
                time.sleep(1)

            if not any(cookie["name"] in AUTH_COOKIE_NAMES for cookie in cookies):
                raise HTTPException(
                    status_code=408,
                    detail=f"Chưa phát hiện đăng nhập Gemini sau {LOGIN_TIMEOUT_SECONDS} giây.",
                )

            time.sleep(5)
            config = read_config()
            config["gemini"].update({
                "cookies": "; ".join(f"{cookie['name']}={cookie['value']}" for cookie in cookies),
                "cookie_count": len(cookies),
                "saved_at": datetime.now(timezone.utc).isoformat(),
            })
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
