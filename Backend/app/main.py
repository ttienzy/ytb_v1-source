import sys
from contextlib import asynccontextmanager
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
from app.media.video_router import router as video_router
from app.media.audio_router import router as audio_router
from app.media.background_router import router as background_router
from app.recap.router import router as recap_router
from app.routers.health import router as health_router
from app.voices.router import router as voices_router
from app.watermark.router import router as watermark_router
from app.publisher_monitor.router import router as monitor_router
from app.stories.router import router as stories_router
from app.veo.router import router as veo_router
from app.ai.muse.router import router as muse_router
from app.ai.image_gen.router import router as image_gen_router
from app.workflow.router import router as workflow_router
from app.campaign.router import router as campaign_router
from app.motion_long.router import router as motion_long_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Khởi động Veo Bridge Service & đảm bảo các bảng SQLite sẵn sàng
    from app.veo import service as veo_service
    veo_service.startup()

    try:
        from app.voices.router import ensure_voice_table
        ensure_voice_table()
    except Exception:
        pass

    try:
        from app.media.router import ensure_bgm_table
        ensure_bgm_table()
    except Exception:
        pass

    try:
        from app.stories.router import ensure_story_tables
        ensure_story_tables()
    except Exception:
        pass

    try:
        # Tạo bảng Campaign + đánh dấu các run đang dở (tiến trình cũ đã chết) là lỗi/unknown.
        from app.campaign.router import ensure_campaign_tables
        ensure_campaign_tables()
    except Exception:
        import logging
        logging.getLogger("campaign").exception("Không khởi tạo được Campaign engine")

    yield

    # Dọn dẹp khi tắt server
    veo_service.shutdown()


app = FastAPI(title="Google Search Backend", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(health_router)
app.include_router(gemini_router)
app.include_router(workflow_router)
app.include_router(campaign_router)
app.include_router(motion_long_router)
app.include_router(muse_router)
app.include_router(image_gen_router)
app.include_router(voices_router)
app.include_router(media_router)
app.include_router(video_router)
app.include_router(audio_router)
app.include_router(background_router)
app.include_router(recap_router)
app.include_router(discover_router)
app.include_router(watermark_router)
app.include_router(mailtm_router)
app.include_router(pippit_router)
app.include_router(gdrive_router)
app.include_router(youtube_router)
app.include_router(monitor_router)
app.include_router(stories_router)
app.include_router(veo_router)
