from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

from app.ai.chatgpt.schemas import (
    ChatGptChatRequest,
    ChatGptChatResponse,
    ChatGptSettingsPayload,
    ChatGptStatusResponse,
    ChatGptTestRequest,
    ChatGptTestResponse,
)
from app.ai.chatgpt.service import (
    chat_completion,
    fetch_models,
    get_local_cli_secret,
    normalize_endpoint,
    test_connection,
)
from app.core.storage import mark_saved, read_config, write_config

router = APIRouter(prefix="/api/settings/chatgpt", tags=["ChatGPT (9Router)"])


def _mask_key(key: str) -> str:
    k = (key or "").strip()
    if not k:
        return ""
    if len(k) <= 8:
        return "••••••••"
    return f"{k[:4]}••••••••{k[-4:]}"


@router.get("", response_model=ChatGptStatusResponse)
def get_settings():
    """Lấy cấu hình 9Router và trạng thái kết nối."""
    config = read_config()
    data = config.get("chatgpt_9router", {})
    endpoint = data.get("endpoint", "http://localhost:20128/v1")
    api_key = data.get("api_key", "")
    default_model = data.get("default_model", "gpt-4o")
    is_connected = data.get("is_connected", False)
    last_checked_at = data.get("last_checked_at")

    local_secret = get_local_cli_secret()

    # Nếu người dùng chưa lưu key mà máy có sẵn cli-secret, có thể dùng tạm để thăm dò
    active_key = api_key or local_secret

    models = fetch_models(endpoint, active_key, timeout=2.5) if endpoint else []
    if models:
        is_connected = True

    return ChatGptStatusResponse(
        endpoint=endpoint,
        api_key_masked=_mask_key(api_key),
        has_api_key=bool(api_key),
        default_model=default_model,
        is_connected=is_connected,
        last_checked_at=last_checked_at,
        detected_local_secret=local_secret if local_secret != api_key else None,
        available_models=models,
    )


@router.put("", response_model=ChatGptStatusResponse)
def save_settings(payload: ChatGptSettingsPayload):
    """Lưu cài đặt kết nối 9Router / ChatGPT."""
    config = read_config()
    current = config.get("chatgpt_9router", {})

    endpoint = normalize_endpoint(payload.endpoint)
    api_key = payload.api_key.strip()
    default_model = payload.default_model.strip() or "gpt-4o"

    # Nhanh chóng thử lấy models
    models = fetch_models(endpoint, api_key, timeout=3.0)
    is_connected = bool(models)
    now_iso = datetime.now(timezone.utc).isoformat()

    updated_data = {
        **current,
        "endpoint": endpoint,
        "api_key": api_key,
        "default_model": default_model,
        "is_connected": is_connected,
        "last_checked_at": now_iso,
    }

    config["chatgpt_9router"] = mark_saved(updated_data)
    write_config(config)

    local_secret = get_local_cli_secret()

    return ChatGptStatusResponse(
        endpoint=endpoint,
        api_key_masked=_mask_key(api_key),
        has_api_key=bool(api_key),
        default_model=default_model,
        is_connected=is_connected,
        last_checked_at=now_iso,
        detected_local_secret=local_secret if local_secret != api_key else None,
        available_models=models,
    )


@router.post("/test", response_model=ChatGptTestResponse)
def test_settings(req: ChatGptTestRequest):
    """Kiểm tra kết nối và độ trễ phản hồi tới 9Router."""
    config = read_config()
    saved = config.get("chatgpt_9router", {})

    endpoint = normalize_endpoint(req.endpoint or saved.get("endpoint", "http://localhost:20128/v1"))
    api_key = req.api_key if req.api_key is not None else saved.get("api_key", "")
    if not api_key:
        api_key = get_local_cli_secret()

    model = req.model or saved.get("default_model", "gpt-4o")

    result = test_connection(endpoint=endpoint, api_key=api_key, model=model)

    # Nếu kết nối thành công, cập nhật trạng thái trong storage
    if result.get("ok"):
        now_iso = datetime.now(timezone.utc).isoformat()
        saved["is_connected"] = True
        saved["last_checked_at"] = now_iso
        config["chatgpt_9router"] = saved
        write_config(config)

    return ChatGptTestResponse(
        ok=result.get("ok", False),
        latency_ms=result.get("latency_ms", 0),
        reply=result.get("reply", ""),
        models_count=result.get("models_count", 0),
        available_models=result.get("available_models", []),
        error=result.get("error"),
    )


@router.get("/models")
def get_available_models():
    """Lấy danh sách các model đang kích hoạt trong 9Router."""
    config = read_config()
    saved = config.get("chatgpt_9router", {})
    endpoint = saved.get("endpoint", "http://localhost:20128/v1")
    api_key = saved.get("api_key") or get_local_cli_secret()

    models = fetch_models(endpoint, api_key, timeout=4.0)
    return {"ok": True, "count": len(models), "models": models}


@router.post("/chat", response_model=ChatGptChatResponse)
def test_chat(req: ChatGptChatRequest):
    """Sandbox chat test thử nghiệm sinh kịch bản / prompt từ 9Router."""
    config = read_config()
    saved = config.get("chatgpt_9router", {})
    endpoint = saved.get("endpoint", "http://localhost:20128/v1")
    api_key = saved.get("api_key") or get_local_cli_secret()
    model = req.model or saved.get("default_model", "cx/gpt-5.5")

    result = chat_completion(
        endpoint=endpoint,
        api_key=api_key,
        model=model,
        prompt=req.prompt,
        system_prompt=req.system_prompt or "",
        images=req.images,
    )

    return ChatGptChatResponse(
        ok=result.get("ok", False),
        content=result.get("content", ""),
        model=result.get("model", model),
        latency_ms=result.get("latency_ms", 0),
        error=result.get("error"),
    )


@router.post("/launch-9router")
def launch_9router():
    """Khởi động 9Router nền và mở trình duyệt/dashboard."""
    from app.ai.chatgpt.service import launch_9router_and_open_browser
    res = launch_9router_and_open_browser(port=20128)
    return res

