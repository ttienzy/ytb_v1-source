"""Pydantic schemas cho voice-service (register/remove engine + TTS)."""
from pydantic import BaseModel, Field


class VoiceRegistered(BaseModel):
    ok: bool
    voice_id: str
    name: str | None = None


class VoiceRemoved(BaseModel):
    ok: bool
    voice_id: str


class PresetVoice(BaseModel):
    """1 preset voice của VieNeu (sẵn dùng, không cần clone)."""
    name: str
    description: str = ""
    gender: str = ""


class PresetList(BaseModel):
    presets: list[PresetVoice]


# ── TTS ──────────────────────────────────────────────────────────────────────
# voice_id: tên voice đã register (clone id hoặc preset như "Adam"). None → default.

DEFAULT_PREVIEW_TEXT = "Xin chào, đây là giọng đọc thử được tổng hợp bằng VieNeu-TTS."


class PreviewRequest(BaseModel):
    """/preview — nghe thử 1 câu ngắn với 1 voice. text tuỳ chọn (có default)."""
    text: str = Field(default=DEFAULT_PREVIEW_TEXT)
    voice_id: str | None = None
    temperature: float = 0.6  # thấp → ổn định, hợp để nghe thử


class TTSRequest(BaseModel):
    """/tts — sinh lời (48 kHz) cho 1 đoạn text, trả audio/wav + X-Audio-Duration."""
    text: str
    voice_id: str | None = None
    temperature: float = 0.8
    max_chars: int = 256


class TTSItem(BaseModel):
    text: str
    voice_id: str | None = None  # None → lấy theo batch voice_id


class TTSBatchRequest(BaseModel):
    """​/tts/batch — sinh nhiều đoạn, trả zip {vo_<i>.wav, manifest.json}."""
    items: list[TTSItem]
    voice_id: str | None = None  # mặc định cho item nào không chỉ định
    temperature: float = 0.8
    max_chars: int = 256
