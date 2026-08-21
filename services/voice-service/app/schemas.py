"""Pydantic schemas cho voice-service (register/remove engine)."""
from pydantic import BaseModel


class VoiceRegistered(BaseModel):
    ok: bool
    voice_id: str
    name: str | None = None


class VoiceRemoved(BaseModel):
    ok: bool
    voice_id: str
