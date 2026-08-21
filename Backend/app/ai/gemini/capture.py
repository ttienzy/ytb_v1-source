"""Capture template + cookies từ session Gemini đã login (Chromium) → lưu config.json.

Chạy 1 lần sau khi login (hoặc khi cần làm mới template khi Gemini đổi giao thức).
Sau khi chạy xong có thể xoá *.har — recap.py chỉ còn phụ thuộc config.json.

Cơ chế:
  - Mở Chromium persistent (đã login) → vào gemini.google.com/app.
  - Gõ 1 prompt ném đi ("hi") để trigger request StreamGenerate.
  - Chặn request bằng page.route() → lấy post_data (f.req) + user-agent.
  - route.abort() → request KHÔNG tới server → KHÔNG tạo history thừa.
  - Parse f.req → inner 97-pt; sanitize idx 3/4/59 (= relate-token,
    conversation-id, UUID của capture) → null → template "hội thoại mới" sạch,
    account-agnostic.
  - Lưu cookies + inner_template (sanitized) + user_agent + app_url vào config.json.

Lưu ý: bl (cfb2h) / f.sid / at (SNlM0e) KHÔNG lưu — recap.py tự lấy fresh qua
GET /app ở runtime (chúng đổi theo phiên/build, lưu sẽ bị stale).

Chạy:
  cd Backend
  .venv/Scripts/python capture_gemini_request.py
"""
import json
import urllib.parse
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

from app.core.config import settings
from app.core.storage import read_config, write_config

PROMPT = "hi"  # prompt ném đi — chỉ để trigger StreamGenerate (bị abort)
TRIGGER_TIMEOUT_S = 30

# Các trường gắn conversation/account → null cho template "hội thoại mới" sạch.
#  idx 3 = relate-token (!...), idx 4 = conversation/response-id (32 hex),
#  idx 59 = client request UUID. recap là prompt 1-lần nên không cần thừa kế hội thoại.
SANITIZE_INDICES = (3, 4, 59)


def parse_f_req(body: str) -> list:
    """body = 'f.req=<urlencoded>&at=...' → trả inner 97-pt."""
    parts = {p.split("=", 1)[0]: p.split("=", 1)[1] for p in body.split("&") if "=" in p}
    if "f.req" not in parts:
        raise RuntimeError("body không chứa f.req (có thể không phải request StreamGenerate)")
    outer = json.loads(urllib.parse.unquote(parts["f.req"]))  # outer = [null, "<inner json>"]
    return json.loads(outer[1])


def capture() -> None:
    if not settings.chrome_executable.exists():
        raise SystemExit(f"Không tìm thấy Chrome: {settings.chrome_executable}")
    settings.chrome_profile_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        try:
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(settings.chrome_profile_dir),
                executable_path=str(settings.chrome_executable),
                headless=False,
                args=["--no-first-run", "--no-default-browser-check"],
            )
        except Exception as error:
            raise SystemExit(
                "Không mở được Chrome profile. Hãy ĐÓNG Chrome đang dùng profile này rồi thử lại.\n"
                f"Lỗi: {error}"
            ) from error

        try:
            page = context.pages[0] if context.pages else context.new_page()
            captured: dict = {}

            def on_route(route, request):
                if not captured and request.method == "POST" and "StreamGenerate" in request.url:
                    captured["body"] = request.post_data or ""
                    captured["user_agent"] = request.headers.get("user-agent", "")
                    captured["url"] = request.url
                    route.abort()  # chặn → request không tới server → không sinh history
                else:
                    route.continue_()

            page.route("**/StreamGenerate*", on_route)
            page.goto("https://gemini.google.com/app", wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(3000)

            # Tìm ô nhập (textarea hoặc contenteditable) — Gemini hay đổi giữa 2 dạng.
            editor = page.locator("textarea").first
            if editor.count() == 0:
                editor = page.locator('[contenteditable="true"]').first
            if editor.count() == 0:
                raise SystemExit("Không tìm thấy ô nhập Gemini — có thể chưa login hoặc UI đã đổi.")
            editor.click()
            page.keyboard.type(PROMPT, delay=10)
            page.keyboard.press("Enter")

            for _ in range(TRIGGER_TIMEOUT_S):
                page.wait_for_timeout(1000)
                if captured:
                    break
            if not captured:
                raise SystemExit(f"Không bắt được request StreamGenerate sau {TRIGGER_TIMEOUT_S}s.")

            # Parse + sanitize inner template.
            inner = parse_f_req(captured["body"])
            for i in SANITIZE_INDICES:
                if i < len(inner):
                    inner[i] = None

            # Cookies tươi từ context.
            cookies = context.cookies(["https://gemini.google.com", "https://google.com"])
            cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

            # Lưu vào config.json.
            now = datetime.now(timezone.utc).isoformat()
            config = read_config()
            config["gemini"].update({
                "cookies": cookie_str,
                "cookie_count": len(cookies),
                "inner_template": inner,           # 97-pt đã sanitize (account-agnostic)
                "user_agent": captured["user_agent"],
                "app_url": "https://gemini.google.com/app",
                "client_context_token": "",         # legacy field — bỏ trống
                "saved_at": now,
                "template_saved_at": now,
            })
            write_config(config)

            print(f"\n✅ Đã capture & lưu vào: {settings.config_file}")
            print(f"   inner length      : {len(inner)}")
            print(f"   sanitized idx     : {SANITIZE_INDICES} → null (bỏ relate-token/conv-id/UUID)")
            print(f"   cookies           : {len(cookies)} (SID/SAPISID/Secure-* đầy đủ)")
            print(f"   user_agent        : {captured['user_agent'][:70]}...")
            print(f"   → recap.py giờ chỉ cần config.json, không cần *.har.")
        finally:
            context.close()


if __name__ == "__main__":
    capture()
