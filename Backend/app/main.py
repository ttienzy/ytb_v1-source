from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai.gemini.router import router as gemini_router
from app.routers.health import router as health_router
from app.voices.router import router as voices_router


app = FastAPI(title="Google Search Backend", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(health_router)
app.include_router(gemini_router)
app.include_router(voices_router)
