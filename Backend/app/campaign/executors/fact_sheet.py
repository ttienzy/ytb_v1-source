"""Executor `fact_sheet` (Hồ sơ áo): Gemini nhìn ảnh áo thật -> hồ sơ có cấu trúc + điểm rủi ro tính tại chỗ.

Điểm rủi ro KHÔNG lấy từ Gemini mà tính bằng luật cố định (docs/AI_WORKFLOW_FASHION_DESIGN.md §6), nên người dùng
sửa hồ sơ thì điểm tính lại. Luật chỉ là điểm khởi đầu; chưa kiểm chứng trên nhiều áo thật.
"""
from __future__ import annotations

from typing import Any

from ..prompts import PromptLibrary
from . import llm
from ..runner import ArtifactSpec, ExecContext, ExecResult

DEFAULT_TEMPLATE = "system:fact_sheet"

PATTERNS = ("solid", "small_print", "stripes", "large_print", "lace", "sheer", "glossy", "other")
TEXT_FIELDS = ("category", "color", "material", "fit", "length", "neckline", "sleeves", "logo_text", "sizes",
               "summary", "summary_vi")
LIST_FIELDS = ("details", "do_not_say")
LEVELS = ("low", "medium", "high")


FactSheetError = llm.LlmJsonError


class FactSheetInputError(ValueError):
    pass


# ── dựng yêu cầu (dùng chung cho xem trước và lúc chạy) ────────────────────────
def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, list[dict[str, Any]]],
                  note: str = "") -> dict[str, Any]:
    garments = inputs.get("garment_source") or []
    if not garments:
        raise FactSheetInputError("Chưa có ảnh sản phẩm.")
    pref = params.get("prompt") or {}
    rendered = prompts.render(pref.get("template_id") or DEFAULT_TEMPLATE, version=pref.get("version"),
                              changes=str(pref.get("changes") or "").strip(), ref_paths=[g["path"] for g in garments])
    rendered["ref_order"] = [
        {"role": g.get("role") or f"photo{i + 1}", "label": f"Ảnh {i + 1}", "path": g["path"], "artifact_id": g["artifact_id"]}
        for i, g in enumerate(garments)
    ]
    rendered["warnings"] = [w for w in rendered["warnings"] if w["code"] not in ("ref_count_mismatch", "too_many_refs")]
    return rendered


# ── parse + chuẩn hóa ──────────────────────────────────────────────────────────
extract_json = llm.extract_json


def _text(v: Any) -> str:
    return "" if v is None else str(v).strip()


def _items(v: Any) -> list[str]:
    if isinstance(v, str):
        v = [v]
    out: list[str] = []
    for item in v if isinstance(v, list) else []:
        s = _text(item)
        if s and s not in out:
            out.append(s)
    return out


def compute_risk(g: dict[str, Any]) -> dict[str, Any]:
    """Luật rủi ro -> {level, reasons, motion_limit, logo_rule}. level cao hơn = hạn chế chuyển động nhiều hơn."""
    level = 0
    reasons: list[str] = []
    pattern = g.get("pattern") or "other"
    if pattern in ("small_print", "stripes"):
        level = max(level, 1)
        reasons.append("Họa tiết nhỏ/kẻ sọc dễ biến dạng khi xoay người")
    elif pattern == "large_print":
        level = max(level, 1)
        reasons.append("Họa tiết lớn dễ đổi bố cục khi xoay")
    elif pattern in ("lace", "sheer", "glossy"):
        level = max(level, 2)
        reasons.append("Ren/trong suốt/vải bóng: AI khó giữ chất liệu, nên dùng cận ảnh thật")
    elif pattern == "other":
        level = max(level, 1)
        reasons.append("Họa tiết không phân loại được")
    logo = bool(g.get("logo_present"))
    if logo:
        level = max(level, 2 if pattern != "solid" else 1)
        reasons.append("Có logo/chữ: chỉ dùng logo từ ảnh thật, không để AI vẽ lại")
    motion = ("free", "gentle", "minimal")[level]
    return {"level": LEVELS[level], "reasons": reasons, "motion_limit": motion,
            "logo_rule": "reference_only" if logo else "none"}


def normalize(data: dict[str, Any]) -> dict[str, Any]:
    """Ép kiểu, điền mặc định, tính lại rủi ro và các điều 'không được nói' tự động. Dùng cả khi người dùng sửa tay."""
    g: dict[str, Any] = {k: _text(data.get(k)) for k in TEXT_FIELDS}
    for k in LIST_FIELDS:
        g[k] = _items(data.get(k))
    pattern = _text(data.get("pattern")).lower().replace(" ", "_")
    g["pattern"] = pattern if pattern in PATTERNS else "other"
    logo = data.get("logo_present")
    g["logo_present"] = logo if isinstance(logo, bool) else _text(logo).lower() in ("true", "yes", "có", "1")
    if g["logo_present"] and not g["logo_text"]:
        g["logo_text"] = "unknown"
    auto = []
    if g["logo_present"]:
        auto.append("Không khẳng định hàng chính hãng/thương hiệu nếu logo thuộc bên thứ ba")
    for claim in auto:
        if claim not in g["do_not_say"]:
            g["do_not_say"].append(claim)
    g["risk"] = compute_risk(g)
    return g


# ── executor ───────────────────────────────────────────────────────────────────
def _gemini(prompt: str, image_paths: list[str]) -> tuple[str, str]:
    return llm.call_llm(prompt, image_paths)


def run_fact_sheet(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, ctx.params, ctx.inputs, ctx.note)
    raw, provider = _gemini(req["prompt"], [s["path"] for s in req["ref_order"]])
    garment = normalize(extract_json(raw))
    return ExecResult([ArtifactSpec(
        "json", json=garment,
        meta={"provider": provider, "template": req["template"], "prompt": req["prompt"],
              "refs": [s["artifact_id"] for s in req["ref_order"]], "raw": raw[:4000]},
    )])
