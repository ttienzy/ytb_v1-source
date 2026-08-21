"""Pydantic schemas cho voice CRUD."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class VoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    voice_id: str
    name: str
    ref_path: str | None = None
    tags: dict = {}
    created_at: datetime | None = None
