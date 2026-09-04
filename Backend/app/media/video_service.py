"""Video library and FFmpeg transform helpers for the Video workspace."""
from __future__ import annotations

import json
import re
import subprocess
import uuid
import shutil
from datetime import datetime
from pathlib import Path

from app.core.config import TOOLS_DIR
from app.recap.ffmpeg import ffprobe_duration

VIDEO_DIR = TOOLS_DIR / "Data" / "media" / "videos"
OUTPUT_DIR = VIDEO_DIR / "processed"
STATE_FILE = VIDEO_DIR / "library.json"
PRESET_FILE = VIDEO_DIR / "preset.json"
PRESETS_FILE = VIDEO_DIR / "presets.json"
DONE_FILE = VIDEO_DIR / "done.json"
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
BACKGROUND_DIR = VIDEO_DIR / "backgrounds"


def _read() -> list[dict]:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def _write(items: list[dict]) -> None:
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def list_videos() -> list[dict]:
    return [x for x in _read() if Path(x["file_path"]).exists()]


def add_video(data: bytes, filename: str) -> dict:
    suffix = Path(filename).suffix.lower()
    if suffix not in VIDEO_EXTS:
        raise ValueError("Định dạng video không được hỗ trợ.")
    video_id = uuid.uuid4().hex[:12]
    safe = re.sub(r"[^\w.-]+", "_", Path(filename).stem).strip("._") or "video"
    path = VIDEO_DIR / f"{video_id}_{safe}{suffix}"
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    item = {"video_id": video_id, "name": filename, "file_path": str(path),
            "size_bytes": len(data), "duration_sec": ffprobe_duration(path)}
    items = _read(); items.insert(0, item); _write(items)
    return item

def add_background(data: bytes, filename: str) -> dict:
    suffix = Path(filename).suffix.lower()
    if suffix not in IMAGE_EXTS: raise ValueError("Ảnh nền phải là PNG, JPG, JPEG hoặc WEBP.")
    background_id = uuid.uuid4().hex[:12]
    BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)
    path = BACKGROUND_DIR / f"{background_id}{suffix}"
    path.write_bytes(data)
    return {"background_id": background_id, "name": filename, "file_path": str(path)}

def get_background(background_id: str) -> dict | None:
    for suffix in IMAGE_EXTS:
        path = BACKGROUND_DIR / f"{background_id}{suffix}"
        if path.exists(): return {"background_id": background_id, "file_path": str(path)}
    return None

def import_youtube(url: str) -> dict:
    """Download one YouTube video with the project's existing yt-dlp wrapper."""
    from app.recap.ytdlp import download_video
    job_dir = VIDEO_DIR / "youtube" / uuid.uuid4().hex[:12]
    downloaded = download_video(url.strip(), job_dir)
    item = add_video(downloaded.read_bytes(), downloaded.name)
    shutil.rmtree(job_dir, ignore_errors=True)
    item["name"] = f"YouTube · {item['name']}"
    items = _read()
    for existing in items:
        if existing["video_id"] == item["video_id"]: existing["name"] = item["name"]
    _write(items)
    return item


def get(video_id: str) -> dict | None:
    return next((x for x in list_videos() if x["video_id"] == video_id), None)


def remove(video_id: str) -> bool:
    items = _read(); item = next((x for x in items if x["video_id"] == video_id), None)
    if not item:
        return False
    try: Path(item["file_path"]).unlink(missing_ok=True)
    except OSError: pass
    _write([x for x in items if x["video_id"] != video_id])
    return True

def save_preset(options: dict) -> dict:
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    PRESET_FILE.write_text(json.dumps(options, ensure_ascii=False, indent=2), encoding="utf-8")
    return options

def load_preset() -> dict:
    try: return json.loads(PRESET_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError): return {}

def list_presets() -> list[dict]:
    try: return json.loads(PRESETS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError): return []

def save_named_preset(name: str, options: dict) -> dict:
    item = {"preset_id": uuid.uuid4().hex[:12], "name": name.strip(), "options": options,
            "created_at": datetime.now().isoformat()}
    items = [item, *[p for p in list_presets() if p.get("name") != item["name"]]]
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    PRESETS_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    return item

def list_done() -> list[dict]:
    try:
        items = json.loads(DONE_FILE.read_text(encoding="utf-8"))
        return [x for x in items if Path(x["file_path"]).exists()]
    except (OSError, ValueError): return []

def record_done(output: Path, source: dict, options: dict) -> dict:
    item = {"done_id": uuid.uuid4().hex[:12], "name": output.name, "file_path": str(output),
            "source_name": source["name"], "aspect": options.get("aspect", "9:16"),
            "created_at": __import__("datetime").datetime.now().isoformat()}
    items = [item, *list_done()]
    DONE_FILE.parent.mkdir(parents=True, exist_ok=True)
    DONE_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    return item

def get_done(done_id: str) -> dict | None:
    return next((x for x in list_done() if x["done_id"] == done_id), None)


def transform(item: dict, options: dict) -> Path:
    src = Path(item["file_path"])
    aspect = options.get("aspect", "9:16")
    tw, th = (1080, 1920) if aspect == "9:16" else (1920, 1080)
    crop = options.get("crop", "fit")
    if crop == "square":
        crop_filter = r"crop=min(iw\,ih):min(iw\,ih):(iw-min(iw\,ih))/2:(ih-min(iw\,ih))/2"
    elif crop == "custom":
        w, h = min(1.0, max(.01, float(options.get("crop_w", 1)))), min(1.0, max(.01, float(options.get("crop_h", 1))))
        x, y = min(1.0 - w, max(0.0, float(options.get("crop_x", 0)))), min(1.0 - h, max(0.0, float(options.get("crop_y", 0))))
        crop_filter = f"crop=iw*{w}:ih*{h}:iw*{x}:ih*{y}"
    else:
        crop_filter = "null"
    bg = str(options.get("background", "#111827")).lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", bg): bg = "111827"
    base_vf = f"{crop_filter},scale={tw}:{th}:force_original_aspect_ratio=decrease,pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:color=0x{bg}"
    vf = base_vf
    background = get_background(str(options.get("background_image", ""))) if options.get("background_image") else None
    if background:
        # Background image is scaled/cropped to fill the output canvas; video is fitted above it.
        foreground = f"{crop_filter},scale={tw}:{th}:force_original_aspect_ratio=decrease"
        base_vf = foreground
        vf = base_vf
    label_filter = ""
    blur = options.get("blur", {}) or {}
    blur_enabled = bool(blur.get("enabled", False))
    label = str(options.get("label", "")).strip()
    if label:
        safe_label = label.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("%", "\\%")
        label_bg = str(options.get("label_background", "#000000")).lstrip("#")
        if not re.fullmatch(r"[0-9a-fA-F]{6}", label_bg): label_bg = "000000"
        # fontsize scales with the output canvas, so portrait labels remain readable.
        size = 52 if aspect == "9:16" else 58
        label_pos = options.get("label_position", "bottom")
        label_x = float(options.get("label_x", 0.5)); label_y = float(options.get("label_y", 0.88))
        pos = {"top": "y=fontsize", "center": "y=(h-text_h)/2", "bottom": f"y=h-{size*2}"}.get(label_pos, f"x=w*{label_x}-text_w/2:y=h*{label_y}")
        if label_pos != "custom": pos = f"x=(w-text_w)/2:{pos}"
        label_filter = f"drawtext=text='{safe_label}':fontcolor=white:fontsize={size}:" + pos + f":box=1:boxcolor=0x{label_bg}cc:boxborderw=18"
        vf = f"{base_vf},{label_filter}"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUTPUT_DIR / f"video_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}_{item['video_id']}_{aspect.replace(':','x')}.mp4"
    remove_audio = bool(options.get("remove_audio", False))
    audio_args = ["-an"] if remove_audio else ["-c:a", "copy"]
    if blur_enabled:
        bw, bh = min(1.0, max(.01, float(blur.get("w", .5)))), min(1.0, max(.01, float(blur.get("h", .25))))
        bx, by = min(1.0 - bw, max(0.0, float(blur.get("x", .25)))), min(1.0 - bh, max(0.0, float(blur.get("y", .25))))
        blur_amount = max(1.0, min(30.0, float(blur.get("amount", 60)) * .3))
        final_filter = f"[v0]{label_filter}[v]" if label_filter else "[v0]null[v]"
        if background:
            background_filter = f"[1:v]scale={tw}:{th}:force_original_aspect_ratio=increase,crop={tw}:{th}[bg];[0:v]{base_vf},split=2[main][blur];[blur]crop=iw*{bw}:ih*{bh}:iw*{bx}:ih*{by},boxblur={blur_amount}:1[blurred];[main][blurred]overlay=x=main_w*{bx}:y=main_h*{by}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v0];{final_filter}"
        else:
            background_filter = f"[0:v]{base_vf},split=2[main][blur];[blur]crop=iw*{bw}:ih*{bh}:iw*{bx}:ih*{by},boxblur={blur_amount}:1[blurred];[main][blurred]overlay=x=main_w*{bx}:y=main_h*{by}[v0];{final_filter}"
        complex_filter = background_filter
        video_args = ["-filter_complex", complex_filter, "-map", "[v]"]
    else:
        if background:
            label_tail = f",{label_filter}" if label_filter else ""
            complex_filter = f"[1:v]scale={tw}:{th}:force_original_aspect_ratio=increase,crop={tw}:{th}[bg];[0:v]{base_vf}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2{label_tail}[v]"
            video_args = ["-filter_complex", complex_filter, "-map", "[v]"]
        else: video_args = ["-vf", vf]
    inputs = ["-i", str(src)]
    if background: inputs += ["-loop", "1", "-i", background["file_path"]]
    cmd = ["ffmpeg", "-y", *inputs, *video_args, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", *audio_args, "-movflags", "+faststart", str(out)]
    # Audio stream-copy may fail for odd source codecs; retry with AAC.
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
    if proc.returncode != 0 and not remove_audio:
        cmd[cmd.index("copy")] = "aac"; cmd.insert(cmd.index("-movflags"), "-b:a"); cmd.insert(cmd.index("-movflags"), "192k")
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError((proc.stderr or "FFmpeg lỗi")[-800:])
    return out
