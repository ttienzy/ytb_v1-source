"""Executor thật cho bước `look` (Ảnh mẫu mặc áo): ảnh nhân vật + ảnh áo + prompt -> look sheet bằng ChatGPT ảnh.

`build_request` dùng chung cho xem trước (UI) và cho lúc chạy, nên prompt bạn thấy là prompt được gửi.
Thứ tự ảnh tham chiếu theo mẫu prompt: Image 1 = nhân dạng (ảnh nhân vật), Image 2 = trang phục (ảnh áo).
"""
from __future__ import annotations

import time
import uuid
from typing import Any

from ..prompts import PromptLibrary
from ..runner import ArtifactSpec, ExecContext, ExecResult

DEFAULT_TEMPLATE = "system:look_sheet"
DEFAULT_ASPECT = "16:9"
MAX_COUNT = 4


class LookInputError(ValueError):
    pass


def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, list[dict[str, Any]]],
                  note: str = "") -> dict[str, Any]:
    cast = inputs.get("cast") or []
    garments = inputs.get("garment_source") or []
    if not cast:
        raise LookInputError("Chưa có ảnh nhân vật.")
    if not garments:
        raise LookInputError("Chưa có ảnh sản phẩm.")
    identity = next((c for c in cast if c.get("role") == "identity"), cast[0])
    outfit = next((g for g in garments if g.get("role") == "front"), garments[0])
    refs = [identity, outfit]

    pref = params.get("prompt") or {}
    changes = str(pref.get("changes") or "").strip()
    if note.strip():  # ghi chú từ lần từ chối cổng trước đi vào prompt lần chạy lại
        changes = (changes + "; " if changes else "") + "reviewer feedback: " + note.strip()
    rendered = prompts.render(pref.get("template_id") or DEFAULT_TEMPLATE, version=pref.get("version"),
                              changes=changes, ref_paths=[r["path"] for r in refs])
    for slot, ref in zip(rendered["ref_order"], refs):
        slot["artifact_id"] = ref["artifact_id"]
    if len(garments) > 1:
        rendered["warnings"].append({
            "code": "extra_garment_photos",
            "message": f"Look sheet chỉ dùng 1 ảnh áo ({outfit.get('role') or 'ảnh đầu tiên'}); "
                       f"{len(garments) - 1} ảnh còn lại chưa được dùng.",
        })
    rendered["aspect"] = str(params.get("aspect") or DEFAULT_ASPECT)
    rendered["count"] = max(1, min(int(params.get("count") or 1), MAX_COUNT))
    rendered["note"] = note
    return rendered


def _client():
    from app.ai.image_gen.service import get_image_client
    return get_image_client()


def _sniff_ext(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "png"


def run_look(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, ctx.params, ctx.inputs, ctx.note)
    ref_paths = [slot["path"] for slot in req["ref_order"]]
    client = _client()
    tmp = ctx.store.campaign_dir(ctx.campaign_id) / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)

    artifacts: list[ArtifactSpec] = []
    errors: list[str] = []
    for i in range(req["count"]):
        if ctx.cancelled():
            break
        dest = tmp / f"look_{uuid.uuid4().hex[:10]}.png"
        started = time.time()
        ctx.report(f"Ảnh {i + 1}/{req['count']}: đang tạo (thường 40–70 giây)…")
        try:
            client.generate(prompt=req["prompt"], dest=str(dest), ref_paths=ref_paths, aspect=req["aspect"])
            data = dest.read_bytes()
        except Exception as exc:  # noqa: BLE001 - hết hạn mức/tài khoản lỗi: dừng, giữ ảnh đã có
            errors.append(f"{type(exc).__name__}: {exc}"[:300])
            break
        finally:
            dest.unlink(missing_ok=True)
        artifacts.append(ArtifactSpec(
            "image", ext=_sniff_ext(data), data=data,
            meta={"prompt": req["prompt"], "template": req["template"], "aspect": req["aspect"],
                  "refs": [s["artifact_id"] for s in req["ref_order"]], "seconds": round(time.time() - started, 1),
                  "candidate": i + 1},
        ))
    if not artifacts:
        raise RuntimeError(errors[0] if errors else "Đã hủy trước khi tạo ảnh.")
    if errors:
        artifacts[0].meta["warning"] = f"Chỉ tạo được {len(artifacts)}/{req['count']} ảnh: {errors[0]}"
    return ExecResult(artifacts)
