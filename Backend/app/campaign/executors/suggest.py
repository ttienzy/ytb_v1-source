"""Gợi ý điền sẵn các form tham số (Brief, Các cảnh + phong cách) bằng Gemini từ ảnh áo + hồ sơ áo + format đã chọn.

Đây KHÔNG phải bước của engine: kết quả không được lưu, chỉ trả về để giao diện điền vào ô trống cho người dùng xem
lại rồi bấm Lưu. Giá/khuyến mãi chỉ được điền khi Gemini đọc được trên ảnh (không bịa).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .. import formats
from ..prompts import PromptLibrary
from . import llm

MAX_LEN = 300
SCENE_FIELDS = ("name", "place", "time", "light", "mood", "action")


@dataclass(frozen=True)
class SuggestSpec:
    step: str
    template_id: str
    fields: tuple[str, ...]


SPECS: dict[str, SuggestSpec] = {
    "brief": SuggestSpec("brief", "system:brief_suggest", ("audience", "occasion", "price", "promo")),
    "scene_set": SuggestSpec("scene_set", "system:scene_suggest", ("lighting", "palette", "dont")),
}


def _clean(v: Any) -> str:
    return " ".join(str(v).split())[:MAX_LEN] if isinstance(v, (str, int, float)) else ""


def suggest(prompts: PromptLibrary, step: str, *, garment: dict[str, Any], brief: dict[str, Any],
            existing: dict[str, Any], image_paths: list[str], format_params: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = SPECS[step]
    fmt = formats.resolve(format_params)
    variables = {"garment": garment or "not analysed yet", "brief": brief or "not provided", "existing": existing or "empty",
                 "format": {"name_vi": fmt["name_vi"], "desc_vi": fmt["desc_vi"], "scenes": int(fmt["scenes"])}}
    rendered = prompts.render(spec.template_id, variables=variables)
    raw, provider = llm.call_llm(rendered["prompt"], image_paths)
    data = llm.extract_json(raw)
    suggestion: dict[str, Any] = {k: _clean(data.get(k)) for k in spec.fields}
    if step == "scene_set":
        items = []
        for i, it in enumerate((data.get("items") or [])[: int(fmt["scenes"])]):
            if isinstance(it, dict):
                items.append({"key": f"scene:{i + 1}", **{k: _clean(it.get(k)) for k in SCENE_FIELDS}})
        suggestion["items"] = items
    return {"suggestion": suggestion, "note": _clean(data.get("note")), "provider": provider, "images": len(image_paths)}
