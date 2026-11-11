"""Executor `storyboard` (Khối 5): mỗi shot MỘT ảnh gồm 2–4 khung nối tiếp, làm ảnh tham chiếu thứ hai cho clip Ingredients.

Bố cục theo docs/PLAN_campaign_v24_storyboard_ingredients.md: khung sát nhau, không viền, không chữ, để mỗi khung còn đủ độ phân giải.
Tham chiếu: khung mẫu đã duyệt (mặt, áo, bối cảnh, ánh sáng) + ảnh áo thật (logo).
"""
from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any

from ..prompts import PromptLibrary
from ..runner import ArtifactSpec, ExecContext, ExecResult
from . import look
from .planning import BOARD_LABEL_EN, load_input, master_scene, shot_panels

DEFAULT_TEMPLATE = "system:storyboard"
DEFAULT_ASPECT = "9:16"
ASPECT_LABEL = {"9:16": "vertical 9:16", "16:9": "horizontal 16:9"}
# Khi người dùng chưa điền phong cách: mặc định trung tính để prompt không có dòng rỗng.
STYLE_DEFAULTS = {
    "lighting": "soft natural daylight with a gentle rim light that separates the subject from the background",
    "background": "one real out-of-focus location with depth, never a flat blank wall",
    "palette": "keep the garment's real colors",
    "dont": "extra text, watermarks, other brand logos, altering the garment's logo or color",
}
LOGO_RULE = "The garment has a logo/text: reproduce it exactly as in the references; never redraw, translate or alter it."
FRAMING_EN = {"wide": "wide shot", "medium": "medium shot", "closeup": "close-up"}
# (tỉ lệ video, số khung) -> (mô tả cách xếp, hình dạng ảnh tổng). ChatGPT chỉ nhận ảnh gần 1:1, 2:3 hoặc 3:2.
LAYOUTS: dict[tuple[str, int], tuple[str, str]] = {
    ("9:16", 1): ("as a single frame", "portrait 2:3"),
    ("9:16", 2): ("in one row, left to right", "square 1:1"),
    ("9:16", 3): ("in one row, left to right", "landscape 3:2"),
    ("9:16", 4): ("in a 2x2 grid, read left to right then top to bottom", "portrait 2:3"),
    ("16:9", 1): ("as a single frame", "landscape 3:2"),
    ("16:9", 2): ("in one column, top to bottom", "square 1:1"),
    ("16:9", 3): ("in one column, top to bottom", "portrait 2:3"),
    ("16:9", 4): ("in a 2x2 grid, read left to right then top to bottom", "landscape 3:2"),
}


class StoryboardInputError(ValueError):
    pass


def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, list[dict[str, Any]]],
                  note: str = "") -> dict[str, Any]:
    anchors, items, photos = inputs.get("anchor_frame") or [], inputs.get("shot_plan") or [], inputs.get("garment_source") or []
    if not anchors:
        raise StoryboardInputError("Chưa có khung mẫu đã duyệt (khối 4).")
    if not items or "item" not in items[0]:
        raise StoryboardInputError("Chưa có shot tương ứng trong kế hoạch.")
    photo = next((p for p in photos if p.get("role") == "front"), photos[0] if photos else None)
    if photo is None:
        raise StoryboardInputError("Chưa có ảnh sản phẩm.")
    shot = items[0]["item"]
    panels = shot_panels(shot)[:4]
    if not panels:
        raise StoryboardInputError(f"{shot.get('key', 'Shot')} chưa có nhịp nào: thêm ít nhất một khung ở kế hoạch shot.")
    aspect = str(params.get("aspect") or DEFAULT_ASPECT)
    if (aspect, len(panels)) not in LAYOUTS:
        raise StoryboardInputError(f"Tỉ lệ không hỗ trợ: {aspect}")
    garment, style = load_input(inputs, "fact_sheet"), load_input(inputs, "style")
    pref = params.get("prompt") or {}
    changes = str(pref.get("changes") or "").strip()
    if note.strip():
        changes = (changes + "; " if changes else "") + "reviewer feedback: " + note.strip()
    layout, canvas = LAYOUTS[(aspect, len(panels))]
    board = str(shot.get("board_type") or "")
    face_visible = str(shot.get("face_policy") or "visible") != "none"
    no_person = board == "still_life"
    variables = {
        "duration": shot.get("duration") or 6, "board_label": BOARD_LABEL_EN.get(board, "fashion shot"), "panel_count": len(panels),
        "layout_text": layout, "canvas_text": canvas, "aspect_label": ASPECT_LABEL.get(aspect, aspect),
        "panels_text": chr(10).join(f"FRAME {i + 1} ({FRAMING_EN.get(p.get('framing') or '', 'medium shot')}): {p['action']}" for i, p in enumerate(panels)),
        "master_scene": master_scene(style),
        "expression": str(shot.get("expression") or "").strip() if face_visible and not no_person else "",
        "no_face": "yes" if not face_visible and not no_person else "", "no_person": "yes" if no_person else "",
        "style": {k: (style.get(k) or STYLE_DEFAULTS[k]) for k in STYLE_DEFAULTS},
        "garment": {"summary": garment.get("summary") or "the garment shown in the reference images"},
        "logo_rule": LOGO_RULE if (garment.get("risk") or {}).get("logo_rule") == "reference_only" else "",
    }
    refs = [("anchor", "Khung mẫu", anchors[0]), ("photo", "Ảnh áo thật", photo)]
    rendered = prompts.render(pref.get("template_id") or DEFAULT_TEMPLATE, version=pref.get("version"), variables=variables,
                              changes=changes, ref_paths=[r[2]["path"] for r in refs])
    rendered["ref_order"] = [{"role": role, "label": label, "path": r["path"], "artifact_id": r.get("artifact_id")} for role, label, r in refs]
    rendered["warnings"] = [w for w in rendered["warnings"] if w["code"] != "ref_count_mismatch"]
    rendered.update({"aspect": aspect, "panels": len(panels), "layout": layout, "canvas": canvas, "shot": shot.get("key", ""), "note": note})
    return rendered


def run_storyboard(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, ctx.params, ctx.inputs, ctx.note)
    tmp = ctx.store.campaign_dir(ctx.campaign_id) / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    dest = tmp / f"sb_{uuid.uuid4().hex[:10]}.png"
    ctx.report(f"Đang vẽ storyboard {req['panels']} khung (thường 40–70 giây)…")
    started = time.time()
    try:
        look._client().generate(prompt=req["prompt"], dest=str(dest), ref_paths=[r["path"] for r in req["ref_order"]], aspect=req["aspect"])
        data = Path(dest).read_bytes()
    finally:
        Path(dest).unlink(missing_ok=True)
    return ExecResult([ArtifactSpec("image", ext=look._sniff_ext(data), data=data, meta={
        "prompt": req["prompt"], "template": req["template"], "aspect": req["aspect"], "panels": req["panels"], "shot": req["shot"],
        "seconds": round(time.time() - started, 1)})])
