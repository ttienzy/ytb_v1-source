"""Pipeline tạo video truyện có lồng tiếng từ dữ liệu đã crawl."""
from __future__ import annotations

import asyncio
import json
import math
import subprocess
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

from app.core.config import TOOLS_DIR
from app.recap.ffmpeg import ffprobe_duration
from app.voices.voice_client import tts_batch
from app.media import video_service

AUDIO_DIR = TOOLS_DIR / "Data" / "media" / "videos" / "Viaudio"
AUDIO_JOBS: dict[str, dict] = {}


def _set(job_id: str, **values: object) -> None:
    if job_id in AUDIO_JOBS:
        AUDIO_JOBS[job_id].update(values)


def _mux(video: Path, audio: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(video), "-i", str(audio),
         "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
         "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(output)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800,
    )
    if result.returncode or not output.exists() or not output.stat().st_size:
        raise RuntimeError((result.stderr or "Không thể ghép voice vào video.")[-1200:])


async def run(job_id: str, story_name: str, chapter_title: str, paragraph: str, voice_id: str, aspect: str) -> None:
    voice_file: Path | None = None
    merged_file: Path | None = None
    try:
        _set(job_id, status="running", step="voice", progress=20, message="Đang chuyển nội dung chương thành voice…")
        payload = await tts_batch([{ "text": paragraph }], voice_id)
        work = AUDIO_DIR / ".tmp" / job_id
        work.mkdir(parents=True, exist_ok=True)
        archive = work / "voice.zip"
        archive.write_bytes(payload)
        with zipfile.ZipFile(archive) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            voice_name = manifest["items"][0]["filename"]
            voice_file = work / "voice.wav"
            voice_file.write_bytes(zf.read(voice_name))
        voice_duration = ffprobe_duration(voice_file)
        if voice_duration <= 0:
            raise RuntimeError("Không đọc được thời lượng voice.")
        _set(job_id, step="duration", progress=35, duration_sec=voice_duration, message=f"Voice dài {voice_duration:.1f} giây.")

        _set(job_id, step="merge", progress=45, message="Đang gộp video hoàn tất theo thời lượng voice…")
        merged = await asyncio.to_thread(video_service.merge_done_videos, max(1, math.ceil(voice_duration)), None, True, aspect)
        merged_file = Path(merged["file_path"])
        _set(job_id, progress=70, message="Đã gộp video nền, đang ghép voice…")

        _set(job_id, step="mux", progress=78, message="Đang ghép voice vào video…")
        safe_story = "".join(c if c.isalnum() or c in "-_" else "_" for c in story_name).strip("_")[:60] or "story"
        output = AUDIO_DIR / f"{safe_story}_chuong_{job_id[:8]}.mp4"
        await asyncio.to_thread(_mux, merged_file, voice_file, output)
        _set(job_id, status="completed", step="done", progress=100, message="Hoàn thành video Audio.", output_name=output.name, output_path=str(output), created_at=datetime.now().isoformat())
    except Exception as error:  # noqa: BLE001
        _set(job_id, status="error", step="error", message=str(error), error=str(error))
    finally:
        if voice_file:
            voice_file.unlink(missing_ok=True)


def create(story_name: str, chapter_title: str) -> str:
    job_id = uuid.uuid4().hex[:12]
    AUDIO_JOBS[job_id] = {"job_id": job_id, "story_name": story_name, "chapter_title": chapter_title, "status": "queued", "step": "queued", "progress": 0, "message": "Đang xếp hàng…", "created_at": datetime.now().isoformat()}
    return job_id


def list_outputs() -> list[dict]:
    if not AUDIO_DIR.exists():
        return []
    return [{"file_name": p.name, "name": p.name, "duration_sec": ffprobe_duration(p), "created_at": datetime.fromtimestamp(p.stat().st_mtime).isoformat()} for p in sorted(AUDIO_DIR.glob("*.mp4"), key=lambda x: x.stat().st_mtime, reverse=True)]
