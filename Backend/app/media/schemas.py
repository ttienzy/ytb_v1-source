"""Pydantic schemas cho BGM CRUD."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BgmOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    track_id: str
    name: str
    needs_attribution: bool = False
    description: str | None = None
    duration_sec: float = 0.0
    created_at: datetime | None = None
