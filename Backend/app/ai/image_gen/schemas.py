from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class ChatgptAccountView(BaseModel):
    id: str
    email: Optional[str] = None
    hasSession: bool = True
    partition: Optional[str] = ""
    hasProfile: bool = True
    status: str = "active"  # 'active' | 'exhausted' | 'error'
    message: Optional[str] = ""
    addedAt: Optional[float] = 0
    lastUsed: Optional[float] = 0
    exhaustedAt: Optional[float] = 0


class ImageGenStatusResponse(BaseModel):
    provider: str = "chatgpt"
    saved_at: Optional[str] = None
    accounts: list[ChatgptAccountView] = Field(default_factory=list)
    active_accounts_count: int = 0
    total_accounts_count: int = 0


class TestImageGenRequest(BaseModel):
    prompt: str = Field(..., description="Prompt mô tả hình ảnh cần tạo")
    aspect_ratio: str = Field(default="9:16", description="Tỉ lệ hình ảnh (9:16 hoặc 16:9)")


class TestImageGenResponse(BaseModel):
    ok: bool
    saved_path: str
    relative_url: str
    elapsed_seconds: float
    error: Optional[str] = None
