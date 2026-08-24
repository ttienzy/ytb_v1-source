from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


TOOLS_DIR = Path(__file__).resolve().parents[3]
DEFAULT_DATABASE_URL = f"sqlite:///{(TOOLS_DIR / 'Data' / 'app.db').as_posix()}"


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = DEFAULT_DATABASE_URL
    chrome_profile_dir: Path = TOOLS_DIR / "Backend" / "Data" / "ChromeProfile"
    config_file: Path = TOOLS_DIR / "Backend" / "Data" / "config.json"
    chrome_executable: Path = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    voice_service_url: str = "http://127.0.0.1:8001"  # voice-service (VieNeu-TTS) nội bộ
    # Profile riêng cho YouTube login (KHÔNG dùng ChromeProfile của Gemini — tránh account
    # bị SABR-only cướp 1080p, và để user login account khác không bị SABR). Cookie xuất ra
    # yt_cookies_file (Netscape) cho yt-dlp fallback khi bị IP bot-wall. Xem [[ytdlp-youtube-block]].
    yt_profile_dir: Path = TOOLS_DIR / "Backend" / "Data" / "YtProfile"
    yt_cookies_file: Path = TOOLS_DIR / "Backend" / "Data" / "yt_cookies.txt"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
