"""GET /health — trạng thái voice-service (model loaded?, backend, voices_count, error)."""
from fastapi import APIRouter

from app.engine import engine

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    s = engine.status()
    return {"status": "ok" if s["model_loaded"] else "degraded", **s}
