"""Entrypoint chạy Standalone Voice Service (VieNeu-TTS) trên port 8001."""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Đảm bảo sys.path chứa thư mục services/voice-service
SERVICE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIR))

import uvicorn
from app.main import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    host = os.environ.get("HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port, log_level="info")
