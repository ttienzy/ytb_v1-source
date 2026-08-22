"""FFmpeg helpers — Phase R2 cut (stream-copy) + Phase R3 atempo sync (re-encode audio).

R2 ``cut_segment``: ``-ss`` trước ``-i`` (input seek, nhanh — nhảy tới keyframe gần nhất)
+ ``-t`` (output duration) + ``-c copy``: cắt gần như tức thì (<1s/đoạn). Tradeoff: điểm
bắt đầu lệch tối đa ~2-5s do keyframe spacing YouTube DASH — chấp nhận vì R3 thay audio gốc.

R3 ``atempo_sync``: VO TTS sinh ra thừa/thiếu vs ``duration_sec`` segment → dùng ``atempo``
(đổi tốc độ, giữ cao độ) để kéo về đúng target. atempo mỗi stage giới hạn [0.5, 2.0]; ngoài
khoảng đó chain nhiều stage. Cả hai idempotent: đã có file → skip.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

TIMEOUT = 120  # mỗi đoạn — stream-copy rất nhanh; atempo re-encode audio WAV cũng chỉ vài giây.
TIMEOUT_MUX = 300  # mux 1 segment: video copy + audio aac, nhanh.
TIMEOUT_CONCAT = 1800  # concat 25 segment (stream-copy) — có thể chậm với file lớn.


def cut_segment(video: Path, start_sec: float, end_sec: float, out: Path) -> Path:
    """Cắt [start, end] giây từ video → out (mp4, stream-copy). Skip nếu đã có."""
    if out.exists() and out.stat().st_size:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    dur = max(0.0, end_sec - start_sec)
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start_sec:.3f}",
        "-i", str(video),
        "-t", f"{dur:.3f}",
        "-c", "copy",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
    if proc.returncode != 0 or not out.exists() or not out.stat().st_size:
        raise RuntimeError(f"ffmpeg cut thất bại [{out.name}]: {(proc.stderr or '')[-400:]}")
    return out


def _atempo_chain(factor: float) -> list[float]:
    """Phân rã factor về list các giá trị atempo ∈ [0.5, 2.0] (tích = factor).

    atempo mỗi stage chỉ chấp nhận [0.5, 2.0]; factor=4 → [2.0, 2.0], factor=0.25 → [0.5, 0.5].
    """
    factors: list[float] = []
    f = factor
    while f > 2.0:
        factors.append(2.0)
        f /= 2.0
    while f < 0.5:
        factors.append(0.5)
        f /= 0.5  # f/0.5 = 2f → kéo f lên gần 1
    factors.append(round(f, 4))
    return factors


def atempo_sync(wav_in: Path, tts_dur: float, target_sec: float, out: Path) -> tuple[Path, bool]:
    """Đồng bộ TTS audio → đúng ``target_sec`` bằng atempo (đổi tốc độ, giữ cao độ).

    Trả (out_path, overspeed). ``overspeed``=True khi factor ngoài [0.5, 2.0] (cần chain ≥2
    stage → tốc độ ép mạnh, giọng nghe ráo/kéo → UI warn đoạn đó). Factor≈1 (|f-1|<0.03)
    → copy thô (không re-encode). Idempotent: file đã có → skip ffmpeg nhưng vẫn tính overspeed.
    """
    factor = (tts_dur / target_sec) if target_sec > 0 else 1.0
    overspeed = factor > 2.0 or factor < 0.5

    if out.exists() and out.stat().st_size:
        return out, overspeed
    out.parent.mkdir(parents=True, exist_ok=True)

    if abs(factor - 1.0) < 0.03:
        shutil.copyfile(wav_in, out)
        return out, overspeed

    flt = ",".join(f"atempo={x:.4f}" for x in _atempo_chain(factor))
    cmd = ["ffmpeg", "-y", "-i", str(wav_in), "-filter:a", flt, str(out)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
    if proc.returncode != 0 or not out.exists() or not out.stat().st_size:
        raise RuntimeError(f"ffmpeg atempo thất bại [{out.name}]: {(proc.stderr or '')[-400:]}")
    return out, overspeed


def mux_segment(clip: Path, voice: Path, out: Path) -> Path:
    """Ghép clip (video-only) + VO (wav) → mp4 có cả video+audio (R4).

    Video stream-copy (giữ avc1), audio encode aac (PCM wav không vào mp4 trực tiếp).
    ``-shortest`` cắt video theo độ dài VO (đã sync chính xác) → VO phủ kín cả đoạn.
    KHÔNG dùng ``-avoid_negative_ts make_zero``: nó phồng video stream (17s → 18s). Idempotent.
    """
    if out.exists() and out.stat().st_size:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(clip), "-i", str(voice),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_MUX)
    if proc.returncode != 0 or not out.exists() or not out.stat().st_size:
        raise RuntimeError(f"ffmpeg mux thất bại [{out.name}]: {(proc.stderr or '')[-400:]}")
    return out


def concat_segments(segments: list[Path], out: Path, work_dir: Path) -> Path:
    """Concat list seg_i.mp4 → final mp4 (concat demuxer + stream-copy).

    Dùng path dạng POSIX (forward-slash) trong concat list để ffmpeg Windows đọc ổn.
    Idempotent: đã có final → skip.
    """
    if out.exists() and out.stat().st_size:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    lst = work_dir / "concat_list.txt"
    # concat demuxer: mỗi dòng "file 'path'" — escape dấu nháy đơn.
    lines = []
    for p in segments:
        posix = p.as_posix().replace("'", "'\\''")
        lines.append(f"file '{posix}'")
    lst.write_text("\n".join(lines), encoding="utf-8")
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(lst),
        "-c", "copy",
        str(out),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_CONCAT)
    if proc.returncode != 0 or not out.exists() or not out.stat().st_size:
        raise RuntimeError(f"ffmpeg concat thất bại: {(proc.stderr or '')[-500:]}")
    return out
