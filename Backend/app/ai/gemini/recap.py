"""Gemini Recap Generator — Dynamic Chunking & Extensible Multi-Stage Pipeline.

Architecture:
  Step 0: Dynamic transcript extraction & chunking (chunker.py)
  Step 1: Per-chunk LLM invocation with context chaining & auto-healing JSON parsing
  Step 2: Chronological scene merging & timestamp drift validation (merger.py)
  Step 2b: Social media caption & hashtags generation (title, description, hashtags)
"""
from __future__ import annotations

import copy
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, Callable

import httpx

from app.core.config import TOOLS_DIR
from app.core.storage import read_config
from app.recap.chunker import build_dynamic_chunks, extract_transcript_entries
from app.recap.merger import extract_scene_titles, merge_chunk_outputs

DEFAULT_CHUNK_PROMPT_PATH = TOOLS_DIR / "Backend" / "prompts" / "recap" / "food_review_chunk.prompt.txt"
DEFAULT_CAPTION_PROMPT_PATH = TOOLS_DIR / "Backend" / "prompts" / "recap" / "social_caption.prompt.txt"


def _log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        try:
            print(msg.encode("ascii", errors="backslashreplace").decode("ascii"), flush=True)
        except Exception:
            pass


PUSH_ID = "feeds/mcudyrk2a4khkz"
X_CLIENT_PCTX = "CgcSBWjK7pYx"
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
)


class RecapConfigError(RuntimeError):
    """Thiếu config (cookies/inner_template) — user cần login + capture trước."""


def _gemini_config() -> dict:
    """Đọc phần persist từ config.json; raise RecapConfigError nếu thiếu."""
    g = read_config().get("gemini", {})
    cookies = g.get("cookies", "")
    inner = g.get("inner_template")
    if not cookies:
        raise RecapConfigError("Chưa có cookies Gemini — chạy /api/settings/gemini/login trước.")
    if not inner:
        raise RecapConfigError("Chưa có inner_template — chạy app.ai.gemini.capture trước.")
    return {
        "cookies": cookies,
        "inner_template": inner,
        "user_agent": g.get("user_agent") or DEFAULT_UA,
    }


def _auto_refresh_cookies() -> dict:
    """Tự động mở Chrome profile để refresh cookies Gemini và lưu vào config.json."""
    from app.ai.gemini.service import login_and_save_cookie

    _log("[Gemini] Đang tự động làm mới cookie Gemini qua Chrome profile...")
    res = login_and_save_cookie()
    if not res.get("has_cookie"):
        raise RuntimeError("Không lấy được cookie Gemini sau khi mở Chrome.")
    return _gemini_config()


def _fresh_tokens(client: httpx.Client, cookies: str, ua: str) -> tuple[str, str, str]:
    """GET /app → regex token fresh (at/bl/f.sid). Raise nếu cookie hết hạn."""
    r = client.get("https://gemini.google.com/app", headers={"User-Agent": ua, "Cookie": cookies})
    at_val = re.search(r'"SNlM0e":"(.*?)"', r.text)
    bl_val = re.search(r'"cfb2h":"(.*?)"', r.text)
    fsid_val = re.search(r'"FdrFJe":"(.*?)"', r.text)
    if not (at_val and bl_val and fsid_val):
        raise RuntimeError("Không lấy được token fresh (at/bl/f.sid) — cookie hết hạn? Re-login Gemini.")
    return at_val.group(1), bl_val.group(1), fsid_val.group(1)


def _upload_file(client: httpx.Client, content: bytes, name: str, cookies: str, ua: str) -> str:
    """Resumable upload (start + finalize) → trả gcs path (/contrib_service/...)."""
    common = {
        "User-Agent": ua,
        "Referer": "https://gemini.google.com/",
        "Origin": "https://gemini.google.com",
        "X-Tenant-Id": "bard-storage",
        "Push-ID": PUSH_ID,
        "X-Client-Pctx": X_CLIENT_PCTX,
        "Cookie": cookies,
    }
    r1 = client.post(
        "https://push.clients6.google.com/upload/",
        content=f"File name: {name}".encode("utf-8"),
        headers={
            **common,
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(len(content)),
        },
    )
    upload_url = r1.headers.get("x-goog-upload-url")
    if not upload_url:
        raise RuntimeError(f"upload start fail [{name}]: HTTP {r1.status_code} — {r1.text[:200]}")

    r2 = client.post(
        upload_url,
        content=content,
        headers={
            **common,
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
            "X-Goog-Upload-Command": "upload, finalize",
            "X-Goog-Upload-Offset": "0",
        },
    )
    gcs = r2.text.strip()
    if not gcs.startswith("/contrib_service"):
        raise RuntimeError(f"upload finalize fail [{name}]: HTTP {r2.status_code} — {r2.text[:200]}")
    return gcs


def _parse_stream_frames(raw: str) -> list:
    """Tách response streaming thành list payload JSON đã decode."""
    payloads = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line.startswith("[["):
            continue
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            continue
        for item in frame:
            if isinstance(item, list) and len(item) >= 3 and item[0] == "wrb.fr" and isinstance(item[2], str):
                try:
                    payloads.append(json.loads(item[2]))
                except json.JSONDecodeError:
                    pass
    return payloads


def _clean_citation_markers(obj: Any) -> Any:
    """Loại bỏ triệt để các ký tự trích dẫn nguồn của Gemini Web (ví dụ: [cite: 1], [cite: 1, 2], [1], v.v.)."""
    if isinstance(obj, str):
        # Loại bỏ [cite: 1], [cite: 1, 2], [cite: 1,2,3]
        cleaned = re.sub(r"\[cite:\s*[\d,\s]+\]", "", obj)
        # Chuẩn hóa khoảng trắng bị thừa sau khi bỏ cite
        cleaned = re.sub(r"\s{2,}", " ", cleaned)
        return cleaned.strip()
    elif isinstance(obj, dict):
        return {k: _clean_citation_markers(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_clean_citation_markers(item) for item in obj]
    return obj


def _normalize_recap_dict(data: dict) -> dict:
    """Chuẩn hóa recap dict: loại bỏ citation tags, làm sạch link markdown [url](url) nếu có, chuẩn hoá caption."""
    # 1. Làm sạch toàn bộ citation tags ([cite: 1], ...) trong toàn bộ cấu trúc dict
    data = _clean_citation_markers(data)

    if "video_url" in data and isinstance(data["video_url"], str):
        m = re.search(r"https?://[^\s\)\]]+", data["video_url"])
        if m:
            data["video_url"] = m.group(0)
    if "caption" in data and isinstance(data["caption"], dict):
        cap = data["caption"]
        if "title" in cap and isinstance(cap["title"], str):
            cap["title"] = cap["title"].strip()
        if "description" in cap and isinstance(cap["description"], str):
            cap["description"] = cap["description"].strip()
        if "hashtags" in cap:
            if isinstance(cap["hashtags"], list):
                cap["hashtags"] = [
                    (h.strip() if h.strip().startswith("#") else f"#{h.strip()}")
                    for h in cap["hashtags"]
                    if isinstance(h, str) and h.strip()
                ]
            elif isinstance(cap["hashtags"], str):
                cap["hashtags"] = [
                    (h.strip() if h.strip().startswith("#") else f"#{h.strip()}")
                    for h in cap["hashtags"].split()
                    if h.strip()
                ]
    return data


def _extract_json_from_candidates(candidates: list[str]) -> dict | None:
    """Parser JSON đa tầng với regex start scan và auto-healing closing brackets."""
    if not candidates:
        return None

    # 1. Thử khối code fence markdown ```json ... ```
    for txt in sorted(candidates, key=len, reverse=True):
        if "```json" in txt:
            start = txt.find("```json")
            end = txt.rfind("```")
            if start != -1 and end > start:
                try:
                    return json.loads(txt[start + len("```json"):end].strip())
                except json.JSONDecodeError:
                    pass
        if "```" in txt:
            start = txt.find("```")
            end = txt.rfind("```")
            if start != -1 and end > start:
                try:
                    c = txt[start + 3:end].strip()
                    if c.startswith("json"):
                        c = c[4:].strip()
                    return json.loads(c)
                except json.JSONDecodeError:
                    pass

    # 2. Quét tất cả start indices và thử auto-healing
    suffixes = [
        "",
        "\n}",
        "\n  ]\n}",
        "\n        }\n      ]\n    }\n  ]\n}",
        "\n      ]\n    }\n  ]\n}",
        "\n    }\n  ]\n}",
        "\n  ]\n}",
        "\n}",
    ]
    for txt in sorted(candidates, key=len, reverse=True):
        start_indices = [
            m.start() for m in re.finditer(r'\{\s*\"(chunk_index|scenes|caption|title|chunk_summary_for_next|video_url)', txt)
        ]
        if not start_indices:
            start_indices = [m.start() for m in re.finditer(r'\{', txt)]

        for s_idx in reversed(start_indices):
            chunk = txt[s_idx:]
            e_idx = chunk.rfind("}")
            if e_idx != -1:
                sub = chunk[:e_idx + 1]
                try:
                    data = json.loads(sub)
                    if isinstance(data, dict) and ("scenes" in data or "title" in data or "chunk_index" in data or "caption" in data):
                        return data
                except json.JSONDecodeError:
                    pass

            last_positions = [m.start() for m in re.finditer(r"[\}\]]", chunk)]
            for end_pos in reversed(last_positions[-30:]):
                candidate = chunk[:end_pos + 1]
                for suffix in suffixes:
                    try:
                        data = json.loads(candidate + suffix)
                        if isinstance(data, dict) and ("scenes" in data or "title" in data or "chunk_index" in data or "caption" in data):
                            return data
                    except json.JSONDecodeError:
                        pass

    return None


def _call_gemini_stream(
    prompt_text: str,
    filename: str,
    query_text: str = "Tạo kịch bản JSON theo nội dung trong file đính kèm.",
    allow_refresh: bool = True,
    status_callback: Callable[[str], None] | None = None,
    backoff_sec: int = 30,
) -> str:
    """Upload prompt text lên Gemini GCS và gọi StreamGenerate lấy response stream thô.

    Tự động xử lý:
    1. HTTP 429 / Rate Limit: Tạm dừng 30–45s, thông báo qua status_callback và retry êm ái.
    2. HTTP 401/403 hoặc Auth hết hạn ngầm: Tự động refresh cookies và retry.
    """
    cfg = _gemini_config()
    cookies, inner_template, ua = cfg["cookies"], cfg["inner_template"], cfg["user_agent"]

    with httpx.Client(http2=False, timeout=180, follow_redirects=True) as client:
        try:
            at_val, bl_val, fsid_val = _fresh_tokens(client, cookies, ua)
        except Exception as exc:
            if allow_refresh:
                _log(f"[Gemini] Refreshing cookies: {exc}")
                if status_callback:
                    status_callback("refreshing_cookie")
                _auto_refresh_cookies()
                if status_callback:
                    status_callback("running")
                return _call_gemini_stream(
                    prompt_text, filename, query_text, allow_refresh=False, status_callback=status_callback
                )
            raise

        prompt_bytes = prompt_text.encode("utf-8")
        try:
            gcs_prompt = _upload_file(client, prompt_bytes, filename, cookies, ua)
        except Exception as exc:
            if allow_refresh:
                _log(f"[Gemini] Upload file auth fail ({exc}). Refreshing cookies...")
                if status_callback:
                    status_callback("refreshing_cookie")
                _auto_refresh_cookies()
                if status_callback:
                    status_callback("running")
                return _call_gemini_stream(
                    prompt_text, filename, query_text, allow_refresh=False, status_callback=status_callback
                )
            raise

        attachments = [
            [[gcs_prompt, 3, None, "text/plain"], filename, None, None, None, None, None, None, [0]]
        ]

        inner = copy.deepcopy(inner_template)
        # Sử dụng câu lệnh chỉ đạo trực tiếp thay vì link YouTube để tránh Gemini Web kích hoạt YouTube/Search Tool ngầm gây xung đột & lỗi
        inner[0] = [query_text, 0, None, attachments, None, None, 0]
        nj = json.dumps(
            [None, json.dumps(inner, ensure_ascii=False, separators=(",", ":"))],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        enc = urllib.parse.quote(nj, safe="")
        body = "f.req=" + enc + "&at=" + urllib.parse.quote_plus(at_val) + "&"

        url_stream = (
            "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
            f"?bl={bl_val}&f.sid={fsid_val}&hl=vi&_reqid=100000&rt=c"
        )

        resp = client.post(
            url_stream,
            content=body,
            headers={
                "User-Agent": ua,
                "Cookie": cookies,
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "Origin": "https://gemini.google.com",
                "Referer": "https://gemini.google.com/",
                "X-Same-Domain": "1",
            },
            timeout=180,
        )

        rr_text_lower = resp.text[:500].lower()
        _RATE_LIMIT_MARKERS = (
            "rate limit",
            "too many requests",
            "resource exhausted",
            "quota exceeded",
        )
        is_rate_limit = (resp.status_code == 429) or any(m in rr_text_lower for m in _RATE_LIMIT_MARKERS)

        if is_rate_limit:
            _log(f"[Gemini] Quá tải / Rate Limit (HTTP {resp.status_code}). Tự động tạm dừng {backoff_sec}s rồi thử lại...")
            if status_callback:
                status_callback(f"rate_limited:{backoff_sec}")
            time.sleep(backoff_sec)
            if status_callback:
                status_callback("running")
            return _call_gemini_stream(
                prompt_text,
                filename,
                query_text,
                allow_refresh=allow_refresh,
                status_callback=status_callback,
                backoff_sec=min(backoff_sec + 15, 60),
            )

        _SILENT_AUTH_MARKERS = (
            "unauthenticated",
            "sign in to continue",
            "please sign in",
            "session expired",
            "login required",
        )
        is_auth_fail_silent = any(m in rr_text_lower for m in _SILENT_AUTH_MARKERS)
        is_http_auth_fail = resp.status_code in (401, 403)
        has_error_frame = '"er"' in resp.text[:200]

        if resp.status_code != 200 or has_error_frame or is_auth_fail_silent:
            if allow_refresh and (is_http_auth_fail or is_auth_fail_silent):
                _log(f"[Gemini] StreamGenerate auth fail ({resp.status_code}). Refreshing...")
                if status_callback:
                    status_callback("refreshing_cookie")
                _auto_refresh_cookies()
                if status_callback:
                    status_callback("running")
                return _call_gemini_stream(
                    prompt_text, filename, query_text, allow_refresh=False, status_callback=status_callback
                )
            raise RuntimeError(f"Gemini StreamGenerate fail: HTTP {resp.status_code} — {resp.text[:300]}")

        return resp.text


def _parse_gemini_response(resp_text: str) -> dict:
    """Tách stream frames và trích xuất JSON dict hoàn chỉnh."""
    payloads = _parse_stream_frames(resp_text)
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

    if not candidates:
        raise ValueError("Không tìm thấy candidate response từ Gemini stream.")

    data = _extract_json_from_candidates(candidates)
    if data is None:
        raise ValueError(f"Không thể parse JSON từ candidate: {candidates[0][:300]}")
    return _normalize_recap_dict(data)


def _ensure_intro_and_outro(scenes: list[dict[str, Any]]) -> None:
    """Đảm bảo phân cảnh đầu tiên luôn có lời chào mở màn và phân cảnh cuối cùng luôn có lời cảm ơn & CTA."""
    if not scenes:
        return

    flat_segs = []
    for s in scenes:
        for seg in s.get("segments", []):
            if isinstance(seg, dict) and "vietnamese_vo" in seg:
                flat_segs.append(seg)

    if not flat_segs:
        return

    # 1. Kiểm tra Segment đầu tiên (Intro Greeting)
    first_vo = flat_segs[0].get("vietnamese_vo", "").strip()
    first_vo_lower = first_vo.lower()
    intro_keywords = ("chào", "hello", "hé lô", "quay trở lại", "hôm nay cùng mình", "theo chân mình")
    if not any(kw in first_vo_lower for kw in intro_keywords):
        flat_segs[0]["vietnamese_vo"] = f"Chào cả nhà đã quay trở lại với kênh ẩm thực độc lạ! {first_vo}"

    # 2. Kiểm tra Segment cuối cùng (Outro Thank You & CTA)
    last_vo = flat_segs[-1].get("vietnamese_vo", "").strip()
    last_vo_lower = last_vo.lower()
    outro_keywords = ("cảm ơn", "theo dõi", "follow", "thả tim", "hẹn gặp lại", "tạm biệt", "like", "chia sẻ")
    if not any(kw in last_vo_lower for kw in outro_keywords):
        outro_tail = " Cảm ơn các bạn đã theo dõi hành trình ẩm thực hôm nay, nhớ bấm like và follow kênh để không bỏ lỡ những món ngon tiếp theo nhé! Hẹn gặp lại mọi người!"
        flat_segs[-1]["vietnamese_vo"] = (last_vo.rstrip(".!?") + "." + outro_tail).strip()


def generate_recap(
    youtube_url: str,
    raw_bytes: bytes | str | dict,
    raw_name: str = "raw.txt",
    prompt_bytes: bytes | None = None,
    prompt_name: str | None = None,
    prompt_template_path: Path | None = None,
    caption_template_path: Path | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
    status_callback: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Tạo recap hoàn chỉnh qua kiến trúc phân chunk động đa giai đoạn (Step 0 -> Step 1 -> Step 2 -> Step 2b)."""
    chunk_tpl_path = prompt_template_path or DEFAULT_CHUNK_PROMPT_PATH
    caption_tpl_path = caption_template_path or DEFAULT_CAPTION_PROMPT_PATH

    if not chunk_tpl_path.exists():
        old_prompt = TOOLS_DIR / "Backend" / "prompts" / "System Prompt Food Review Recap.txt"
        if old_prompt.exists():
            chunk_tpl_path = old_prompt
        else:
            raise FileNotFoundError(f"Không tìm thấy chunk prompt template: {chunk_tpl_path}")

    chunk_tpl = chunk_tpl_path.read_text(encoding="utf-8")
    caption_tpl = caption_tpl_path.read_text(encoding="utf-8") if caption_tpl_path.exists() else ""

    # 1. Step 0: Preprocessing & Dynamic Chunking
    _log(f"[Recap Engine] Bắt đầu Step 0: Tiền xử lý transcript cho {youtube_url}...")
    entries = extract_transcript_entries(raw_bytes)
    if not entries:
        raise ValueError("Không trích xuất được dòng đối thoại nào từ transcript đầu vào.")

    chunks = build_dynamic_chunks(entries, youtube_url)
    total_chunks = len(chunks)
    _log(f"[Recap Engine] Đã phân tích thành {total_chunks} chunks động (Tổng: {entries[-1]['start_sec']}s).")

    # 2. Step 1: Process Each Chunk with Context Chaining
    chunk_outputs: list[dict[str, Any]] = []
    previous_summary = ""

    for idx, c in enumerate(chunks):
        c_idx = c["chunk_index"]
        _log(f"\n[Recap Engine] --- Xử lý Chunk {c_idx + 1}/{total_chunks} [{c['chunk_start_sec']}s - {c['chunk_end_sec']}s] ---")
        _log(f"[Recap Engine] Segment Quota: {c['target_segments_min']} - {c['target_segments_max']} segs.")

        # Điền placeholders vào template
        filled_prompt = chunk_tpl
        filled_prompt = filled_prompt.replace("{{video_url}}", str(c["video_url"]))
        filled_prompt = filled_prompt.replace("{{chunk_index}}", str(c["chunk_index"]))
        filled_prompt = filled_prompt.replace("{{total_chunks}}", str(c["total_chunks"]))
        filled_prompt = filled_prompt.replace("{{chunk_start_sec}}", str(c["chunk_start_sec"]))
        filled_prompt = filled_prompt.replace("{{chunk_end_sec}}", str(c["chunk_end_sec"]))
        filled_prompt = filled_prompt.replace("{{is_first_chunk}}", "true" if c["is_first_chunk"] else "false")
        filled_prompt = filled_prompt.replace("{{is_last_chunk}}", "true" if c["is_last_chunk"] else "false")
        filled_prompt = filled_prompt.replace(
            "{{previous_chunk_summary}}",
            previous_summary or "(None - this is the first chunk)",
        )
        filled_prompt = filled_prompt.replace("{{target_segments_min}}", str(c["target_segments_min"]))
        filled_prompt = filled_prompt.replace("{{target_segments_max}}", str(c["target_segments_max"]))
        filled_prompt = filled_prompt.replace("{{raw_text}}", c["raw_text"])

        # Chỉ dẫn chi tiết cho từng vị trí chunk
        if c["is_first_chunk"] and c["is_last_chunk"]:
            chunk_task_note = "LƯU Ý: Phân cảnh đầu tiên BẮT BUỘC có lời chào Intro, phân cảnh cuối cùng BẮT BUỘC có lời cảm ơn và kêu gọi follow kênh (Outro CTA)."
        elif c["is_first_chunk"]:
            chunk_task_note = "LƯU Ý: Đây là chunk ĐẦU TIÊN (is_first_chunk=true), phân cảnh đầu tiên BẮT BUỘC phải mở màn bằng lời chào Intro cuốn hút."
        elif c["is_last_chunk"]:
            chunk_task_note = "LƯU Ý: Đây là chunk CUỐI CÙNG (is_last_chunk=true), phân cảnh cuối cùng BẮT BUỘC phải có lời cảm ơn người xem và kêu gọi like/follow kênh (Outro CTA)."
        else:
            chunk_task_note = "Nối tiếp mượt mà từ chunk trước."

        chunk_json = None
        for attempt in range(1, 4):
            try:
                resp_text = _call_gemini_stream(
                    prompt_text=filled_prompt,
                    filename=f"chunk_{c_idx}_prompt.txt",
                    query_text=f"Tạo kịch bản recap ẩm thực JSON cho chunk {c_idx + 1}/{total_chunks} theo dữ liệu trong file đính kèm. {chunk_task_note}",
                    status_callback=status_callback,
                )
                chunk_json = _parse_gemini_response(resp_text)
                if chunk_json and chunk_json.get("scenes"):
                    break
            except Exception as ex:
                _log(f"[Recap Engine] Chunk {c_idx + 1} thử lần {attempt}/3 thất bại ({ex}). Thử lại...")
                time.sleep(2)

        if not chunk_json:
            raise RuntimeError(f"Xử lý chunk {c_idx + 1}/{total_chunks} thất bại sau 3 lần thử.")

        scenes_count = len(chunk_json.get("scenes", []))
        segs_count = sum(len(s.get("segments", [])) for s in chunk_json.get("scenes", []))
        _log(f"[Recap Engine] [OK] Chunk {c_idx + 1} hoàn tất: {scenes_count} scenes, {segs_count} segments.")

        chunk_outputs.append(chunk_json)
        previous_summary = chunk_json.get("chunk_summary_for_next", "")

        if progress_callback:
            try:
                progress_callback(idx + 1, total_chunks)
            except Exception:
                pass

        if idx < total_chunks - 1:
            time.sleep(2)

    # 3. Step 2: Merge All Chunks & Ensure Intro/Outro Guarantee
    _log("\n[Recap Engine] Bắt đầu Step 2: Ghép nối các scenes và kiểm tra tính liên tục...")
    merged_recap = merge_chunk_outputs(chunk_outputs, youtube_url)
    all_scenes = merged_recap.get("scenes", [])

    # Đảm bảo 100% video luôn có lời chào mở màn và lời cảm ơn kết bài
    _ensure_intro_and_outro(all_scenes)

    total_segments = sum(len(s.get("segments", [])) for s in all_scenes)
    _log(f"[Recap Engine] Hợp nhất thành công: {len(all_scenes)} scenes, {total_segments} segments.")

    # 4. Step 2b: Generate Social Caption & Hashtags
    caption_dict = {
        "title": f"Review Ẩm Thực {youtube_url}",
        "description": "Video recap ẩm thực đặc sắc.",
        "hashtags": ["#reviewamthuc", "#foodreview", "#monngon"],
    }
    if caption_tpl and all_scenes:
        _log("[Recap Engine] Bắt đầu Step 2b: Sinh Caption SEO & Hashtags...")
        scene_titles_text = extract_scene_titles(merged_recap)
        if scene_titles_text:
            caption_prompt = caption_tpl.replace("{{scene_titles_joined_by_newline}}", scene_titles_text)
            try:
                cap_resp = _call_gemini_stream(
                    prompt_text=caption_prompt,
                    filename="caption_prompt.txt",
                    query_text="Tạo tiêu đề, mô tả và hashtags SEO theo danh sách tiêu đề cảnh trong file đính kèm.",
                    status_callback=status_callback,
                )
                cap_parsed = _parse_gemini_response(cap_resp)
                if cap_parsed and isinstance(cap_parsed, dict):
                    if "caption" in cap_parsed and isinstance(cap_parsed["caption"], dict):
                        caption_dict = cap_parsed["caption"]
                    elif "title" in cap_parsed:
                        caption_dict = cap_parsed
            except Exception as cap_err:
                _log(f"[Recap Engine] Warning: Sinh caption thất bại ({cap_err}), dùng caption mặc định.")

    # 5. Hoàn tất cấu trúc Recap
    final_recap = {
        "video_url": youtube_url,
        "caption": caption_dict,
        "scenes": all_scenes,
    }

    # Ghi response ra file response.txt để inspect
    try:
        (TOOLS_DIR / "response.txt").write_text(json.dumps(final_recap, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass

    return final_recap
