from datetime import datetime, timezone

from fastapi import HTTPException
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from app.core.config import settings
from app.core.storage import read_config, write_config


AUTH_COOKIE_NAMES = {"SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"}
LOGIN_TIMEOUT_SECONDS = 60


def login_and_save_cookie() -> dict:
    if not settings.chrome_executable.exists():
        raise HTTPException(status_code=503, detail=f"Không tìm thấy Chrome: {settings.chrome_executable}")

    settings.chrome_profile_dir.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(settings.chrome_profile_dir),
                executable_path=str(settings.chrome_executable),
                headless=False,
                args=["--no-first-run", "--no-default-browser-check"],
            )
            try:
                page = context.pages[0] if context.pages else context.new_page()
                page.goto("https://gemini.google.com/app", wait_until="domcontentloaded", timeout=45_000)
                cookies = []
                # Giữ cửa sổ Chrome mở đủ thời gian để người dùng đăng nhập Gmail.
                for _ in range(LOGIN_TIMEOUT_SECONDS):
                    cookies = context.cookies(["https://gemini.google.com", "https://google.com"])
                    if any(cookie["name"] in AUTH_COOKIE_NAMES for cookie in cookies):
                        break
                    page.wait_for_timeout(1000)

                if not any(cookie["name"] in AUTH_COOKIE_NAMES for cookie in cookies):
                    raise HTTPException(status_code=408, detail=f"Chưa phát hiện đăng nhập Gemini sau {LOGIN_TIMEOUT_SECONDS} giây")

                # Chờ thêm một nhịp để cookie và phiên đăng nhập được Chrome ghi ổn định.
                page.wait_for_timeout(5000)
                config = read_config()
                config["gemini"].update({
                    "cookies": "; ".join(f"{cookie['name']}={cookie['value']}" for cookie in cookies),
                    "cookie_count": len(cookies),
                    "saved_at": datetime.now(timezone.utc).isoformat(),
                })
                write_config(config)
                return {"ok": True, "has_cookie": True, "cookie_count": len(cookies)}
            finally:
                context.close()
    except HTTPException:
        raise
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail="Gemini không phản hồi trong thời gian chờ") from error
    except Exception as error:
        raise HTTPException(status_code=409, detail=f"Không thể mở Chrome profile. Hãy đóng Chrome profile này rồi thử lại: {error}") from error
