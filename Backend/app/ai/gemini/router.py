from datetime import datetime, timezone

from fastapi import APIRouter

from app.ai.gemini.schemas import GeminiSettingsPayload
from app.ai.gemini.service import login_and_save_cookie
from app.core.storage import mark_saved, read_config, write_config


router = APIRouter(prefix="/api/settings/gemini", tags=["Gemini"])


@router.get("")
def get_settings() -> dict:
    config = read_config()
    data = config["gemini"]
    return {"has_cookie": bool(data.get("cookies")), "cookie_count": data.get("cookie_count", 0), "saved_at": data.get("saved_at"), "client_context_token": data.get("client_context_token", ""), "app_url": data.get("app_url", "https://gemini.google.com/app")}


@router.put("")
def save_settings(payload: GeminiSettingsPayload) -> dict:
    config = read_config()
    current = config["gemini"]
    next_data = {
        **current,
        "client_context_token": payload.client_context_token.strip(),
        "app_url": payload.app_url.strip() or "https://gemini.google.com/app",
    }

    # The UI leaves this field blank when a cookie is already stored. Preserve
    # the existing cookie; deletion is handled explicitly by DELETE below.
    cookies = payload.cookies.strip()
    if cookies:
        next_data["cookies"] = cookies
        next_data["cookie_count"] = sum(1 for item in cookies.split(";") if item.strip())

    config["gemini"] = mark_saved(next_data)
    write_config(config)
    return {
        "ok": True,
        "has_cookie": bool(config["gemini"].get("cookies")),
        "cookie_count": config["gemini"].get("cookie_count", 0),
    }


@router.delete("")
def reset_cookie() -> dict:
    """Delete the stored Gemini cookie while preserving profile and template data."""
    config = read_config()
    config["gemini"] = {
        **config["gemini"],
        "cookies": "",
        "cookie_count": 0,
        "saved_at": None,
        "cookie_cleared_at": datetime.now(timezone.utc).isoformat(),
    }
    write_config(config)
    return {"ok": True, "has_cookie": False, "cookie_count": 0}


@router.post("/login")
def login() -> dict:
    return login_and_save_cookie()
