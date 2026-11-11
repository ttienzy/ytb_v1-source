"""Ghép các đoạn Motion Control thành một video: cắt ở khung giống nhau nhất trong phần gối, chuyển cảnh mờ ngắn, thêm âm thanh.

Mỗi đoạn Flow tạo ra bám đúng thời gian của video mẫu (đo thật: tư thế khớp từng giây), nên đoạn i đặt vào trục thời gian
của video gốc tại start_i. Trong phần gối giữa hai đoạn, ta so từng cặp khung (ảnh xám thu nhỏ) và cắt ở chỗ giống nhau nhất;
quanh điểm cắt trộn mờ một khoảng ngắn. Không có phần gối thì cắt thẳng. Tiếng của các đoạn do Flow tạo luôn bị bỏ.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

OUT_FPS = 24
SAMPLE_W, SAMPLE_H = 48, 86
DEFAULT_CROSSFADE = 0.25
TIMEOUT = 900


class MergeError(RuntimeError):
    """Ghép video thất bại (thiếu file, ffmpeg lỗi...)."""


def _run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    proc = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, timeout=TIMEOUT)
    if proc.returncode != 0:
        tail = (proc.stderr or b"").decode("utf-8", errors="replace")[-600:]
        raise MergeError(f"ffmpeg lỗi: {tail}")
    return proc


def probe(path: Path) -> dict[str, Any]:
    """{duration, width, height, fps, has_audio} của một video."""
    import json
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration",
         "-of", "json", str(path)], capture_output=True, timeout=60)
    if proc.returncode != 0:
        raise MergeError(f"Không đọc được video {Path(path).name}.")
    data = json.loads(proc.stdout.decode("utf-8", errors="replace") or "{}")
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video:
        raise MergeError(f"{Path(path).name} không có luồng hình.")
    num, _, den = str(video.get("r_frame_rate", "0/1")).partition("/")
    try:
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps = 0.0
    return {
        "duration": float(data.get("format", {}).get("duration") or 0.0),
        "width": int(video.get("width") or 0), "height": int(video.get("height") or 0), "fps": fps,
        "has_audio": any(s.get("codec_type") == "audio" for s in data.get("streams", [])),
    }


def sample_frames(path: Path, start: float, seconds: float, fps: int = OUT_FPS) -> list[bytes]:
    """Các khung xám thu nhỏ (SAMPLE_W×SAMPLE_H) từ `start`, đủ `seconds` giây, mỗi khung là một chuỗi byte."""
    if seconds <= 0:
        return []
    proc = _run(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, start):.3f}", "-i", str(path), "-t", f"{seconds:.3f}",
                 "-vf", f"fps={fps},scale={SAMPLE_W}:{SAMPLE_H},format=gray", "-f", "rawvideo", "-"])
    size = SAMPLE_W * SAMPLE_H
    raw = proc.stdout
    return [raw[i:i + size] for i in range(0, len(raw) - size + 1, size)]


def frame_distance(a: bytes, b: bytes) -> float:
    """Sai khác trung bình mỗi điểm ảnh (0–255) giữa hai khung cùng kích thước."""
    n = min(len(a), len(b))
    if n == 0:
        return 255.0
    return sum(abs(x - y) for x, y in zip(a[:n], b[:n])) / n


def best_cut(frames_a: list[bytes], frames_b: list[bytes], half_window: int) -> tuple[int, list[float]]:
    """Chỉ số khung (theo trục gối) mà hai đoạn giống nhau nhất; chừa `half_window` khung hai đầu cho chuyển cảnh mờ.
    Trả (chỉ số, sai khác từng khung). Cặp khung cùng chỉ số tương ứng cùng một thời điểm của video gốc."""
    count = min(len(frames_a), len(frames_b))
    if count == 0:
        return 0, []
    scores = [frame_distance(frames_a[i], frames_b[i]) for i in range(count)]
    lo = min(half_window, count - 1)
    hi = max(lo, count - 1 - half_window)
    # Làm mượt 3 khung để không chọn trúng một khung tình cờ giống
    smooth = [sum(scores[max(0, i - 1):i + 2]) / len(scores[max(0, i - 1):i + 2]) for i in range(count)]
    best = min(range(lo, hi + 1), key=lambda i: (smooth[i], abs(i - count // 2)))
    return best, scores


def plan_cuts(segments: list[dict[str, Any]], files: list[Path], crossfade: float = DEFAULT_CROSSFADE,
              sampler: Callable[..., list[bytes]] = sample_frames) -> list[dict[str, Any]]:
    """Với mỗi mối nối giữa đoạn i và i+1: điểm cắt c (giây, trục video gốc) và độ rộng chuyển cảnh w.
    Không gối: c = hết đoạn i, w = 0 (cắt thẳng)."""
    joints: list[dict[str, Any]] = []
    for i in range(len(segments) - 1):
        a, b = segments[i], segments[i + 1]
        ov = max(0.0, a["end"] - b["start"])
        if ov < 2.0 / OUT_FPS:
            joints.append({"cut": a["end"], "fade": 0.0, "overlap": ov, "distance": None})
            continue
        fade = min(crossfade, ov * 0.8)
        frames_a = sampler(files[i], b["start"] - a["start"], ov)
        frames_b = sampler(files[i + 1], 0.0, ov)
        idx, scores = best_cut(frames_a, frames_b, int(round(fade * OUT_FPS / 2)) + 1)
        cut = b["start"] + (idx + 0.5) / OUT_FPS
        joints.append({"cut": cut, "fade": fade, "overlap": ov, "distance": scores[idx] if scores else None,
                       "mean_distance": (sum(scores) / len(scores)) if scores else None})
    return joints


def build_pieces(segments: list[dict[str, Any]], joints: list[dict[str, Any]]) -> list[dict[str, float]]:
    """Khoảng thời gian (trục video gốc) lấy từ mỗi đoạn. Mảnh i kéo dài thêm nửa độ rộng chuyển cảnh ở mỗi mối nối."""
    pieces = []
    for i, seg in enumerate(segments):
        a = seg["start"] if i == 0 else joints[i - 1]["cut"] - joints[i - 1]["fade"] / 2
        b = seg["end"] if i == len(segments) - 1 else joints[i]["cut"] + joints[i]["fade"] / 2
        pieces.append({"from": a - seg["start"], "to": b - seg["start"]})
    return pieces


def build_filter(pieces: list[dict[str, float]], joints: list[dict[str, Any]], size: tuple[int, int]) -> tuple[str, float]:
    """Filtergraph nối các mảnh bằng xfade (mối nối gối) hoặc concat (cắt thẳng). Trả (filter, tổng thời lượng)."""
    w, h = size
    parts: list[str] = []
    for i, p in enumerate(pieces):
        parts.append(f"[{i}:v]trim=start={p['from']:.4f}:end={p['to']:.4f},setpts=PTS-STARTPTS,fps={OUT_FPS},"
                     f"scale={w}:{h}:flags=lanczos,setsar=1,format=yuv420p[p{i}]")
    acc, acc_len = "p0", pieces[0]["to"] - pieces[0]["from"]
    for k, joint in enumerate(joints):
        nxt = f"p{k + 1}"
        out = f"j{k + 1}"
        nxt_len = pieces[k + 1]["to"] - pieces[k + 1]["from"]
        if joint["fade"] > 0:
            offset = max(0.0, acc_len - joint["fade"])
            parts.append(f"[{acc}][{nxt}]xfade=transition=fade:duration={joint['fade']:.4f}:offset={offset:.4f}[{out}]")
            acc_len = acc_len + nxt_len - joint["fade"]
        else:
            parts.append(f"[{acc}][{nxt}]concat=n=2:v=1:a=0[{out}]")
            acc_len += nxt_len
        acc = out
    parts.append(f"[{acc}]null[v]")
    return ";".join(parts), acc_len


def merge_segments(segments: list[dict[str, Any]], files: list[Path], output: Path, *, crossfade: float = DEFAULT_CROSSFADE,
                   audio_mode: str = "none", source_audio: Path | None = None, music: Path | None = None,
                   music_volume: float = 0.35, sampler: Callable[..., list[bytes]] = sample_frames) -> dict[str, Any]:
    """Ghép `files` (theo `segments`) thành `output` (mp4). audio_mode: 'original' (tiếng của video gốc), 'bgm' (file nhạc), 'none'."""
    if not segments or len(segments) != len(files):
        raise MergeError("Số đoạn và số file video không khớp.")
    for f in files:
        if not Path(f).is_file():
            raise MergeError(f"Thiếu file đoạn: {Path(f).name}")
    info = probe(files[0])
    size = (info["width"] or 720, info["height"] or 1280)
    joints = plan_cuts(segments, files, crossfade, sampler)
    pieces = build_pieces(segments, joints)
    graph, total = build_filter(pieces, joints, size)

    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_name(f".{output.stem}.tmp{output.suffix}")
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for f in files:
        cmd += ["-i", str(f)]
    audio_args: list[str] = ["-an"]
    audio_in = len(files)
    if audio_mode == "original":
        if not source_audio or not Path(source_audio).is_file():
            raise MergeError("Không có video gốc để lấy âm thanh.")
        cmd += ["-ss", f"{segments[0]['start']:.3f}", "-t", f"{total:.3f}", "-i", str(source_audio)]
        audio_args = ["-map", f"{audio_in}:a:0", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    elif audio_mode == "bgm":
        if not music or not Path(music).is_file():
            raise MergeError("Không tìm thấy file nhạc.")
        fade_out = max(0.0, total - 1.5)
        cmd += ["-stream_loop", "-1", "-i", str(music)]
        graph += (f";[{audio_in}:a]atrim=0:{total:.3f},volume={music_volume:.3f},afade=t=in:d=0.8,"
                  f"afade=t=out:st={fade_out:.3f}:d=1.5[a]")
        audio_args = ["-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    cmd += ["-filter_complex", graph, "-map", "[v]", *audio_args,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(OUT_FPS),
            "-t", f"{total:.3f}", "-movflags", "+faststart", str(tmp)]
    try:
        _run(cmd)
        if not tmp.is_file() or tmp.stat().st_size <= 0:
            raise MergeError("ffmpeg không tạo được file ghép.")
        tmp.replace(output)
    finally:
        tmp.unlink(missing_ok=True)
    return {"duration": total, "joints": joints, "pieces": pieces, "audio": audio_mode}
