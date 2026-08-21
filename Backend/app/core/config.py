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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
