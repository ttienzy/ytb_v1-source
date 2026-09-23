"""Pydantic schemas cho voice-service (register/remove engine + TTS)."""
from typing import Annotated, Literal
from pydantic import BaseModel, Field, StringConstraints, model_validator

SpeechText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]


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
    text: SpeechText = Field(default=DEFAULT_PREVIEW_TEXT)
    voice_id: str | None = None
    temperature: float = Field(default=0.6, gt=0, le=2)


class TTSRequest(BaseModel):
    """/tts — sinh lời (48 kHz) cho 1 đoạn text, trả audio/wav + X-Audio-Duration."""
    text: SpeechText
    voice_id: str | None = None
    temperature: float = Field(default=0.8, gt=0, le=2)
    max_chars: int = Field(default=256, ge=32, le=512)


class TTSItem(BaseModel):
    text: SpeechText
    voice_id: str | None = None  # None → lấy theo batch voice_id


class TTSBatchRequest(BaseModel):
    """​/tts/batch — sinh nhiều đoạn, trả zip {vo_<i>.wav, manifest.json}."""
    items: list[TTSItem] = Field(min_length=1, max_length=200)
    voice_id: str | None = None  # mặc định cho item nào không chỉ định
    temperature: float = Field(default=0.8, gt=0, le=2)
    max_chars: int = Field(default=256, ge=32, le=512)

    @model_validator(mode="after")
    def limit_total_text(self):
        if sum(len(item.text) for item in self.items) > 100000:
            raise ValueError("Batch giới hạn 100.000 ký tự.")
        return self


class SpeechRequest(BaseModel):
    input: SpeechText
    model: str = "vieneu-v3-turbo"
    voice: str | None = None
    response_format: Literal["pcm", "wav"] = "wav"
    speed: Literal[1.0] = 1.0
    stream: bool = True
    temperature: float = Field(default=0.6, gt=0, le=2)
    max_chars: int = Field(default=256, ge=32, le=512)
