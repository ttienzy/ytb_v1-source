"""Vân tay (fingerprint) của một bước: hash của mọi thứ làm thay đổi đầu ra (docs/PLAN §3.3)."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical(obj: Any) -> str:
    """JSON chuẩn hóa: khóa sắp xếp, không khoảng trắng thừa. Cùng nội dung -> cùng chuỗi."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def sha(text: str | bytes) -> str:
    data = text.encode("utf-8") if isinstance(text, str) else text
    return hashlib.sha256(data).hexdigest()


def make_fingerprint(parts: dict[str, Any]) -> str:
    return sha(canonical(parts))


def diff_parts(old: dict[str, Any] | None, new: dict[str, Any]) -> list[str]:
    """Liệt kê thành phần nào đổi, để giải thích vì sao một bước bị "cũ".

    Trả về nhãn như "params.duration", "inputs.fact_sheet", "prompt", "tier", "logic".
    """
    old = old or {}
    reasons: list[str] = []
    for top in sorted(set(old) | set(new)):
        a, b = old.get(top), new.get(top)
        if canonical(a) == canonical(b):
            continue
        if top in ("params", "inputs") and isinstance(a or {}, dict) and isinstance(b or {}, dict):
            a, b = a or {}, b or {}
            for key in sorted(set(a) | set(b)):
                if canonical(a.get(key)) != canonical(b.get(key)):
                    reasons.append(f"{top}.{key}")
        else:
            reasons.append(top)
    return reasons
