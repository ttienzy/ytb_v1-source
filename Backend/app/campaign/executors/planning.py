"""Khối 3 (Kế hoạch): góc kể, hook, danh sách shot, lời thoại. Toàn LLM, 0 credit Flow.

Mỗi bước = (mẫu prompt, hàm dựng biến từ đầu vào, hàm chuẩn hóa). Chuẩn hóa chạy cả sau LLM lẫn sau khi người dùng
sửa tay, nên các luật (giới hạn chuyển động theo rủi ro, quét lời chứng giả, quét "không được nói") luôn áp dụng.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..prompts import PromptLibrary, has_fake_testimonial
from ..runner import ArtifactSpec, ExecContext, ExecResult
from . import llm

MOTION_RANK = {"minimal": 0, "gentle": 1, "free": 2}
ROLES = ("hook", "benefit", "cta")
HOOK_TYPES = ("contrast", "direct", "pain_question", "surprise_visual", "number_signal")
WORDS_PER_SECOND = 3
# Thời lượng một clip Ingredients (Omni 1.2): số nguyên 3-15 giây. Giá từ giây thứ 11 gấp đôi nên mặc định giữ ngắn.
MIN_DURATION, MAX_DURATION = 3, 15
DEFAULT_DURATION = 6
DEFAULT_TOTAL_SECONDS = 20
AUTHENTICITY = re.compile(r"chính hãng|authentic|genuine|hàng hiệu|auth\b", re.I)

# Kiểu storyboard của từng shot: docs/PLAN_campaign_v24_storyboard_ingredients.md. `archetype` suy ra từ đây, để bước ghép biết vùng cần phóng.
BOARD_TYPES = {"hero_walk": "hero", "turn_reveal": "motion", "pose_sequence": "hero", "detail_macro": "detail",
               "fabric_touch": "detail", "still_life": "detail", "closer_cta": "cta"}
BOARD_LABEL_EN = {"hero_walk": "model walking toward the camera", "turn_reveal": "turn to reveal the outfit", "pose_sequence": "lookbook pose sequence",
                  "detail_macro": "close-up garment detail", "fabric_touch": "fabric in motion", "still_life": "garment still life", "closer_cta": "closing hero pose"}
NO_FACE_BOARDS = ("detail_macro", "fabric_touch", "still_life")
FRAMINGS = ("wide", "medium", "closeup")
CAMERA_MOVES = ("static", "push_in", "pull_out", "pan", "orbit")
FACE_POLICIES = ("visible", "none")

# Các "đích" mà một shot chi tiết (detail) có thể nhắm vào: nhắm hai đích trong một khung cận cảnh là không khả thi
# (logo ngực và cạp quần cách nhau cả thân người; campaign thật shot:2 ra khung nửa thân thay vì cận cảnh).
DETAIL_TARGETS = {
    "logo": re.compile(r"logo|monogram|embroider|thêu|(?<!\w)print(?!\w)|họa tiết", re.I),
    "waistband": re.compile(r"waist|cạp|drawstring|dây rút|elastic", re.I),
    "pocket": re.compile(r"pocket|túi", re.I),
    "hem": re.compile(r"(?<!\w)hem(?!\w)|gấu", re.I),
    "collar": re.compile(r"collar|neckline|cổ áo|viền cổ", re.I),
    "sleeve": re.compile(r"sleeve|tay áo|cuff", re.I),
    "button": re.compile(r"button|cúc|zipper|khóa", re.I),
}
MULTI_CHANGE = re.compile(r"(?<!\w)and(?!\w)|(?<!\w)then(?!\w)|\+|;|(?<!\w)và(?!\w)|(?<!\w)rồi(?!\w)", re.I)
CLOSEUP_WORDS = re.compile(r"close-?up|detail shot|macro|cận cảnh|chi tiết", re.I)
FACE_WORDS = re.compile(r"(?<!\w)face(?!\w)|(?<!\w)smil|gương mặt|khuôn mặt|(?<!\w)mặt(?!\w)|(?<!\w)eyes?(?!\w)", re.I)

# Lời hứa "biến hình/trước-sau/đồ khác" mà pipeline KHÔNG thể thể hiện: chỉ có MỘT bộ đồ trong ảnh (campaign thật: hook "đồ ở nhà... lột xác"
# nhưng giây 0 đã mặc đủ set). Chỉ là cảnh báo + loại khỏi hook mặc định; người dùng vẫn chọn được.
UNVISUALIZABLE = re.compile(r"lột xác|biến hình|thay đổi diện mạo|trước\s*(?:và|/|-)\s*sau|đồ ở nhà|bình thường thế này|từ bình thường|(?<!\w)before(?!\w)\s*(?:and|/|&|-)\s*(?<!\w)after(?!\w)|(?<!\w)transform(?:s|ation|ing)?(?!\w)|(?<!\w)transitions? into(?!\w)|(?<!\w)changes? into(?!\w)|plain homewear|swaps? outfit|outfit change|thay đồ", re.I)

DEFAULT_BRIEF = {"language": "vi", "audience": "", "occasion": "", "price": "", "promo": "", "platform": "tiktok"}


class PlanError(ValueError):
    pass


# ── đọc đầu vào ───────────────────────────────────────────────────────────────
def load_input(inputs: dict[str, list[dict[str, Any]]], dep: str) -> dict[str, Any]:
    refs = inputs.get(dep) or []
    if not refs:
        return {}
    ref = refs[0]
    if "params" in ref:
        return dict(ref["params"])
    try:
        data = json.loads(Path(ref["path"]).read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        return {}
    return data if isinstance(data, dict) else {}


def _garment(inputs: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    return load_input(inputs, "fact_sheet")


def _motion_limit(inputs: dict[str, list[dict[str, Any]]], params: dict[str, Any] | None = None) -> str:
    """Trần chuyển động của CHỦ THỂ (không áp cho máy quay). Người dùng đặt `motion_limit` ở bước thì thắng mặc định theo rủi ro của áo."""
    forced = str((params or {}).get("motion_limit") or "").strip().lower()
    if forced in MOTION_RANK:
        return forced
    limit = ((_garment(inputs).get("risk") or {}).get("motion_limit")) or "free"
    return limit if limit in MOTION_RANK else "free"


def _brief(inputs: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    return {**DEFAULT_BRIEF, **{k: v for k, v in load_input(inputs, "brief").items() if v not in (None, "")}}


def _chosen_angle(inputs: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    angle = load_input(inputs, "angle")
    items = angle.get("items") or []
    chosen = angle.get("chosen")
    return next((a for a in items if a.get("key") == chosen), items[0] if items else {})


def master_scene(style: dict[str, Any]) -> str:
    """MỘT bối cảnh cho cả phim: người dùng ghi ở Phong cách, không có thì ghép từ bối cảnh + ánh sáng."""
    explicit = _s(style.get("master_scene"))
    if explicit:
        return explicit
    parts = [_s(style.get("background")) or "a real city street with depth, softly out of focus",
             _s(style.get("lighting")) or "soft natural daylight with a gentle rim light"]
    return "; ".join(parts)


def _chosen_hook(inputs: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    hook = load_input(inputs, "hook")
    items = hook.get("items") or []
    chosen = hook.get("chosen")
    return next((h for h in items if h.get("key") == chosen), items[0] if items else {})


# ── tiện ích chuẩn hóa ─────────────────────────────────────────────────────────
def _s(v: Any) -> str:
    return "" if v is None else str(v).strip()


def _keyed(raw_items: Any, prefix: str) -> list[dict[str, Any]]:
    """Giữ khóa hợp lệ và duy nhất (để sửa/xóa một phần tử không làm lệch khóa các phần tử khác); cấp khóa mới cho phần còn lại."""
    pattern = re.compile(rf"^{re.escape(prefix)}:\d+$")
    items = [dict(x) for x in raw_items if isinstance(x, dict)] if isinstance(raw_items, list) else []
    used: set[str] = set()
    for it in items:
        k = _s(it.get("key"))
        if pattern.match(k) and k not in used:
            used.add(k)
        else:
            it["key"] = ""
    n = 0
    for it in items:
        if it["key"]:
            continue
        while f"{prefix}:{n + 1}" in used:
            n += 1
        n += 1
        it["key"] = f"{prefix}:{n}"
        used.add(it["key"])
    return items


def _int(v: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


def snap_duration(value: Any, default: int = DEFAULT_DURATION) -> int:
    """Thời lượng hợp lệ của một clip: số nguyên 3-15 giây."""
    return _int(value, default, MIN_DURATION, MAX_DURATION)


def panel_count(duration: int) -> int:
    """Số khung storyboard vừa với thời lượng: mỗi nhịp cần khoảng 2,5-4 giây để đọc được."""
    return 2 if duration <= 5 else 3 if duration <= 10 else 4


def recommended_shots(total_seconds: int) -> int:
    """Số shot đề xuất cho tổng thời lượng: khoảng 5 giây một shot (15 giây = 3, 30 giây = 6). Mốc tham khảo, không phải chuẩn ngành."""
    return max(2, min(8, round(total_seconds / 5)))


def _panels(raw: Any) -> list[dict[str, str]]:
    out = []
    for p in raw if isinstance(raw, list) else []:
        if isinstance(p, dict) and _s(p.get("action")):
            framing = _s(p.get("framing")).lower()
            out.append({"framing": framing if framing in FRAMINGS else "medium", "action": _s(p.get("action"))})
    return out


def shot_panels(shot: dict[str, Any]) -> list[dict[str, str]]:
    """Các nhịp của shot. Kế hoạch tạo trước v2.4 chưa có `panels`: dựng từ mô tả khung đầu và thay đổi cuối cũ."""
    panels = _panels(shot.get("panels"))
    if panels:
        return panels
    framing = _s(shot.get("framing")) or "medium"
    return _panels([{"framing": framing, "action": _s(shot.get(k))} for k in ("keyframe_start", "end_delta")])


def _words(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


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


# ── chuẩn hóa từng bước ────────────────────────────────────────────────────────
def normalize_angle(content: dict[str, Any], inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    items = _keyed(content.get("items"), "angle")
    if not items:
        raise PlanError("Cần ít nhất một góc kể.")
    out = []
    for it in items:
        motion = _s(it.get("needs_motion")).lower()
        out.append({"key": it["key"], "id": _s(it.get("id")), "title_vi": _s(it.get("title_vi")),
                    "pitch_vi": _s(it.get("pitch_vi")), "needs_motion": motion if motion in MOTION_RANK else "free",
                    "risk_note": _s(it.get("risk_note"))})
    chosen = _s(content.get("chosen"))
    return {"items": out, "chosen": chosen if chosen in {i["key"] for i in out} else out[0]["key"]}


def normalize_hook(content: dict[str, Any], inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    garment = _garment(inputs)
    items = _keyed(content.get("items"), "hook")
    if not items:
        raise PlanError("Cần ít nhất một hook.")
    out, warnings = [], []
    for it in items:
        typ = _s(it.get("type")).lower()
        h = {"key": it["key"], "type": typ if typ in HOOK_TYPES else "other", "voiceover": _s(it.get("voiceover")),
             "on_screen_text": _s(it.get("on_screen_text")), "visual": _s(it.get("visual")),
             "seconds": _int(it.get("seconds"), 4, 3, 6)}
        if _words(h["voiceover"]) > h["seconds"] * WORDS_PER_SECOND:
            warnings.append({"where": h["key"], "code": "voiceover_too_long",
                             "message": f"{h['key']}: lời thoại dài quá {h['seconds']} giây (khoảng {h['seconds'] * WORDS_PER_SECOND} từ)."})
        warnings += lint_text({f"{h['key']} lời thoại": h["voiceover"], f"{h['key']} chữ": h["on_screen_text"]}, garment)
        h["needs_unavailable_visual"] = bool(UNVISUALIZABLE.search(" ".join([h["voiceover"], h["on_screen_text"], h["visual"]])))
        if h["needs_unavailable_visual"]:
            warnings.append({"where": h["key"], "code": "needs_unavailable_visual",
                             "message": f"{h['key']}: hứa biến hình/trước-sau/đồ khác nhưng ảnh chỉ có một bộ đồ, hình sẽ không khớp lời. Chọn hook khác."})
        out.append(h)
    chosen = _s(content.get("chosen"))
    valid = {h["key"] for h in out}
    if chosen not in valid or next(h for h in out if h["key"] == chosen)["needs_unavailable_visual"] and not _s(content.get("chosen_by_user")):
        chosen = next((h["key"] for h in out if not h["needs_unavailable_visual"]), out[0]["key"])    # mặc định: hook đầu tiên thể hiện được bằng hình
    return {"items": out, "chosen": chosen, "warnings": warnings}


def lint_shot(s: dict[str, Any]) -> list[dict[str, str]]:
    """Luật rẻ (0 credit) bắt lỗi thiết kế shot, chạy cả sau LLM lẫn sau khi sửa tay."""
    out: list[dict[str, str]] = []
    key = s["key"]

    def warn(code: str, message: str) -> None:
        out.append({"where": key, "code": code, "message": f"{key}: {message}"})

    panels = s["panels"]
    want = panel_count(s["duration"])
    text = " ".join(p["action"] for p in panels)
    if s["camera_move"] == "static" and s["board_type"] != "still_life":
        warn("camera_static", "máy quay đứng yên: shot dễ giống ảnh động. Dùng đẩy vào, lia hoặc xoay quanh.")
    if s["board_type"] not in NO_FACE_BOARDS and not s["expression"]:
        warn("expression_missing", "chưa có biểu cảm cho người mẫu: dễ ra ánh nhìn vô hồn. Ghi rõ nét mặt (vd. nụ cười tự tin, liếc nhìn máy).")
    if not panels:
        warn("panels_missing", "chưa có khung storyboard nào: shot này chưa tạo được ảnh storyboard.")
    elif len(panels) < want:
        warn("panels_few", f"có {len(panels)} khung cho {s['duration']} giây, nên có {want} khung để chuyển động không bị kéo lê.")
    elif len(panels) > want:
        warn("panels_many", f"có {len(panels)} khung cho {s['duration']} giây, nên có {want} khung: nhiều nhịp quá dễ thành vội và méo.")
    if any(len(MULTI_CHANGE.findall(p["action"])) >= 2 for p in panels):
        warn("many_actions", "có khung mô tả nhiều hành động; mỗi khung chỉ nên có một thay đổi đơn giản.")
    if s["duration"] > 10:
        warn("long_shot_cost", f"{s['duration']} giây: mỗi giây sau giây thứ 10 đắt gấp đôi. Chỉ giữ khi hành động cần liền mạch.")
    if s["archetype"] == "detail":
        hit = [name for name, rx in DETAIL_TARGETS.items() if rx.search(text)]
        if len(hit) >= 2:
            warn("two_targets", f"shot chi tiết nhắm tới {len(hit)} đích ({', '.join(hit)}): một cận cảnh chỉ nên có một đích, tách thành shot riêng.")
        if FACE_WORDS.search(text):
            warn("detail_face", "shot chi tiết không nên mô tả khuôn mặt (khung cận không chứa mặt).")
    if UNVISUALIZABLE.search(" ".join([s["voiceover"], s["on_screen_text"]])):
        warn("script_claims_not_visible", "lời thoại/chữ hứa biến hình, trước-sau hoặc đồ khác nhưng hình chỉ có một bộ đồ: viết lại cho khớp điều storyboard thể hiện.")
    return out


def _board_type(it: dict[str, Any], role: str) -> str:
    """Kiểu storyboard của LLM/người dùng; thiếu thì suy từ kiểu shot của kế hoạch cũ."""
    board = _s(it.get("board_type")).lower()
    if board in BOARD_TYPES:
        return board
    legacy = _s(it.get("archetype")).lower()
    closeup = _s(it.get("framing")).lower() == "closeup" or bool(CLOSEUP_WORDS.search(_s(it.get("camera")) + " " + _s(it.get("keyframe_start"))))
    if legacy == "detail" or (legacy not in ("hero", "motion", "cta") and closeup):
        return "detail_macro"
    if legacy == "motion":
        return "turn_reveal"
    return "closer_cta" if legacy == "cta" or role == "cta" else "hero_walk"


def normalize_shot_plan(content: dict[str, Any], inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    garment = _garment(inputs)
    limit = _motion_limit(inputs, params)
    items = _keyed(content.get("items"), "shot")
    if not items:
        raise PlanError("Kế hoạch phải có ít nhất một shot.")
    out, warnings = [], []
    for i, it in enumerate(items):
        role = _s(it.get("role")).lower()
        if role not in ROLES:
            role = "hook" if i == 0 else "cta" if i == len(items) - 1 and len(items) > 1 else "benefit"
        motion = _s(it.get("motion")).lower()
        if motion not in MOTION_RANK:
            motion = limit
        adjusted = bool(it.get("motion_adjusted"))
        if MOTION_RANK[motion] > MOTION_RANK[limit]:
            motion, adjusted = limit, True
        duration = snap_duration(it.get("duration"))
        board = _board_type(it, role)
        archetype = BOARD_TYPES[board]
        framing = _s(it.get("framing")).lower()
        if framing not in FRAMINGS:
            framing = "closeup" if archetype == "detail" else "medium"
        move = _s(it.get("camera_move")).lower().replace("-", "_").replace(" ", "_")
        face = _s(it.get("face_policy")).lower()
        if face not in FACE_POLICIES:
            face = "visible"
        if board in NO_FACE_BOARDS:
            face = "none"                                     # khung cận/tĩnh vật không chứa mặt
            if MOTION_RANK[motion] > MOTION_RANK["minimal"]:
                motion = "minimal"                            # cận cảnh chỉ nên rung nhẹ; chuyển động lớn làm méo logo
        s = {"key": it["key"], "role": role, "board_type": board, "archetype": archetype, "framing": framing, "duration": duration,
             "camera_move": move if move in CAMERA_MOVES else "static", "expression": _s(it.get("expression")), "face_policy": face,
             "motion": motion, "motion_cap": limit, "motion_adjusted": adjusted, "panels": shot_panels({**it, "framing": framing}),
             "on_screen_text": _s(it.get("on_screen_text")), "voiceover": _s(it.get("voiceover"))}
        warnings += lint_shot(s)
        if adjusted:
            warnings.append({"where": s["key"], "code": "motion_adjusted",
                             "message": f"{s['key']}: chuyển động đã hạ xuống “{limit}” vì áo có rủi ro (không vượt mức cho phép)."})
        if _words(s["voiceover"]) > s["duration"] * WORDS_PER_SECOND:
            warnings.append({"where": s["key"], "code": "voiceover_too_long",
                             "message": f"{s['key']}: lời thoại dài quá {s['duration']} giây (khoảng {s['duration'] * WORDS_PER_SECOND} từ)."})
        warnings += lint_text({f"{s['key']} lời thoại": s["voiceover"], f"{s['key']} chữ": s["on_screen_text"]}, garment)
        out.append(s)
    if len(out) > 1 and sum(1 for s in out if s["camera_move"] == "static") > 1:
        warnings.append({"where": out[0]["key"], "code": "camera_mostly_static",
                         "message": "Chỉ nên có tối đa một shot đứng yên; hiện có " + str(sum(1 for s in out if s["camera_move"] == "static")) + " shot tĩnh."})
    if out[0]["role"] != "hook":
        warnings.append({"where": out[0]["key"], "code": "no_hook", "message": "Shot đầu tiên nên là hook."})
    if len(out) > 1 and out[-1]["role"] != "cta":
        warnings.append({"where": out[-1]["key"], "code": "no_cta", "message": "Shot cuối nên là lời kêu gọi hành động (CTA)."})
    target = _total_seconds(params)
    planned = sum(s["duration"] for s in out)
    if abs(planned - target) > 3:
        warnings.append({"where": out[0]["key"], "code": "total_mismatch", "message": f"Tổng các shot là {planned} giây, mục tiêu {target} giây."})
    return {"items": out, "motion_limit": limit, "total_seconds": planned, "warnings": warnings}


def normalize_script(content: dict[str, Any], inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    garment = _garment(inputs)
    shots = load_input(inputs, "shot_plan").get("items") or []
    shot_keys = {s.get("key") for s in shots}
    items = []
    for it in content.get("items") or []:
        if isinstance(it, dict):
            items.append({"shot": _s(it.get("shot")), "voiceover": _s(it.get("voiceover")),
                          "on_screen_text": _s(it.get("on_screen_text"))})
    if not items:
        raise PlanError("Cần lời thoại cho ít nhất một shot.")
    tags: list[str] = []
    for t in content.get("hashtags") or []:
        tag = _s(t)
        tag = tag if tag.startswith("#") else f"#{tag}" if tag else ""
        if tag and tag not in tags:
            tags.append(tag)
    out = {"items": items, "caption": _s(content.get("caption")), "hashtags": tags, "cta": _s(content.get("cta"))}
    fields = {f"{i['shot'] or 'shot'} lời thoại": i["voiceover"] for i in items}
    fields.update({f"{i['shot'] or 'shot'} chữ": i["on_screen_text"] for i in items})
    fields.update({"caption": out["caption"], "CTA": out["cta"]})
    warnings = lint_text(fields, garment)
    for i in items:
        if shot_keys and i["shot"] not in shot_keys:
            warnings.append({"where": i["shot"], "code": "unknown_shot", "message": f"Lời thoại gắn với shot không có trong kế hoạch: “{i['shot']}”."})
    for s in shots:
        if s.get("key") not in {i["shot"] for i in items}:
            warnings.append({"where": s.get("key", ""), "code": "missing_shot", "message": f"Chưa có lời thoại cho {s.get('key')}."})
    out["warnings"] = warnings
    return out


# ── biến cho mẫu prompt ────────────────────────────────────────────────────────
def _compact(d: dict[str, Any], drop: tuple[str, ...] = ("risk",)) -> dict[str, Any]:
    return {k: v for k, v in d.items() if k not in drop}


def vars_angle(params: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    g = _garment(inputs)
    return {"garment": {**_compact(g), "risk": g.get("risk", {})}, "brief": _brief(inputs)}


def vars_hook(params: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    g = _garment(inputs)
    return {"garment": {**_compact(g), "risk": g.get("risk", {})}, "angle": _chosen_angle(inputs), "brief": _brief(inputs),
            "count": _int(params.get("count"), 5, 1, 5)}


def _total_seconds(params: dict[str, Any]) -> int:
    return _int(params.get("total_seconds"), DEFAULT_TOTAL_SECONDS, 6, 90)


def vars_shot_plan(params: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    g = _garment(inputs)
    hook = _chosen_hook(inputs)
    return {"garment": {**_compact(g), "risk": g.get("risk", {})}, "angle": _chosen_angle(inputs),
            "hook": {k: hook.get(k, "") for k in ("type", "voiceover", "on_screen_text", "visual")} if hook else {},
            "style": {k: v for k, v in load_input(inputs, "style").items() if v}, "brief": _brief(inputs),
            "master_scene": master_scene(load_input(inputs, "style")),
            "shot_rule": _shot_rule(params), "total_seconds": _total_seconds(params), "motion_limit": _motion_limit(inputs, params)}


def _shot_rule(params: dict[str, Any]) -> str:
    """Người dùng chọn số shot thì làm đúng; để tự động thì model đề xuất quanh mốc theo tổng thời lượng."""
    chosen = _int(params.get("shots"), 0, 0, 8)
    if chosen:
        return f"exactly {chosen} shots."
    n = recommended_shots(_total_seconds(params))
    return f"you decide the best number of shots for this product, normally about {n} (between 2 and 8)."


def vars_script(params: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    g = _garment(inputs)
    return {"garment": {**_compact(g), "risk": g.get("risk", {})}, "brief": _brief(inputs),
            "shots": load_input(inputs, "shot_plan").get("items") or []}


@dataclass(frozen=True)
class PlanSpec:
    step: str
    template_id: str
    variables: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]
    normalize: Callable[[dict[str, Any], dict[str, Any], dict[str, Any]], dict[str, Any]]


SPECS: dict[str, PlanSpec] = {
    "angle": PlanSpec("angle", "system:angle", vars_angle, normalize_angle),
    "hook": PlanSpec("hook", "system:hook", vars_hook, normalize_hook),
    "shot_plan": PlanSpec("shot_plan", "system:shot_plan", vars_shot_plan, normalize_shot_plan),
    "script": PlanSpec("script", "system:script", vars_script, normalize_script),
}


def build_request(spec: PlanSpec, prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, Any],
                  note: str = "") -> dict[str, Any]:
    if not _garment(inputs):
        raise PlanError("Chưa có hồ sơ áo.")
    pref = params.get("prompt") or {}
    changes = str(pref.get("changes") or "").strip()
    rendered = prompts.render(pref.get("template_id") or spec.template_id, version=pref.get("version"),
                              variables=spec.variables(params, inputs), changes=changes)
    rendered["ref_order"] = []
    rendered["warnings"] = [w for w in rendered["warnings"] if w["code"] not in ("ref_count_mismatch", "too_many_refs")]
    looks = inputs.get("look") or []
    if spec.step == "shot_plan" and looks and looks[0].get("path"):
        rendered["_image_paths"] = [looks[0]["path"]]          # nhà dựng cảnh nhìn thấy người mẫu và áo thật đã duyệt
    return rendered


def make_executor(spec: PlanSpec) -> Callable[[ExecContext], ExecResult]:
    def run(ctx: ExecContext) -> ExecResult:
        req = build_request(spec, ctx.prompts, ctx.params, ctx.inputs, ctx.note)
        raw, provider = llm.call_llm(req["prompt"], req.get("_image_paths") or None)
        content = spec.normalize(llm.extract_json(raw), ctx.inputs, ctx.params)
        return ExecResult([ArtifactSpec("json", json=content, meta={
            "provider": provider, "template": req["template"], "prompt": req["prompt"], "raw": raw[:4000]})])
    return run
