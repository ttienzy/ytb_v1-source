"""Gợi ý điền sẵn các form tham số (Brief, Phong cách) bằng Gemini từ ảnh áo + hồ sơ áo.

Đây KHÔNG phải bước của engine: kết quả không được lưu, chỉ trả về để giao diện điền vào ô trống cho người dùng xem
lại rồi bấm Lưu. Giá/khuyến mãi chỉ được điền khi Gemini đọc được trên ảnh (không bịa).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..prompts import PromptLibrary
from . import llm

MAX_LEN = 300


@dataclass(frozen=True)
class SuggestSpec:
    step: str
    template_id: str
    fields: tuple[str, ...]


SPECS: dict[str, SuggestSpec] = {
    "brief": SuggestSpec("brief", "system:brief_suggest", ("audience", "occasion", "price", "promo")),
    "style": SuggestSpec("style", "system:style_suggest", ("lighting", "background", "palette", "dont")),
}


def _clean(v: Any) -> str:
    return " ".join(str(v).split())[:MAX_LEN] if isinstance(v, (str, int, float)) else ""


def suggest(prompts: PromptLibrary, step: str, *, garment: dict[str, Any], brief: dict[str, Any],
            existing: dict[str, Any], image_paths: list[str]) -> dict[str, Any]:
    spec = SPECS[step]
    variables = {"garment": garment or "not analysed yet", "brief": brief or "not provided", "existing": existing or "empty"}
    rendered = prompts.render(spec.template_id, variables=variables)
    raw, provider = llm.call_llm(rendered["prompt"], image_paths)
    data = llm.extract_json(raw)
    suggestion = {k: _clean(data.get(k)) for k in spec.fields}
    return {"suggestion": suggestion, "note": _clean(data.get("note")), "provider": provider,
            "images": len(image_paths)}
