"""Gọi LLM dạng văn bản (Gemini web) + tách/sửa JSON khỏi câu trả lời. Một chỗ duy nhất để test thay thế."""
from __future__ import annotations

import json
import re
from typing import Any


class LlmJsonError(ValueError):
    """Câu trả lời của LLM không phải JSON dùng được."""


def call_llm(prompt: str, image_paths: list[str] | None = None) -> tuple[str, str]:
    """Trả (văn bản thô, nhà cung cấp). Dùng Gemini web đã đăng nhập sẵn trong Cài đặt."""
    from app.workflow.service import execute_gemini_analysis
    return execute_gemini_analysis(prompt, list(image_paths or []))


_TRAILING_COMMA = re.compile(r",\s*([}\]])")
_SMART_QUOTES = {"“": '"', "”": '"', "‘": "'", "’": "'"}


def _slice(raw: str) -> str:
    text = (raw or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S | re.I)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0:
        raise LlmJsonError("Gemini không trả về JSON. Đầu câu trả lời: " + (raw or "")[:200].replace("\n", " "))
    return text[start:end + 1] if end > start else text[start:]      # thiếu ngoặc đóng: để repair_json bù


def repair_json(text: str) -> str:
    """Sửa các lỗi JSON Gemini hay mắc: dấu phẩy thừa trước } ], dấu ngoặc kép cong, thiếu ngoặc đóng cuối chuỗi."""
    out = text
    for k, v in _SMART_QUOTES.items():
        out = out.replace(k, v)
    out = _TRAILING_COMMA.sub(r"\1", out)
    # Cân bằng ngoặc đóng ở cuối (câu trả lời bị cắt giữa chừng).
    opens, closes = out.count("{"), out.count("}")
    if opens > closes:
        if out.count('"') % 2 == 1:
            out += '"'
        out += "]" * max(0, out.count("[") - out.count("]")) + "}" * (opens - closes)
    return out


def extract_json(raw: str) -> dict[str, Any]:
    text = _slice(raw)
    data: Any = None
    last: json.JSONDecodeError | None = None
    for candidate in (text, repair_json(text)):
        try:
            data = json.loads(candidate, strict=False)
            break
        except json.JSONDecodeError as exc:
            last = exc
    if data is None:
        raise LlmJsonError(f"JSON của Gemini không hợp lệ ({last.msg if last else '?'}). Đầu câu trả lời: {(raw or '')[:200]}".replace("\n", " "))
    if not isinstance(data, dict):
        raise LlmJsonError("Gemini trả về JSON không phải đối tượng.")
    return data


RETRY_SUFFIX = ("\n\nIMPORTANT: your previous answer was not valid JSON. Answer again with ONLY one valid JSON object, "
                "no markdown fences, no comments, no trailing commas.")


def call_llm_json(prompt: str, image_paths: list[str] | None = None, retries: int = 1) -> tuple[dict[str, Any], str, str]:
    """Gọi LLM và tách JSON; JSON hỏng thì gọi lại tối đa `retries` lần (bước LLM không tốn credit). Trả (json, raw, provider)."""
    attempt = 0
    while True:
        raw, provider = call_llm(prompt if attempt == 0 else prompt + RETRY_SUFFIX, image_paths)
        try:
            return extract_json(raw), raw, provider
        except LlmJsonError:
            if attempt >= retries:
                raise
            attempt += 1
