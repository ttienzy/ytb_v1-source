"""Gemini AI YouTube Channel Scout & Recommendation."""
from __future__ import annotations

import json
import re
from typing import Any

from app.core.config import TOOLS_DIR

RECOMMEND_PROMPT_PATH = TOOLS_DIR / "Backend" / "prompts" / "discover" / "recommend_channels.prompt.txt"


def scout_channels_with_gemini(query: str) -> list[dict[str, Any]]:
    """Gọi Gemini AI để tìm kiếm và đề xuất kênh YouTube phù hợp theo System Prompt."""
    try:
        from app.ai.gemini.recap import _call_gemini_stream, _parse_stream_frames

        prompt_template = ""
        if RECOMMEND_PROMPT_PATH.exists():
            try:
                prompt_template = RECOMMEND_PROMPT_PATH.read_text(encoding="utf-8")
            except Exception:
                pass

        if prompt_template and "{query}" in prompt_template:
            prompt = prompt_template.replace("{query}", query)
        else:
            prompt = (
                f"Analyze YouTube food & culinary channels for: \"{query}\". "
                f"Recommend 6-8 top English channels in strict JSON format."
            )

        # Accompanying chat message that instructs Gemini what to do with the attached prompt file
        chat_message = f"Please scout and recommend 6-8 top English food YouTube channels for: \"{query}\""

        stream_resp = _call_gemini_stream(
            prompt_text=prompt,
            filename="discover_channels.txt",
            query_text=chat_message,
            allow_refresh=False,
        )

        # Parse candidates from Gemini StreamGenerate frames
        payloads = _parse_stream_frames(stream_resp)
        candidates: list[str] = []
        for p in payloads:
            try:
                rc_block = p[4]
                for rc in rc_block:
                    if isinstance(rc, list) and len(rc) >= 2 and isinstance(rc[1], list) and rc[1]:
                        txt = rc[1][0]
                        if isinstance(txt, str) and len(txt) > 10:
                            candidates.append(txt)
            except Exception:
                pass

        if not candidates and stream_resp:
            candidates.append(stream_resp)

        # Extract JSON Array from candidates
        for txt in candidates:
            # 1. Code fence ```json ... ```
            if "```" in txt:
                start = txt.find("```")
                end = txt.rfind("```")
                if start != -1 and end > start:
                    c = txt[start + 3:end].strip()
                    if c.startswith("json"):
                        c = c[4:].strip()
                    try:
                        data = json.loads(c)
                        if isinstance(data, list) and len(data) > 0:
                            return data
                    except json.JSONDecodeError:
                        pass

            # 2. Direct regex array search [ { ... } ]
            m = re.search(r"\[\s*\{.*\}\s*\]", txt, re.DOTALL)
            if m:
                try:
                    data = json.loads(m.group(0))
                    if isinstance(data, list) and len(data) > 0:
                        return data
                except json.JSONDecodeError:
                    pass

    except Exception as exc:
        print(f"[Discover Scout] Gemini recommendation failed: {exc}")

    return []
