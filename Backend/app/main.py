import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Force UTF-8 on Windows stdout/stderr to prevent 'charmap' UnicodeEncodeError
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from app.ai.gemini.router import router as gemini_router
from app.externals.gdrive.router import router as gdrive_router
from app.externals.mailtm.router import router as mailtm_router
from app.externals.pippit.router import router as pippit_router
from app.externals.youtube.router import router as youtube_router
from app.discover.router import router as discover_router
from app.media.router import router as media_router
from app.recap.router import router as recap_router
from app.routers.health import router as health_router
from app.voices.router import router as voices_router
from app.watermark.router import router as watermark_router
from app.publisher_monitor.router import router as monitor_router
from app.stories.router import router as stories_router



app = FastAPI(title="Google Search Backend", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(health_router)
app.include_router(gemini_router)
app.include_router(voices_router)
app.include_router(media_router)
app.include_router(recap_router)
app.include_router(discover_router)
app.include_router(watermark_router)
app.include_router(mailtm_router)
app.include_router(pippit_router)
app.include_router(gdrive_router)
app.include_router(youtube_router)
app.include_router(monitor_router)
app.include_router(stories_router)


