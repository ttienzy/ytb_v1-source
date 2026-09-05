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
AUDIO_MANIFEST = AUDIO_DIR / "outputs.json"


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


async def _run_one(job_id: str, story_name: str, chapter_title: str, paragraph: str, voice_id: str, aspect: str, chapter_number: int | None, start: int = 0, end: int = 100) -> str:
    voice_file: Path | None = None
    merged_file: Path | None = None
    try:
        def progress(value: int) -> int:
            return round(start + (end - start) * value / 100)
        _set(job_id, status="running", step="voice", progress=progress(20), message=f"Đang chuyển chương {chapter_number or ''} thành voice…")
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
        _set(job_id, step="duration", progress=progress(35), duration_sec=voice_duration, message=f"Voice dài {voice_duration:.1f} giây.")

        _set(job_id, step="merge", progress=progress(45), message="Đang gộp video hoàn tất theo thời lượng voice…")
        merged = await asyncio.to_thread(video_service.merge_done_videos, max(1, math.ceil(voice_duration)), None, True, aspect)
        merged_file = Path(merged["file_path"])
        _set(job_id, progress=progress(70), message="Đã gộp video nền, đang ghép voice…")

        _set(job_id, step="mux", progress=progress(78), message="Đang ghép voice vào video…")
        safe_story = "".join(c if c.isalnum() or c in "-_" else "_" for c in story_name).strip("_")[:60] or "story"
        chapter_suffix = f"{chapter_number}" if chapter_number is not None else job_id[:8]
        output = AUDIO_DIR / f"{safe_story}_chuong_{chapter_suffix}_{job_id[:8]}.mp4"
        await asyncio.to_thread(_mux, merged_file, voice_file, output)
        metadata = {"file_name": output.name, "name": output.name, "story_name": story_name, "chapter_number": chapter_number, "chapter_title": chapter_title, "duration_sec": ffprobe_duration(output), "created_at": datetime.now().isoformat()}
        _append_manifest(metadata)
        return output.name
    except Exception as error:  # noqa: BLE001
        raise
    finally:
        if voice_file:
            voice_file.unlink(missing_ok=True)


async def run(job_id: str, story_name: str, chapter_title: str, paragraph: str, voice_id: str, aspect: str, chapter_number: int | None = None) -> None:
    try:
        output_name = await _run_one(job_id, story_name, chapter_title, paragraph, voice_id, aspect, chapter_number)
        _set(job_id, status="completed", step="done", progress=100, message="Hoàn thành video Audio.", output_name=output_name)
    except Exception as error:  # noqa: BLE001
        _set(job_id, status="error", step="error", message=str(error), error=str(error))


async def run_batch(job_id: str, story_name: str, chapters: list, voice_id: str, aspect: str) -> None:
    total = len(chapters)
    try:
        for index, chapter in enumerate(chapters):
            _set(job_id, current_chapter=chapter.chapter_number, completed_chapters=index, total_chapters=total, message=f"Đang xử lý chương {chapter.chapter_number}/{total}…")
            output_name = await _run_one(job_id, story_name, chapter.title, chapter.paragraph, voice_id, aspect, chapter.chapter_number, round(index * 100 / total), round((index + 1) * 100 / total))
            _set(job_id, completed_chapters=index + 1, output_name=output_name)
        _set(job_id, status="completed", step="done", progress=100, message=f"Đã hoàn thành {total} video Audio.")
    except Exception as error:  # noqa: BLE001
        _set(job_id, status="error", step="error", message=str(error), error=str(error))


def create(story_name: str, chapter_title: str, total_chapters: int = 1) -> str:
    job_id = uuid.uuid4().hex[:12]
    AUDIO_JOBS[job_id] = {"job_id": job_id, "story_name": story_name, "chapter_title": chapter_title, "status": "queued", "step": "queued", "progress": 0, "message": "Đang xếp hàng…", "total_chapters": total_chapters, "completed_chapters": 0, "created_at": datetime.now().isoformat()}
    return job_id


def list_outputs() -> list[dict]:
    if not AUDIO_DIR.exists():
        return []
    try: metadata = {x["file_name"]: x for x in json.loads(AUDIO_MANIFEST.read_text(encoding="utf-8"))}
    except (OSError, ValueError): metadata = {}
    return [{**metadata.get(p.name, {}), "file_name": p.name, "name": metadata.get(p.name, {}).get("name", p.name), "duration_sec": metadata.get(p.name, {}).get("duration_sec") or ffprobe_duration(p), "created_at": metadata.get(p.name, {}).get("created_at") or datetime.fromtimestamp(p.stat().st_mtime).isoformat()} for p in sorted(AUDIO_DIR.glob("*.mp4"), key=lambda x: x.stat().st_mtime, reverse=True)]


def _append_manifest(item: dict) -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    try: items = json.loads(AUDIO_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError): items = []
    items = [item, *[x for x in items if x.get("file_name") != item["file_name"]]]
    AUDIO_MANIFEST.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
