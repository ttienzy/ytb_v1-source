import json
from datetime import datetime, timezone

from app.core.config import settings


def default_config() -> dict:
    return {
        "gemini": {"cookies": "", "cookie_count": 0, "client_context_token": "", "app_url": "https://gemini.google.com/app"},
        "google_chrome": {"executable": str(settings.chrome_executable), "profile_dir": str(settings.chrome_profile_dir)},
        "mailtm": {"accounts": []},
        "pippit": {"accounts": []},
        "muse": {
            "app_url": "https://muse.ai/",
            "is_connected": False,
            "last_checked_at": None,
            "cdp_port": 9225,
            "auto_download": True,
            "download_dir": str(settings.chrome_profile_dir.parent / "Downloads"),
            "timeout_seconds": 120,
            "default_prompt_prefix": "",
        },
        "image_gen": {
            "provider": "chatgpt",
            "saved_at": None,
        },
    }


def read_config() -> dict:
    defaults = default_config()
    try:
        if settings.config_file.exists() and settings.config_file.stat().st_size:
            config = json.loads(settings.config_file.read_text(encoding="utf-8"))
            return {
                **defaults,
                **config,
                "gemini": {**defaults["gemini"], **config.get("gemini", {})},
                "google_chrome": {**defaults["google_chrome"], **config.get("google_chrome", {})},
                "mailtm": {**defaults["mailtm"], **config.get("mailtm", {})},
                "pippit": {**defaults["pippit"], **config.get("pippit", {})},
                "muse": {**defaults["muse"], **config.get("muse", {})},
                "image_gen": {**defaults["image_gen"], **config.get("image_gen", {})},
            }
    except (OSError, json.JSONDecodeError):
        pass
    return defaults


def write_config(config: dict) -> None:
    settings.config_file.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(config, ensure_ascii=False, indent=2)
    temporary_file = settings.config_file.with_suffix(".tmp")
    try:
        temporary_file.write_text(content, encoding="utf-8")
        try:
            temporary_file.replace(settings.config_file)
        except OSError:
            settings.config_file.write_text(content, encoding="utf-8")
            try:
                temporary_file.unlink(missing_ok=True)
            except OSError:
                pass
    except Exception:
        settings.config_file.write_text(content, encoding="utf-8")



def mark_saved(data: dict) -> dict:
    return {**data, "saved_at": datetime.now(timezone.utc).isoformat()}
