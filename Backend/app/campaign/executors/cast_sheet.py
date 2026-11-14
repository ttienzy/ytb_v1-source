"""Executor `cast_sheet` (Khối 2): ảnh nhân vật + ảnh áo thật -> cast sheet trên nền trơn bằng ChatGPT ảnh.

Cast sheet là tham chiếu nhân dạng + trang phục cho khung chốt cảnh và clip (Flow Help: ảnh chủ thể nên nền trơn).
`build_request` dùng chung cho xem trước (UI) và lúc chạy, nên prompt bạn thấy là prompt được gửi.
Thứ tự ảnh tham chiếu theo mẫu: Image 1 = nhân dạng, Image 2 = trang phục (ảnh áo mặt trước).
"""
from __future__ import annotations

from typing import Any

from ..prompts import PromptLibrary
from ..runner import ArtifactSpec, ExecContext, ExecResult
from . import common

DEFAULT_TEMPLATE = "system:cast_sheet"
DEFAULT_ASPECT = "16:9"
MAX_COUNT = 4


class CastSheetInputError(ValueError):
    pass


def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, list[dict[str, Any]]],
                  note: str = "") -> dict[str, Any]:
    identity = common.identity_photo(inputs)
    outfit = common.garment_photo(inputs, "front")
    if identity is None:
        raise CastSheetInputError("Chưa có ảnh nhân vật.")
    if outfit is None:
        raise CastSheetInputError("Chưa có ảnh sản phẩm.")
    refs = [identity, outfit]
    template_id, version = common.template_pref(params, DEFAULT_TEMPLATE)
    variables = {"presentation": common.presentation_of(inputs), **common.garment_vars(common.garment_of(inputs))}
    rendered = prompts.render(template_id, version=version, variables=variables, changes=common.changes_with_note(params, note),
                              ref_paths=[r["path"] for r in refs])
    for slot, ref in zip(rendered["ref_order"], refs):
        slot["artifact_id"] = ref["artifact_id"]
    rendered["warnings"] = [w for w in rendered["warnings"] if w["code"] != "missing_variables"]
    photos = inputs.get("garment_source") or []
    if len(photos) > 1:
        rendered["warnings"].append({"code": "extra_garment_photos",
                                     "message": f"Cast sheet chỉ dùng 1 ảnh áo ({outfit.get('role') or 'ảnh đầu tiên'}); "
                                                f"{len(photos) - 1} ảnh còn lại dùng ở khung chốt và clip."})
    if common.s(common.load_input(inputs, "cast_profile").get("real_face")).lower() == "yes":
        rendered["warnings"].append({"code": "real_face", "message": "Ảnh nhân vật là người thật: Flow có thể chặn clip (bộ lọc người nổi tiếng). "
                                                                       "Cân nhắc tạo nhân vật AI từ ảnh này trước khi tốn ảnh và credit."})
    rendered["aspect"] = str(params.get("aspect") or DEFAULT_ASPECT)
    rendered["count"] = max(1, min(int(params.get("count") or 1), MAX_COUNT))
    rendered["note"] = note
    return rendered


def run_cast_sheet(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, ctx.params, ctx.inputs, ctx.note)
    artifacts: list[ArtifactSpec] = []
    errors: list[str] = []
    for i in range(req["count"]):
        if ctx.cancelled():
            break
        ctx.report(f"Ảnh {i + 1}/{req['count']}: đang tạo cast sheet (thường 40–70 giây)…")
        try:
            artifacts.append(common.generate_image(ctx, req, "cast", {"candidate": i + 1}))
        except Exception as exc:  # noqa: BLE001 - hết hạn mức/tài khoản lỗi: dừng, giữ ảnh đã có
            errors.append(f"{type(exc).__name__}: {exc}"[:300])
            break
    if not artifacts:
        raise RuntimeError(errors[0] if errors else "Đã hủy trước khi tạo ảnh.")
    if errors:
        artifacts[0].meta["warning"] = f"Chỉ tạo được {len(artifacts)}/{req['count']} ảnh: {errors[0]}"
    return ExecResult(artifacts)
