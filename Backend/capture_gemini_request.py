import json

from playwright.sync_api import sync_playwright


PROFILE = r"D:\GOOGLE SEARCH\tools\Backend\Data\ChromeProfile"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUTPUT = r"D:\GOOGLE SEARCH\tools\Backend\Data\curl_request.json"
PROMPT = "Liệt kê những tin tức nổi bật ở Việt Nam hôm nay. Tóm tắt ngắn gọn từng tin và ghi rõ nguồn nếu có."


with sync_playwright() as playwright:
    context = playwright.chromium.launch_persistent_context(
        user_data_dir=PROFILE,
        executable_path=CHROME,
        headless=False,
        args=["--no-first-run", "--no-default-browser-check"],
    )
    try:
        page = context.pages[0] if context.pages else context.new_page()
        captured = {}

        def capture(route, request):
            if not captured and request.method == "POST" and "StreamGenerate" in request.url:
                captured.update({
                    "url": request.url,
                    "body": request.post_data or "",
                    "headers": {
                        name: value for name, value in request.headers.items()
                        if name.lower() in {"content-type", "x-same-domain", "referer", "user-agent"}
                    },
                })
                route.abort()
            else:
                route.continue_()

        page.route("**/StreamGenerate*", capture)
        page.goto("https://gemini.google.com/app", wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(3000)
        editor = page.locator("textarea").first
        if editor.count() == 0:
            editor = page.locator('[contenteditable="true"]').first
        if editor.count() == 0:
            raise RuntimeError("Không tìm thấy ô nhập Gemini")
        editor.fill(PROMPT)
        editor.press("Enter")
        for _ in range(20):
            page.wait_for_timeout(1000)
            if captured:
                break
        if not captured:
            raise RuntimeError("Không bắt được request StreamGenerate")
        with open(OUTPUT, "w", encoding="utf-8") as file:
            json.dump(captured, file, ensure_ascii=False)
        print("CAPTURED_PROMPT_REQUEST")
    finally:
        context.close()
