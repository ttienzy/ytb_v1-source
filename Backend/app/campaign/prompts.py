"""Thư viện prompt: mẫu mặc định hệ thống (file, chỉ đọc) + mẫu của người dùng (DB, có phiên bản).

docs/PLAN_ai_workflow_campaign.md §3.6. Cú pháp mẫu:
  {{biến}}                 thay bằng giá trị (hỗ trợ khóa chấm: {{garment.summary}})
  {{#biến}} ... {{/biến}}  chỉ hiện khi biến có giá trị (không rỗng)
"""
from __future__ import annotations

import json
import re
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator

from sqlalchemy import select
from sqlalchemy.orm import Session

from .fingerprint import sha
from .models import PromptTemplate, new_id

DEFAULTS_DIR = Path(__file__).resolve().parent / "prompt_defaults"
MAX_REFS = 3  # ràng buộc Flow/ChatGPT: tối đa 3 ảnh tham chiếu mỗi lần

# Mẫu hệ thống: metadata ở đây, nội dung ở file. Tăng "version" khi đổi nội dung file.
SYSTEM_TEMPLATES: dict[str, dict[str, Any]] = {
    "system:look_sheet": {
        "kind": "look_sheet",
        "name": "Look sheet: nhân vật + trang phục",
        "version": 1,
        "file": "look_sheet.txt",
        "ref_slots": [
            {"role": "identity", "label": "Image 1", "desc": "Ảnh nhân vật (mặt, tóc, màu da)"},
            {"role": "outfit", "label": "Image 2", "desc": "Ảnh trang phục (loại áo, màu, logo, form, chất liệu)"},
        ],
    },
    "system:angle": {"kind": "angle", "name": "Góc kể: xếp hạng theo rủi ro áo", "version": 1, "file": "angle.txt", "ref_slots": []},
    "system:hook": {"kind": "hook", "name": "Hook: 5 kiểu mở đầu 3-6 giây", "version": 2, "file": "hook.txt", "ref_slots": []},
    "system:shot_plan": {"kind": "shot_plan", "name": "Kịch bản shot và storyboard (đề xuất số shot, thời lượng)", "version": 7,
                         "file": "shot_plan.txt", "ref_slots": []},
    "system:script": {"kind": "script", "name": "Lời thoại, caption, hashtag, CTA", "version": 1, "file": "script.txt", "ref_slots": []},
    "system:anchor_frame": {
        "kind": "anchor_frame", "name": "Khung mẫu: chốt khuôn mặt, áo, bối cảnh, ánh sáng", "version": 1, "file": "anchor_frame.txt",
        "ref_slots": [{"role": "identity", "label": "Image 1"}, {"role": "sheet", "label": "Image 2"}, {"role": "photo", "label": "Image 3"}],
    },
    "system:clip_ingredients": {
        "kind": "clip_ingredients", "name": "Clip Ingredients: khung mẫu + storyboard + ảnh áo, nhịp theo giây", "version": 2, "file": "clip_ingredients.txt",
        "ref_slots": [{"role": "anchor", "label": "Ảnh 1"}, {"role": "storyboard", "label": "Ảnh 2"}, {"role": "photo", "label": "Ảnh 3"}],
    },
    "system:storyboard": {
        "kind": "storyboard", "name": "Storyboard: nhiều khung của một shot trong một ảnh", "version": 1, "file": "storyboard.txt",
        "ref_slots": [{"role": "anchor", "label": "Image 1"}, {"role": "photo", "label": "Image 2"}],
    },
    "system:brief_suggest": {"kind": "brief_suggest", "name": "Gợi ý brief từ ảnh áo", "version": 1,
                             "file": "brief_suggest.txt", "ref_slots": []},
    "system:style_suggest": {"kind": "style_suggest", "name": "Gợi ý phong cách từ ảnh áo", "version": 1,
                             "file": "style_suggest.txt", "ref_slots": []},
    "system:fact_sheet": {
        "kind": "fact_sheet",
        "name": "Hồ sơ áo: Gemini trích từ ảnh thật",
        "version": 1,
        "file": "fact_sheet.txt",
        "ref_slots": [],
    },
}


# Mẫu đã bỏ mà chiến dịch cũ có thể còn lưu trong tham số.
RETIRED_SYSTEM_TEMPLATES = {"system:clip_video": "system:clip_ingredients"}


class PromptError(ValueError):
    pass


@dataclass(frozen=True)
class Template:
    template_id: str
    version: int
    kind: str
    name: str
    body: str
    ref_slots: tuple[dict[str, Any], ...]
    owner: str                      # system | user
    base_id: str = ""

    @property
    def body_hash(self) -> str:
        return sha(self.body)

    @property
    def read_only(self) -> bool:
        return self.owner == "system"

    def to_dict(self) -> dict[str, Any]:
        return {
            "template_id": self.template_id, "version": self.version, "kind": self.kind, "name": self.name,
            "body": self.body, "ref_slots": list(self.ref_slots), "owner": self.owner,
            "read_only": self.read_only, "base_id": self.base_id,
        }


# ── dựng prompt ────────────────────────────────────────────────────────────────
_MISSING = object()
_SECTION = re.compile(r"\{\{#([\w.]+)\}\}(.*?)\{\{/\1\}\}(\n?)", re.S)
_VAR = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")
_TESTIMONIAL = re.compile(
    r"(tôi|mình|em)\s+đã\s+(mua|dùng|mặc)|\bI\s+(bought|tried|have been using|'ve been using|wore)\b", re.I
)


def has_fake_testimonial(text: str) -> bool:
    return bool(_TESTIMONIAL.search(text or ""))


def _lookup(variables: dict[str, Any], dotted: str) -> Any:
    cur: Any = variables
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return _MISSING
    return cur


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def render_body(body: str, variables: dict[str, Any]) -> tuple[str, list[str]]:
    """Thay biến. Trả (văn bản, danh sách biến bị thiếu). Biến thiếu được thay bằng chuỗi rỗng."""
    missing: list[str] = []

    def section(m: re.Match[str]) -> str:
        value = _lookup(variables, m.group(1))
        if value is _MISSING or not _text(value).strip():
            return ""                       # mục rỗng: bỏ luôn cả dòng (không để lại dòng trống)
        return m.group(2) + m.group(3)

    def var(m: re.Match[str]) -> str:
        value = _lookup(variables, m.group(1))
        if value is _MISSING:
            if m.group(1) not in missing:
                missing.append(m.group(1))
            return ""
        return _text(value).strip()

    text = _VAR.sub(var, _SECTION.sub(section, body))
    text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
    return text, missing


def lint(text: str, ref_slots: tuple[dict[str, Any], ...], ref_count: int, missing: list[str]) -> list[dict[str, str]]:
    """Cảnh báo mềm, không chặn."""
    out: list[dict[str, str]] = []
    if missing:
        out.append({"code": "missing_variables", "message": "Thiếu biến: " + ", ".join(missing)})
    if ref_count > MAX_REFS:
        out.append({"code": "too_many_refs", "message": f"Tối đa {MAX_REFS} ảnh tham chiếu mỗi lần (đang có {ref_count})."})
    if ref_slots and ref_count != len(ref_slots):
        out.append({"code": "ref_count_mismatch",
                    "message": f"Mẫu khai báo {len(ref_slots)} ảnh tham chiếu nhưng đang có {ref_count}."})
    if _TESTIMONIAL.search(text):
        out.append({"code": "fake_testimonial", "message": "Prompt có lời chứng ngôi thứ nhất kiểu 'tôi đã mua/dùng' (rủi ro đánh giá giả)."})
    return out


# ── thư viện ───────────────────────────────────────────────────────────────────
class PromptLibrary:
    def __init__(self, session_factory: Callable[[], Session]):
        self._factory = session_factory

    @contextmanager
    def _session(self) -> Iterator[Session]:
        s = self._factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    # hệ thống
    @staticmethod
    def _system(template_id: str) -> Template | None:
        template_id = RETIRED_SYSTEM_TEMPLATES.get(template_id, template_id)
        meta = SYSTEM_TEMPLATES.get(template_id)
        if not meta:
            return None
        body = (DEFAULTS_DIR / meta["file"]).read_text(encoding="utf-8")
        return Template(template_id, int(meta["version"]), meta["kind"], meta["name"], body,
                        tuple(meta["ref_slots"]), "system")

    @staticmethod
    def _from_row(row: PromptTemplate) -> Template:
        return Template(row.template_id, row.version, row.kind, row.name, row.body,
                        tuple(json.loads(row.ref_slots_json or "[]")), "user", row.base_id)

    def get(self, template_id: str, version: int | None = None) -> Template | None:
        if template_id.startswith("system:"):
            return self._system(template_id)
        with self._session() as s:
            q = select(PromptTemplate).where(PromptTemplate.template_id == template_id, PromptTemplate.is_deleted.is_(False))
            if version is not None:
                q = q.where(PromptTemplate.version == version)
            row = s.scalars(q.order_by(PromptTemplate.version.desc())).first()
            return self._from_row(row) if row else None

    resolve = get

    def list_templates(self, kind: str | None = None) -> list[Template]:
        out = [t for tid in SYSTEM_TEMPLATES if (t := self._system(tid)) and (kind is None or t.kind == kind)]
        with self._session() as s:
            rows = s.scalars(select(PromptTemplate).where(PromptTemplate.is_deleted.is_(False))
                             .order_by(PromptTemplate.template_id, PromptTemplate.version.desc())).all()
            seen: set[str] = set()
            for r in rows:
                if r.template_id in seen:
                    continue
                seen.add(r.template_id)
                if kind is None or r.kind == kind:
                    out.append(self._from_row(r))
        return out

    def versions(self, template_id: str) -> list[Template]:
        if template_id.startswith("system:"):
            t = self._system(template_id)
            return [t] if t else []
        with self._session() as s:
            rows = s.scalars(select(PromptTemplate).where(PromptTemplate.template_id == template_id)
                             .order_by(PromptTemplate.version.desc())).all()
            return [self._from_row(r) for r in rows]

    def create(self, *, kind: str, name: str, body: str | None = None, ref_slots: list[dict[str, Any]] | None = None,
               base_id: str = "") -> Template:
        """Tạo mẫu của người dùng. Có base_id mà thiếu body/ref_slots -> sao chép từ mẫu gốc (nhân bản)."""
        if base_id:
            base = self.get(base_id)
            if base is None:
                raise PromptError(f"Không tìm thấy mẫu gốc: {base_id}")
            kind = kind or base.kind
            body = base.body if body is None else body
            ref_slots = list(base.ref_slots) if ref_slots is None else ref_slots
        if not (name or "").strip():
            raise PromptError("Tên mẫu không được để trống.")
        if not (body or "").strip():
            raise PromptError("Nội dung mẫu không được để trống.")
        template_id = f"user:{new_id(10)}"
        with self._session() as s:
            s.add(PromptTemplate(template_id=template_id, version=1, kind=kind, name=name.strip(), body=body,
                                 ref_slots_json=json.dumps(ref_slots or [], ensure_ascii=False), base_id=base_id))
        return self.get(template_id)  # type: ignore[return-value]

    def update(self, template_id: str, *, name: str | None = None, body: str | None = None,
               ref_slots: list[dict[str, Any]] | None = None) -> Template:
        """Mỗi lần sửa tạo phiên bản mới; phiên bản cũ giữ nguyên."""
        if template_id.startswith("system:"):
            raise PromptError("Mẫu hệ thống chỉ đọc. Hãy nhân bản rồi sửa bản của bạn.")
        cur = self.get(template_id)
        if cur is None:
            raise PromptError(f"Không tìm thấy mẫu: {template_id}")
        new_body = cur.body if body is None else body
        if not new_body.strip():
            raise PromptError("Nội dung mẫu không được để trống.")
        with self._session() as s:
            s.add(PromptTemplate(
                template_id=template_id, version=cur.version + 1, kind=cur.kind,
                name=(cur.name if name is None else name.strip()) or cur.name, body=new_body,
                ref_slots_json=json.dumps(list(cur.ref_slots) if ref_slots is None else ref_slots, ensure_ascii=False),
                base_id=cur.base_id,
            ))
        return self.get(template_id)  # type: ignore[return-value]

    def delete(self, template_id: str) -> None:
        if template_id.startswith("system:"):
            raise PromptError("Không xóa được mẫu hệ thống.")
        with self._session() as s:
            rows = s.scalars(select(PromptTemplate).where(PromptTemplate.template_id == template_id)).all()
            if not rows:
                raise PromptError(f"Không tìm thấy mẫu: {template_id}")
            for r in rows:
                r.is_deleted = True

    def render(self, template_id: str, *, version: int | None = None, variables: dict[str, Any] | None = None,
               changes: str = "", ref_paths: list[str] | None = None) -> dict[str, Any]:
        """Prompt cuối cùng + thứ tự ảnh tham chiếu + cảnh báo (dùng cho xem trước và cho executor)."""
        t = self.get(template_id, version)
        if t is None:
            raise PromptError(f"Không tìm thấy mẫu prompt: {template_id}" + (f" v{version}" if version else ""))
        variables = dict(variables or {})
        variables["changes"] = changes or ""
        text, missing = render_body(t.body, variables)
        refs = list(ref_paths or [])
        slots = list(t.ref_slots)
        ref_order = [
            {"role": (slots[i]["role"] if i < len(slots) else f"extra{i + 1}"),
             "label": (slots[i].get("label") if i < len(slots) else f"Image {i + 1}"),
             "path": p}
            for i, p in enumerate(refs)
        ]
        return {
            "prompt": text, "ref_order": ref_order, "missing_variables": missing,
            # Xem trước khi chưa gắn ảnh (ref_paths=None) thì không so số ảnh, tránh cảnh báo thừa.
            "warnings": lint(text, t.ref_slots, len(refs) if ref_paths is not None else len(t.ref_slots), missing),
            "template": {"template_id": t.template_id, "version": t.version, "name": t.name,
                         "body_hash": t.body_hash, "read_only": t.read_only},
        }
