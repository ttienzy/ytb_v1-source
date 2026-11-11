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
    uvicorn.run("app.main:app", host=host, port=port, log_level="info", reload=True)
