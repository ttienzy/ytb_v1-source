"""Merger & Timestamp Validation for Studio Recap (Step 2).

Combines per-chunk recap outputs into a single chronological recap structure,
validates timestamp continuity across chunk boundaries, and extracts scene titles
for social media caption generation.
"""
from __future__ import annotations

from typing import Any


def merge_chunk_outputs(chunk_outputs: list[dict[str, Any]], video_url: str) -> dict[str, Any]:
    """Hợp nhất các chunk outputs thành một recap structure hoàn chỉnh."""
    if not chunk_outputs:
        return {
            "video_url": video_url,
            "scenes": [],
        }

    # Sắp xếp theo thứ tự chunk_index
    ordered = sorted(chunk_outputs, key=lambda c: c.get("chunk_index", 0))

    all_scenes: list[dict[str, Any]] = []
    for c in ordered:
        scenes = c.get("scenes", [])
        if isinstance(scenes, list):
            for s in scenes:
                if isinstance(s, dict):
                    all_scenes.append(s)

    validate_timestamp_integrity(all_scenes)

    return {
        "video_url": video_url,
        "scenes": all_scenes,
    }


def validate_timestamp_integrity(scenes: list[dict[str, Any]]) -> bool:
    """Kiểm tra tính đơn điệu tăng dần của timestamps qua các cảnh và segments."""
    flat_segs = []
    for scene in scenes:
        for seg in scene.get("segments", []):
            if isinstance(seg, dict):
                flat_segs.append(seg)

    last_start = -1.0
    for idx, seg in enumerate(flat_segs):
        st = float(seg.get("start_time_sec", 0.0) or 0.0)
        et = float(seg.get("end_time_sec", 0.0) or 0.0)

        # Tính toán lại duration_sec để đảm bảo khớp toán học
        seg["start_time_sec"] = st
        seg["end_time_sec"] = et
        seg["duration_sec"] = round(max(0.0, et - st), 2)

        if st < last_start:
            print(
                f"[Warning: Timestamp Drift] Seg #{idx+1} start ({st:.1f}s) < previous start ({last_start:.1f}s)"
            )
        last_start = st

    return True


def extract_scene_titles(merged_recap: dict[str, Any]) -> str:
    """Trích xuất danh sách scene_title nối bằng dấu xuống dòng cho Step 2b Caption."""
    titles = []
    for scene in merged_recap.get("scenes", []):
        t = (scene.get("scene_title") or "").strip()
        if t:
            titles.append(t)
    return "\n".join(titles)
