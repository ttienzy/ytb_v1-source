"""Read one JSON object following an agent's optional progress messages."""

import json
import re


def reply_object(text: str) -> dict:
    blocks = re.findall(r"^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)^\s*```[ \t]*$", text, re.I | re.M)
    if blocks:
        if len(blocks) != 1:
            raise ValueError("Cần một khối JSON duy nhất.")
        text = blocks[0]
    else:
        start = re.search(r"^\s*\{", text, re.M)
        if start:
            text = text[start.start() :]
    result = json.loads(text.strip())
    if not isinstance(result, dict):
        raise ValueError("Cần một đối tượng JSON.")
    return result
