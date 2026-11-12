"""Pipeline tạo video truyện có lồng tiếng từ dữ liệu đã crawl."""
from __future__ import annotations

import asyncio
import json
from functools import partial
import math
import subprocess
import uuid
import zipfile
import re
import random
import shutil
import textwrap
from datetime import datetime
from pathlib import Path

from app.core.config import TOOLS_DIR
from app.recap.ffmpeg import ffprobe_duration
from app.voices.voice_client import VoiceBusyError, tts_batch
from app.media import backgrounds, overlays
from app.media.audio_options import AudioOptions
from app.media.fonts import stage_font

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
    size = "1080:1920" if aspect == "9:16" else "1920:1080"
    output = work / "thumbnail.jpg"
    vf = f"scale={size}:force_original_aspect_ratio=increase,crop={size}"
    # drawtext phải có fontfile= (không có thì ffmpeg Windows crash vì Fontconfig) và dùng đường dẫn TƯƠNG ĐỐI + cwd=work
    # để khỏi dính lỗi dấu ':' của ổ đĩa / dấu cách. Không tìm được font thì bỏ label chứ không làm hỏng cả chương.
    if stage_font(work):
        (work / "thumbnail-label.txt").write_text(label, encoding="utf-8")
        vf += (
            ",drawtext=fontfile=font.ttf:textfile=thumbnail-label.txt:fontcolor=white:fontsize=46:"
            "line_spacing=10:fix_bounds=1:x=(w-text_w)/2:y=110:"
            "box=1:boxcolor=black@0.65:boxborderw=24"
        )
    result = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source), "-vf", vf, "-frames:v", "1", output.name],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120, cwd=str(work),
    )
    if result.returncode or not output.exists():
        raise RuntimeError(f"Không thể xử lý thumbnail (ffmpeg exit {result.returncode}): {(result.stderr or '').strip()[-900:]}")
    return output


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


def _upload_audio_output(output: Path, story_name: str, chapter_number: int | None, story_slug: str | None = None) -> dict:
    from app.externals.gdrive import service as gdrive_service
    cfg = gdrive_service.get_gdrive_config()
    client = gdrive_service.get_client()
    if not client:
        raise RuntimeError("Google Drive chưa được kết nối.")
    root_id = gdrive_service.get_workflow_folder_id("audio") or cfg.get("folder_id")
    if not root_id:
        raise RuntimeError("Chưa cấu hình thư mục Google Drive cho Audio.")
    existing = find_history_item(story_slug, story_name, chapter_number)
    if existing and existing.get("drive_uploaded"):
        return existing.get("drive_result") or {"file_id": existing.get("drive_file_id"), "web_view_link": existing.get("drive_url"), "file_name": existing.get("drive_name")}
    story_folder = client.get_or_create_child_folder(story_name or "Video Audio khác", root_id)
    safe_story = _safe_name(story_name or "Video_Audio")
    drive_name = f"{safe_story}_Phần_{chapter_number or 1}.mp4"
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


async def _run_one(job_id: str, story_name: str, chapter_title: str, paragraph: str, voice_id: str, aspect: str, chapter_number: int | None, thumbnail: Path | None = None, bgm_pool: list[Path] | None = None, start: int = 0, end: int = 100, auto_upload_drive: bool = False, delete_local_after_upload: bool = False, story_slug: str | None = None, bg_fit: str = "fill", options: AudioOptions | None = None) -> str:
    options = options or AudioOptions()
    merged_file: Path | None = None
    overlay_file: Path | None = None
    work = AUDIO_DIR / ".tmp" / job_id
    try:
        def progress(value: int) -> int:
            return round(start + (end - start) * value / 100)
        work.mkdir(parents=True, exist_ok=True)
        # Bước nào không chạy (vd chế độ test không có thumbnail/nhạc nền) thì báo rõ để giao diện không hiện nhầm "đã hoàn tất".
        _set(job_id, skipped_steps=[step for step, skipped in (("image", not thumbnail), ("bgm", not bgm_pool), ("overlay", not options.needs_overlay())) if skipped])

        # Bước rẻ và dễ hỏng làm TRƯỚC TTS: lỗi thumbnail (font, ảnh hỏng…) báo ngay thay vì sau khi đã đọc xong cả chương.
        labeled_thumbnail = None
        if thumbnail:
            _set(job_id, status="running", step="image", progress=progress(5), message=f"Đang xử lý thumbnail và ghép label chương {chapter_number or ''}…")
            labeled_thumbnail = await asyncio.to_thread(_process_thumbnail, thumbnail, story_name, chapter_number, work, aspect)

        _set(job_id, status="running", step="voice", progress=progress(20), message=f"Đang chuyển chương {chapter_number or ''} thành voice…")
        payload = await _tts_with_retry(job_id, [{ "text": paragraph }], voice_id)
        archive = work / "voice.zip"
        archive.write_bytes(payload)
        with zipfile.ZipFile(archive) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            voice_name = manifest["items"][0]["filename"]
            voice_file = work / "voice.wav"
            voice_file.write_bytes(zf.read(voice_name))
        if abs(options.voice_speed - 1.0) >= 0.01:
            _set(job_id, message=f"Đang chỉnh tốc độ đọc ×{options.voice_speed:.2f}…")
            voice_file = await asyncio.to_thread(apply_voice_speed, voice_file, work / "voice_speed.wav", options.voice_speed)
        voice_duration = ffprobe_duration(voice_file)
        if voice_duration <= 0:
            raise RuntimeError("Không đọc được thời lượng voice.")
        _set(job_id, step="duration", progress=progress(35), duration_sec=voice_duration, message=f"Voice dài {voice_duration:.1f} giây.")

        _set(job_id, step="merge", progress=progress(45), message="Đang gộp video hoàn tất theo thời lượng voice…")
        # Nối (stream copy) các clip nền đã chuẩn hóa — chỉ chuẩn hóa thêm đúng phần còn thiếu, không mã hóa lại cả chiều dài chương.
        seconds = max(1, math.ceil(voice_duration))
        on_status = lambda message: _set(job_id, message=message)  # noqa: E731
        if options.bg_mode == "cover":
            if not thumbnail:
                raise RuntimeError("Chế độ nền ảnh bìa cần truyện có thumbnail.")
            merged_file = await asyncio.to_thread(backgrounds.build_cover_background, thumbnail, seconds, aspect, on_status)
        else:
            merged_file = await asyncio.to_thread(backgrounds.build_background, seconds, aspect, bg_fit, on_status)
        _set(job_id, progress=progress(66), message="Đã gộp video nền.")

        video_for_mux = merged_file
        if options.needs_overlay():
            _set(job_id, step="overlay", progress=progress(68), message="Đang phủ lớp hiệu ứng (tiêu đề, waveform, logo…)…")
            logo = logo_path(options.logo_id)
            if options.logo_id and logo is None:
                raise RuntimeError("Không tìm thấy file logo đã chọn. Hãy chọn lại logo.")
            lines = overlays.title_lines(story_name, chapter_number, chapter_title, aspect)
            overlay_file = await asyncio.to_thread(overlays.render_overlays, merged_file, voice_file, logo, work, aspect=aspect,
                                                   duration=voice_duration, options=options, lines=lines)
            video_for_mux = overlay_file

        _set(job_id, step="mux", progress=progress(78), message="Đang ghép voice vào video…")
        safe_story = "".join(c if c.isalnum() or c in "-_" else "_" for c in story_name).strip("_")[:60] or "story"
        chapter_suffix = f"{chapter_number}" if chapter_number is not None else job_id[:8]
        output = AUDIO_DIR / f"{safe_story}_chuong_{chapter_suffix}_{job_id[:8]}.mp4"
        selected_bgm = random.choice(bgm_pool) if bgm_pool else None
        if selected_bgm:
            _set(job_id, step="bgm", progress=progress(88), message="Đang chọn và mix nhạc nền ngẫu nhiên…")
        await asyncio.to_thread(partial(_mux, video_for_mux, voice_file, output, selected_bgm, options.bgm_volume, duck=options.bgm_duck,
                                        fade_out=options.fade_out_sec, loudnorm=options.loudnorm, duration=voice_duration))
        output_thumbnail_name = None
        if labeled_thumbnail:
            output_thumbnail_name = f"{output.stem}.jpg"
            AUDIO_THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
            (AUDIO_THUMBNAIL_DIR / output_thumbnail_name).write_bytes(labeled_thumbnail.read_bytes())
        metadata = {"file_name": output.name, "name": output.name, "story_slug": story_slug, "story_name": story_name, "chapter_number": chapter_number, "chapter_title": chapter_title, "thumbnail_name": output_thumbnail_name, "duration_sec": ffprobe_duration(output), "created_at": datetime.now().isoformat()}
        record_completion(metadata, story_slug)
        if auto_upload_drive:
            _set(job_id, step="drive", progress=progress(92), message="Đang upload video lên Google Drive…")
            try:
                drive_res = await asyncio.to_thread(_upload_audio_output, output, story_name, chapter_number, story_slug)
                metadata["drive_file_id"] = drive_res.get("file_id")
                metadata["drive_url"] = drive_res.get("web_view_link")
                metadata["drive_name"] = drive_res.get("file_name")
                metadata["drive_uploaded"] = True
                record_drive_upload(metadata, drive_res)
                if delete_local_after_upload:
                    output.unlink(missing_ok=True)
                    if output_thumbnail_name:
                        (AUDIO_THUMBNAIL_DIR / output_thumbnail_name).unlink(missing_ok=True)
                _set(job_id, progress=progress(97), message="Đã upload Google Drive và dọn file local.")
            except Exception as drive_error:  # Drive lỗi không làm hỏng video local đã tạo.
                metadata["drive_error"] = str(drive_error)
        _append_manifest(metadata)
        return output.name
    finally:
        # Dọn mọi file trung gian dù thành công hay lỗi: video ghép nền dài bằng cả chương (hàng trăm MB), voice.zip/wav, thumbnail tạm.
        # (Thumbnail có label đã được chép sang AUDIO_THUMBNAIL_DIR trước đó.)
        if merged_file:
            merged_file.unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)


async def run(job_id: str, story_name: str, chapter_title: str, paragraph: str, voice_id: str, aspect: str, chapter_number: int | None = None, thumbnail: Path | None = None, bgm_pool: list[Path] | None = None, auto_upload_drive: bool = False, delete_local_after_upload: bool = False, story_slug: str | None = None, bg_fit: str = "fill", options: AudioOptions | None = None) -> None:
    try:
        output_name = await _run_one(job_id, story_name, chapter_title, paragraph, voice_id, aspect, chapter_number, thumbnail, bgm_pool, auto_upload_drive=auto_upload_drive, delete_local_after_upload=delete_local_after_upload, story_slug=story_slug, bg_fit=bg_fit, options=options)
        _set(job_id, status="completed", step="done", progress=100, message="Hoàn thành video Audio.", output_name=output_name)
    except Exception as error:  # noqa: BLE001
        # Giữ nguyên `step` đang chạy: giao diện tô đỏ đúng node bị lỗi và hiện `error` ở đó.
        _set(job_id, status="error", message=str(error), error=str(error))


async def run_batch(job_id: str, story_name: str, chapters: list, voice_id: str, aspect: str, thumbnail: Path | None = None, bgm_pool: list[Path] | None = None, auto_upload_drive: bool = False, delete_local_after_upload: bool = False, story_slug: str | None = None, bg_fit: str = "fill", options: AudioOptions | None = None) -> None:
    """Nhiều chương của MỘT truyện = queue có một truyện."""
    await run_queue(job_id, [(story_slug or "", story_name, chapters, thumbnail)], voice_id, aspect, bgm_pool, auto_upload_drive, delete_local_after_upload, bg_fit, options)


# Dừng cả queue khi liên tiếp N chương lỗi: gần như chắc chắn là lỗi hệ thống (voice-service tắt, thiếu video nền…),
# chạy tiếp chỉ đốt thời gian (mỗi chương có thể chờ TTS tới 15 phút) mà vẫn lỗi.
MAX_CONSECUTIVE_FAILURES = 3


def _failure_summary(failures: list[dict]) -> str:
    first = failures[0]
    return f"{first['story_name']} · chương {first['chapter_number']}: {first['error']}"


async def run_queue(job_id: str, queue: list[tuple[str, str, list, Path | None]], voice_id: str, aspect: str, bgm_pool: list[Path] | None = None, auto_upload_drive: bool = False, delete_local_after_upload: bool = False, bg_fit: str = "fill", options: AudioOptions | None = None) -> None:
    """Chạy tuần tự các chương đã chọn từ tối đa 10 truyện.

    Một chương lỗi KHÔNG làm hỏng các chương còn lại: ghi vào `failed_chapters` rồi chạy tiếp
    (trừ khi liên tiếp MAX_CONSECUTIVE_FAILURES chương lỗi)."""
    total = sum(len(chapters) for _, _, chapters, _ in queue)
    processed = 0
    succeeded = 0
    consecutive = 0
    aborted = False
    failures: list[dict] = []
    _set(job_id, total_chapters=total, completed_chapters=0, failed_chapters=[])
    for story_slug, story_name, chapters, thumbnail in queue:
        _set(job_id, current_story=story_name, message=f"Đang xử lý truyện {story_name}…")
        for chapter in chapters:
            _set(job_id, current_chapter=chapter.chapter_number, message=f"Đang xử lý {story_name} · chương {chapter.chapter_number}…")
            try:
                output_name = await _run_one(job_id, story_name, chapter.title, chapter.paragraph, voice_id, aspect, chapter.chapter_number, thumbnail, bgm_pool, round(processed * 100 / total), round((processed + 1) * 100 / total), auto_upload_drive, delete_local_after_upload, story_slug or None, bg_fit, options)
                succeeded += 1
                consecutive = 0
                _set(job_id, completed_chapters=succeeded, output_name=output_name)
            except Exception as error:  # noqa: BLE001
                failures.append({"story_name": story_name, "chapter_number": chapter.chapter_number, "error": str(error)})
                consecutive += 1
                _set(job_id, failed_chapters=list(failures))
                if consecutive >= MAX_CONSECUTIVE_FAILURES:
                    aborted = True
            processed += 1
            if aborted:
                break
        if aborted:
            break

    if not failures:
        _set(job_id, status="completed", step="done", progress=100, message=f"Đã hoàn thành {succeeded} video Audio từ {len(queue)} truyện." if len(queue) > 1 else f"Đã hoàn thành {succeeded} video Audio.")
    elif aborted:
        _set(job_id, status="error", error=f"Dừng sớm vì {MAX_CONSECUTIVE_FAILURES} chương liên tiếp lỗi (xong {succeeded}/{total}). Lỗi đầu tiên — {_failure_summary(failures)}",
             message=f"Dừng sớm vì {MAX_CONSECUTIVE_FAILURES} chương liên tiếp lỗi (xong {succeeded}/{total}).")
    elif succeeded == 0:
        _set(job_id, status="error", error=_failure_summary(failures), message=f"Tất cả {total} chương đều lỗi.")
    else:
        _set(job_id, status="completed", step="done", progress=100, message=f"Xong {succeeded}/{total} chương, {len(failures)} chương lỗi (xem danh sách bên dưới).")


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
