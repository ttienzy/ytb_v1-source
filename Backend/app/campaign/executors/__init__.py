"""Executor thật của từng bước (v3). Mỗi bước compute có executor ở đây; bước nào thiếu sẽ báo rõ khi chạy."""
from __future__ import annotations

from typing import Any, Callable

from ..runner import register_executor
from . import assemble, cast_sheet, clip, export_pack, fact_sheet, scene_anchor, scene_plate, script, voice

# Hàm dựng prompt dùng chung cho xem trước (UI) và lúc chạy: (prompts, params, inputs, note) -> dict
PREVIEWERS: dict[str, Callable[..., dict[str, Any]]] = {
    "fact_sheet": fact_sheet.build_request,
    "cast_sheet": cast_sheet.build_request,
    "scene_plate": scene_plate.build_request,
    "script": script.build_request,
    "scene_anchor": scene_anchor.build_request,
    "clip": clip.build_request,
}

# Chuẩn hóa kết quả JSON, chạy sau LLM VÀ sau khi người dùng sửa tay: (content, inputs, params) -> content
NORMALIZERS: dict[str, Callable[[dict[str, Any], dict[str, Any], dict[str, Any]], dict[str, Any]]] = {
    "fact_sheet": lambda content, inputs, params: fact_sheet.normalize(content),
    "script": script.normalize_script,
}


def register_all() -> None:
    register_executor("fact_sheet", fact_sheet.run_fact_sheet)
    register_executor("cast_sheet", cast_sheet.run_cast_sheet)
    register_executor("scene_plate", scene_plate.run_scene_plate)
    register_executor("script", script.run_script)
    register_executor("scene_anchor", scene_anchor.run_scene_anchor)
    register_executor("clip", clip.run_clip)
    register_executor("voice", voice.run_voice)
    register_executor("assemble", assemble.run_assemble)
    register_executor("export_pack", export_pack.run_export_pack)
