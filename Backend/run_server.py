"""Entrypoint chạy Backend FastAPI server độc lập (cho cả Dev và Production PyInstaller binary)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Đảm bảo sys.path chứa thư mục Backend
BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

import uvicorn
from app.main import app

if __name__ == "__main__":
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
