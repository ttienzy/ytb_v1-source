"""Pydantic schemas cho /api/recap — Phase A redesign."""
from datetime import datetime
from pydantic import BaseModel


class JobOut(BaseModel):
    job_id: str
    youtube_url: str
    # Per-phase status
    recap_status: str = "idle"
    cut_status: str = "idle"
    voice_status: str = "idle"
    merge_status: str = "idle"
    polish_status: str = "idle"
    # Computed overall (idle | running | recap_done | error | merged | polished)
    overall: str = "idle"
    # Progress per phase
    progress: dict = {}
    # Timestamps
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # Payload
    voice_id: str | None = None
    error: str | None = None
    recap: dict | None = None
    caption: dict | None = None
    clips: list[str] | None = None
    overspeed: list[int] | None = None
    final: str | None = None
    final_studio: str | None = None
    credits: str | None = None
    pippit_tasks: list[dict] = []



class JobPublishFacebookRequest(BaseModel):
    account_id: str
    page_id: str
    title: str = ""
    caption: str = ""
    when_minutes_ahead: int = 1

