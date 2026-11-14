"""Executor `scene_anchor` (Khối 4, theo cảnh): MỘT ảnh người-trong-cảnh cho mỗi cảnh = cast sheet + ảnh áo thật + ảnh bối cảnh.

Là ảnh tham chiếu "the location photo with the person" của mọi clip thuộc cảnh đó; duyệt một lần mỗi cảnh (không phải mỗi shot).
"""
from __future__ import annotations

from typing import Any

from ..prompts import PromptLibrary
from ..runner import ExecContext, ExecResult
from . import common
from .scene_plate import SceneInputError, scene_vars

DEFAULT_TEMPLATE = "system:scene_anchor"
DEFAULT_ASPECT = "9:16"


def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, list[dict[str, Any]]],
                  note: str = "") -> dict[str, Any]:
    scenes, sheets, plates = inputs.get("scene_set") or [], inputs.get("cast_sheet") or [], inputs.get("scene_plate") or []
    if not scenes or "item" not in scenes[0]:
        raise SceneInputError("Chưa có cảnh tương ứng trong danh sách cảnh (khối 2).")
    if not sheets:
        raise SceneInputError("Chưa có cast sheet đã duyệt (khối 2).")
    if not plates:
        raise SceneInputError("Chưa có ảnh bối cảnh của cảnh này (khối 2).")
    photo = common.garment_photo(inputs, "front")
    if photo is None:
        raise SceneInputError("Chưa có ảnh sản phẩm (khối 1).")
    scene = scene_vars(scenes[0]["item"])
    aspect = str(params.get("aspect") or DEFAULT_ASPECT)
    template_id, version = common.template_pref(params, DEFAULT_TEMPLATE)
    variables = {"scene": scene, "style": common.style_of(inputs), "aspect_label": common.ASPECT_LABEL.get(aspect, aspect),
                 "presentation": common.presentation_of(inputs), **common.garment_vars(common.garment_of(inputs))}
    refs = [("sheet", "Cast sheet", sheets[0]), ("photo", "Ảnh áo thật", photo), ("plate", "Ảnh bối cảnh", plates[0])]
    rendered = prompts.render(template_id, version=version, variables=variables, changes=common.changes_with_note(params, note),
                              ref_paths=[r[2]["path"] for r in refs])
    rendered["ref_order"] = [{"role": role, "label": label, "path": r["path"], "artifact_id": r.get("artifact_id")} for role, label, r in refs]
    rendered["warnings"] = [w for w in rendered["warnings"] if w["code"] not in ("ref_count_mismatch", "missing_variables")]
    rendered.update({"aspect": aspect, "scene": scene["key"], "note": note})
    return rendered


def run_scene_anchor(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, ctx.params, ctx.inputs, ctx.note)
    ctx.report("Đang tạo khung chốt cảnh (thường 40–70 giây)…")
    return ExecResult([common.generate_image(ctx, req, "anchor", {"scene": req["scene"]})])
