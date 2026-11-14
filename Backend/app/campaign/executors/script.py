"""Executor `script` (Khối 3): MỘT lượt LLM điền nội dung vào khung format: hook, beat từng shot, lời thoại, chữ, caption.

Khung (số shot, vai, cảnh, thời lượng, máy quay, số beat) do format + code quyết (`skeleton`); LLM chỉ viết nội dung.
Chuẩn hóa chạy cả sau LLM lẫn sau khi người dùng sửa tay, nên mọi luật (trần chuyển động theo rủi ro áo, âm tiết/giây,
lời chứng giả, điều "không được nói") luôn áp dụng. 0 credit Flow.
"""
from __future__ import annotations

from typing import Any

from .. import formats
from ..prompts import PromptLibrary
from ..runner import ArtifactSpec, ExecContext, ExecResult
from . import common, llm
from .common import MOTION_RANK, s

DEFAULT_TEMPLATE = "system:script_v3"
MIN_DURATION, MAX_DURATION = formats.MIN_DURATION, formats.MAX_DURATION
CAMERA_KEYS = ("angle", "lens", "move")
DEFAULT_BRIEF = {"language": "vi", "audience": "", "occasion": "", "price": "", "promo": "", "platform": "tiktok"}


class ScriptError(ValueError):
    pass


def beats_for(duration: int) -> int:
    """Số beat vừa với thời lượng: mỗi beat cần khoảng 2,5–4 giây để đọc được."""
    return 2 if duration <= 5 else 3 if duration <= 10 else 4


def _int(v: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


def _brief(inputs: dict[str, Any]) -> dict[str, Any]:
    return {**DEFAULT_BRIEF, **{k: v for k, v in common.load_input(inputs, "brief").items() if v not in (None, "")}}


def scenes_of(inputs: dict[str, Any]) -> list[dict[str, Any]]:
    """Danh sách cảnh có khóa; chưa nhập cảnh nào thì một cảnh mặc định để kịch bản vẫn viết được."""
    raw = common.load_input(inputs, "scene_set").get("items")
    out = []
    for i, item in enumerate(raw if isinstance(raw, list) else []):
        if isinstance(item, dict):
            out.append({**item, "key": s(item.get("key")) or f"scene:{i + 1}"})
    return out


def motion_limit(garment: dict[str, Any]) -> str:
    limit = (garment.get("risk") or {}).get("motion_limit") or "free"
    return limit if limit in MOTION_RANK else "free"


def cap_motion(want: str, limit: str) -> str:
    return common.MOTION_BY_RANK[min(MOTION_RANK.get(want, 2), MOTION_RANK.get(limit, 2))]


def skeleton(fmt: dict[str, Any], scenes: list[dict[str, Any]], garment: dict[str, Any]) -> list[dict[str, Any]]:
    """Khung shot từ format: số shot, vai, cảnh (ánh xạ thứ tự; thiếu cảnh thì dùng cảnh 1), thời lượng, máy quay, số beat."""
    limit = motion_limit(garment)
    keys = [sc["key"] for sc in scenes] or ["scene:1"]
    out = []
    for i, shot in enumerate(fmt["shots"], start=1):
        idx = int(shot.get("scene", 1)) - 1
        duration = _int(shot.get("duration"), 5, MIN_DURATION, MAX_DURATION)
        out.append({
            "key": f"shot:{i}", "role": shot["role"], "scene": keys[idx] if idx < len(keys) else keys[0], "duration": duration,
            "camera": {k: s(shot["camera"].get(k)) for k in CAMERA_KEYS}, "needs_face": bool(shot.get("needs_face", True)),
            "garment_ref": shot.get("garment_ref", "front"), "motion": cap_motion(shot.get("motion", "gentle"), limit),
            "beats_n": beats_for(duration), "beat_hint": s(shot.get("beat_hint")), "max_syllables": common.max_syllables(duration),
        })
    return out


def shot_lines(skel: list[dict[str, Any]], scenes: list[dict[str, Any]]) -> str:
    names = {sc["key"]: s(sc.get("name")) or s(sc.get("place")) for sc in scenes}
    lines = []
    for sh in skel:
        cam = sh["camera"]
        lines.append(f"- {sh['key']} | role: {sh['role']} | scene: {sh['scene']} ({names.get(sh['scene'], 'the one scene')}) | {sh['duration']} s | "
                     f"EXACTLY {sh['beats_n']} beats | {'face visible' if sh['needs_face'] else 'NO FACE in frame'} | "
                     f"camera: {cam['angle']}, {cam['lens']}, {cam['move']} | motion: {sh['motion']} | voiceover max {sh['max_syllables']} syllables | "
                     f"idea: {sh['beat_hint']}")
    return "\n".join(lines)


def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, Any], note: str = "") -> dict[str, Any]:
    garment = common.garment_of(inputs)
    if not garment:
        raise ScriptError("Chưa có hồ sơ áo.")
    fmt = formats.resolve(common.load_input(inputs, "format"))
    scenes = scenes_of(inputs)
    skel = skeleton(fmt, scenes, garment)
    template_id, version = common.template_pref(params, DEFAULT_TEMPLATE)
    variables = {
        "garment": {k: v for k, v in garment.items() if k != "risk"} | {"risk": garment.get("risk", {})},
        "brief": _brief(inputs), "format": {"name_vi": fmt["name_vi"], "desc_vi": fmt["desc_vi"]},
        "scenes": [{"key": sc["key"], "name": s(sc.get("name")), "place": s(sc.get("place")), "action": s(sc.get("action"))} for sc in scenes]
                  or [{"key": "scene:1", "name": "one scene", "place": "a simple real location", "action": ""}],
        "shot_lines": shot_lines(skel, scenes), "hook_types": ", ".join(fmt.get("hook_types") or list(formats.HOOK_TYPES)),
        "presentation": common.presentation_of(inputs),
    }
    rendered = prompts.render(template_id, version=version, variables=variables, changes=common.changes_with_note(params, note))
    rendered["ref_order"] = []
    rendered["warnings"] = [w for w in rendered["warnings"] if w["code"] not in ("ref_count_mismatch", "too_many_refs", "missing_variables")]
    sheets = inputs.get("cast_sheet") or []
    if sheets and sheets[0].get("path"):
        rendered["_image_paths"] = [sheets[0]["path"]]          # đạo diễn nhìn thấy người mẫu và áo thật đã duyệt
    rendered["format_id"] = fmt["id"]
    rendered["skeleton"] = skel
    return rendered


def _beats(raw: Any) -> list[str]:
    if isinstance(raw, str):
        raw = [raw]
    out = []
    for b in raw if isinstance(raw, list) else []:
        text = s(b.get("action") if isinstance(b, dict) else b)
        if text:
            out.append(text)
    return out


def normalize_script(content: dict[str, Any], inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    """Gộp nội dung LLM/người dùng vào khung format; code chốt số shot, thời lượng, số beat, chuyển động và luật lời thoại."""
    garment = common.garment_of(inputs)
    fmt = formats.resolve(common.load_input(inputs, "format"))
    scenes = scenes_of(inputs)
    scene_keys = {sc["key"] for sc in scenes} or {"scene:1"}
    limit = motion_limit(garment)
    skel = skeleton(fmt, scenes, garment)
    raw_items = [it for it in (content.get("items") or []) if isinstance(it, dict)]
    by_key = {s(it.get("key")): it for it in raw_items}
    language = s(_brief(inputs).get("language")) or "vi"
    warnings: list[dict[str, str]] = []
    items: list[dict[str, Any]] = []
    for i, sk in enumerate(skel):
        it = by_key.get(sk["key"]) or (raw_items[i] if i < len(raw_items) and not s(raw_items[i].get("key")) else {})
        duration = _int(it.get("duration"), sk["duration"], MIN_DURATION, MAX_DURATION)
        cam_in = it.get("camera") if isinstance(it.get("camera"), dict) else {}
        camera = {k: s(cam_in.get(k)) or sk["camera"][k] for k in CAMERA_KEYS}
        scene = s(it.get("scene")) if s(it.get("scene")) in scene_keys else sk["scene"]
        motion = cap_motion(s(it.get("motion")).lower() or sk["motion"], limit)
        needs_face = bool(it["needs_face"]) if isinstance(it.get("needs_face"), bool) else sk["needs_face"]
        garment_ref = s(it.get("garment_ref")) if s(it.get("garment_ref")) in formats.GARMENT_REFS else sk["garment_ref"]
        want = beats_for(duration)
        beats = _beats(it.get("beats"))
        if len(beats) > want:
            beats = beats[:want]
        shot = {
            "key": sk["key"], "role": sk["role"], "scene": scene, "duration": duration, "camera": camera, "needs_face": needs_face,
            "garment_ref": garment_ref, "motion": motion, "motion_cap": limit, "beats": beats,
            "expression": "" if not needs_face else s(it.get("expression")),
            "voiceover": s(it.get("voiceover")), "on_screen_text": s(it.get("on_screen_text")),
            "max_syllables": common.max_syllables(duration),
        }
        key = shot["key"]
        if not beats:
            warnings.append({"where": key, "code": "beats_missing", "message": f"{key}: chưa có beat nào; clip sẽ chỉ có mô tả máy quay. Thêm ít nhất một beat."})
        elif len(beats) < want:
            warnings.append({"where": key, "code": "beats_few", "message": f"{key}: có {len(beats)} beat cho {duration} giây, nên có {want}."})
        if needs_face and not shot["expression"]:
            warnings.append({"where": key, "code": "expression_missing", "message": f"{key}: chưa có biểu cảm người mẫu: dễ ra ánh nhìn vô hồn."})
        n = common.syllables(shot["voiceover"])
        if n > shot["max_syllables"]:
            warnings.append({"where": key, "code": "voiceover_too_long",
                             "message": f"{key}: lời thoại {n} {'âm tiết' if language == 'vi' else 'từ'}, quá mức {shot['max_syllables']} cho {duration} giây."})
        if common.UNVISUALIZABLE.search(" ".join([shot["voiceover"], shot["on_screen_text"], " ".join(beats)])):
            warnings.append({"where": key, "code": "script_claims_not_visible",
                             "message": f"{key}: hứa biến hình/trước-sau/đồ khác nhưng hình chỉ có một bộ đồ: viết lại cho khớp."})
        warnings += common.lint_text({f"{key} lời thoại": shot["voiceover"], f"{key} chữ": shot["on_screen_text"]}, garment)
        items.append(shot)

    hook_in = content.get("hook") if isinstance(content.get("hook"), dict) else {}
    allowed = list(fmt.get("hook_types") or formats.HOOK_TYPES)
    hook_type = s(hook_in.get("type")).lower()
    if hook_type not in formats.HOOK_TYPES:
        hook_type = allowed[0]
    hook = {"type": hook_type, "on_screen_text": s(hook_in.get("on_screen_text")) or (items[0]["on_screen_text"] if items else "")}
    if hook_type not in allowed:
        warnings.append({"where": "hook", "code": "hook_type_off_format", "message": f"Hook kiểu “{hook_type}” không nằm trong các kiểu của format ({', '.join(allowed)})."})
    tags: list[str] = []
    for t in content.get("hashtags") or []:
        tag = s(t)
        tag = tag if tag.startswith("#") else f"#{tag}" if tag else ""
        if tag and tag not in tags:
            tags.append(tag)
    out = {
        "format_id": fmt["id"], "angle_vi": s(content.get("angle_vi")), "hook": hook, "items": items,
        "caption": s(content.get("caption")), "hashtags": tags, "cta": s(content.get("cta")),
        "motion_limit": limit, "total_seconds": sum(x["duration"] for x in items),
    }
    warnings += common.lint_text({"caption": out["caption"], "CTA": out["cta"], "hook chữ": hook["on_screen_text"]}, garment)
    out["warnings"] = warnings
    return out


def run_script(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, ctx.params, ctx.inputs, ctx.note)
    data, raw, provider = llm.call_llm_json(req["prompt"], req.get("_image_paths") or None, retries=1)
    content = normalize_script(data, ctx.inputs, ctx.params)
    return ExecResult([ArtifactSpec("json", json=content, meta={
        "provider": provider, "template": req["template"], "prompt": req["prompt"], "raw": raw[:4000], "format_id": req["format_id"]})])
