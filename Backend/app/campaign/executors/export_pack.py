"""Executor `export_pack` (Khối 6): gói đăng bài cho video đã ghép: caption + hashtag + dòng khai báo AI + checklist theo nền tảng. 0 credit, cục bộ.

Luật AI Việt Nam (hiệu lực 1/3/2026) và TikTok yêu cầu dán nhãn nội dung tạo bằng AI; gói xuất luôn kèm dòng khai báo và nhắc bật nhãn.
"""
from __future__ import annotations

from typing import Any

from ..runner import ArtifactSpec, ExecContext, ExecResult
from . import common

DISCLOSURE = {"vi": "Hình ảnh trong video được tạo bằng AI.", "en": "Visuals in this video were generated with AI."}
PLATFORM_NOTES: dict[str, list[str]] = {
    "tiktok": ["Bật nhãn “Nội dung do AI tạo” khi đăng (TikTok yêu cầu).", "Gắn sản phẩm từ TikTok Shop nếu có.",
               "Nếu dùng nhạc nền của TikTok, tải bản “không nhạc nền” ở menu Tải xuống."],
    "reels": ["Meta tự gắn “AI info”; vẫn ghi dòng khai báo trong caption.", "Đăng dọc 9:16, chữ nằm trong vùng an toàn."],
    "shopee": ["Shopee yêu cầu gắn nhãn nội dung AI; video gắn nhãn có thể không được tính hoa hồng (kiểm tra chính sách hiện hành).",
               "Đính kèm link sản phẩm trong phần mô tả."],
}
PLATFORM_LABEL = {"tiktok": "TikTok", "reels": "Facebook / Instagram Reels", "shopee": "Shopee Video"}


class ExportPackError(RuntimeError):
    pass


def build_pack(script: dict[str, Any], brief: dict[str, Any], video_meta: dict[str, Any]) -> dict[str, Any]:
    language = common.s(brief.get("language")) or "vi"
    platform = common.s(brief.get("platform")) or "tiktok"
    caption = common.s(script.get("caption"))
    tags = [t for t in (script.get("hashtags") or []) if common.s(t)]
    cta = common.s(script.get("cta"))
    disclosure = DISCLOSURE.get(language, DISCLOSURE["vi"])
    parts = [p for p in (caption, cta, " ".join(tags), disclosure) if p]
    checklist = [
        f"Video {video_meta.get('seconds', '?')} giây, {video_meta.get('size', '')}" + (" · đã có nhãn AI trong hình" if video_meta.get("ai_label") else " · chưa in nhãn AI lên hình"),
        "Lời thoại và chữ không hứa điều hình không thể hiện (đã lint ở Kịch bản).",
        *PLATFORM_NOTES.get(platform, PLATFORM_NOTES["tiktok"]),
    ]
    if common.s(brief.get("price")) or common.s(brief.get("promo")):
        checklist.append(f"Giá/khuyến mãi trong brief: {common.s(brief.get('price'))} {common.s(brief.get('promo'))}".strip() + " — kiểm tra lại trước khi đăng.")
    return {"platform": platform, "platform_label": PLATFORM_LABEL.get(platform, platform), "language": language,
            "caption": caption, "hashtags": tags, "cta": cta, "disclosure": disclosure,
            "post_text": "\n\n".join(parts), "checklist": checklist, "video_seconds": video_meta.get("seconds")}


def run_export_pack(ctx: ExecContext) -> ExecResult:
    videos = ctx.inputs.get("assemble") or []
    if not videos:
        raise ExportPackError("Chưa có video đã ghép.")
    script = common.load_input(ctx.inputs, "script")
    brief = common.load_input(ctx.inputs, "brief")
    pack = build_pack(script, brief, dict(videos[0].get("meta") or {}))
    return ExecResult([ArtifactSpec("json", json=pack, meta={"platform": pack["platform"]})])
