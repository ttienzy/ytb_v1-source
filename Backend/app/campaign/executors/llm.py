"""Gọi LLM dạng văn bản (Gemini web) + tách JSON khỏi câu trả lời. Một chỗ duy nhất để test thay thế."""
from __future__ import annotations

import json
import re
from typing import Any


class LlmJsonError(ValueError):
    """Câu trả lời của LLM không phải JSON dùng được. Không tự thử lại (mỗi lần gọi đều là một lượt LLM)."""


def call_llm(prompt: str, image_paths: list[str] | None = None) -> tuple[str, str]:
    """Trả (văn bản thô, nhà cung cấp). Dùng Gemini web đã đăng nhập sẵn trong Cài đặt."""
    from app.workflow.service import execute_gemini_analysis
    return execute_gemini_analysis(prompt, list(image_paths or []))


def extract_json(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S | re.I)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise LlmJsonError("Gemini không trả về JSON. Đầu câu trả lời: " + (raw or "")[:200].replace("\n", " "))
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise LlmJsonError(f"JSON của Gemini không hợp lệ ({exc.msg}). Đầu câu trả lời: {(raw or '')[:200]}".replace("\n", " ")) from exc
    if not isinstance(data, dict):
        raise LlmJsonError("Gemini trả về JSON không phải đối tượng.")
    return data
