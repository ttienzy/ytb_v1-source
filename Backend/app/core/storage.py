import json
from datetime import datetime, timezone

from app.core.config import settings


def default_config() -> dict:
    return {
        "gemini": {"cookies": "", "cookie_count": 0, "client_context_token": "", "app_url": "https://gemini.google.com/app"},
        "google_chrome": {"executable": str(settings.chrome_executable), "profile_dir": str(settings.chrome_profile_dir)},
    }


def read_config() -> dict:
    defaults = default_config()
    try:
        if settings.config_file.exists() and settings.config_file.stat().st_size:
            config = json.loads(settings.config_file.read_text(encoding="utf-8"))
            return {**defaults, **config, "gemini": {**defaults["gemini"], **config.get("gemini", {})}, "google_chrome": {**defaults["google_chrome"], **config.get("google_chrome", {})}}
    except (OSError, json.JSONDecodeError):
        pass
    return defaults


def write_config(config: dict) -> None:
    settings.config_file.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = settings.config_file.with_suffix(".tmp")
    temporary_file.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_file.replace(settings.config_file)


def mark_saved(data: dict) -> dict:
    return {**data, "saved_at": datetime.now(timezone.utc).isoformat()}
