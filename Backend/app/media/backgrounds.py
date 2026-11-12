"""Thư viện video nền cho Workflow Audio.

Một kho NGUỒN duy nhất (chính là kho "video chưa upload" của trang Video: nhập từ máy hoặc YouTube), không gắn với khổ 9:16 / 16:9.
Khi cần một khổ nào đó, từng nguồn được chuẩn hóa MỘT lần (cache) thành clip đúng kích thước, cùng codec/khung hình/giây:
  * "fill": lấp đầy khung (cắt giữa)            — gọn, không viền;
  * "blur": giữ nguyên hình + nền mờ phía sau  — không mất nội dung ở hai mép.
Vì mọi clip đã chuẩn hóa có cùng thông số nên ghép nền cho một chương chỉ là NỐI (stream copy, gần như tức thì),
không còn phải mã hóa lại cả chiều dài chương như trước.
"""
from __future__ import annotations

import hashlib
import os
import random
import subprocess
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from app.media import video_service
from app.recap.ffmpeg import ffprobe_duration

ASPECTS: dict[str, tuple[int, int]] = {"9:16": (1080, 1920), "16:9": (1920, 1080)}
FITS = ("fill", "blur")
DEFAULT_FIT = "fill"
MAX_CLIP_SECONDS = 600  # mỗi video nguồn chỉ dùng tối đa 10 phút đầu (nguồn dài hơn sẽ tốn thời gian + dung lượng vô ích)
FPS = 30
EMPTY_MESSAGE = "Thư viện nền đang trống. Hãy thêm ít nhất 1 video nền (nút \"Quản lý nền\" ở cột bên phải)."

_STATE: dict[tuple[str, str, str], str] = {}  # (video_id, aspect, fit) -> "queued" | "running" | "error: ..."
_STATE_LOCK = threading.Lock()
_FILE_LOCKS: dict[str, threading.Lock] = defaultdict(threading.Lock)
_FILE_LOCKS_GUARD = threading.Lock()
# Chuẩn hóa là việc ffmpeg nặng: chạy tuần tự trong nền, không chiếm hết CPU.
_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bg-prepare")


def check(aspect: str, fit: str) -> None:
    if aspect not in ASPECTS:
        raise ValueError("Khổ video không hợp lệ.")
    if fit not in FITS:
        raise ValueError("Cách khớp khung không hợp lệ.")


# ── Đường dẫn (tính lúc gọi để test đổi được VIDEO_DIR) ──────────────────────

def _root() -> Path:
    return video_service.VIDEO_DIR


def prepared_dir(aspect: str, fit: str) -> Path:
    return _root() / "bgprep" / f"{aspect.replace(':', 'x')}_{fit}"


def prepared_path(video_id: str, aspect: str, fit: str) -> Path:
    return prepared_dir(aspect, fit) / f"{video_id}.mp4"


def is_ready(video_id: str, aspect: str, fit: str) -> bool:
    path = prepared_path(video_id, aspect, fit)
    return path.is_file() and path.stat().st_size > 0


def _file_lock(path: Path) -> threading.Lock:
    with _FILE_LOCKS_GUARD:
        return _FILE_LOCKS[str(path)]


# ── Chuẩn hóa một clip ───────────────────────────────────────────────────────

def _ffmpeg_args(src: Path, aspect: str, fit: str, out: Path) -> list[str]:
    w, h = ASPECTS[aspect]
    tail_s = f",fps={FPS},format=yuv420p,setsar=1"
    if fit == "blur":
        graph = (
            f"[0:v]split=2[a][b];"
            f"[a]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=24:3[bg];"
            f"[b]scale={w}:{h}:force_original_aspect_ratio=decrease[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2{tail_s}[v]"
        )
        video = ["-filter_complex", graph, "-map", "[v]"]
    else:
        video = ["-vf", f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}{tail_s}"]
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), *video,
        "-an", "-t", str(MAX_CLIP_SECONDS),
        # g=60: khóa hình mỗi 2 giây để cắt/nối stream copy gọn; mọi clip cùng bộ thông số này nên nối copy an toàn.
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", str(FPS * 2), "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(out),
    ]


def prepare_clip(item: dict, aspect: str, fit: str) -> Path:
    """Chuẩn hóa một nguồn thành clip đúng khổ (có cache). Ghi ra file tạm rồi đổi tên: không bao giờ để lộ file dở dang."""
    check(aspect, fit)
    out = prepared_path(item["video_id"], aspect, fit)
    with _file_lock(out):
        if is_ready(item["video_id"], aspect, fit):
            return out
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(f"{out.stem}.part.mp4")
        proc = subprocess.run(_ffmpeg_args(Path(item["file_path"]), aspect, fit, tmp), capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=3600)
        if proc.returncode != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"ffmpeg exit {proc.returncode}: {(proc.stderr or '').strip()[-400:]}")
        os.replace(tmp, out)
        return out


# ── Hàng đợi chuẩn hóa nền ───────────────────────────────────────────────────

def _prepare_task(item: dict, aspect: str, fit: str) -> None:
    key = (item["video_id"], aspect, fit)
    with _STATE_LOCK:
        _STATE[key] = "running"
    try:
        prepare_clip(item, aspect, fit)
        with _STATE_LOCK:
            _STATE.pop(key, None)
    except Exception as exc:  # noqa: BLE001 - lỗi ffmpeg phải hiện ra cho người dùng, không làm chết luồng nền
        with _STATE_LOCK:
            _STATE[key] = f"error: {exc}"


def enqueue_prepare(video_id: str, aspect: str, fit: str) -> str:
    """Đưa một clip vào hàng đợi chuẩn hóa (bỏ qua nếu đã sẵn sàng / đang chờ). Trả trạng thái hiện tại."""
    check(aspect, fit)
    item = video_service.get(video_id)
    if not item:
        return "missing"
    if is_ready(video_id, aspect, fit):
        return "ready"
    key = (video_id, aspect, fit)
    with _STATE_LOCK:
        current = _STATE.get(key)
        if current in ("queued", "running"):
            return current
        _STATE[key] = "queued"
    _POOL.submit(_prepare_task, item, aspect, fit)
    return "queued"


def prepare_all(fit: str, aspects: list[str] | None = None, retry_errors: bool = False) -> int:
    """Chuẩn hóa mọi nguồn còn thiếu cho các khổ. Trả số clip mới được xếp hàng."""
    queued = 0
    for item in video_service.list_videos():
        for aspect in aspects or list(ASPECTS):
            key = (item["video_id"], aspect, fit)
            with _STATE_LOCK:
                failed = str(_STATE.get(key, "")).startswith("error")
                if failed and not retry_errors:
                    continue
                if failed:
                    _STATE.pop(key, None)
            if enqueue_prepare(item["video_id"], aspect, fit) == "queued":
                queued += 1
    return queued


def clip_state(video_id: str, aspect: str, fit: str) -> dict[str, str | None]:
    if is_ready(video_id, aspect, fit):
        return {"status": "ready", "error": None}
    with _STATE_LOCK:
        state = _STATE.get((video_id, aspect, fit))
    if state is None:
        return {"status": "missing", "error": None}
    if state.startswith("error"):
        return {"status": "error", "error": state[len("error: "):] if state.startswith("error: ") else state}
    return {"status": state, "error": None}


def prune_orphans() -> int:
    """Xóa bản đã chuẩn hóa của video nguồn không còn (xóa từ trang Video không biết tới cache này). Trả số file đã xóa."""
    alive = {item["video_id"] for item in video_service.list_videos()}
    removed = 0
    for aspect in ASPECTS:
        for fit in FITS:
            folder = prepared_dir(aspect, fit)
            if not folder.is_dir():
                continue
            for path in folder.glob("*.mp4"):
                video_id = path.name.split(".")[0]  # "<id>.mp4" hoặc "<id>.part.mp4"
                if video_id not in alive:
                    path.unlink(missing_ok=True)
                    removed += 1
    with _STATE_LOCK:
        for key in [k for k in _STATE if k[0] not in alive]:
            _STATE.pop(key, None)
    return removed


def list_backgrounds(fit: str) -> dict:
    check("9:16", fit)
    prune_orphans()
    items = []
    for item in video_service.list_videos():
        items.append({
            "video_id": item["video_id"], "name": item.get("name", ""), "duration_sec": item.get("duration_sec") or 0,
            "size_bytes": item.get("size_bytes") or 0,
            "states": {aspect: clip_state(item["video_id"], aspect, fit) for aspect in ASPECTS},
        })
    return {"fit": fit, "items": items, "total_seconds": round(sum(min(i["duration_sec"], MAX_CLIP_SECONDS) for i in items), 1), "max_clip_seconds": MAX_CLIP_SECONDS}


def ensure_sources() -> int:
    """Kiểm tra nhanh trước khi chạy việc tốn kém: có ít nhất 1 video nguồn không."""
    count = len(video_service.list_videos())
    if not count:
        raise ValueError(EMPTY_MESSAGE)
    return count


# ── Ghép nền cho một chương ──────────────────────────────────────────────────

def _concat_line(path: Path) -> str:
    return "file '" + path.as_posix().replace("'", "'\\''") + "'\n"


def build_background(target_seconds: int, aspect: str, fit: str = DEFAULT_FIT, on_status: Callable[[str], None] | None = None,
                     rng: random.Random | None = None) -> Path:
    """Tạo video nền dài ≥ target_seconds bằng cách NỐI (stream copy) các clip đã chuẩn hóa, xáo trộn, không lặp liền kề.

    Chỉ chuẩn hóa thêm đúng số nguồn còn thiếu cần để đủ thời lượng; phần thừa ở cuối do bước ghép giọng cắt (-shortest)."""
    check(aspect, fit)
    if target_seconds < 1:
        raise ValueError("Thời lượng nền phải lớn hơn 0 giây.")
    rng = rng or random.Random()
    prune_orphans()
    sources = video_service.list_videos()
    if not sources:
        raise ValueError(EMPTY_MESSAGE)

    ready: list[tuple[Path, float]] = []
    missing: list[dict] = []
    for item in sources:
        if is_ready(item["video_id"], aspect, fit):
            path = prepared_path(item["video_id"], aspect, fit)
            duration = ffprobe_duration(path)
            if duration > 0:
                ready.append((path, duration))
        else:
            missing.append(item)
    rng.shuffle(missing)

    errors: list[str] = []
    total = sum(duration for _, duration in ready)
    # Cần thêm clip (đủ thời lượng, hoặc chưa có clip nào sẵn sàng): chuẩn hóa dần từng nguồn còn thiếu.
    while missing and (total < target_seconds + 0.5 or not ready):
        item = missing.pop()
        if on_status:
            on_status(f"Đang chuẩn bị video nền «{item.get('name', '')}» ({aspect})…")
        try:
            path = prepare_clip(item, aspect, fit)
            duration = ffprobe_duration(path)
            if duration > 0:
                ready.append((path, duration))
                total += duration
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{item.get('name', item['video_id'])}: {exc}")
    if not ready:
        raise RuntimeError("Không chuẩn bị được video nền nào." + (f" Lỗi đầu tiên — {errors[0]}" if errors else ""))

    sequence: list[Path] = []
    covered = 0.0
    last: Path | None = None
    while covered < target_seconds + 0.05:
        order = ready[:]
        rng.shuffle(order)
        if last is not None and len(order) > 1 and order[0][0] == last:
            order.append(order.pop(0))  # tránh cùng một clip hai lần liên tiếp
        for path, duration in order:
            sequence.append(path)
            covered += duration
            last = path
            if covered >= target_seconds + 0.05:
                break

    return _concat_to_file(sequence)


def _concat_to_file(sequence: list[Path]) -> Path:
    """Nối các clip cùng thông số bằng concat demuxer + stream copy → một file bg_*.mp4 trong MergeVideo."""
    merge_dir = video_service.MERGE_DIR
    merge_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S") + f"_{int(time.time() * 1000) % 1000:03d}"
    output = merge_dir / f"bg_{stamp}.mp4"
    listing = merge_dir / f".bg_{stamp}.txt"
    try:
        listing.write_text("".join(_concat_line(path) for path in sequence), encoding="utf-8")
        proc = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
                               "-c", "copy", "-movflags", "+faststart", str(output)],
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
        if proc.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError(f"Không nối được video nền: {(proc.stderr or '').strip()[-600:]}")
        return output
    except Exception:
        output.unlink(missing_ok=True)
        raise
    finally:
        listing.unlink(missing_ok=True)


# ── Nền từ ảnh bìa (zoom chậm) ───────────────────────────────────────────────

COVER_LOOP_SECONDS = 40  # một chu kỳ zoom vào rồi ra (liền mạch khi lặp); render MỘT lần rồi cache theo ảnh + khổ
COVER_ZOOM = 0.12        # phóng to tối đa 12%
COVER_PRESCALE = 1.5     # phóng ảnh trước khi zoompan để hình không rung; vẫn nhanh (~200+ khung/giây ở 1080p)


def cover_clip_path(image: Path, aspect: str) -> Path:
    stat = image.stat()
    key = hashlib.sha1(f"{image.resolve()}|{stat.st_size}|{stat.st_mtime_ns}|{aspect}".encode("utf-8")).hexdigest()[:16]
    return _root() / "bgprep" / "cover" / f"{key}_{aspect.replace(':', 'x')}.mp4"


def prepare_cover_clip(image: Path, aspect: str) -> Path:
    """Tạo (có cache) clip zoom chậm từ ảnh bìa: cùng bộ thông số với clip thư viện nên nối copy được."""
    check(aspect, DEFAULT_FIT)
    if not image.is_file():
        raise ValueError("Chế độ nền ảnh bìa cần truyện có thumbnail.")
    out = cover_clip_path(image, aspect)
    with _file_lock(out):
        if out.is_file() and out.stat().st_size > 0:
            return out
        w, h = ASPECTS[aspect]
        frames = COVER_LOOP_SECONDS * FPS
        pw, ph = int(w * COVER_PRESCALE), int(h * COVER_PRESCALE)
        vf = (f"scale={pw}:{ph}:force_original_aspect_ratio=increase,crop={pw}:{ph},"
              f"zoompan=z='1+{COVER_ZOOM}*(1-cos(2*PI*on/{frames}))/2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={w}x{h}:fps={FPS},"
              f"format=yuv420p,setsar=1")
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(f"{out.stem}.part.mp4")
        proc = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(image), "-vf", vf, "-frames:v", str(frames),
                               "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", str(FPS * 2), "-pix_fmt", "yuv420p",
                               "-movflags", "+faststart", str(tmp)],
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
        if proc.returncode != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"Không tạo được nền ảnh bìa (ffmpeg exit {proc.returncode}): {(proc.stderr or '').strip()[-500:]}")
        os.replace(tmp, out)
        return out


def build_cover_background(image: Path, target_seconds: int, aspect: str, on_status: Callable[[str], None] | None = None) -> Path:
    """Nền dài ≥ target_seconds từ ảnh bìa: lặp clip zoom chậm (nối stream copy)."""
    if target_seconds < 1:
        raise ValueError("Thời lượng nền phải lớn hơn 0 giây.")
    cached = cover_clip_path(image, aspect).is_file() if image.is_file() else False
    if on_status and not cached:
        on_status(f"Đang tạo nền ảnh bìa zoom chậm ({aspect})…")
    clip = prepare_cover_clip(image, aspect)
    duration = ffprobe_duration(clip)
    if duration <= 0:
        raise RuntimeError("Clip nền ảnh bìa không đọc được thời lượng.")
    repeats = max(1, int(-(-(target_seconds + 0.05) // duration)))
    return _concat_to_file([clip] * repeats)
