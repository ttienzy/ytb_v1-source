import os
import shutil
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


def _resolve_bundled_dir(rel_name: str) -> Path:
    """Xác định đường dẫn thư mục tài nguyên đóng gói sẵn (prompts, resources...).

    - Khi chạy exe đóng gói PyInstaller: sys._MEIPASS / rel_name
    - Khi chạy dev từ mã nguồn: Backend / rel_name
    """
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        p = Path(bundle) / rel_name
        if p.exists():
            return p
    # Thử từ vị trí của file config.py: Backend/{rel_name}
    backend_dir = Path(__file__).resolve().parents[2]
    p = backend_dir / rel_name
    if p.exists():
        return p
    # Thử từ repo root (dev mode)
    repo_root = Path(__file__).resolve().parents[3]
    p = repo_root / "Backend" / rel_name
    if p.exists():
        return p
    return backend_dir / rel_name


PROMPTS_DIR = _resolve_bundled_dir("prompts")
RESOURCES_DIR = _resolve_bundled_dir("resources")


def _detect_chrome_executable() -> Path:
    """Tự động phát hiện đường dẫn Google Chrome khả dụng trên Windows."""
    candidates = [
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    ]
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "Google" / "Chrome" / "Application" / "chrome.exe")
    which_chrome = shutil.which("chrome") or shutil.which("chrome.exe")
    if which_chrome:
        candidates.append(Path(which_chrome))
    for c in candidates:
        if c.is_file():
            return c
    return candidates[0]


def _ensure_playwright_browsers_path() -> None:
    """Đảm bảo PLAYWRIGHT_BROWSERS_PATH trỏ đúng thư mục browser hợp lệ.

    Khi chạy trong file .exe đóng gói bởi PyInstaller (sys.frozen = True), Playwright mặc định
    gán PLAYWRIGHT_BROWSERS_PATH = '0' nếu biến này chưa được set. Giá trị '0' ép Playwright tìm
    Chromium trong _MEIPASS/.local-browsers (thư mục tạm giải nén của PyInstaller) — nơi không chứa
    browser nặng 200MB, gây ra lỗi 'Executable doesn't exist at ...\\_MEI...\\chrome.exe'.

    Để khắc phục triệt để, ta chủ động set PLAYWRIGHT_BROWSERS_PATH:
      1. WATERMARK_PLAYWRIGHT_BROWSERS_PATH (nếu Electron bundle sẵn browser)
      2. %LOCALAPPDATA%/ms-playwright (nơi playwright install lưu browser mặc định trên Windows)
    """
    current = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if not current or current == "0":
        watermark_pw = os.environ.get("WATERMARK_PLAYWRIGHT_BROWSERS_PATH")
        if watermark_pw and Path(watermark_pw).is_dir():
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = watermark_pw
            return
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            ms_pw = Path(local_app_data) / "ms-playwright"
            if ms_pw.is_dir():
                os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(ms_pw)


_ensure_playwright_browsers_path()


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = DEFAULT_DATABASE_URL
    chrome_profile_dir: Path = DATA_DIR / "ChromeProfile"
    config_file: Path = DATA_DIR / "config.json"
    chrome_executable: Path = _detect_chrome_executable()
    voice_service_url: str = "http://127.0.0.1:8001"  # voice-service (VieNeu-TTS) nội bộ
    # Profile riêng cho YouTube login
    yt_profile_dir: Path = DATA_DIR / "YtProfile"
    yt_cookies_file: Path = DATA_DIR / "yt_cookies.txt"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
