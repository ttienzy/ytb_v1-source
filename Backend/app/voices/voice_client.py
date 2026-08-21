"""HTTP client → voice-service (port 8001, nội bộ).

Chỉ main backend gọi voice-service qua đây. Voice-service không expose ra trình duyệt.
Xem docs/VOICE_SERVICE_PLAN.md §3.2.
"""
from pathlib import Path

import httpx

from app.core.config import settings

TIMEOUT_REGISTER = 120  # add_voice extract speaker embedding có thể chậm với ref dài
TIMEOUT_REMOVE = 30


def _client(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=settings.voice_service_url, timeout=timeout)


async def health() -> dict:
    async with _client(5.0) as client:
        r = await client.get("/health")
        r.raise_for_status()
        return r.json()


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
