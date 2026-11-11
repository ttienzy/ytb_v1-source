"""Executor `anchor_frame` (Khối 4): MỘT ảnh chốt khuôn mặt + áo + bối cảnh + ánh sáng cho cả phim.

Mọi storyboard và clip đều tham chiếu ảnh này (đã duyệt) để mặt và bối cảnh không trôi giữa các shot. Tốn 1 lượt ảnh ChatGPT cho cả chiến dịch, 0 credit Flow.
"""
from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any

from ..prompts import PromptLibrary
from ..runner import ArtifactSpec, ExecContext, ExecResult
from . import look
from .planning import load_input, master_scene
from .storyboard import ASPECT_LABEL, DEFAULT_ASPECT, LOGO_RULE, STYLE_DEFAULTS

DEFAULT_TEMPLATE = "system:anchor_frame"


class AnchorInputError(ValueError):
    pass


def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, list[dict[str, Any]]],
                  note: str = "") -> dict[str, Any]:
    looks, cast, photos = inputs.get("look") or [], inputs.get("cast") or [], inputs.get("garment_source") or []
    if not looks:
        raise AnchorInputError("Chưa có ảnh mẫu (look sheet) đã duyệt.")
    if not cast:
        raise AnchorInputError("Chưa có ảnh nhân vật.")
    if not photos:
        raise AnchorInputError("Chưa có ảnh sản phẩm.")
    identity = next((c for c in cast if c.get("role") == "identity"), cast[0])
    photo = next((p for p in photos if p.get("role") == "front"), photos[0])
    refs = [{**identity, "role": "identity"}, {**looks[0], "role": "sheet"}, {**photo, "role": "photo"}]
    garment, style = load_input(inputs, "fact_sheet"), load_input(inputs, "style")
    aspect = str(params.get("aspect") or DEFAULT_ASPECT)
    pref = params.get("prompt") or {}
    changes = str(pref.get("changes") or "").strip()
    if note.strip():
        changes = (changes + "; " if changes else "") + "reviewer feedback: " + note.strip()
    risk = garment.get("risk") or {}
    variables = {
        "aspect_label": ASPECT_LABEL.get(aspect, aspect),
        "master_scene": master_scene(style),
        "style": {k: (style.get(k) or STYLE_DEFAULTS[k]) for k in STYLE_DEFAULTS},
        "garment": {"summary": garment.get("summary") or "the garment shown in the reference images"},
        "logo_rule": LOGO_RULE if risk.get("logo_rule") == "reference_only" else "",
    }
    rendered = prompts.render(pref.get("template_id") or DEFAULT_TEMPLATE, version=pref.get("version"), variables=variables,
                              changes=changes, ref_paths=[r["path"] for r in refs])
    rendered["ref_order"] = [{"role": r["role"], "label": f"Image {i + 1}", "artifact_id": r.get("artifact_id"), "path": r["path"]}
                             for i, r in enumerate(refs)]
    rendered["aspect"] = aspect
    rendered["note"] = note
    return rendered


def run_anchor(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, ctx.params, ctx.inputs, ctx.note)
    tmp = ctx.store.campaign_dir(ctx.campaign_id) / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    dest = tmp / f"anchor_{uuid.uuid4().hex[:10]}.png"
    ctx.report("Đang tạo khung mẫu (thường 40–70 giây)…")
    started = time.time()
    try:
        look._client().generate(prompt=req["prompt"], dest=str(dest), ref_paths=[r["path"] for r in req["ref_order"]], aspect=req["aspect"])
        data = Path(dest).read_bytes()
    finally:
        Path(dest).unlink(missing_ok=True)
    return ExecResult([ArtifactSpec("image", ext=look._sniff_ext(data), data=data, meta={
        "prompt": req["prompt"], "template": req["template"], "aspect": req["aspect"], "seconds": round(time.time() - started, 1)})])
