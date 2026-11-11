"""Chia video mẫu dài thành các đoạn để Motion Control (Omni 1.2) tạo lần lượt.

Flow chỉ nhận đoạn mẫu 3–10 giây mỗi lượt. Các đoạn có thể gối lên nhau một chút (mặc định 1 giây) để lúc ghép
có chỗ chọn khung giống nhau nhất mà cắt, tránh "nhảy hình" ở mối nối. Số đoạn là tối thiểu để mỗi đoạn <= 10 giây,
độ dài chia đều (đoạn cuối không bị quá ngắn). Mốc làm tròn theo khung hình 30 fps (Flow tính trim theo 30 khung/giây).
"""
from __future__ import annotations

import math
from typing import Any

FPS = 30
MAX_SEGMENT = 10.0
MIN_SEGMENT = 3.0
MAX_OVERLAP = 3.0
MAX_TOTAL_SECONDS = 300.0
FLOW_CREDIT_PER_SEGMENT = 30          # đo thật: Motion Control 720p = 30 credit mỗi lượt (đoạn 8 giây); 10 giây Flow cũng báo 30


class PlanError(ValueError):
    """Video không chia được (quá ngắn, quá dài, tham số lạ)."""


def _frames(seconds: float) -> int:
    return int(round(seconds * FPS))


def plan_segments(duration: float, overlap: float = 1.0, max_segment: float = MAX_SEGMENT) -> list[dict[str, Any]]:
    """[{index, start, end, length}] theo giây (bội của 1/30). Đoạn liền kề gối nhau đúng `overlap` giây (hoặc 0)."""
    if not (duration and duration > 0):
        raise PlanError("Video không có thời lượng.")
    if duration < MIN_SEGMENT:
        raise PlanError(f"Video chỉ dài {duration:.1f} giây; Flow cần ít nhất {MIN_SEGMENT:.0f} giây.")
    if duration > MAX_TOTAL_SECONDS:
        raise PlanError(f"Video dài {duration:.0f} giây, vượt giới hạn {MAX_TOTAL_SECONDS:.0f} giây của một lần chạy.")
    overlap = max(0.0, min(float(overlap or 0.0), MAX_OVERLAP))
    max_segment = max(MIN_SEGMENT + 1.0, min(float(max_segment), MAX_SEGMENT))
    total = _frames(duration) / FPS
    if total <= max_segment + 1e-6:
        return [{"index": 0, "start": 0.0, "end": total, "length": total}]

    count = math.ceil((total - overlap) / (max_segment - overlap) - 1e-9)
    length = (total + (count - 1) * overlap) / count
    length_f = min(_frames(max_segment), max(_frames(MIN_SEGMENT), int(math.floor(length * FPS + 1e-9))))
    overlap_f = _frames(overlap)
    total_f = _frames(total)
    segments: list[dict[str, Any]] = []
    for i in range(count):
        start_f = i * (length_f - overlap_f)
        end_f = start_f + length_f
        if i == count - 1:
            end_f = total_f                      # đoạn cuối chạm đúng cuối video
            start_f = min(start_f, end_f - _frames(MIN_SEGMENT))
            start_f = max(start_f, 0)
        segments.append({"index": i, "start": start_f / FPS, "end": end_f / FPS, "length": (end_f - start_f) / FPS})
    # Làm tròn xuống có thể khiến đoạn cuối dài hơn giới hạn: chia lại bằng cách tăng số đoạn (hiếm gặp).
    if any(s["length"] > max_segment + 1e-6 for s in segments):
        return plan_segments(duration, overlap, max_segment - 0.1)
    # Kiểm tra liền mạch: đoạn sau không được bắt đầu sau khi đoạn trước kết thúc (sẽ hở một khoảng video)
    for a, b in zip(segments, segments[1:]):
        if b["start"] > a["end"] + 1e-6:
            raise PlanError("Không chia được video thành các đoạn liền nhau với cấu hình này.")
    return segments


def overlaps(segments: list[dict[str, Any]]) -> list[float]:
    """Độ dài phần gối (giây) giữa từng cặp đoạn liền kề."""
    return [max(0.0, a["end"] - b["start"]) for a, b in zip(segments, segments[1:])]


def estimate_credits(segments: list[dict[str, Any]]) -> int:
    return FLOW_CREDIT_PER_SEGMENT * len(segments)
