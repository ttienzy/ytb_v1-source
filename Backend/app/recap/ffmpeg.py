"""FFmpeg helpers — Phase R2: cut segment bằng stream-copy (không re-encode).

``-ss`` trước ``-i`` (input seek, nhanh — nhảy tới keyframe gần nhất) + ``-t`` (output duration)
+ ``-c copy``: cắt gần như tức thì (<1s/đoạn). Tradeoff: điểm bắt đầu lệch tối đa ~2-5s do
keyframe spacing của YouTube DASH — chấp nhận được vì Phase R3 thay audio gốc bằng VO Việt.
Idempotent: đã có clip thì skip.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

TIMEOUT = 120  # mỗi đoạn — stream-copy rất nhanh.


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
