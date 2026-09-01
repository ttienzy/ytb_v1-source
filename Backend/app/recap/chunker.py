"""Dynamic Transcript Chunker for Studio Recap (Step 0).

Preprocesses raw transcripts (YouTube JSON panel or text formats) into clean,
lightweight [seconds] dialogue lines and dynamically divides arbitrary-length
videos into N contextual chunks with adaptive segment quotas.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any


def parse_timestamp_to_sec(ts_str: str) -> int:
    """Parse 'MM:SS' or 'HH:MM:SS' or plain integer seconds to int seconds."""
    ts_str = ts_str.strip()
    if ts_str.isdigit():
        return int(ts_str)
    parts = ts_str.split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        pass
    return 0


def extract_transcript_entries(raw_data: bytes | str | dict | list) -> list[dict[str, Any]]:
    """Trích xuất danh sách [{'start_sec': int, 'text': str}] từ mọi định dạng transcript."""
    # 1. Nếu raw_data là bytes -> decode
    if isinstance(raw_data, bytes):
        try:
            raw_data = raw_data.decode("utf-8")
        except UnicodeDecodeError:
            raw_data = raw_data.decode("latin-1", errors="replace")

    # 2. Nếu raw_data là chuỗi JSON -> json.loads
    if isinstance(raw_data, str):
        raw_data_str = raw_data.strip()
        if (raw_data_str.startswith("{") and raw_data_str.endswith("}")) or (
            raw_data_str.startswith("[") and raw_data_str.endswith("]")
        ):
            try:
                raw_data = json.loads(raw_data_str)
            except json.JSONDecodeError:
                pass

    # 3. Phân tích nếu là Dictionary (YouTube get_panel hoặc custom)
    if isinstance(raw_data, dict):
        # Safety net: nếu là dict {"_dom_transcript": "[MM:SS] text\n..."} (từ yt-dlp/DOM scrape)
        # → extract text và re-parse qua nhánh string (Step 5).
        if "_dom_transcript" in raw_data and isinstance(raw_data["_dom_transcript"], str):
            raw_data = raw_data["_dom_transcript"]
        else:
            # Trích xuất từ engagementPanelSectionListRenderer (duyệt tất cả sections)
            sections = (
                raw_data.get("content", {})
                .get("engagementPanelSectionListRenderer", {})
                .get("content", {})
                .get("sectionListRenderer", {})
                .get("contents", [])
            )
            if not sections:
                # Thử trực tiếp nếu raw là sectionListRenderer
                sections = raw_data.get("sectionListRenderer", {}).get("contents", [])

            entries: list[dict[str, Any]] = []
            for sec in sections:
                items = sec.get("itemSectionRenderer", {}).get("contents", [])
                for item in items:
                    tvm = (
                        item.get("macroMarkersPanelItemViewModel", {})
                        .get("item", {})
                        .get("timelineItemViewModel")
                    )
                    if not tvm:
                        continue
                    seg = (tvm.get("contentItems") or [{}])[0].get("transcriptSegmentViewModel")
                    if not seg:
                        continue

                    watch_endpoint = (
                        tvm.get("onTap", {})
                        .get("innertubeCommand", {})
                        .get("watchEndpoint", {})
                    )
                    start_sec = watch_endpoint.get("startTimeSeconds")
                    if start_sec is None:
                        start_sec = parse_timestamp_to_sec(tvm.get("timestamp", "0:00"))

                    text = (seg.get("simpleText") or "").strip()
                    if not text:
                        snip = seg.get("snippet", {})
                        if isinstance(snip, dict) and "runs" in snip:
                            text = " ".join(
                                r.get("text", "") for r in snip["runs"] if isinstance(r, dict)
                            ).strip()

                    if text:
                        entries.append({
                            "start_sec": int(start_sec),
                            "text": text,
                        })

            if entries:
                return sorted(entries, key=lambda e: e["start_sec"])


    # 4. Phân tích nếu là List of dicts
    if isinstance(raw_data, list):
        entries = []
        for it in raw_data:
            if isinstance(it, dict):
                st = it.get("start_sec") or it.get("start") or it.get("start_time_sec") or 0
                tx = it.get("text") or it.get("dialogue") or ""
                if tx:
                    entries.append({"start_sec": int(st), "text": str(tx).strip()})
        if entries:
            return sorted(entries, key=lambda e: e["start_sec"])

    # 5. Phân tích từ Text dạng dòng "[120s] dialogue" hoặc "[02:30] dialogue" hoặc "02:30 dialogue"
    if isinstance(raw_data, str):
        entries = []
        for line in raw_data.splitlines():
            line = line.strip()
            if not line:
                continue
            # Match [02:30] text hoặc [0:01] text hoặc [1:23:45] text (MM:SS TRƯỚC seconds)
            m_ts = re.match(r"^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)$", line)
            if m_ts and m_ts.group(2):
                entries.append({
                    "start_sec": parse_timestamp_to_sec(m_ts.group(1)),
                    "text": m_ts.group(2).strip(),
                })
                continue
            # Match [123s] text hoặc [123] text (chỉ pure digits, KHÔNG chứa ":")
            m_sec = re.match(r"^\[(\d+)s?\]\s*(.*)$", line)
            if m_sec and m_sec.group(2):
                entries.append({
                    "start_sec": int(m_sec.group(1)),
                    "text": m_sec.group(2).strip(),
                })
                continue
            # Fallback nếu không có timestamp
            if entries:
                entries[-1]["text"] += " " + line
            else:
                entries.append({"start_sec": 0, "text": line})

        if entries:
            return sorted(entries, key=lambda e: e["start_sec"])

    return []


def build_dynamic_chunks(
    entries: list[dict[str, Any]],
    video_url: str,
    target_chunk_dur: int = 240,
) -> list[dict[str, Any]]:
    """Chia danh sách entries thành N chunks động (mỗi chunk ~4 phút) với quota co giãn tương ứng."""
    if not entries:
        return []

    # Ước tính tổng thời lượng video từ entry cuối
    last_sec = entries[-1]["start_sec"]
    total_duration_sec = max(last_sec + 15, 60)

    # Tính số lượng chunks N (mỗi chunk ~4 phút / 240s)
    num_chunks = max(1, round(total_duration_sec / target_chunk_dur))
    if num_chunks > 1 and (total_duration_sec / num_chunks) < 180:
        num_chunks = max(1, math.floor(total_duration_sec / target_chunk_dur))

    chunk_window_sec = total_duration_sec / num_chunks

    chunks: list[dict[str, Any]] = []
    for i in range(num_chunks):
        c_start = int(i * chunk_window_sec)
        c_end = int((i + 1) * chunk_window_sec) if i < num_chunks - 1 else int(total_duration_sec)

        # Lấy entries thuộc cửa sổ thời gian này
        if i == num_chunks - 1:
            chunk_entries = [e for e in entries if e["start_sec"] >= c_start]
        else:
            chunk_entries = [e for e in entries if c_start <= e["start_sec"] < c_end]

        # Đảm bảo chunk có ít nhất 1 entry nếu rỗng
        if not chunk_entries:
            # Lấy entry gần nhất
            closest = min(entries, key=lambda e: abs(e["start_sec"] - c_start))
            chunk_entries = [closest]

        # Format raw_text dạng "[seconds] dialogue"
        raw_text_lines = [f"[{e['start_sec']}s] {e['text']}" for e in chunk_entries]
        raw_text = "\n".join(raw_text_lines)

        # Tính dynamic quota cho chunk ~4 phút (nhịp 5-9s/segment -> 8-14 segments)
        chunk_dur = max(c_end - c_start, 60)
        ratio = chunk_dur / 240.0
        min_segs = max(4, round(8 * ratio))
        max_segs = max(min_segs + 2, round(14 * ratio))

        chunks.append({
            "chunk_index": i,
            "total_chunks": num_chunks,
            "chunk_start_sec": c_start,
            "chunk_end_sec": c_end,
            "is_first_chunk": (i == 0),
            "is_last_chunk": (i == num_chunks - 1),
            "target_segments_min": min_segs,
            "target_segments_max": max_segs,
            "entries_count": len(chunk_entries),
            "raw_text": raw_text,
            "video_url": video_url,
        })

    return chunks
