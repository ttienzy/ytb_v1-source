"""Chrome thật mở với profile riêng (--user-data-dir) + CDP: đóng ÊM để profile ghi cookie xuống đĩa.

Chrome chỉ ghi cookie mới xuống `Default/Network/Cookies` định kỳ (~30 s) hoặc khi tắt bình thường. `proc.terminate()`
trên Windows là TerminateProcess (giết ngay) → cookie vừa đăng nhập / vừa xoay vòng bị MẤT, profile "ấm" thực ra đã
đăng xuất và lần làm mới sau hỏng (đã gặp ở ChatGPT, Gemini, YouTube). `browser.close()` của Playwright
`connect_over_cdp` chỉ ngắt kết nối, không đóng Chrome. Guardrail: tests/test_chrome_profile_guardrail.py.
"""
from __future__ import annotations

import logging
import socket
import subprocess
import time
import urllib.request

logger = logging.getLogger("core.chrome")


def close_chrome_gracefully(browser, proc: subprocess.Popen | None, wait_seconds: float = 15.0) -> bool:
    """Gửi CDP `Browser.close`, chờ tiến trình thoát; chỉ giết cứng khi Chrome không tự thoát kịp.

    `browser`: đối tượng Playwright đã `connect_over_cdp` (None nếu chưa nối được). `proc`: tiến trình Chrome do app
    mở (None nếu dùng Chrome có sẵn). Trả True nếu Chrome tự thoát êm (cookie đã được ghi)."""
    if browser is not None:
        try:
            browser.new_browser_cdp_session().send("Browser.close")
        except Exception:  # noqa: BLE001 — Chrome đóng ngay nên kết nối CDP thường đứt giữa chừng: bình thường
            pass
    if proc is None:
        if browser is not None:
            try:
                browser.close()
            except Exception:  # noqa: BLE001
                pass
        return browser is not None
    exited = proc.poll() is not None
    if not exited:
        try:
            proc.wait(timeout=wait_seconds)
            exited = True
        except subprocess.TimeoutExpired:
            logger.warning("Chrome không tự thoát sau %.0fs — buộc tắt (cookie mới có thể chưa được lưu).", wait_seconds)
    if browser is not None:
        try:
            browser.close()
        except Exception:  # noqa: BLE001
            pass
    if not exited and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:  # noqa: BLE001
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass
    return exited


def find_free_cdp_port(start_port: int, span: int = 40) -> int:
    """Một cổng còn trống để làm remote debugging port cho Chrome (tìm từ `start_port`)."""
    for port in range(start_port, start_port + span):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start_port


def wait_for_cdp(port: int, max_wait: float = 15.0) -> bool:
    """Chờ Chrome khởi động xong và mở giao diện DevTools Protocol."""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:  # noqa: BLE001
            time.sleep(0.4)
    return False
