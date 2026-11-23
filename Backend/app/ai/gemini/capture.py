"""Capture khung request StreamGenerate ("inner template") từ profile Gemini đã đăng nhập → lưu config.json.

App đã mang sẵn một template (`app.ai.gemini.template`, resources/gemini/inner_template.json); chỉ cần chạy cái này khi
Gemini đổi giao thức (gọi Gemini báo lỗi lạ dù cookie còn tốt). Gọi từ Cài đặt → Gemini & YouTube → "Cập nhật template
Gemini" (POST /api/settings/gemini/capture-template) hoặc chạy tay: `cd Backend; .venv/Scripts/python -m app.ai.gemini.capture`.

Cơ chế:
  - Mở Chrome với profile Gemini (đã đăng nhập) → gemini.google.com/app.
  - Gõ 1 prompt ném đi ("hi") để trigger request StreamGenerate.
  - Chặn request bằng page.route() → lấy post_data (f.req) + user-agent; route.abort() → request KHÔNG tới server →
    KHÔNG tạo lịch sử chat.
  - Parse f.req → inner 97 trường; làm sạch idx 3/4/59 (relate-token, conversation-id, UUID) → template "hội thoại mới".
  - Lưu inner_template + user_agent + template_saved_at. KHÔNG ghi đè cookie: cookie lấy qua "Đăng nhập Gemini (Chrome)"
    (Chrome thật, không cờ automation).

bl (cfb2h) / f.sid / at (SNlM0e) KHÔNG lưu — recap.py tự lấy mới qua GET /app mỗi lần (đổi theo phiên/build).
"""
from __future__ import annotations

import json
import urllib.parse
from datetime import datetime, timezone

from app.ai.gemini.template import SANITIZE_INDICES, TEMPLATE_LENGTH, sanitize_inner
from app.core.config import settings
from app.core.storage import read_config, write_config

PROMPT = "hi"  # prompt ném đi — chỉ để trigger StreamGenerate (bị abort)
TRIGGER_TIMEOUT_S = 30


class GeminiTemplateCaptureError(RuntimeError):
    """Không capture được template (profile bị Chrome khác giữ, chưa đăng nhập, UI Gemini đổi…)."""


def parse_f_req(body: str) -> list:
    """body = 'f.req=<urlencoded>&at=...' → trả inner 97-pt."""
    parts = {p.split("=", 1)[0]: p.split("=", 1)[1] for p in body.split("&") if "=" in p}
    if "f.req" not in parts:
        raise GeminiTemplateCaptureError("body không chứa f.req (có thể không phải request StreamGenerate)")
    outer = json.loads(urllib.parse.unquote(parts["f.req"]))  # outer = [null, "<inner json>"]
    return json.loads(outer[1])


def capture_template() -> dict:
    """Mở profile Gemini, bắt template, lưu vào config.json. Trả {ok, inner_length, user_agent, template_saved_at}."""
    from playwright.sync_api import sync_playwright

    if not settings.chrome_executable.exists():
        raise GeminiTemplateCaptureError(f"Không tìm thấy Chrome: {settings.chrome_executable}")
    settings.chrome_profile_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        try:
            # Context persistent do Playwright quản lý: context.close() đóng Chrome êm (profile ghi xong xuống đĩa).
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(settings.chrome_profile_dir),
                executable_path=str(settings.chrome_executable),
                headless=False,
                ignore_default_args=["--no-sandbox"],
                args=["--no-first-run", "--no-default-browser-check", "--disable-extensions"],
            )
        except Exception as error:
            raise GeminiTemplateCaptureError(
                "Không mở được Chrome profile Gemini — đóng cửa sổ Chrome của app đang dùng profile này rồi thử lại. "
                f"({error})"
            ) from error

        try:
            page = context.pages[0] if context.pages else context.new_page()
            captured: dict = {}

            def on_route(route, request):
                if not captured and request.method == "POST" and "StreamGenerate" in request.url:
                    captured["body"] = request.post_data or ""
                    captured["user_agent"] = request.headers.get("user-agent", "")
                    route.abort()  # chặn → request không tới server → không sinh lịch sử
                else:
                    route.continue_()

            page.route("**/StreamGenerate*", on_route)
            page.goto("https://gemini.google.com/app", wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(3000)

            # Ô nhập là textarea hoặc contenteditable (Gemini hay đổi giữa 2 dạng).
            editor = page.locator("textarea").first
            if editor.count() == 0:
                editor = page.locator('[contenteditable="true"]').first
            if editor.count() == 0:
                raise GeminiTemplateCaptureError(
                    "Không thấy ô nhập Gemini — profile chưa đăng nhập (bấm “Đăng nhập Gemini (Chrome)” trước) "
                    "hoặc giao diện Gemini đã đổi.")
            editor.click()
            page.keyboard.type(PROMPT, delay=10)
            page.keyboard.press("Enter")

            for _ in range(TRIGGER_TIMEOUT_S):
                page.wait_for_timeout(1000)
                if captured:
                    break
            if not captured:
                raise GeminiTemplateCaptureError(f"Không bắt được request StreamGenerate sau {TRIGGER_TIMEOUT_S}s.")

            inner = sanitize_inner(parse_f_req(captured["body"]))
            if len(inner) != TEMPLATE_LENGTH:
                # Gemini đổi giao thức: vẫn lưu (đó là cái trang đang gửi) nhưng báo để biết.
                print(f"[Gemini template] Độ dài khác thường: {len(inner)} (thường {TEMPLATE_LENGTH})", flush=True)

            now = datetime.now(timezone.utc).isoformat()
            config = read_config()
            config["gemini"].update({
                "inner_template": inner,
                "user_agent": captured["user_agent"] or config["gemini"].get("user_agent", ""),
                "template_saved_at": now,
            })
            write_config(config)
            return {"ok": True, "inner_length": len(inner), "user_agent": captured["user_agent"], "template_saved_at": now}
        finally:
            context.close()


def capture() -> None:
    """Chạy tay từ terminal."""
    try:
        res = capture_template()
    except GeminiTemplateCaptureError as error:
        raise SystemExit(str(error)) from error
    print(f"\n✅ Đã capture & lưu vào: {settings.config_file}")
    print(f"   inner length      : {res['inner_length']}")
    print(f"   sanitized idx     : {SANITIZE_INDICES} → null (bỏ relate-token/conv-id/UUID)")
    print(f"   user_agent        : {res['user_agent'][:70]}...")


if __name__ == "__main__":
    capture()
