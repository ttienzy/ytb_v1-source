"""HTTP client → voice-service (port 8001, nội bộ).

Chỉ main backend gọi voice-service qua đây. Voice-service không expose ra trình duyệt.
Xem docs/VOICE_SERVICE_PLAN.md §3.2.
"""
from pathlib import Path

import httpx

from app.core.config import settings

TIMEOUT_REGISTER = 120  # add_voice extract speaker embedding có thể chậm với ref dài
TIMEOUT_REMOVE = 30
TIMEOUT_TTS = 300  # ONNX/CPU infer có thể chậm với text dài
TIMEOUT_TTS_BATCH = 900  # 25 inferences tuần tự trên CPU — chậm nhất ~30-60p text dài


def _client(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=settings.voice_service_url, timeout=timeout)


async def health() -> dict:
    async with _client(5.0) as client:
        r = await client.get("/health")
        r.raise_for_status()
        return r.json()


async def list_presets() -> list[dict]:
    """Forward → voice-service GET /internal/voices/presets. Trả [{name, description, gender}]."""
    async with _client(10.0) as client:
        r = await client.get("/internal/voices/presets")
        if r.status_code >= 400:
            raise RuntimeError(f"voice-service presets failed ({r.status_code}): {r.text}")
        return r.json().get("presets", [])


async def register_voice(voice_id: str, ref_audio: bytes, filename: str, name: str | None) -> dict:
    """Forward ref audio → voice-service POST /internal/voices/{id} (engine add_voice)."""
    files = {"ref_audio": (filename, ref_audio)}
    data = {"name": name or voice_id}
    async with _client(TIMEOUT_REGISTER) as client:
        r = await client.post(f"/internal/voices/{voice_id}", files=files, data=data)
        if r.status_code >= 400:
            raise RuntimeError(f"voice-service register failed ({r.status_code}): {r.text}")
        return r.json()


async def remove_voice(voice_id: str) -> dict:
    async with _client(TIMEOUT_REMOVE) as client:
        r = await client.delete(f"/internal/voices/{voice_id}")
        if r.status_code >= 400:
            raise RuntimeError(f"voice-service remove failed ({r.status_code}): {r.text}")
        return r.json()


async def preview_voice(voice_id: str, text: str | None = None) -> tuple[bytes, str | None]:
    """Forward → voice-service POST /preview. Trả (wav_bytes, X-Audio-Duration).

    ``text`` tuỳ chọn — None thì voice-service dùng câu mặc định. Trả bytes thô
    để router stream về FE (audio/wav) + forward header duration cho sync.
    """
    payload: dict = {"voice_id": voice_id, "temperature": 0.6}
    if text:
        payload["text"] = text
    async with _client(TIMEOUT_TTS) as client:
        r = await client.post("/preview", json=payload)
        if r.status_code >= 400:
            raise RuntimeError(f"voice-service preview failed ({r.status_code}): {r.text}")
        return r.content, r.headers.get("X-Audio-Duration")


async def tts_batch(items: list[dict], voice_id: str) -> bytes:
    """Forward → voice-service POST /tts/batch. Trả zip bytes ({vo_i.wav, manifest.json}).

    ``items`` = [{"text": str}, ...] (voice_id truyền 1 lần ở batch level). manifest có
    duration/đoạn để main backend tính atempo sync về đúng ``duration_sec`` của segment.
    Dùng timeout dài (25 infer CPU tuần tự).
    """
    payload = {"items": items, "voice_id": voice_id, "temperature": 0.8, "max_chars": 256}
    async with _client(TIMEOUT_TTS_BATCH) as client:
        r = await client.post("/tts/batch", json=payload)
        if r.status_code >= 400:
            raise RuntimeError(f"voice-service tts/batch failed ({r.status_code}): {r.text}")
        return r.content
