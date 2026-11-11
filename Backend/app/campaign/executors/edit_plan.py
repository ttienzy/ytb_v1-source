"""Lập danh sách cắt cho kiểu dựng "micro-cut": nhiều cú cắt 1,5–3 giây, cắt theo nhịp nhạc, chọn đoạn nhiều chuyển động nhất của mỗi clip.

Toàn hàm thuần (trừ hai hàm đọc media), không cần numpy/librosa: backend đóng gói bằng PyInstaller nên tránh thêm phụ thuộc nặng.
"""
from __future__ import annotations

import array
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

DEFAULT_CUT = 2.2
MIN_CUT = 1.2
MAX_CUT = 4.0
PLAY_SPEED = 1.2            # clip AI thường chậm, hơi nổi: phát nhanh hơn một chút cho có quán tính
SNAP = 0.35                 # chỉ dời điểm cắt về phách khi lệch không quá ngần này
_SR = 11025
_HOP = 256
_MOTION_FPS = 4


@dataclass(frozen=True)
class BeatGrid:
    period: float
    phase: float

    def times(self, until: float) -> list[float]:
        out, t = [], self.phase
        while t <= until + self.period:
            out.append(round(t, 3))
            t += self.period
        return out


def clamp_cut(value: object) -> float:
    try:
        v = float(value)                                     # type: ignore[arg-type]
    except (TypeError, ValueError):
        return DEFAULT_CUT
    return max(MIN_CUT, min(MAX_CUT, v))


def beat_grid_from_envelope(onsets: list[float], hop_seconds: float) -> BeatGrid | None:
    """Ước lượng nhịp bằng tự tương quan đường onset. Nhạc không rõ nhịp thì trả None để dùng lưới đều."""
    n = len(onsets)
    if n < 80 or max(onsets, default=0) <= 0:
        return None
    mean = sum(onsets) / n
    centred = [x - mean for x in onsets]
    energy = sum(x * x for x in centred) or 1.0
    best_lag, best_score, best_raw = 0, -math.inf, 0.0
    for lag in range(max(2, round(60 / 170 / hop_seconds)), round(60 / 70 / hop_seconds) + 1):
        raw = sum(centred[i] * centred[i + lag] for i in range(n - lag)) / energy
        bpm = 60 / (lag * hop_seconds)
        score = raw * math.exp(-0.5 * (math.log2(bpm / 120) / 0.9) ** 2)   # ưu tiên quanh 120 BPM để tránh nhịp đôi/nửa
        if score > best_score:
            best_lag, best_score, best_raw = lag, score, raw
    if best_lag == 0 or best_raw < 0.08:
        return None
    phase_scores = [sum(onsets[i] for i in range(off, n, best_lag)) for off in range(best_lag)]
    phase = max(range(best_lag), key=phase_scores.__getitem__)
    return BeatGrid(period=best_lag * hop_seconds, phase=phase * hop_seconds)


def detect_beats(path: Path, seconds: float) -> BeatGrid | None:
    """Giải mã bằng ffmpeg rồi tìm nhịp. Lỗi đọc nhạc không được làm hỏng bước ghép: trả None."""
    try:
        proc = subprocess.run(["ffmpeg", "-v", "error", "-t", f"{min(seconds + 4, 90):.1f}", "-i", str(path), "-ac", "1", "-ar", str(_SR),
                               "-f", "s16le", "-"], capture_output=True, timeout=60)
    except (subprocess.SubprocessError, OSError):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    samples = array.array("h")
    samples.frombytes(proc.stdout[: len(proc.stdout) // 2 * 2])
    env = [sum(map(abs, samples[i:i + _HOP])) / _HOP for i in range(0, len(samples) - _HOP, _HOP)]
    onsets = [max(0.0, env[i] - env[i - 1]) for i in range(1, len(env))]
    return beat_grid_from_envelope(onsets, _HOP / _SR)


def motion_curve(path: Path) -> tuple[list[float], float]:
    """Độ thay đổi giữa các khung (4 khung/giây, ảnh rất nhỏ). Không đọc được thì trả rỗng và cắt đều."""
    dt = 1 / _MOTION_FPS
    w, h = 36, 64
    try:
        proc = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"fps={_MOTION_FPS},scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
                              capture_output=True, timeout=60)
    except (subprocess.SubprocessError, OSError):
        return [], dt
    if proc.returncode != 0:
        return [], dt
    size = w * h
    frames = [proc.stdout[i:i + size] for i in range(0, len(proc.stdout) - size + 1, size)]
    return [sum(abs(a - b) for a, b in zip(frames[i], frames[i + 1])) / size for i in range(len(frames) - 1)], dt


def pick_windows(curve: list[float], dt: float, clip_seconds: float, lengths: list[float]) -> list[float]:
    """Điểm bắt đầu của từng đoạn, theo THỨ TỰ THỜI GIAN và không chồng nhau, ưu tiên đoạn nhiều chuyển động nhất."""
    starts: list[float] = []
    cursor = 0.0
    for j, length in enumerate(lengths):
        latest = max(cursor, clip_seconds - length - sum(lengths[j + 1:]))
        best, best_score = cursor, -1.0
        t = cursor
        while t <= latest + 1e-6:
            first, last = int(t / dt), int((t + length) / dt)
            score = sum(curve[first:last]) if curve else 0.0
            if score > best_score + 1e-9:
                best, best_score = t, score
            t += dt
        starts.append(round(best, 3))
        cursor = best + length
    return starts


def snap_up(t: float, beats: list[float], limit: float) -> float:
    """Kết thúc shot rơi vào phách kế tiếp nếu gần (chỉ dời về sau để không cắt mất lời thoại)."""
    next_beat = next((b for b in beats if b >= t), None)
    return next_beat if next_beat is not None and next_beat - t <= SNAP and next_beat <= limit else t


def split_slot(start: float, end: float, target: float, beats: list[float]) -> list[tuple[float, float]]:
    """Chia một shot thành các cú cắt dài khoảng `target`, điểm cắt dời về phách gần nhất, không cú nào ngắn hơn MIN_CUT."""
    n = max(1, round((end - start) / target))
    step = (end - start) / n
    points = [start]
    for k in range(1, n):
        ideal = start + k * step
        near = min(beats, key=lambda b: abs(b - ideal)) if beats else ideal
        cut = near if abs(near - ideal) <= SNAP else ideal
        if cut - points[-1] >= MIN_CUT and end - cut >= MIN_CUT:
            points.append(round(cut, 3))
    points.append(end)
    return list(zip(points, points[1:]))


PUNCH_DEFAULT = (1.0, 1.22, 1.1, 1.3)
PUNCH_DETAIL = (1.0, 1.25, 1.45, 1.15)


def punch_for(archetype: str, index: int) -> float:
    """Phóng số xen kẽ để hai cú cắt liền nhau từ cùng một clip đọc như hai góc máy khác nhau."""
    pattern = PUNCH_DETAIL if archetype == "detail" else PUNCH_DEFAULT
    return pattern[index % len(pattern)]


def focus_for(archetype: str, framing: str) -> float:
    """Vị trí dọc của vùng cắt khi phóng (0 = mép trên): shot có người giữ mặt và ngực trong khung."""
    if archetype == "detail":
        return 0.5
    return 0.35 if framing == "wide" else 0.2
