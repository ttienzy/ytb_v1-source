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


def _connection_error(error: httpx.HTTPError) -> RuntimeError:
    return RuntimeError(
        f"Không kết nối được voice-service tại {settings.voice_service_url}. "
        f"Hãy khởi động voice-service trên cổng 8001. Chi tiết: {error}"
    )


async def health() -> dict:
    try:
        async with _client(5.0) as client:
            r = await client.get("/health")
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as error:
        raise _connection_error(error) from error


async def list_presets() -> list[dict]:
    """Forward → voice-service GET /internal/voices/presets. Trả [{name, description, gender}]."""
    try:
        async with _client(10.0) as client:
            r = await client.get("/internal/voices/presets")
            if r.status_code >= 400:
                raise RuntimeError(f"voice-service presets failed ({r.status_code}): {r.text}")
            return r.json().get("presets", [])
    except httpx.HTTPError as error:
        raise _connection_error(error) from error


async def register_voice(voice_id: str, ref_audio: bytes, filename: str, name: str | None) -> dict:
    """Forward ref audio → voice-service POST /internal/voices/{id} (engine add_voice)."""
    files = {"ref_audio": (filename, ref_audio)}
    data = {"name": name or voice_id}
    try:
        async with _client(TIMEOUT_REGISTER) as client:
            r = await client.post(f"/internal/voices/{voice_id}", files=files, data=data)
            if r.status_code >= 400:
                raise RuntimeError(f"voice-service register failed ({r.status_code}): {r.text}")
            return r.json()
    except httpx.HTTPError as error:
        raise _connection_error(error) from error


async def remove_voice(voice_id: str) -> dict:
    try:
        async with _client(TIMEOUT_REMOVE) as client:
            r = await client.delete(f"/internal/voices/{voice_id}")
            if r.status_code >= 400:
                raise RuntimeError(f"voice-service remove failed ({r.status_code}): {r.text}")
            return r.json()
    except httpx.HTTPError as error:
        raise _connection_error(error) from error


async def preview_voice(voice_id: str, text: str | None = None) -> tuple[bytes, str | None]:
    """Forward → voice-service POST /preview. Trả (wav_bytes, X-Audio-Duration).

    ``text`` tuỳ chọn — None thì voice-service dùng câu mặc định. Trả bytes thô
    để router stream về FE (audio/wav) + forward header duration cho sync.
    """
    payload: dict = {"voice_id": voice_id, "temperature": 0.6}
    if text:
        payload["text"] = text
    try:
        async with _client(TIMEOUT_TTS) as client:
            r = await client.post("/preview", json=payload)
            if r.status_code >= 400:
                raise RuntimeError(f"voice-service preview failed ({r.status_code}): {r.text}")
            return r.content, r.headers.get("X-Audio-Duration")
    except httpx.HTTPError as error:
        raise _connection_error(error) from error


async def tts_batch(items: list[dict], voice_id: str) -> bytes:
    """Forward → voice-service POST /tts/batch. Trả zip bytes ({vo_i.wav, manifest.json}).

    ``items`` = [{"text": str}, ...] (voice_id truyền 1 lần ở batch level). manifest có
    duration/đoạn để main backend tính atempo sync về đúng ``duration_sec`` của segment.
    Dùng timeout dài (25 infer CPU tuần tự).
    """
    payload = {"items": items, "voice_id": voice_id, "temperature": 0.8, "max_chars": 256}
    try:
        async with _client(TIMEOUT_TTS_BATCH) as client:
            r = await client.post("/tts/batch", json=payload)
            if r.status_code >= 400:
                raise RuntimeError(f"voice-service tts/batch failed ({r.status_code}): {r.text}")
            return r.content
    except httpx.HTTPError as error:
        raise _connection_error(error) from error
