from datetime import datetime, timezone

from fastapi import APIRouter

from app.ai.gemini.schemas import GeminiSettingsPayload
from app.ai.gemini.service import login_and_save_cookie
from app.core.storage import mark_saved, read_config, write_config


router = APIRouter(prefix="/api/settings/gemini", tags=["Gemini"])


@router.get("")
def get_settings() -> dict:
    config = read_config()
    write_config(config)
    data = config["gemini"]
    return {"has_cookie": bool(data.get("cookies")), "cookie_count": data.get("cookie_count", 0), "saved_at": data.get("saved_at"), "client_context_token": data.get("client_context_token", ""), "app_url": data.get("app_url", "https://gemini.google.com/app")}


@router.put("")
def save_settings(payload: GeminiSettingsPayload) -> dict:
    config = read_config()
    config["gemini"] = mark_saved({**config["gemini"], "cookies": payload.cookies.strip(), "client_context_token": payload.client_context_token.strip(), "app_url": payload.app_url.strip() or "https://gemini.google.com/app"})
    write_config(config)
    return {"ok": True, "has_cookie": bool(payload.cookies.strip())}


@router.post("/login")
def login() -> dict:
    return login_and_save_cookie()
