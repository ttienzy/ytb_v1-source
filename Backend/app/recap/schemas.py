"""Pydantic schemas cho /api/recap."""
from pydantic import BaseModel


class JobOut(BaseModel):
    job_id: str
    youtube_url: str
    status: str
    error: str | None = None
    recap: dict | None = None
    clips: list[str] | None = None
