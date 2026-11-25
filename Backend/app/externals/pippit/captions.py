"""AI viết caption hàng loạt cho video sắp đăng (Gemini web, 0 credit Flow/Muse). Một lượt cho cả lô, không tự gửi lại."""
from __future__ import annotations

import json
import re
from typing import Any

from app.externals.pippit.client import smart_truncate

MAX_BATCH = 15
MAX_TITLE = 90
MAX_CAPTION = 1800
MAX_TAGS = 8
DISCLOSURE = {"vi": "Hình ảnh trong video được tạo bằng AI.", "en": "Visuals in this video were generated with AI."}
TONES = {
    "sales_tiktok": "bán hàng TikTok Shop: mở bằng nỗi đau/lợi ích rõ, câu ngắn, có CTA nhẹ hướng về giỏ hàng",
    "storytelling": "kể chuyện tự nhiên, gần gũi, như người thật chia sẻ, không sáo rỗng",
    "trendy_short": "ngắn gọn bắt trend, 1-2 câu, giàu cảm xúc, dễ dừng lại xem",
    "review": "review chân thật, nêu điểm nổi bật cụ thể, không phóng đại, không hứa điều video không thể hiện",
}


class CaptionError(RuntimeError):
    """Gemini không trả được caption dùng được."""


def _call_llm(prompt: str) -> dict[str, Any]:
    from app.campaign.executors import llm
    data, _raw, _provider = llm.call_llm_json(prompt, retries=1)
    return data


def build_prompt(items: list[dict[str, Any]], *, tone: str, extra_brief: str, language: str) -> str:
    lines = []
    for i, it in enumerate(items, 1):
        lines.append(json.dumps({
            "n": i, "uid": it["uid"], "platform": it.get("platform") or "tiktok",
            "video_name": (it.get("title") or "")[:120], "context": (it.get("context_text") or "")[:500],
            "current_caption": (it.get("existing_caption") or "")[:300],
        }, ensure_ascii=False))
    tone_text = TONES.get(tone, TONES["sales_tiktok"])
    lang = "Vietnamese" if language == "vi" else "English"
    return (
        "You write social video captions for Vietnamese short-video channels (TikTok / Facebook Reels).\n"
        f"Write in {lang}. Style: {tone_text}.\n"
        f"EXTRA BRIEF FROM OWNER: {extra_brief.strip() or '(none)'}\n"
        "RULES:\n"
        "- One entry per video below, keep the same uid.\n"
        "- Every video MUST use a clearly DIFFERENT angle, opening line and hashtag mix (platforms penalise duplicated captions).\n"
        "- Base the text ONLY on the context given; never invent prices, discounts, materials or claims, never fake testimonials.\n"
        f"- title: max {MAX_TITLE} chars, no hashtags. caption: 1-3 short lines, no hashtags inside. hashtags: 4-{MAX_TAGS} items, each starting with #.\n"
        "- Never use the raw file name as the caption.\n"
        f"VIDEOS (one JSON per line):\n" + "\n".join(lines) + "\n"
        'Return ONLY JSON: {"items":[{"uid":"...","title":"...","caption":"...","hashtags":["#..."]}]}\n'
    )


def _clean_tags(raw: Any) -> list[str]:
    seq = raw if isinstance(raw, list) else re.split(r"[\s,]+", str(raw or ""))
    out: list[str] = []
    for t in seq:
        t = re.sub(r"\s+", "", str(t or ""))
        if not t or t == "#":
            continue
        t = t if t.startswith("#") else f"#{t}"
        if t.lower() not in {x.lower() for x in out}:
            out.append(t)
    return out[:MAX_TAGS]


def normalize(items: list[dict[str, Any]], data: dict[str, Any], *, include_ai_disclosure: bool, language: str) -> dict[str, Any]:
    raw_list = data.get("items") if isinstance(data, dict) else None
    if not isinstance(raw_list, list) or not raw_list:
        raise CaptionError("Gemini không trả về danh sách caption hợp lệ.")
    by_uid = {str(r.get("uid")): r for r in raw_list if isinstance(r, dict) and r.get("uid")}
    disclosure = DISCLOSURE.get(language, DISCLOSURE["vi"])
    out, missing = [], []
    for idx, it in enumerate(items):
        r = by_uid.get(it["uid"])
        if r is None and idx < len(raw_list) and isinstance(raw_list[idx], dict) and not raw_list[idx].get("uid"):
            r = raw_list[idx]
        caption = str((r or {}).get("caption") or "").strip()
        if not caption:
            missing.append(it["uid"])
            continue
        tags = _clean_tags((r or {}).get("hashtags"))
        title = smart_truncate(str(r.get("title") or caption.splitlines()[0]).strip(), MAX_TITLE)
        caption = smart_truncate(caption, MAX_CAPTION)
        parts = [caption, " ".join(tags)]
        if include_ai_disclosure:
            parts.append(disclosure)
        out.append({"uid": it["uid"], "title": title, "caption": caption, "hashtags": tags,
                    "full_text": "\n\n".join(p for p in parts if p)})
    if not out:
        raise CaptionError("Gemini không viết được caption nào dùng được. Thử lại hoặc nhập tay.")
    return {"items": out, "missing": missing}


def generate_batch_captions(items: list[dict[str, Any]], *, tone: str = "sales_tiktok", extra_brief: str = "",
                            include_ai_disclosure: bool = False, language: str = "vi") -> dict[str, Any]:
    if not items:
        raise CaptionError("Chưa chọn video nào để viết caption.")
    if len(items) > MAX_BATCH:
        raise CaptionError(f"Mỗi lượt chỉ viết tối đa {MAX_BATCH} video (đang chọn {len(items)}). Chia thành nhiều lượt.")
    prompt = build_prompt(items, tone=tone, extra_brief=extra_brief, language=language)
    try:
        data = _call_llm(prompt)
    except CaptionError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise CaptionError(f"Gemini lỗi: {exc}. Kiểm tra tài khoản Gemini ở Cài đặt rồi thử lại (không tự gửi lại).") from exc
    return normalize(items, data, include_ai_disclosure=include_ai_disclosure, language=language)
