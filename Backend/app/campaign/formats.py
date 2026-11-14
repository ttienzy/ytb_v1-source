"""Format quảng cáo: bản thiết kế có sẵn của một video (số cảnh, danh sách shot với vai, thời lượng, máy quay, gợi ý beat).

Dữ liệu nằm trong `formats/*.json` để cập nhật theo thị trường mà không đổi code. LLM chỉ điền nội dung vào khung này
(docs/PLAN_campaign_v3_format_director.md §5.3); số shot, thời lượng, số beat do code quyết, không nhờ LLM đếm.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FORMATS_DIR = Path(__file__).resolve().parent / "formats"
ROLES = ("hook", "proof", "detail", "cta")
MOTIONS = ("minimal", "gentle", "free")
GARMENT_REFS = ("front", "detail", "back")
HOOK_TYPES = ("direct", "pain_question", "surprise_visual", "number_signal", "story")
DEFAULT_FORMAT = "fit_check"
MIN_DURATION, MAX_DURATION = 3, 15
# Thứ tự hiển thị: format dễ làm nhất trước.
ORDER = ("fit_check", "detail_first", "hero_piece", "occasions", "grwm")


class FormatError(ValueError):
    pass


def _validate(fmt: dict[str, Any], name: str) -> dict[str, Any]:
    for key in ("id", "name_vi", "desc_vi", "scenes", "shots"):
        if key not in fmt:
            raise FormatError(f"{name}: thiếu trường '{key}'")
    if not isinstance(fmt["shots"], list) or not fmt["shots"]:
        raise FormatError(f"{name}: shots phải là danh sách không rỗng")
    scenes = int(fmt["scenes"])
    if not 1 <= scenes <= 3:
        raise FormatError(f"{name}: scenes phải từ 1 tới 3")
    for i, shot in enumerate(fmt["shots"], start=1):
        if shot.get("role") not in ROLES:
            raise FormatError(f"{name} shot {i}: role '{shot.get('role')}' không hợp lệ")
        if not 1 <= int(shot.get("scene", 1)) <= scenes:
            raise FormatError(f"{name} shot {i}: scene {shot.get('scene')} ngoài 1..{scenes}")
        if not MIN_DURATION <= int(shot.get("duration", 0)) <= MAX_DURATION:
            raise FormatError(f"{name} shot {i}: duration phải 3–15")
        cam = shot.get("camera") or {}
        for k in ("angle", "lens", "move"):
            if not str(cam.get(k) or "").strip():
                raise FormatError(f"{name} shot {i}: camera.{k} trống")
        if shot.get("motion", "gentle") not in MOTIONS:
            raise FormatError(f"{name} shot {i}: motion không hợp lệ")
        if shot.get("garment_ref", "front") not in GARMENT_REFS:
            raise FormatError(f"{name} shot {i}: garment_ref không hợp lệ")
        if not str(shot.get("beat_hint") or "").strip():
            raise FormatError(f"{name} shot {i}: thiếu beat_hint")
    if fmt["shots"][0]["role"] != "hook" or fmt["shots"][-1]["role"] != "cta":
        raise FormatError(f"{name}: shot đầu phải là hook, shot cuối phải là cta")
    for t in fmt.get("hook_types") or []:
        if t not in HOOK_TYPES:
            raise FormatError(f"{name}: hook_type '{t}' không hợp lệ")
    return fmt


def _load() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for path in sorted(FORMATS_DIR.glob("*.json")):
        fmt = _validate(json.loads(path.read_text(encoding="utf-8")), path.name)
        out[fmt["id"]] = fmt
    if DEFAULT_FORMAT not in out:
        raise FormatError(f"Thiếu format mặc định {DEFAULT_FORMAT}")
    return out


FORMATS: dict[str, dict[str, Any]] = _load()


def total_seconds(fmt: dict[str, Any]) -> int:
    return sum(int(s["duration"]) for s in fmt["shots"])


def summary(fmt: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": fmt["id"], "name_vi": fmt["name_vi"], "desc_vi": fmt["desc_vi"], "best_for_vi": fmt.get("best_for_vi", ""),
        "scenes": int(fmt["scenes"]), "shots": len(fmt["shots"]), "total_seconds": total_seconds(fmt),
        "hook_types": list(fmt.get("hook_types") or []),
        "shot_list": [{"role": s["role"], "scene": int(s.get("scene", 1)), "duration": int(s["duration"]),
                       "needs_face": bool(s.get("needs_face", True)), "camera": dict(s["camera"]),
                       "garment_ref": s.get("garment_ref", "front"), "motion": s.get("motion", "gentle")} for s in fmt["shots"]],
    }


def list_formats() -> list[dict[str, Any]]:
    keys = [k for k in ORDER if k in FORMATS] + [k for k in FORMATS if k not in ORDER]
    return [summary(FORMATS[k]) for k in keys]


def get_format(format_id: str) -> dict[str, Any] | None:
    return FORMATS.get(format_id)


def resolve(params: dict[str, Any] | None) -> dict[str, Any]:
    """Format của chiến dịch theo tham số bước `format`; thiếu/sai thì mặc định."""
    fmt = get_format(str((params or {}).get("format_id") or ""))
    return fmt if fmt is not None else FORMATS[DEFAULT_FORMAT]
