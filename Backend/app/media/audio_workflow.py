"""Phần dùng chung của Workflow Audio: thư mục/đầu ra, lịch sử "đã làm", job trong RAM, TTS có chờ khi bận, ghép âm thanh,
logo, upload Drive. Pipeline tạo video nằm ở story_video.py."""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

from app.core.config import TOOLS_DIR
from app.recap.ffmpeg import ffprobe_duration
from app.voices.voice_client import VoiceBusyError, tts_batch

AUDIO_DIR = TOOLS_DIR / "Data" / "media" / "videos" / "Viaudio"
AUDIO_JOBS: dict[str, dict] = {}
AUDIO_MANIFEST = AUDIO_DIR / "outputs.json"
AUDIO_HISTORY = AUDIO_DIR / "audio_history.json"
AUDIO_THUMBNAIL_DIR = AUDIO_DIR / "thumbnails"


def _set(job_id: str, **values: object) -> None:
    if job_id in AUDIO_JOBS:
        AUDIO_JOBS[job_id].update(values)


def _safe_name(value: str) -> str:
    return re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("._")[:80] or "story"


THUMBNAIL_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")


def thumbnail_path(story_slug: str) -> Path | None:
    for suffix in THUMBNAIL_SUFFIXES:
        path = AUDIO_THUMBNAIL_DIR / f"{_safe_name(story_slug)}{suffix}"
        if path.exists() and path.stat().st_size:
            return path
    return None


def thumbnail_index() -> dict[str, str]:
    """Quét thư mục thumbnail MỘT lần: tên-đã-safe của truyện -> tên file (cùng thứ tự ưu tiên đuôi file với thumbnail_path).

    Dùng khi cần tra hàng nghìn truyện, thay vì gọi thumbnail_path (vài lệnh stat) cho từng truyện."""
    found: dict[str, dict[str, str]] = {}
    if AUDIO_THUMBNAIL_DIR.exists():
        for path in AUDIO_THUMBNAIL_DIR.iterdir():
            if path.suffix in THUMBNAIL_SUFFIXES and path.is_file() and path.stat().st_size:
                found.setdefault(path.stem, {})[path.suffix] = path.name
    return {stem: by_suffix[next(s for s in THUMBNAIL_SUFFIXES if s in by_suffix)] for stem, by_suffix in found.items()}


# Voice-service chỉ chạy một suy luận một lúc; nếu Recap/Campaign đang dùng thì chờ thay vì hủy cả chương.
TTS_BUSY_RETRIES = 6
TTS_BUSY_DELAY_SEC = 10.0


async def _tts_with_retry(job_id: str, items: list[dict], voice_id: str) -> bytes:
    for attempt in range(TTS_BUSY_RETRIES + 1):
        try:
            return await tts_batch(items, voice_id)
        except VoiceBusyError as error:
            if attempt >= TTS_BUSY_RETRIES:
                raise RuntimeError(f"Voice-service vẫn bận sau {TTS_BUSY_RETRIES} lần thử lại (đang có tác vụ giọng đọc khác chạy). Chạy lại sau khi tác vụ đó xong. Chi tiết: {error}") from error
            _set(job_id, message=f"Voice-service đang bận (có tác vụ giọng đọc khác), thử lại sau {TTS_BUSY_DELAY_SEC:.0f} giây ({attempt + 1}/{TTS_BUSY_RETRIES})…")
            await asyncio.sleep(TTS_BUSY_DELAY_SEC)
    raise AssertionError("unreachable")


DUCK_SETTINGS = {
    "normal": "threshold=0.03:ratio=6:attack=20:release=350",   # mức cũ: nhạc tự hạ khi giọng đang nói
    "strong": "threshold=0.02:ratio=10:attack=15:release=400",
}


def build_audio_filter(has_bgm: bool, *, bgm_volume: float = 0.22, duck: str = "normal", fade_out: float = 1.5,
                       loudnorm: bool = True, duration: float | None = None) -> str:
    """filter_complex âm thanh cuối: [1:a] là giọng đọc, [2:a] là nhạc nền (nếu có) → [aout].

    amix có normalize=0 (mặc định nó chia đôi mỗi đầu vào → giọng nhỏ đi ~6 dB). loudnorm kéo cả video về ~-16 LUFS để các video đồng đều
    (YouTube quy chuẩn quanh -14 LUFS; giọng đọc nên -14…-16); aresample vì loudnorm có thể đổi tần số lấy mẫu. alimiter chặn vỡ tiếng."""
    tail: list[str] = []
    if loudnorm:
        tail += ["loudnorm=I=-16:TP=-1.5:LRA=11", "aresample=48000"]
    if fade_out > 0 and duration and duration > fade_out:
        tail.append(f"afade=t=out:st={duration - fade_out:.3f}:d={fade_out:.3f}")
    tail.append("alimiter=limit=0.97")
    tail_s = ",".join(tail)
    if not has_bgm:
        return f"[1:a]{tail_s}[aout]"
    volume = max(0.0, min(1.0, bgm_volume))
    if duck == "off" or duck not in DUCK_SETTINGS:
        chain = f"[2:a]volume={volume:.3f}[music];[1:a][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[mix]"
    else:
        chain = (f"[1:a]asplit=2[voice][sidechain];[2:a]volume={volume:.3f}[music];"
                 f"[music][sidechain]sidechaincompress={DUCK_SETTINGS[duck]}[ducked];"
                 f"[voice][ducked]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[mix]")
    return f"{chain};[mix]{tail_s}[aout]"


def _mux(video: Path, audio: Path, output: Path, bgm: Path | None = None, bgm_volume: float = 0.22, *, duck: str = "normal",
         fade_out: float = 1.5, loudnorm: bool = True, duration: float | None = None) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    inputs = ["-i", str(video), "-i", str(audio)]
    if bgm:
        inputs += ["-stream_loop", "-1", "-i", str(bgm)]
    graph = build_audio_filter(bool(bgm), bgm_volume=bgm_volume, duck=duck, fade_out=fade_out, loudnorm=loudnorm,
                               duration=duration if duration else ffprobe_duration(audio))
    result = subprocess.run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", graph, "-map", "0:v:0", "-map", "[aout]",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(output)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800,
    )
    if result.returncode or not output.exists() or not output.stat().st_size:
        raise RuntimeError((result.stderr or "Không thể ghép voice vào video.")[-1200:])


def apply_voice_speed(src: Path, dst: Path, speed: float) -> Path:
    """Đổi tốc độ đọc bằng atempo (giữ nguyên cao độ). speed≈1 thì dùng nguyên file."""
    if abs(speed - 1.0) < 0.01:
        return src
    result = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-filter:a", f"atempo={speed:.3f}", "-vn", str(dst)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    if result.returncode or not dst.exists() or not dst.stat().st_size:
        raise RuntimeError(f"Không đổi được tốc độ đọc: {(result.stderr or '').strip()[-400:]}")
    return dst


LOGO_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")


def logo_dir() -> Path:
    return AUDIO_DIR / "logos"


def logo_path(logo_id: str | None) -> Path | None:
    """Đường dẫn file logo theo id (12 ký tự hex); không có/không tồn tại -> None."""
    if not logo_id or not re.fullmatch(r"[a-f0-9]{12}", logo_id):
        return None
    for suffix in LOGO_SUFFIXES:
        path = logo_dir() / f"{logo_id}{suffix}"
        if path.is_file() and path.stat().st_size:
            return path
    return None


def _upload_audio_output(output: Path, story_name: str, chapter_number: int | None, story_slug: str | None = None, *,
                         drive_label: str | None = None) -> dict:
    from app.externals.gdrive import service as gdrive_service
    cfg = gdrive_service.get_gdrive_config()
    client = gdrive_service.get_client()
    if not client:
        raise RuntimeError("Google Drive chưa được kết nối.")
    root_id = gdrive_service.get_workflow_folder_id("audio") or cfg.get("folder_id")
    if not root_id:
        raise RuntimeError("Chưa cấu hình thư mục Google Drive cho Audio.")
    existing = find_history_item(story_slug, story_name, chapter_number) if drive_label is None else None
    if existing and existing.get("drive_uploaded"):
        return existing.get("drive_result") or {"file_id": existing.get("drive_file_id"), "web_view_link": existing.get("drive_url"), "file_name": existing.get("drive_name")}
    story_folder = client.get_or_create_child_folder(story_name or "Video Audio khác", root_id)
    safe_story = _safe_name(story_name or "Video_Audio")
    drive_name = f"{safe_story}_{_safe_name(drive_label)}.mp4" if drive_label else f"{safe_story}_Phần_{chapter_number or 1}.mp4"
    stem, suffix = Path(drive_name).stem, Path(drive_name).suffix
    index = 1
    while client.find_file_in_folder(drive_name, story_folder["id"]):
        drive_name = f"{stem} ({index}){suffix}"
        index += 1
    return client.upload_file_resumable(output, folder_id=story_folder["id"], custom_name=drive_name)


def _read_history() -> list[dict]:
    try:
        value = json.loads(AUDIO_HISTORY.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except (OSError, ValueError, TypeError):
        return []


def _write_history(items: list[dict]) -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    temp = AUDIO_HISTORY.with_suffix(".tmp")
    temp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(AUDIO_HISTORY)


def find_history_item(story_slug: str | None, story_name: str | None, chapter_number: int | None) -> dict | None:
    fallback = None
    for item in _read_history():
        if chapter_number is None or item.get("chapter_number") != chapter_number:
            continue
        if story_slug and item.get("story_slug") == story_slug:
            return item
        if item.get("story_name") == story_name:
            fallback = item
    return fallback


def record_completion(metadata: dict, story_slug: str | None = None) -> dict:
    previous = find_history_item(story_slug, metadata.get("story_name"), metadata.get("chapter_number"))
    item = {
        "story_slug": story_slug,
        "story_name": metadata.get("story_name"),
        "chapter_number": metadata.get("chapter_number"),
        "chapter_title": metadata.get("chapter_title"),
        "file_name": metadata.get("file_name"),
        "status": "completed",
        "drive_uploaded": False,
        "created_at": metadata.get("created_at") or datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    if previous and previous.get("drive_uploaded"):
        item.update({
            "status": "uploaded",
            "drive_uploaded": True,
            "drive_file_id": previous.get("drive_file_id"),
            "drive_url": previous.get("drive_url"),
            "drive_name": previous.get("drive_name"),
            "drive_result": previous.get("drive_result"),
        })
    items = [x for x in _read_history() if not (
        x.get("story_slug") == story_slug and x.get("story_name") == item["story_name"] and x.get("chapter_number") == item["chapter_number"]
    )]
    _write_history([item, *items])
    return item


def record_drive_upload(metadata: dict, result: dict) -> None:
    items = _read_history()
    target = next((x for x in items if x.get("file_name") == metadata.get("file_name")), None)
    if target is None:
        target = record_completion(metadata, metadata.get("story_slug"))
        items = _read_history()
        target = next(x for x in items if x.get("file_name") == metadata.get("file_name"))
    target.update({
        "status": "uploaded",
        "drive_uploaded": True,
        "drive_file_id": result.get("file_id"),
        "drive_url": result.get("web_view_link"),
        "drive_name": result.get("file_name"),
        "drive_result": result,
        "updated_at": datetime.now().isoformat(),
    })
    _write_history(items)


def mark_drive_uploaded(file_name: str, result: dict) -> None:
    """Đánh dấu MỌI chương nằm trong một video (video cả truyện gồm nhiều chương) là đã upload Drive."""
    items = _read_history()
    for item in items:
        if item.get("file_name") == file_name:
            item.update({"status": "uploaded", "drive_uploaded": True, "drive_file_id": result.get("file_id"),
                         "drive_url": result.get("web_view_link"), "drive_name": result.get("file_name"), "drive_result": result,
                         "updated_at": datetime.now().isoformat()})
    _write_history(items)


def history() -> list[dict]:
    items = _read_history()
    known = {x.get("file_name") for x in items}
    try:
        manifest = json.loads(AUDIO_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        manifest = []
    changed = False
    for metadata in manifest if isinstance(manifest, list) else []:
        if metadata.get("file_name") in known:
            continue
        items.append({
            "story_slug": metadata.get("story_slug"),
            "story_name": metadata.get("story_name"),
            "chapter_number": metadata.get("chapter_number"),
            "chapter_title": metadata.get("chapter_title"),
            "file_name": metadata.get("file_name"),
            "status": "completed",
            "drive_uploaded": bool(metadata.get("drive_uploaded")),
            "drive_file_id": metadata.get("drive_file_id"),
            "drive_url": metadata.get("drive_url"),
            "drive_name": metadata.get("drive_name"),
            "created_at": metadata.get("created_at"),
            "updated_at": datetime.now().isoformat(),
        })
        changed = True
    if changed:
        _write_history(items)
    return items


def create(story_name: str, chapter_title: str, total_chapters: int = 1) -> str:
    job_id = uuid.uuid4().hex[:12]
    AUDIO_JOBS[job_id] = {"job_id": job_id, "story_name": story_name, "chapter_title": chapter_title, "status": "queued", "step": "queued", "progress": 0, "message": "Đang xếp hàng…", "total_chapters": total_chapters, "completed_chapters": 0, "created_at": datetime.now().isoformat()}
    return job_id


def list_outputs() -> list[dict]:
    if not AUDIO_DIR.exists():
        return []
    try: metadata = {x["file_name"]: x for x in json.loads(AUDIO_MANIFEST.read_text(encoding="utf-8"))}
    except (OSError, ValueError): metadata = {}
    history_by_file = {x.get("file_name"): x for x in _read_history() if x.get("file_name")}
    return [{**history_by_file.get(p.name, {}), **metadata.get(p.name, {}), "file_name": p.name, "name": metadata.get(p.name, {}).get("name", p.name), "duration_sec": metadata.get(p.name, {}).get("duration_sec") or ffprobe_duration(p), "created_at": metadata.get(p.name, {}).get("created_at") or datetime.fromtimestamp(p.stat().st_mtime).isoformat()} for p in sorted(AUDIO_DIR.glob("*.mp4"), key=lambda x: x.stat().st_mtime, reverse=True)]


def _append_manifest(item: dict) -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    try: items = json.loads(AUDIO_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError): items = []
    items = [item, *[x for x in items if x.get("file_name") != item["file_name"]]]
    AUDIO_MANIFEST.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
