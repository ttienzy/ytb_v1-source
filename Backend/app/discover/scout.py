"""Gemini AI YouTube Channel Scout & Recommendation."""
from __future__ import annotations

import json
import re
from typing import Any

from app.core.config import TOOLS_DIR

RECOMMEND_PROMPT_PATH = TOOLS_DIR / "Backend" / "prompts" / "discover" / "recommend_channels.prompt.txt"


def scout_channels_with_gemini(query: str) -> list[dict[str, Any]]:
    """Gọi Gemini AI để tìm kiếm và đề xuất kênh YouTube phù hợp theo System Prompt."""
    try:
        from app.ai.gemini.recap import _call_gemini_stream, _parse_stream_frames

        prompt_template = ""
        if RECOMMEND_PROMPT_PATH.exists():
            try:
                prompt_template = RECOMMEND_PROMPT_PATH.read_text(encoding="utf-8")
            except Exception:
                pass

        if prompt_template and "{query}" in prompt_template:
            prompt = prompt_template.replace("{query}", query)
        else:
            prompt = (
                f"Hãy tìm và gợi ý cho mình 6-8 kênh YouTube tiếng Anh hay nhất về chủ đề: \"{query}\" dưới dạng JSON array."
            )

        # Câu lệnh người dùng gửi kèm file prompt
        chat_message = f"Hãy gợi ý cho mình 6-8 kênh YouTube tiếng Anh hay nhất về chủ đề: '{query}'"

        stream_resp = _call_gemini_stream(
            prompt_text=prompt,
            filename="discover_channels.txt",
            query_text=chat_message,
            allow_refresh=True,
        )

        # Parse candidates from Gemini StreamGenerate frames
        payloads = _parse_stream_frames(stream_resp)
        candidates: list[str] = []
        for p in payloads:
            try:
                rc_block = p[4]
                for rc in rc_block:
                    if isinstance(rc, list) and len(rc) >= 2 and isinstance(rc[1], list) and rc[1]:
                        txt = rc[1][0]
                        if isinstance(txt, str) and len(txt) > 10:
                            candidates.append(txt)
            except Exception:
                pass

        if not candidates and stream_resp:
            candidates.append(stream_resp)

        # Extract JSON Array from candidates
        for txt in candidates:
            # 1. Code fence ```json ... ```
            if "```" in txt:
                start = txt.find("```")
                end = txt.rfind("```")
                if start != -1 and end > start:
                    c = txt[start + 3:end].strip()
                    if c.startswith("json"):
                        c = c[4:].strip()
                    try:
                        data = json.loads(c)
                        if isinstance(data, list) and len(data) > 0:
                            return data
                    except json.JSONDecodeError:
                        pass

            # 2. Direct regex array search [ { ... } ]
            m = re.search(r"\[\s*\{.*\}\s*\]", txt, re.DOTALL)
            if m:
                try:
                    data = json.loads(m.group(0))
                    if isinstance(data, list) and len(data) > 0:
                        return data
                except json.JSONDecodeError:
                    pass

    except Exception as exc:
        print(f"[Discover Scout] Gemini recommendation failed: {exc}")

    return []


RECOMMEND_VIDEOS_PROMPT_PATH = TOOLS_DIR / "Backend" / "prompts" / "discover" / "recommend_videos.prompt.txt"


def _clean_scout_query(text: str) -> str:
    """Làm sạch query: loại bỏ chữ Hán (như 抖音), ngoặc vuông, và các từ khóa nhạy cảm (Trung Quốc, China, Douyin) gây lỗi từ chối của Gemini."""
    if not text:
        return ""
    t = text
    # 1. Loại bỏ toàn bộ ký tự chữ Hán
    t = re.sub(r"[\u4e00-\u9fff]+", "", t)
    # 2. Loại bỏ ngoặc vuông, ngoặc đơn, ngoặc kép chứa tag [抖音]
    t = re.sub(r"[\[\(【「［].*?[\]\)】」］]", "", t)
    # 3. Thay thế "Trung Quốc", "China", "Chinese", "nội địa Trung" thành "Châu Á" để tránh trigger filter
    t = re.sub(r"(?i)\b(trung\s*qu[oố]c|china|chinese|n[oộ]i\s*đ[iị]a\s*trung|đ[aạ]i\s*l[uụ]c)\b", "Châu Á", t)
    # 4. Chuẩn hóa Douyin thành TikTok
    t = re.sub(r"(?i)\b(douyin|d[oô]uyin)\b", "TikTok", t)
    # 5. Dọn dẹp khoảng trắng và từ lặp
    t = re.sub(r"(?i)\bchâu á\s+châu á\b", "Châu Á", t)
    return re.sub(r"\s+", " ", t).strip()


def search_youtube_videos_ytdlp(query: str, limit: int = 8) -> list[dict[str, Any]]:
    """Tìm kiếm trực tiếp video thực tế trên YouTube qua yt-dlp flat search."""
    import subprocess
    import sys
    
    clean_q = _clean_scout_query(query) or "Nấu ăn cùng TikTok bento cơm hộp"
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--flat-playlist",
        "--dump-single-json",
        f"ytsearch{limit}:{clean_q}",
        "--no-warnings",
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
        if proc.returncode == 0 and proc.stdout:
            data = json.loads(proc.stdout)
            entries = data.get("entries") or []
            results: list[dict[str, Any]] = []
            for it in entries:
                if not it:
                    continue
                v_id = it.get("id") or ""
                v_url = it.get("url") or f"https://www.youtube.com/watch?v={v_id}"
                dur = it.get("duration")
                dur_fmt = f"{int(dur // 60):02d}:{int(dur % 60):02d}" if dur else "—"
                results.append({
                    "title": it.get("title") or f"Video YouTube ({v_id})",
                    "url": v_url,
                    "video_id": v_id,
                    "channel_name": it.get("channel") or it.get("uploader") or "Kênh YouTube",
                    "channel_url": it.get("uploader_url") or "",
                    "thumbnail_url": f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg" if v_id else "",
                    "duration_approx": dur_fmt,
                    "niche_topic": query or "Ẩm thực",
                    "reason": "Video phổ biến trên YouTube với hình ảnh hấp dẫn và nhiều lượt xem thực tế.",
                })
            return results
    except Exception as exc:
        print(f"[YouTube Search] yt-dlp fallback search failed: {exc}")

    return []


def scout_videos_with_gemini(
    query: str,
    custom_prompt: str | None = None,
    urls: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Gợi ý danh sách video YouTube theo chủ đề ngách bằng câu lệnh tự nhiên hoặc tìm kiếm YouTube trực tiếp."""
    clean_query = _clean_scout_query(query)
    combined_parts = []
    if clean_query:
        combined_parts.append(f"Chủ đề tìm kiếm: {clean_query}")
    if custom_prompt and custom_prompt.strip():
        combined_parts.append(f"Yêu cầu bổ sung: {_clean_scout_query(custom_prompt.strip())}")
    if urls and len(urls) > 0:
        valid_urls = [u.strip() for u in urls if u.strip()]
        if valid_urls:
            combined_parts.append("Danh sách video tham khảo:\n" + "\n".join(valid_urls))

    full_user_prompt = "\n\n".join(combined_parts) if combined_parts else "Nấu ăn cùng TikTok cách làm cơm hộp bento đơn giản"

    raw_items: list[dict[str, Any]] = []

    try:
        from app.ai.gemini.recap import _call_gemini_stream, _parse_stream_frames

        prompt_template = ""
        if RECOMMEND_VIDEOS_PROMPT_PATH.exists():
            try:
                prompt_template = RECOMMEND_VIDEOS_PROMPT_PATH.read_text(encoding="utf-8")
            except Exception:
                pass

        if prompt_template and "{user_prompt}" in prompt_template:
            prompt = prompt_template.replace("{user_prompt}", full_user_prompt)
        else:
            prompt = (
                f"Hãy gợi ý cho mình danh sách 6-8 video YouTube về chủ đề: \"{full_user_prompt}\". "
                f"Trả về dạng JSON array với các trường title, url, video_id, channel_name, duration_approx, niche_topic, reason."
            )

        chat_message = f"Hãy gợi ý cho mình 6-8 video YouTube phổ biến về chủ đề: '{clean_query or 'ẩm thực Châu Á'}'"

        stream_resp = _call_gemini_stream(
            prompt_text=prompt,
            filename="videos_request.txt",
            query_text=chat_message,
            allow_refresh=True,
        )

        payloads = _parse_stream_frames(stream_resp)
        candidates: list[str] = []
        for p in payloads:
            try:
                rc_block = p[4]
                for rc in rc_block:
                    if isinstance(rc, list) and len(rc) >= 2 and isinstance(rc[1], list) and rc[1]:
                        txt = rc[1][0]
                        if isinstance(txt, str) and len(txt) > 10:
                            candidates.append(txt)
            except Exception:
                pass

        if not candidates and stream_resp:
            candidates.append(stream_resp)

        for txt in candidates:
            # 1. Code fence ```json ... ```
            if "```" in txt:
                start = txt.find("```")
                end = txt.rfind("```")
                if start != -1 and end > start:
                    c = txt[start + 3:end].strip()
                    if c.startswith("json"):
                        c = c[4:].strip()
                    try:
                        data = json.loads(c)
                        if isinstance(data, list) and len(data) > 0:
                            raw_items = data
                            break
                    except json.JSONDecodeError:
                        pass

            # 2. Direct regex array search [ { ... } ]
            m = re.search(r"\[\s*\{.*\}\s*\]", txt, re.DOTALL)
            if m:
                try:
                    data = json.loads(m.group(0))
                    if isinstance(data, list) and len(data) > 0:
                        raw_items = data
                        break
                except json.JSONDecodeError:
                    pass

    except Exception as exc:
        print(f"[Discover Scout Videos] Gemini recommendation failed: {exc}")

    # Fallback to direct YouTube search if Gemini did not produce items
    if not raw_items and (query or clean_query):
        print("[Discover Scout Videos] Falling back to direct YouTube search via yt-dlp...")
        raw_items = search_youtube_videos_ytdlp(clean_query or query, limit=8)

    # Normalize and enrich items
    cleaned_items: list[dict[str, Any]] = []
    seen_urls = set()

    for item in raw_items:
        if not isinstance(item, dict):
            continue
        v_url = str(item.get("url") or "").strip()
        v_title = str(item.get("title") or "").strip()
        if not v_url and not v_title:
            continue

        # Extract or normalize video_id
        vid_m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})", v_url)
        vid = vid_m.group(1) if vid_m else str(item.get("video_id") or "").strip()
        if vid == "VIDEO_ID" or len(vid) != 11:
            vid = vid_m.group(1) if vid_m else ""

        if vid and (not v_url or "VIDEO_ID" in v_url):
            v_url = f"https://www.youtube.com/watch?v={vid}"

        if v_url in seen_urls:
            continue
        seen_urls.add(v_url)

        # Robust YouTube thumbnail from video_id
        thumb = str(item.get("thumbnail_url") or "").strip()
        if vid and len(vid) == 11 and vid != "VIDEO_ID":
            thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        elif "VIDEO_ID" in thumb or not thumb.startswith("http"):
            thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else ""

        cleaned_items.append({
            "title": v_title or f"YouTube Video ({vid})",
            "url": v_url,
            "video_id": vid,
            "channel_name": item.get("channel_name") or "Kênh YouTube",
            "channel_url": item.get("channel_url") or "",
            "thumbnail_url": thumb,
            "duration_approx": item.get("duration_approx") or "—",
            "niche_topic": item.get("niche_topic") or (query or "Nấu ăn TikTok / Bento"),
            "reason": item.get("reason") or "Video có hình ảnh hấp dẫn, chủ đề thịnh hành phù hợp lưu trữ và phát triển nội dung.",
        })

    # If user passed seed URLs, also ensure they are included in results
    if urls:
        for seed in reversed(urls):
            s_url = seed.strip()
            if not s_url.startswith("http"):
                continue
            s_m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})", s_url)
            s_vid = s_m.group(1) if s_m else ""
            clean_seed_url = f"https://www.youtube.com/watch?v={s_vid}" if s_vid else s_url
            if clean_seed_url not in seen_urls:
                seen_urls.add(clean_seed_url)
                cleaned_items.insert(0, {
                    "title": f"Video YouTube ({s_vid or 'Gốc'})",
                    "url": clean_seed_url,
                    "video_id": s_vid,
                    "channel_name": "Kênh YouTube",
                    "channel_url": "",
                    "thumbnail_url": f"https://i.ytimg.com/vi/{s_vid}/hqdefault.jpg" if s_vid else "",
                    "duration_approx": "—",
                    "niche_topic": query or "Video tham khảo",
                    "reason": "Video từ liên kết trực tiếp do người dùng cung cấp.",
                })

    return cleaned_items


