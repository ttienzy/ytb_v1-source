"""Hàm dùng chung của các executor v3: đọc đầu vào, nhân vật (cách gọi), phong cách, luật lời thoại, tạo ảnh ChatGPT."""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

from ..prompts import has_fake_testimonial
from ..runner import ArtifactSpec, ExecContext

MOTION_RANK = {"minimal": 0, "gentle": 1, "free": 2}
MOTION_BY_RANK = {v: k for k, v in MOTION_RANK.items()}
ASPECT_LABEL = {"9:16": "vertical 9:16", "16:9": "horizontal 16:9"}
LOGO_RULE = "The garment has a logo/text: reproduce it exactly as in the references; never redraw, translate or alter it."
# Khi người dùng chưa điền phong cách: mặc định trung tính để prompt không có dòng rỗng.
STYLE_DEFAULTS = {
    "lighting": "soft natural daylight with a gentle rim light that separates the subject from the background",
    "palette": "keep the garment's real colors",
    "dont": "extra text, watermarks, other brand logos, altering the garment's logo or color",
}
# Cách gọi nhân vật trong prompt tiếng Anh (hồ sơ nhân vật `presentation`); mặc định trung tính.
PRESENTATIONS = {"woman": "woman", "man": "man", "person": "person"}
AUTHENTICITY = re.compile(r"chính hãng|authentic|genuine|hàng hiệu|auth\b", re.I)
# Lời hứa "biến hình/trước-sau/đồ khác" mà pipeline KHÔNG thể thể hiện: chỉ có MỘT bộ đồ trong ảnh.
UNVISUALIZABLE = re.compile(
    r"lột xác|biến hình|thay đổi diện mạo|trước\s*(?:và|/|-)\s*sau|đồ ở nhà|bình thường thế này|từ bình thường|"
    r"(?<!\w)before(?!\w)\s*(?:and|/|&|-)\s*(?<!\w)after(?!\w)|(?<!\w)transform(?:s|ation|ing)?(?!\w)|(?<!\w)transitions? into(?!\w)|"
    r"(?<!\w)changes? into(?!\w)|plain homewear|swaps? outfit|outfit change|thay đồ", re.I)

# Luật lời thoại tiếng Việt: đo trên giọng VieNeu thật (chiến dịch 5d27a03c3a42): 13–14 âm tiết = 3,3–3,9 giây ≈ 3,6–4,0 âm tiết/giây.
SYLLABLES_PER_SECOND = 3.7
SYLLABLE_TOLERANCE = 0.15


def max_syllables(seconds: float) -> int:
    return max(1, round(float(seconds) * SYLLABLES_PER_SECOND * (1 + SYLLABLE_TOLERANCE)))


def syllables(text: str) -> int:
    """Tiếng Việt: mỗi tiếng là một từ cách nhau bằng khoảng trắng; tiếng Anh: đếm từ (xấp xỉ)."""
    return len(re.findall(r"[\w'’-]+", text or "", re.UNICODE))


def s(v: Any) -> str:
    return "" if v is None else str(v).strip()


def load_input(inputs: dict[str, list[dict[str, Any]]], dep: str) -> dict[str, Any]:
    """Nội dung đầu vào `dep`: tham số (bước input_params), phần tử (bước map) hoặc JSON của artifact."""
    refs = inputs.get(dep) or []
    if not refs:
        return {}
    ref = refs[0]
    if "params" in ref:
        return dict(ref["params"])
    if "item" in ref:
        return dict(ref["item"])
    try:
        data = json.loads(Path(ref["path"]).read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        return {}
    return data if isinstance(data, dict) else {}


def presentation_of(inputs: dict[str, list[dict[str, Any]]]) -> str:
    p = s(load_input(inputs, "cast_profile").get("presentation")).lower()
    return PRESENTATIONS.get(p, "person")


def style_of(inputs: dict[str, list[dict[str, Any]]]) -> dict[str, str]:
    style = load_input(inputs, "style")
    return {k: (s(style.get(k)) or STYLE_DEFAULTS[k]) for k in STYLE_DEFAULTS}


def garment_of(inputs: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    return load_input(inputs, "fact_sheet")


def garment_vars(garment: dict[str, Any]) -> dict[str, Any]:
    risk = garment.get("risk") or {}
    return {"garment": {"summary": s(garment.get("summary")) or "the garment shown in the reference images"},
            "logo_rule": LOGO_RULE if risk.get("logo_rule") == "reference_only" else ""}


def garment_photo(inputs: dict[str, list[dict[str, Any]]], role: str = "front") -> dict[str, Any] | None:
    """Ảnh áo theo vai (front/detail/back); không có vai đó thì ảnh mặt trước, rồi ảnh đầu tiên."""
    photos = inputs.get("garment_source") or []
    for want in (role, "front"):
        hit = next((p for p in photos if p.get("role") == want), None)
        if hit is not None:
            return hit
    return photos[0] if photos else None


def identity_photo(inputs: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    cast = inputs.get("cast") or []
    return next((c for c in cast if c.get("role") == "identity"), cast[0] if cast else None)


def changes_with_note(params: dict[str, Any], note: str) -> str:
    pref = params.get("prompt") or {}
    changes = s(pref.get("changes"))
    if s(note):  # ghi chú từ lần từ chối cổng trước đi vào prompt lần chạy lại
        changes = (changes + "; " if changes else "") + "reviewer feedback: " + s(note)
    return changes


def template_pref(params: dict[str, Any], default: str) -> tuple[str, int | None]:
    pref = params.get("prompt") or {}
    return str(pref.get("template_id") or default), pref.get("version")


def lint_text(fields: dict[str, str], garment: dict[str, Any]) -> list[dict[str, str]]:
    """Cảnh báo lời chứng giả ngôi thứ nhất, điều 'không được nói', và tuyên bố chính hãng cho áo có logo."""
    out: list[dict[str, str]] = []
    claims = [c.strip() for c in garment.get("do_not_say", []) if isinstance(c, str) and c.strip()]
    for label, text in fields.items():
        if not text:
            continue
        low = text.lower()
        if has_fake_testimonial(text):
            out.append({"where": label, "code": "fake_testimonial",
                        "message": f"{label}: lời chứng ngôi thứ nhất kiểu 'tôi đã mua/dùng' (rủi ro đánh giá giả)."})
        for claim in claims:
            if claim.lower() in low:
                out.append({"where": label, "code": "do_not_say", "message": f"{label}: nhắc tới điều không được nói: “{claim}”."})
        if garment.get("logo_present") and AUTHENTICITY.search(text):
            out.append({"where": label, "code": "authenticity",
                        "message": f"{label}: khẳng định hàng chính hãng/thương hiệu trong khi áo có logo của bên khác."})
    return out


# ── ảnh ChatGPT ───────────────────────────────────────────────────────────────
def image_client():
    from app.ai.image_gen.service import get_image_client
    return get_image_client()


def sniff_ext(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "png"


def generate_image(ctx: ExecContext, req: dict[str, Any], label: str, extra_meta: dict[str, Any] | None = None) -> ArtifactSpec:
    """Tạo MỘT ảnh ChatGPT theo prompt đã dựng (ref theo thứ tự `ref_order`) và trả ArtifactSpec kèm provenance."""
    tmp = ctx.store.campaign_dir(ctx.campaign_id) / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    dest = tmp / f"{label}_{uuid.uuid4().hex[:10]}.png"
    started = time.time()
    try:
        image_client().generate(prompt=req["prompt"], dest=str(dest), ref_paths=[r["path"] for r in req["ref_order"]] or None,
                                aspect=req["aspect"])
        data = dest.read_bytes()
    finally:
        dest.unlink(missing_ok=True)
    meta = {"prompt": req["prompt"], "template": req["template"], "aspect": req["aspect"],
            "refs": [r.get("artifact_id") for r in req["ref_order"]], "seconds": round(time.time() - started, 1)}
    meta.update(extra_meta or {})
    return ArtifactSpec("image", ext=sniff_ext(data), data=data, meta=meta)
