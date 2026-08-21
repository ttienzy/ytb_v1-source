from playwright.sync_api import sync_playwright


PROFILE = r"D:\GOOGLE SEARCH\tools\Backend\Data\ChromeProfile"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROMPT = "Trả lời đúng một từ: OK"


with sync_playwright() as playwright:
    context = playwright.chromium.launch_persistent_context(
        user_data_dir=PROFILE,
        executable_path=CHROME,
        headless=False,
        args=["--no-first-run", "--no-default-browser-check"],
    )
    try:
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://gemini.google.com/app", wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(5000)
        before = page.locator("body").inner_text()

        editor = page.locator("textarea").first
        if editor.count() == 0:
            editor = page.locator('[contenteditable="true"]').first
        if editor.count() == 0:
            print("TEST_FAILED: Không tìm thấy ô nhập Gemini")
        else:
            editor.fill(PROMPT)
            editor.press("Enter")
            for _ in range(30):
                page.wait_for_timeout(1000)
                after = page.locator("body").inner_text()
                if len(after) > len(before) + 10:
                    print("TEST_OK: Gemini đã có phản hồi")
                    print("RESPONSE_PREVIEW:", after[-300:].replace("\n", " "))
                    break
            else:
                print("TEST_TIMEOUT: Chưa thấy phản hồi trong 30 giây")
    finally:
        context.close()
