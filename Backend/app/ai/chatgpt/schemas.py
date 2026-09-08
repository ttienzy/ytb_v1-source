from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class ChatGptSettingsPayload(BaseModel):
    endpoint: str = Field(default="http://localhost:20128/v1", description="9Router API endpoint")
    api_key: str = Field(default="", description="9Router API Key hoặc CLI Secret")
    default_model: str = Field(default="cx/gpt-5.5", description="Model mặc định cho prompt kịch bản")


class ChatGptStatusResponse(BaseModel):
    endpoint: str
    api_key_masked: str
    has_api_key: bool
    default_model: str
    is_connected: bool
    last_checked_at: Optional[str] = None
    detected_local_secret: Optional[str] = None
    available_models: list[str] = []


class ChatGptTestRequest(BaseModel):
    endpoint: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None


class ChatGptTestResponse(BaseModel):
    ok: bool
    latency_ms: int = 0
    reply: str = ""
    models_count: int = 0
    available_models: list[str] = []
    error: Optional[str] = None


class ChatGptChatRequest(BaseModel):
    prompt: str
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    images: list[str] = []  # base64 data URIs hoặc image URLs


class ChatGptChatResponse(BaseModel):
    ok: bool
    content: str = ""
    model: str = ""
    latency_ms: int = 0
    error: Optional[str] = None
