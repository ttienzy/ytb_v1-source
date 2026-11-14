"""Executor `scene_plate` (Khối 2, theo cảnh): MỘT ảnh bối cảnh KHÔNG người cho mỗi cảnh (Flow Help: ảnh bối cảnh không có chủ thể).

Không có ảnh tham chiếu: chỉ mô tả nơi, thời điểm, ánh sáng, tâm trạng của cảnh và phong cách chung. 0 credit Flow.
"""
from __future__ import annotations

from typing import Any

from ..prompts import PromptLibrary
from ..runner import ExecContext, ExecResult
from . import common

DEFAULT_TEMPLATE = "system:scene_plate"
DEFAULT_ASPECT = "9:16"


class SceneInputError(ValueError):
    pass


def scene_vars(scene: dict[str, Any]) -> dict[str, str]:
    place = common.s(scene.get("place"))
    if not place:
        raise SceneInputError(f"Cảnh {scene.get('key') or ''} chưa ghi nơi quay (place).")
    return {"key": common.s(scene.get("key")), "name": common.s(scene.get("name")), "place": place,
            "time": common.s(scene.get("time")) or "daytime", "light": common.s(scene.get("light")) or "soft natural light",
            "mood": common.s(scene.get("mood")) or "calm, natural", "action": common.s(scene.get("action")) or "standing relaxed, looking toward the camera"}


def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, list[dict[str, Any]]],
                  note: str = "") -> dict[str, Any]:
    refs = inputs.get("scene_set") or []
    if not refs or "item" not in refs[0]:
        raise SceneInputError("Chưa có cảnh tương ứng trong danh sách cảnh (khối 2).")
    scene = scene_vars(refs[0]["item"])
    aspect = str(params.get("aspect") or DEFAULT_ASPECT)
    template_id, version = common.template_pref(params, DEFAULT_TEMPLATE)
    variables = {"scene": scene, "style": common.style_of(inputs), "aspect_label": common.ASPECT_LABEL.get(aspect, aspect)}
    rendered = prompts.render(template_id, version=version, variables=variables, changes=common.changes_with_note(params, note), ref_paths=[])
    rendered["ref_order"] = []
    rendered["warnings"] = [w for w in rendered["warnings"] if w["code"] not in ("ref_count_mismatch", "missing_variables")]
    rendered.update({"aspect": aspect, "scene": scene["key"], "note": note})
    return rendered


def run_scene_plate(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, ctx.params, ctx.inputs, ctx.note)
    ctx.report("Đang tạo ảnh bối cảnh (thường 40–70 giây)…")
    return ExecResult([common.generate_image(ctx, req, "plate", {"scene": req["scene"]})])
