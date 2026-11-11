"""Executor `voice` (Khối 8): lời thoại từng shot -> giọng đọc VieNeu (voice-service), mỗi shot một file wav. 0 credit Flow.

Bundle trả về có vai trò = khóa shot ("shot:1"...), để bước ghép biết đoạn tiếng nào của shot nào.
"""
from __future__ import annotations

import asyncio
import io
import json
import zipfile
from typing import Any

from ..runner import ArtifactSpec, ExecContext, ExecResult
from .planning import load_input


class VoiceError(RuntimeError):
    pass


def voice_lines(script: dict[str, Any]) -> list[tuple[str, str]]:
    """[(khóa shot, lời thoại)] theo thứ tự lời thoại; bỏ shot không có lời."""
    out = []
    for it in script.get("items") or []:
        text = str(it.get("voiceover") or "").strip()
        if text and it.get("shot"):
            out.append((str(it["shot"]), text))
    return out


def _tts_batch(items: list[dict[str, str]], voice_id: str) -> bytes:
    from app.voices import voice_client
    return asyncio.run(voice_client.tts_batch(items, voice_id))


def run_voice(ctx: ExecContext) -> ExecResult:
    voice_id = str(ctx.params.get("voice_id") or "").strip()
    if not voice_id:
        raise VoiceError("Chưa chọn giọng đọc. Chọn một giọng ở khối Ghép & Xuất rồi chạy lại.")
    lines = voice_lines(load_input(ctx.inputs, "script"))
    if not lines:
        raise VoiceError("Chưa có lời thoại nào để đọc (bước Lời thoại & caption).")
    ctx.report(f"Đang đọc {len(lines)} đoạn bằng giọng {voice_id} (CPU, có thể mất vài chục giây)…")
    try:
        zip_bytes = _tts_batch([{"text": t} for _, t in lines], voice_id)
    except Exception as exc:  # noqa: BLE001
        raise VoiceError(f"Voice-service lỗi: {exc}. Kiểm tra dịch vụ giọng đọc đang chạy ở cổng 8001.") from exc
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    durations = {int(it["index"]): float(it.get("duration") or 0) for it in json.loads(zf.read("manifest.json")).get("items", [])}
    artifacts: list[ArtifactSpec] = []
    for i, (shot, text) in enumerate(lines):
        artifacts.append(ArtifactSpec("audio", ext="wav", data=zf.read(f"vo_{i}.wav"),
                                      meta={"shot": shot, "text": text, "seconds": durations.get(i, 0.0), "voice_id": voice_id}))
    artifacts.append(ArtifactSpec("bundle", members=[(i, shot) for i, (shot, _) in enumerate(lines)],
                                  meta={"voice_id": voice_id, "shots": [s for s, _ in lines]}))
    return ExecResult(artifacts, primary=len(artifacts) - 1)
