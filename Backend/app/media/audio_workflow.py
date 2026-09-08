"""Pipeline tạo video truyện có lồng tiếng từ dữ liệu đã crawl."""
from __future__ import annotations

import asyncio
import json
import math
import subprocess
import uuid
import zipfile
import re
import random
import textwrap
from datetime import datetime
from pathlib import Path

from app.core.config import TOOLS_DIR
from app.recap.ffmpeg import ffprobe_duration
from app.voices.voice_client import tts_batch
from app.media import video_service

AUDIO_DIR = TOOLS_DIR / "Data" / "media" / "videos" / "Viaudio"
AUDIO_JOBS: dict[str, dict] = {}
AUDIO_MANIFEST = AUDIO_DIR / "outputs.json"
AUDIO_THUMBNAIL_DIR = AUDIO_DIR / "thumbnails"


def _set(job_id: str, **values: object) -> None:
    if job_id in AUDIO_JOBS:
        AUDIO_JOBS[job_id].update(values)


def _safe_name(value: str) -> str:
    return re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("._")[:80] or "story"


def thumbnail_path(story_slug: str) -> Path | None:
    for suffix in (".png", ".jpg", ".jpeg", ".webp"):
        path = AUDIO_THUMBNAIL_DIR / f"{_safe_name(story_slug)}{suffix}"
        if path.exists() and path.stat().st_size:
            return path
    return None


def _process_thumbnail(source: Path, story_name: str, chapter_number: int | None, work: Path, aspect: str) -> Path:
    """Chuẩn hóa ảnh và burn label để dùng làm thumbnail/poster của video."""
    work.mkdir(parents=True, exist_ok=True)
    label = f"Audio {story_name} - phần {chapter_number or 1}"
    # Chia dòng để tên truyện dài không tràn ra ngoài khung thumbnail.
    label = "\n".join(textwrap.wrap(
        label,
        width=24 if aspect == "9:16" else 42,
        break_long_words=False,
        break_on_hyphens=False,
    ))
    text_file = work / "thumbnail-label.txt"
    text_file.write_text(label, encoding="utf-8")
    size = "1080:1920" if aspect == "9:16" else "1920:1080"
    output = work / "thumbnail.jpg"
    vf = (
        f"scale={size}:force_original_aspect_ratio=increase,crop={size},"
        f"drawtext=textfile='{text_file.as_posix().replace(':', '\\:')}':fontcolor=white:fontsize=46:"
        "line_spacing=10:fix_bounds=1:x=(w-text_w)/2:y=110:"
        "box=1:boxcolor=black@0.65:boxborderw=24"
    )
    result = subprocess.run(["ffmpeg", "-y", "-i", str(source), "-vf", vf, "-frames:v", "1", str(output)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if result.returncode or not output.exists():
        raise RuntimeError((result.stderr or "Không thể xử lý thumbnail.")[-1000:])
    return output


def _mux(video: Path, audio: Path, output: Path, bgm: Path | None = None, bgm_volume: float = 0.22) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    inputs = ["-i", str(video), "-i", str(audio)]
    maps = ["-map", "0:v:0", "-map", "1:a:0"]
    filters: list[str] = []
    if bgm:
        inputs = ["-i", str(video), "-i", str(audio), "-stream_loop", "-1", "-i", str(bgm)]
        # Giữ BGM ở khoảng 22% bản gốc và tự duck thêm khi voice đang phát.
        filters = [f"[1:a]asplit=2[voice][sidechain];[2:a]volume={max(0.0, min(1.0, bgm_volume))}[music];[music][sidechain]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[ducked];[voice][ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]"]
        maps = ["-map", "0:v:0", "-map", "[aout]"]
    result = subprocess.run(
        ["ffmpeg", "-y", *inputs, *(["-filter_complex", filters[0]] if filters else []), *maps,
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(output)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800,
    )
    if result.returncode or not output.exists() or not output.stat().st_size:
        raise RuntimeError((result.stderr or "Không thể ghép voice vào video.")[-1200:])

def _upload_audio_output(output: Path, story_name: str, chapter_number: int | None) -> dict:
    from app.externals.gdrive import service as gdrive_service
    cfg = gdrive_service.get_gdrive_config()
    client = gdrive_service.get_client()
    if not client:
        raise RuntimeError("Google Drive chưa được kết nối.")
    root_id = gdrive_service.get_workflow_folder_id("audio") or cfg.get("folder_id")
    if not root_id:
        raise RuntimeError("Chưa cấu hình thư mục Google Drive cho Audio.")
    story_folder = client.get_or_create_child_folder(story_name or "Video Audio khác", root_id)
    safe_story = _safe_name(story_name or "Video_Audio")
    drive_name = f"{safe_story}_Phần_{chapter_number or 1}.mp4"
    stem, suffix = Path(drive_name).stem, Path(drive_name).suffix
    index = 1
    while client.find_file_in_folder(drive_name, story_folder["id"]):
        drive_name = f"{stem} ({index}){suffix}"
        index += 1
    return client.upload_file_resumable(output, folder_id=story_folder["id"], custom_name=drive_name)


async def _run_one(job_id: str, story_name: str, chapter_title: str, paragraph: str, voice_id: str, aspect: str, chapter_number: int | None, thumbnail: Path | None = None, bgm_pool: list[Path] | None = None, start: int = 0, end: int = 100, auto_upload_drive: bool = False, delete_local_after_upload: bool = False) -> str:
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

        labeled_thumbnail = None
        if thumbnail:
            _set(job_id, step="image", progress=progress(40), message="Đang xử lý thumbnail và ghép label chương…")
            labeled_thumbnail = await asyncio.to_thread(_process_thumbnail, thumbnail, story_name, chapter_number, work, aspect)

        _set(job_id, step="merge", progress=progress(45), message="Đang gộp video hoàn tất theo thời lượng voice…")
        merged = await asyncio.to_thread(video_service.merge_done_videos, max(1, math.ceil(voice_duration)), None, True, aspect)
        merged_file = Path(merged["file_path"])
        _set(job_id, progress=progress(70), message="Đã gộp video nền, đang ghép voice…")

        _set(job_id, step="mux", progress=progress(78), message="Đang ghép voice vào video…")
        safe_story = "".join(c if c.isalnum() or c in "-_" else "_" for c in story_name).strip("_")[:60] or "story"
        chapter_suffix = f"{chapter_number}" if chapter_number is not None else job_id[:8]
        output = AUDIO_DIR / f"{safe_story}_chuong_{chapter_suffix}_{job_id[:8]}.mp4"
        _set(job_id, step="bgm", progress=progress(88), message="Đang chọn và mix nhạc nền ngẫu nhiên…")
        selected_bgm = random.choice(bgm_pool) if bgm_pool else None
        await asyncio.to_thread(_mux, merged_file, voice_file, output, selected_bgm)
        output_thumbnail_name = None
        if labeled_thumbnail:
            output_thumbnail_name = f"{output.stem}.jpg"
            AUDIO_THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
            (AUDIO_THUMBNAIL_DIR / output_thumbnail_name).write_bytes(labeled_thumbnail.read_bytes())
        metadata = {"file_name": output.name, "name": output.name, "story_name": story_name, "chapter_number": chapter_number, "chapter_title": chapter_title, "thumbnail_name": output_thumbnail_name, "duration_sec": ffprobe_duration(output), "created_at": datetime.now().isoformat()}
        if auto_upload_drive:
            _set(job_id, step="drive", progress=progress(92), message="Đang upload video lên Google Drive…")
            try:
                drive_res = await asyncio.to_thread(_upload_audio_output, output, story_name, chapter_number)
                metadata["drive_file_id"] = drive_res.get("file_id")
                metadata["drive_url"] = drive_res.get("web_view_link")
                metadata["drive_name"] = drive_res.get("file_name")
                metadata["drive_uploaded"] = True
                if delete_local_after_upload:
                    output.unlink(missing_ok=True)
                    if output_thumbnail_name:
                        (AUDIO_THUMBNAIL_DIR / output_thumbnail_name).unlink(missing_ok=True)
                _set(job_id, progress=progress(97), message="Đã upload Google Drive và dọn file local.")
            except Exception as drive_error:  # Drive lỗi không làm hỏng video local đã tạo.
                metadata["drive_error"] = str(drive_error)
        _append_manifest(metadata)
        return output.name
    except Exception as error:  # noqa: BLE001
        raise
    finally:
        if voice_file:
            voice_file.unlink(missing_ok=True)


async def run(job_id: str, story_name: str, chapter_title: str, paragraph: str, voice_id: str, aspect: str, chapter_number: int | None = None, thumbnail: Path | None = None, bgm_pool: list[Path] | None = None, auto_upload_drive: bool = False, delete_local_after_upload: bool = False) -> None:
    try:
        output_name = await _run_one(job_id, story_name, chapter_title, paragraph, voice_id, aspect, chapter_number, thumbnail, bgm_pool, auto_upload_drive=auto_upload_drive, delete_local_after_upload=delete_local_after_upload)
        _set(job_id, status="completed", step="done", progress=100, message="Hoàn thành video Audio.", output_name=output_name)
    except Exception as error:  # noqa: BLE001
        _set(job_id, status="error", step="error", message=str(error), error=str(error))


async def run_batch(job_id: str, story_name: str, chapters: list, voice_id: str, aspect: str, thumbnail: Path | None = None, bgm_pool: list[Path] | None = None, auto_upload_drive: bool = False, delete_local_after_upload: bool = False) -> None:
    total = len(chapters)
    try:
        for index, chapter in enumerate(chapters):
            _set(job_id, current_chapter=chapter.chapter_number, completed_chapters=index, total_chapters=total, message=f"Đang xử lý chương {chapter.chapter_number}/{total}…")
            output_name = await _run_one(job_id, story_name, chapter.title, chapter.paragraph, voice_id, aspect, chapter.chapter_number, thumbnail, bgm_pool, round(index * 100 / total), round((index + 1) * 100 / total), auto_upload_drive, delete_local_after_upload)
            _set(job_id, completed_chapters=index + 1, output_name=output_name)
        _set(job_id, status="completed", step="done", progress=100, message=f"Đã hoàn thành {total} video Audio.")
    except Exception as error:  # noqa: BLE001
        _set(job_id, status="error", step="error", message=str(error), error=str(error))


async def run_queue(job_id: str, queue: list[tuple[str, list, Path | None]], voice_id: str, aspect: str, bgm_pool: list[Path] | None = None, auto_upload_drive: bool = False, delete_local_after_upload: bool = False) -> None:
    """Chạy tuần tự các chương đã chọn từ tối đa 10 truyện."""
    total = sum(len(chapters) for _, chapters, _ in queue)
    completed = 0
    try:
        for story_name, chapters, thumbnail in queue:
            _set(job_id, current_story=story_name, message=f"Đang xử lý truyện {story_name}…")
            for chapter in chapters:
                _set(job_id, current_chapter=chapter.chapter_number, completed_chapters=completed, total_chapters=total, message=f"Đang xử lý {story_name} · chương {chapter.chapter_number}…")
                await _run_one(job_id, story_name, chapter.title, chapter.paragraph, voice_id, aspect, chapter.chapter_number, thumbnail, bgm_pool, round(completed * 100 / total), round((completed + 1) * 100 / total), auto_upload_drive, delete_local_after_upload)
                completed += 1
                _set(job_id, completed_chapters=completed)
        _set(job_id, status="completed", step="done", progress=100, message=f"Đã hoàn thành {completed} video Audio từ {len(queue)} truyện.")
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
