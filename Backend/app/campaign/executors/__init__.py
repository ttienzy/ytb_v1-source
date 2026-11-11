"""Executor thật của từng bước. Mỗi giai đoạn thêm một executor vào đây."""
from __future__ import annotations

from typing import Any, Callable

from ..runner import register_executor
from . import anchor, assemble, clip, fact_sheet, look, planning, storyboard, voice

# Hàm dựng prompt dùng chung cho xem trước (UI) và lúc chạy: (prompts, params, inputs, note) -> dict
PREVIEWERS: dict[str, Callable[..., dict[str, Any]]] = {
    "look": look.build_request,
    "anchor_frame": anchor.build_request,
    "fact_sheet": fact_sheet.build_request,
    "storyboard": storyboard.build_request,
    "clip": clip.build_request,
    **{key: (lambda prompts, params, inputs, note="", _spec=spec: planning.build_request(_spec, prompts, params, inputs, note))
       for key, spec in planning.SPECS.items()},
}

# Chuẩn hóa kết quả JSON, chạy sau LLM VÀ sau khi người dùng sửa tay: (content, inputs, params) -> content
NORMALIZERS: dict[str, Callable[[dict[str, Any], dict[str, Any], dict[str, Any]], dict[str, Any]]] = {
    "fact_sheet": lambda content, inputs, params: fact_sheet.normalize(content),
    **{key: spec.normalize for key, spec in planning.SPECS.items()},
}


def register_all() -> None:
    register_executor("look", look.run_look)
    register_executor("anchor_frame", anchor.run_anchor)
    register_executor("fact_sheet", fact_sheet.run_fact_sheet)
    register_executor("storyboard", storyboard.run_storyboard)
    register_executor("clip", clip.run_clip)
    register_executor("voice", voice.run_voice)
    register_executor("assemble", assemble.run_assemble)
    for key, spec in planning.SPECS.items():
        register_executor(key, planning.make_executor(spec))
