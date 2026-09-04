import os
import sys
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Hỗ trợ tùy chỉnh APP_DATA_DIR khi chạy môi trường đóng gói (Production) hoặc mặc định thư mục gốc (Dev)
if os.environ.get("APP_DATA_DIR"):
    TOOLS_DIR = Path(os.environ["APP_DATA_DIR"]).resolve()
    DATA_DIR = TOOLS_DIR / "Data"
elif getattr(sys, "frozen", False):
    # Nếu chạy từ file .exe đóng gói bởi PyInstaller, lưu data vào AppData của User
    app_data = Path(os.environ.get("APPDATA", Path.home())).resolve() / "GoogleSearchApp"
    TOOLS_DIR = app_data
    DATA_DIR = TOOLS_DIR / "Data"
else:
    # Ở chế độ Development: TOOLS_DIR là thư mục gốc của repo, DATA_DIR là Backend/Data
    TOOLS_DIR = Path(__file__).resolve().parents[3]
    DATA_DIR = Path(__file__).resolve().parents[2] / "Data"

try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass

DEFAULT_DATABASE_URL = f"sqlite:///{(DATA_DIR / 'app.db').as_posix()}"


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = DEFAULT_DATABASE_URL
    chrome_profile_dir: Path = DATA_DIR / "ChromeProfile"
    config_file: Path = DATA_DIR / "config.json"
    chrome_executable: Path = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    voice_service_url: str = "http://127.0.0.1:8001"  # voice-service (VieNeu-TTS) nội bộ
    # Profile riêng cho YouTube login
    yt_profile_dir: Path = DATA_DIR / "YtProfile"
    yt_cookies_file: Path = DATA_DIR / "yt_cookies.txt"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

