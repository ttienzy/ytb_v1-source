import asyncio
from unittest.mock import AsyncMock, Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.voices import router, service, voice_client


def test_stream_proxy_passes_rate_and_closes_upstream(monkeypatch):
    client = Mock(aclose=AsyncMock())
    response = Mock(status_code=200, headers={"X-Sample-Rate": "24000"}, aclose=AsyncMock())

    async def chunks():
        yield b"\x00\x00"
        yield b"\x00\x01"

    response.aiter_bytes = chunks
    monkeypatch.setattr(voice_client, "open_preview_stream", AsyncMock(return_value=(client, response)))
    app = FastAPI()
    app.include_router(router.router)
    frontend = TestClient(app)  # No application/database startup for this HTTP contract test.
    try:
        result = frontend.post("/api/voices/test/preview/stream", json={"text": "hello"})
    finally:
        frontend.close()
    assert result.status_code == 200
    assert result.content == b"\x00\x00\x00\x01"
    assert result.headers["X-Sample-Rate"] == "24000"
    assert "X-Sample-Rate" in result.headers["Access-Control-Expose-Headers"]
    assert response.aclose.await_count >= 1
    assert client.aclose.await_count >= 1


def test_failed_service_delete_keeps_metadata(monkeypatch):
    import pytest
    db = Mock()
    monkeypatch.setattr(voice_client, "remove_voice", AsyncMock(side_effect=RuntimeError("offline")))
    with pytest.raises(RuntimeError):
        asyncio.run(service.delete_voice(db, "abcdef123456"))
    db.delete.assert_not_called()
    db.commit.assert_not_called()
