"""Video library and FFmpeg transform helpers for the Video workspace."""
from __future__ import annotations

import json
import re
import subprocess
import uuid
import shutil
import threading
import time
import shlex
import random
from typing import Callable
from datetime import datetime
from pathlib import Path

from app.core.config import DATA_DIR
from app.media.fonts import filter_path, find_font
from app.recap.ffmpeg import ffprobe_duration

VIDEO_DIR = DATA_DIR / "media" / "videos"
OUTPUT_DIR = VIDEO_DIR / "processed"
STATE_FILE = VIDEO_DIR / "library.json"
PRESET_FILE = VIDEO_DIR / "preset.json"
PRESETS_FILE = VIDEO_DIR / "presets.json"
DONE_FILE = VIDEO_DIR / "done.json"
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
BACKGROUND_DIR = VIDEO_DIR / "backgrounds"
PROCESS_LOG_DIR = VIDEO_DIR / "logs"
MERGE_DIR = VIDEO_DIR / "MergeVideo"
_PROCESS_JOBS: dict[str, dict] = {}
_PROCESS_JOBS_LOCK = threading.Lock()


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


def _has_audio_stream(path: Path) -> bool:
    try:
        probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        return bool((probe.stdout or "").strip())
    except (OSError, subprocess.SubprocessError):
        return False


def merge_done_videos(target_seconds: int, done_ids: list[str] | None = None, randomize: bool = True, aspect: str = "9:16") -> dict:
    if target_seconds < 1: raise ValueError("Thời lượng gộp phải lớn hơn 0 giây.")
    if aspect not in {"9:16", "16:9"}: raise ValueError("Khổ video không hợp lệ.")
    available = [item for item in list_done() if item.get("aspect") == aspect]
    if not available: raise ValueError(f"Kho video hoàn tất chưa có video khổ {aspect}.")
    if done_ids:
        by_id = {item["done_id"]: item for item in available}
        selected = [by_id[done_id] for done_id in done_ids if done_id in by_id]
        if len(selected) != len(set(done_ids)): raise ValueError(f"Một hoặc nhiều video đã chọn không phải khổ {aspect} hoặc không còn tồn tại.")
    else:
        selected = []
    if done_ids and not selected: raise ValueError("Kho video hoàn tất đang trống hoặc chưa chọn video.")

    durations = {item["done_id"]: ffprobe_duration(Path(item["file_path"])) for item in available}
    available = [item for item in available if durations.get(item["done_id"], 0.0) > 0]
    selected = [item for item in selected if item["done_id"] in {candidate["done_id"] for candidate in available}]
    if not available: raise ValueError(f"Kho video khổ {aspect} không có file hợp lệ để gộp.")
    usable: list[tuple[dict, float]] = []
    total = 0.0
    while total < target_seconds:
        pool = selected if selected and total < target_seconds and len(usable) < len(selected) else available
        item = random.choice(pool) if randomize or not selected or len(usable) >= len(selected) else selected[len(usable)]
        duration = durations.get(item["done_id"], 0.0)
        if duration <= 0: available = [candidate for candidate in available if candidate["done_id"] != item["done_id"]]; selected = [candidate for candidate in selected if candidate["done_id"] != item["done_id"]]; pool = available; continue
        usable.append((item, duration))
        total += duration
        if not available: raise ValueError("Không có video hợp lệ để gộp.")

    MERGE_DIR.mkdir(parents=True, exist_ok=True)
    output = MERGE_DIR / f"merged_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}.mp4"
    parts_dir = MERGE_DIR / f".parts_{output.stem}"
    try:
        with_audio = all(_has_audio_stream(Path(path)) for path in dict.fromkeys(item["file_path"] for item, _ in usable))
        if len(usable) <= MAX_CONCAT_INPUTS:
            _concat_clips(usable, output, target_seconds, with_audio)
        else:
            # Quá nhiều clip cho MỘT lệnh ffmpeg (Windows giới hạn ~32.767 ký tự dòng lệnh): ghép từng nhóm thành đoạn,
            # rồi nối các đoạn bằng concat demuxer (stream copy, gần như tức thì). Mỗi clip vẫn chỉ bị encode một lần.
            parts_dir.mkdir(parents=True, exist_ok=True)
            remaining = float(target_seconds)
            parts: list[str] = []
            for start in range(0, len(usable), MAX_CONCAT_INPUTS):
                group = usable[start:start + MAX_CONCAT_INPUTS]
                group_len = sum(duration for _, duration in group)
                take = min(group_len, remaining)
                part = parts_dir / f"part_{len(parts):03d}.mp4"
                # Chỉ đoạn cuối mới bị cắt cho vừa thời lượng đích (cắt bằng re-encode nên chính xác, không lệch theo keyframe).
                _concat_clips(group, part, take if take < group_len else None, with_audio, normalize_fps=True)
                parts.append(part.name)
                remaining -= take
                if remaining <= 0: break
            (parts_dir / "list.txt").write_text("".join(f"file '{name}'\n" for name in parts), encoding="utf-8")
            proc = subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", str(output)],
                                  capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800, cwd=str(parts_dir))
            if proc.returncode != 0 or not output.exists() or output.stat().st_size == 0:
                raise RuntimeError((proc.stderr or "FFmpeg không thể nối các đoạn video.")[-1200:])
        return {"file_name": output.name, "file_path": str(output), "duration_sec": ffprobe_duration(output),
                "source_count": len(usable), "source_names": [item["name"] for item, _ in usable], "aspect": aspect}
    except Exception:
        output.unlink(missing_ok=True)  # không để lại file ghép dở dang
        raise
    finally:
        shutil.rmtree(parts_dir, ignore_errors=True)


# Số clip tối đa trong một lệnh ffmpeg. Mỗi clip tốn ~220 ký tự (đường dẫn + filter); 60 clip ≈ 13K, xa giới hạn 32.767 của Windows.
MAX_CONCAT_INPUTS = 60


def _concat_clips(clips: list[tuple[dict, float]], output: Path, seconds: float | None, with_audio: bool, normalize_fps: bool = False) -> None:
    """Nối các clip (re-encode) bằng concat filter, tùy chọn cắt còn `seconds`."""
    inputs: list[str] = []
    filters: list[str] = []
    # normalize_fps: các đoạn sẽ được nối bằng stream copy nên phải cùng khung hình/giây.
    fps = ",fps=30" if normalize_fps else ""
    for index, (item, _) in enumerate(clips):
        inputs.extend(["-i", item["file_path"]])
        filters.append(f"[{index}:v:0]setpts=PTS-STARTPTS{fps}[v{index}]")
        if with_audio:
            filters.append(f"[{index}:a:0]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[a{index}]")
    concat_inputs = "".join(f"[v{index}]" + (f"[a{index}]" if with_audio else "") for index in range(len(clips)))
    concat_filter = f"{concat_inputs}concat=n={len(clips)}:v=1:a={1 if with_audio else 0}[v]" + ("[a]" if with_audio else "")
    filter_graph = ";".join([*filters, concat_filter])
    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", filter_graph, "-map", "[v]"]
    if with_audio: cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
    else: cmd += ["-an"]
    if seconds is not None: cmd += ["-t", str(seconds)]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", str(output)]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
    if proc.returncode != 0 or not output.exists() or output.stat().st_size == 0:
        raise RuntimeError((proc.stderr or "FFmpeg không thể gộp video.")[-1200:])


def _write_process_log(log_file: Path | None, message: str) -> None:
    if not log_file: return
    try:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        with log_file.open("a", encoding="utf-8") as handle:
            handle.write(f"[{datetime.now().isoformat(timespec='seconds')}] {message}\n")
            handle.flush()
    except OSError:
        pass


def _run_ffmpeg(cmd: list[str], duration_sec: float | None, total_frames: int | None = None, on_progress: Callable[[int], None] | None = None, log_file: Path | None = None) -> tuple[int, str]:
    """Run FFmpeg and report real output-time progress (not elapsed-time estimates)."""
    progress_cmd = [*cmd[:-1], "-progress", "pipe:1", "-stats_period", "0.5", "-nostats", cmd[-1]]
    _write_process_log(log_file, f"FFmpeg START: {shlex.join(progress_cmd)}")
    proc = subprocess.Popen(progress_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", bufsize=1)
    last_progress = -1
    started_at = time.monotonic()
    log_lines: list[str] = []
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            _write_process_log(log_file, f"FFmpeg: {line.rstrip()}" )
            if time.monotonic() - started_at > 1800:
                _write_process_log(log_file, "FFmpeg TIMEOUT after 1800 seconds; terminating process")
                proc.kill()
                proc.communicate()
                raise subprocess.TimeoutExpired(progress_cmd, 1800)
            if line.startswith("out_time_ms=") or line.startswith("out_time_us="):
                try:
                    current_us = int(line.split("=", 1)[1].strip())
                    if line.startswith("out_time_ms="): current_us *= 1000
                    current = min(99, max(0, round(current_us / (duration_sec * 1_000_000) * 100))) if duration_sec and duration_sec > 0 else 0
                    if current != last_progress and on_progress:
                        last_progress = current
                        on_progress(current)
                except ValueError:
                    pass
            elif line.startswith("frame=") and total_frames and total_frames > 0:
                try:
                    current = min(99, max(0, round(int(line.split("=", 1)[1].strip()) / total_frames * 100)))
                    if current > last_progress and on_progress:
                        last_progress = current
                        on_progress(current)
                except ValueError:
                    pass
            elif line.strip() and not line.startswith(("fps=", "stream_", "bitrate=", "total_size=", "out_time=", "dup_frames=", "drop_frames=", "speed=", "progress=")):
                log_lines.append(line.strip())
        return_code = proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        _write_process_log(log_file, "FFmpeg did not exit after progress stream closed; terminating process")
        proc.kill()
        proc.communicate()
        raise
    if on_progress and return_code == 0:
        on_progress(100)
    _write_process_log(log_file, f"FFmpeg END: return_code={return_code}")
    if log_lines: _write_process_log(log_file, "FFmpeg diagnostics: " + " | ".join(log_lines[-20:]))
    return return_code, "\n".join(log_lines)


def _probe_video_frames(path: Path) -> int | None:
    cmd = ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
           "-show_entries", "stream=nb_read_frames", "-of", "default=noprint_wrappers=1:nokey=1", str(path)]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        value = int((result.stdout or "").strip())
        return value if value > 0 else None
    except (ValueError, OSError, subprocess.SubprocessError):
        return None


def transform(item: dict, options: dict, on_progress: Callable[[int], None] | None = None, log_file: Path | None = None) -> Path:
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
        # fontfile= bắt buộc: drawtext không có nó sẽ đi qua Fontconfig và làm ffmpeg Windows crash (xem app/media/fonts.py).
        font = find_font()
        font_arg = f"fontfile={filter_path(font)}:" if font else ""
        label_filter = f"drawtext={font_arg}text='{safe_label}':fontcolor=white:fontsize={size}:" + pos + f":box=1:boxcolor=0x{label_bg}cc:boxborderw=18"
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
    duration_sec = item.get("duration_sec") or ffprobe_duration(src)
    total_frames = _probe_video_frames(src)
    # Audio stream-copy may fail for odd source codecs; retry with AAC.
    _write_process_log(log_file, f"Input: {src} | duration={duration_sec}s | frames={total_frames} | output={out}")
    proc_code, proc_stderr = _run_ffmpeg(cmd, duration_sec, total_frames, on_progress, log_file)
    if proc_code != 0 and not remove_audio:
        cmd[cmd.index("copy")] = "aac"; cmd.insert(cmd.index("-movflags"), "-b:a"); cmd.insert(cmd.index("-movflags"), "192k")
        _write_process_log(log_file, "Retrying FFmpeg with AAC audio because audio stream-copy failed")
        proc_code, proc_stderr = _run_ffmpeg(cmd, duration_sec, total_frames, on_progress, log_file)
    if proc_code != 0 or not out.exists():
        raise RuntimeError((proc_stderr or "FFmpeg lỗi")[-800:])
    return out


def start_transform(item: dict, options: dict) -> str:
    job_id = uuid.uuid4().hex[:12]
    log_file = PROCESS_LOG_DIR / f"{job_id}.log"
    with _PROCESS_JOBS_LOCK:
        _PROCESS_JOBS[job_id] = {"job_id": job_id, "status": "queued", "phase": "Đang xếp hàng...", "progress": 0, "error": None, "output_path": None, "log_path": str(log_file)}
    _write_process_log(log_file, f"JOB CREATED: job_id={job_id} video_id={item.get('video_id')} name={item.get('name')}")
    _write_process_log(log_file, f"Options: {json.dumps(options, ensure_ascii=False, sort_keys=True)}")

    def run() -> None:
        def update(progress: int) -> None:
            with _PROCESS_JOBS_LOCK:
                if job_id in _PROCESS_JOBS:
                    _PROCESS_JOBS[job_id]["progress"] = progress
                    _PROCESS_JOBS[job_id]["status"] = "running"
                    _PROCESS_JOBS[job_id]["phase"] = "Đang hoàn tất file..." if progress >= 99 else "Đang render video..."
            _write_process_log(log_file, f"PROGRESS: {progress}% | phase={_PROCESS_JOBS[job_id]['phase']}")
        try:
            update(1)
            with _PROCESS_JOBS_LOCK:
                _PROCESS_JOBS[job_id]["status"] = "running"
                _PROCESS_JOBS[job_id]["phase"] = "Đang render video..."
            _write_process_log(log_file, "PHASE: Đang render video...")
            output = transform(item, options, update, log_file)
            with _PROCESS_JOBS_LOCK:
                _PROCESS_JOBS[job_id]["phase"] = "Đang lưu kết quả..."
            _write_process_log(log_file, f"PHASE: Đang lưu kết quả... output={output}")
            record_done(output, item, options)
            with _PROCESS_JOBS_LOCK:
                _PROCESS_JOBS[job_id].update(status="completed", phase="Hoàn tất", progress=100, output_path=str(output))
            _write_process_log(log_file, "JOB COMPLETED: done.json updated")
        except Exception as exc:
            with _PROCESS_JOBS_LOCK:
                _PROCESS_JOBS[job_id].update(status="error", phase="Đã xảy ra lỗi", error=str(exc))
            _write_process_log(log_file, f"JOB ERROR: {type(exc).__name__}: {exc}")

    threading.Thread(target=run, daemon=True, name=f"video-process-{job_id}").start()
    return job_id


def get_process_job(job_id: str) -> dict | None:
    with _PROCESS_JOBS_LOCK:
        job = _PROCESS_JOBS.get(job_id)
        return dict(job) if job else None


def get_process_log(job_id: str) -> str | None:
    log_file = PROCESS_LOG_DIR / f"{job_id}.log"
    if not log_file.exists(): return None
    try: return log_file.read_text(encoding="utf-8")
    except OSError: return None


def list_merged_videos() -> list[dict]:
    if not MERGE_DIR.exists(): return []
    items = []
    for path in sorted(MERGE_DIR.glob("*.mp4"), key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
            stream = (json.loads(probe.stdout).get("streams") or [{}])[0]
            width, height = int(stream.get("width") or 0), int(stream.get("height") or 0)
            aspect = "9:16" if height > width else "16:9"
            items.append({"file_name": path.name, "name": path.name, "file_path": str(path),
                          "duration_sec": ffprobe_duration(path), "aspect": aspect, "created_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat()})
        except OSError:
            continue
    return items
