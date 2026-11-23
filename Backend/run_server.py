"""Entrypoint chạy Backend FastAPI server độc lập (cho cả Dev và Production PyInstaller binary)."""
from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

# Đảm bảo sys.path chứa thư mục Backend
BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))


def _start_parent_watchdog() -> None:
    """Tự thoát nếu tiến trình cha (Electron) đã chết — ngăn backend_server.exe mồ côi chiếm cổng."""
    parent_pid_str = os.environ.get("PARENT_PID", "").strip()
    if not parent_pid_str:
        return
    try:
        parent_pid = int(parent_pid_str)
    except ValueError:
        return

    def _watch() -> None:
        while True:
            time.sleep(3)
            try:
                os.kill(parent_pid, 0)  # signal 0 = chỉ kiểm tra sự tồn tại, không kill
            except OSError:
                # Tiến trình cha không còn tồn tại → tự thoát ngay lập tức
                print(f"[watchdog] Tiến trình cha PID {parent_pid} đã chết — backend tự thoát.", flush=True)
                os._exit(0)

    t = threading.Thread(target=_watch, daemon=True, name="parent-watchdog")
    t.start()


import uvicorn
from app.main import app

if __name__ == "__main__":
    _start_parent_watchdog()
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "127.0.0.1")
    # Reload CHỈ khi dev chủ động bật (BACKEND_RELOAD=1) và không phải bản đóng gói: trong exe PyInstaller, reload=True
    # làm uvicorn sinh tiến trình reloader lặp vô hạn (backend không bao giờ phục vụ); trên Windows nó còn gửi CTRL_C_EVENT
    # tới cả console. `npm start` (Desktop/dev.js) tự restart backend khi sửa .py nên không cần reload ở đây.
    reload = os.environ.get("BACKEND_RELOAD") == "1" and not getattr(sys, "frozen", False)
    if reload:
        uvicorn.run("app.main:app", host=host, port=port, log_level="info", reload=True)
    else:
        uvicorn.run(app, host=host, port=port, log_level="info")
