"""FastAPI app cho voice-service. Load model 1 lần trong lifespan (dung sai lỗi)."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.engine import engine
from app.routers import health, tts, voices

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine.start()
    yield


app = FastAPI(title="Voice Service", version="0.1.0", lifespan=lifespan)
app.include_router(health.router, tags=["health"])
app.include_router(voices.router, tags=["voices"])
app.include_router(tts.router, tags=["tts"])
