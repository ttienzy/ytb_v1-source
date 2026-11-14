"""Executor `clip` (Khối 5): khung chốt cảnh + cast sheet + ảnh áo thật -> clip Ingredients qua Flow (Omni 1.2 r2v). TỐN CREDIT.

Quy tắc bất di bất dịch: KHÔNG BAO GIỜ gửi lại lệnh tạo video.
  * Chỉ lỗi ĐÃ CHẮC CHẮN xảy ra trước khi Flow nhận lệnh (bridge/extension/đăng nhập/captcha/upload ảnh) mới là lỗi thường.
  * Mọi lỗi khác sau khi đã đưa job cho Veo (mất kết nối, quá thời gian, Flow từ chối/hủy...) -> `SubmittedUnknown`:
    run chuyển "unknown", chặn chạy lại cho tới khi người dùng xác nhận.
  * Gửi cùng một vân tay hai lần thì Veo nhận ra (idempotency_key) và trả lại job cũ, không tạo job mới.
Ảnh tham chiếu theo VAI (Flow Help: gọi ingredient theo vai bằng lời): khung chốt của CẢNH mà shot dùng, cast sheet, ảnh áo
(mặt trước hoặc cận chi tiết theo shot). Prompt theo công thức của Google: chủ thể, bối cảnh, máy quay, mốc thời gian, diễn xuất, âm thanh.
"""
from __future__ import annotations

import time
from typing import Any

from .. import graph
from ..prompts import PromptLibrary
from ..runner import ArtifactSpec, ExecContext, ExecResult, SubmittedUnknown
from . import common
from .common import MOTION_RANK, s
from .providers import FlowProvider
from .scene_plate import scene_vars

DEFAULT_TEMPLATE = "system:clip_v3"
DEFAULT_ASPECT = "9:16"
PROMPT_MAX = 2000                   # giới hạn của VeoJobRequest.prompt
POLL_SECONDS = 3.0
TIMEOUT_SECONDS = 1200.0            # 20 phút
MIN_DURATION, MAX_DURATION = 3, 15
# Veo error_code chắc chắn xảy ra TRƯỚC khi Flow nhận lệnh (không mất credit, thử lại được).
SAFE_ERROR_CODES = {"BRIDGE_OFFLINE", "EXTENSION_DISCONNECTED", "FLOW_AUTH_REQUIRED", "CAPTCHA_QUEUE_BUSY",
                    "CAPTCHA_FAILED", "REFERENCE_INVALID", "NOT_SUBMITTED"}
# Flow ĐÃ nhận lệnh nhưng chính Flow báo render thất bại (kết quả cuối cùng, không còn "không rõ").
RENDER_FAILED_CODES = {"FLOW_RENDER_FAILED"}

MOTION_TEXT = {
    "minimal": "very subtle, natural movement only (breathing, a slight weight shift, hands and fabric); no walking, no turning, no big gestures",
    "gentle": "gentle, natural movement (small steps or a slow turn, soft gestures); no spinning, no fast motion",
    "free": "natural, confident movement that follows the beats: walking, turning, posing",
}
SOUND_DEFAULT = "the natural ambience of the location (soft room tone or quiet street)"


class ClipInputError(ValueError):
    pass


def _veo():
    from app.veo import service
    return service


def _provider() -> FlowProvider:
    return FlowProvider(_veo())


def effective_motion(shot: dict[str, Any], garment: dict[str, Any]) -> str:
    """Chuyển động của shot, không vượt trần: trần ghi trong shot (người dùng có thể đặt) hoặc theo rủi ro của áo."""
    limit = shot.get("motion_cap") or ((garment.get("risk") or {}).get("motion_limit")) or "free"
    want = str(shot.get("motion") or limit)
    rank = min(MOTION_RANK.get(want, MOTION_RANK["free"]), MOTION_RANK.get(limit, MOTION_RANK["free"]))
    return common.MOTION_BY_RANK[rank]


def timeline(beats: list[str], duration: int) -> str:
    """Mỗi beat thành một mốc thời gian `[0-3s] ...`, chia đều theo thời lượng clip (Google: timecode mỗi dòng)."""
    n = len(beats)
    if n == 0:
        return f"[0-{duration}s] The person holds a relaxed, natural stance and breathes; the camera does the moving."
    marks = [round(i * duration / n) for i in range(n + 1)]
    return "\n".join(f"[{marks[i]}-{marks[i + 1]}s] {b}" for i, b in enumerate(beats))


def shot_beats(shot: dict[str, Any]) -> list[str]:
    raw = shot.get("beats")
    return [s(b.get("action") if isinstance(b, dict) else b) for b in (raw if isinstance(raw, list) else []) if s(b.get("action") if isinstance(b, dict) else b)]


def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, list[dict[str, Any]]],
                  note: str = "") -> dict[str, Any]:
    anchors, sheets, items = inputs.get("scene_anchor") or [], inputs.get("cast_sheet") or [], inputs.get("script") or []
    if not items or "item" not in items[0]:
        raise ClipInputError("Chưa có shot tương ứng trong kịch bản (khối 3).")
    shot = items[0]["item"]
    if not anchors:
        raise ClipInputError(f"Chưa có khung chốt đã duyệt cho cảnh {shot.get('scene') or ''} (khối 4).")
    if not sheets:
        raise ClipInputError("Chưa có cast sheet đã duyệt (khối 2).")
    photo = common.garment_photo(inputs, str(shot.get("garment_ref") or "front"))
    if photo is None:
        raise ClipInputError("Chưa có ảnh áo thật (khối 1).")
    scenes = inputs.get("scene_set") or []
    scene = scene_vars(scenes[0]["item"]) if scenes and "item" in scenes[0] else scene_vars({"key": shot.get("scene"), "place": "the location shown in the photo"})
    garment = common.garment_of(inputs)
    tier = str(params.get("_tier") or "draft")
    if tier not in graph.TIERS:
        raise ClipInputError(f"tier không hợp lệ: {tier}")
    try:
        duration = int(params.get("duration") or shot.get("duration") or 5)
    except (TypeError, ValueError):
        duration = 5
    if not MIN_DURATION <= duration <= MAX_DURATION:
        raise ClipInputError(f"Thời lượng {duration} giây không hợp lệ: Ingredients nhận {MIN_DURATION}–{MAX_DURATION} giây.")
    aspect = str(params.get("aspect") or DEFAULT_ASPECT)
    if aspect not in ("9:16", "16:9"):
        raise ClipInputError(f"Tỉ lệ không hỗ trợ: {aspect}")
    anchor_aspect = str((anchors[0].get("meta") or {}).get("aspect") or "")
    if anchor_aspect and anchor_aspect != aspect:
        raise ClipInputError(f"Khung chốt cảnh được tạo cho tỉ lệ {anchor_aspect} nhưng clip đang đặt {aspect}. Đặt cùng một tỉ lệ cho cả hai.")
    resolution = graph.TIER_RESOLUTION[tier]
    motion = effective_motion(shot, garment)
    cam = shot.get("camera") if isinstance(shot.get("camera"), dict) else {}
    needs_face = shot.get("needs_face", True) is not False
    expression = s(shot.get("expression"))
    performance = (f"{expression}" if expression else "natural, alive, a soft confident presence") if needs_face else \
        "no face in frame: the hands, the fabric and the camera carry the action"
    template_id, version = common.template_pref(params, DEFAULT_TEMPLATE)
    variables = {
        "duration": duration, "aspect_label": common.ASPECT_LABEL.get(aspect, aspect),
        "cut_rule": "one single continuous shot, no scene cuts.",
        "presentation": common.presentation_of(inputs), "scene": scene,
        "camera": {"angle": s(cam.get("angle")) or "eye-level", "lens": s(cam.get("lens")) or "35mm", "move": s(cam.get("move")) or "slow dolly in"},
        "timeline": timeline(shot_beats(shot), duration), "performance": performance, "motion_text": MOTION_TEXT[motion],
        "sound": SOUND_DEFAULT, "style": common.style_of(inputs), **common.garment_vars(garment),
    }
    refs = [("sheet", "Cast sheet (khối 2)", sheets[0]), ("photo", "Ảnh áo thật (khối 1)", photo), ("anchor", f"Khung chốt cảnh (khối 4)", anchors[0])]
    rendered = prompts.render(template_id, version=version, variables=variables, changes=common.changes_with_note(params, note),
                              ref_paths=[r[2]["path"] for r in refs])
    rendered["ref_order"] = [{"role": role, "label": label, "path": r["path"], "artifact_id": r["artifact_id"]} for role, label, r in refs]
    warnings = [w for w in rendered["warnings"] if w["code"] not in ("ref_count_mismatch", "missing_variables")]
    if len(rendered["prompt"]) > PROMPT_MAX:
        warnings.append({"code": "prompt_too_long", "message": f"Prompt dài {len(rendered['prompt'])} ký tự, vượt giới hạn {PROMPT_MAX} của Flow."})
    if not shot_beats(shot):
        warnings.append({"code": "beats_missing", "message": "Shot chưa có beat nào: video sẽ chỉ theo mô tả máy quay."})
    rendered["warnings"] = warnings
    credit = graph.clip_cost({"duration": duration}, tier)
    rendered.update({
        "tier": tier, "resolution": resolution, "aspect": aspect, "duration": duration, "motion": motion, "mode": "r2v",
        "model": FlowProvider.model_id(duration, resolution),
        "credit": credit, "credit_known": credit is not None, "credit_estimate": graph.clip_cost_estimate({"duration": duration}, tier),
        "shot": shot.get("key", ""), "scene": s(shot.get("scene")),
    })
    return rendered


def _classify_failure(state: Any, job_id: str) -> Exception:
    code = str(getattr(state, "error_code", "") or "")
    message = str(getattr(state, "error_message", "") or "Veo báo lỗi")[:1000]
    if code in SAFE_ERROR_CODES:
        return RuntimeError(f"{message} (chưa mất credit; có thể thử lại)")
    if code == "FLOW_PROMINENT_PEOPLE":
        return RuntimeError(
            "Flow chặn clip vì bộ lọc người nổi tiếng (PROMINENT_PERSON) nhận diện khuôn mặt trong ảnh tham chiếu. "
            "Thường không bị trừ credit, nhưng chạy lại với cùng khuôn mặt sẽ lỗi lại: ĐỪNG chạy lại y nguyên. Dùng nhân vật hư cấu rõ "
            "ràng (ảnh AI tạo mới, không dựa trên ảnh người thật) rồi tạo lại cast sheet và khung chốt. Bộ lọc này đôi khi chặn nhầm cả nhân vật "
            f"hư cấu: nếu đúng vậy, báo cáo qua phản hồi của Flow. Job Veo {job_id}.")
    if code in RENDER_FAILED_CODES:
        return RuntimeError(f"Flow đã nhận lệnh nhưng render thất bại: {message}. Job Veo {job_id}. "
                            "Kiểm tra số dư credit và ô lỗi trong Flow; chạy lại y nguyên thường sẽ lỗi lại — đổi prompt/khung chốt trước.")
    return SubmittedUnknown(f"{message} [{code or 'UNKNOWN'}]. Job Veo {job_id} có thể đã được gửi lên Flow: "
                            "kiểm tra Flow trước khi chạy lại.")


def run_clip(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, {**ctx.params, "_tier": ctx.tier}, ctx.inputs, ctx.note)
    if len(req["prompt"]) > PROMPT_MAX:
        raise ClipInputError(f"Prompt dài {len(req['prompt'])} ký tự, vượt giới hạn {PROMPT_MAX}. Rút gọn prompt rồi chạy lại.")
    provider = _provider()
    project_id = provider.active_project_id()
    if project_id is None:
        raise ClipInputError("Chưa chọn project Veo. Vào Veo Studio, tạo/chọn project rồi mở project đó trong tab Flow.")
    if ctx.cancelled():
        raise RuntimeError("Đã hủy trước khi gửi lên Flow.")
    try:
        # Cùng vân tay + cùng lần thử = cùng lệnh (Veo trả lại job cũ). Lần chạy lại sau khi người dùng xác nhận/sửa là lần thử mới.
        job_id, dedup = provider.submit(prompt=req["prompt"], aspect=req["aspect"], duration=req["duration"], resolution=req["resolution"],
                                        project_id=project_id, image_paths=[r["path"] for r in req["ref_order"]],
                                        idempotency_key=f"cmp-{ctx.fingerprint[:40]}-a{ctx.attempt}")
    except ValueError as exc:                        # kiểm tra đầu vào ở đây: lỗi = CHƯA gửi gì
        raise ClipInputError(str(exc)) from exc
    ctx.set_external_ref(job_id)
    ctx.report(f"Đã đưa job {job_id} cho Veo" + (" (dùng lại job cũ cùng vân tay)" if dedup else "") + "…")

    # Từ đây tiền có thể đã/đang bị trừ: bỏ qua yêu cầu hủy, chỉ chờ kết quả, và lỗi nào cũng thận trọng.
    deadline = time.monotonic() + TIMEOUT_SECONDS
    last_step = ""
    done, error = provider.done_status(), provider.error_status()
    while True:
        state = provider.poll(job_id)
        if state is None:
            raise SubmittedUnknown(f"Job Veo {job_id} biến mất khỏi backend. Có thể đã gửi lên Flow: kiểm tra Flow trước khi chạy lại.")
        step = f"{state.status}: {state.step}".strip(": ")
        if step != last_step:
            ctx.report(f"Flow — {step}")
            last_step = step
        if state.status == done:
            break
        if state.status == error:
            raise _classify_failure(state, job_id)
        if time.monotonic() > deadline:
            raise SubmittedUnknown(f"Quá {int(TIMEOUT_SECONDS // 60)} phút chờ Flow. Job Veo {job_id} có thể vẫn đang chạy: "
                                   "kiểm tra Flow trước khi chạy lại.")
        time.sleep(POLL_SECONDS)

    files = list(state.files or [])
    path = provider.video_path(files[0]) if files else None
    if path is None or not path.is_file():
        raise SubmittedUnknown(f"Job Veo {job_id} báo xong nhưng không thấy file video. Kiểm tra Flow/Veo Studio rồi nhận kết quả thủ công.")
    data = path.read_bytes()
    return ExecResult(
        [ArtifactSpec("video", ext="mp4", data=data, meta={
            "veo_job_id": job_id, "model": req["model"], "tier": ctx.tier, "resolution": req["resolution"],
            "duration": req["duration"], "aspect": req["aspect"], "prompt": req["prompt"], "template": req["template"],
            "motion": req["motion"], "credit_estimated": req["credit_estimate"], "shot": req["shot"], "scene": req["scene"], "mode": "r2v",
            "provider": provider.name, "refs": [r["artifact_id"] for r in req["ref_order"]],
        })],
        credit_actual=req["credit"] if req["credit"] is not None else req["credit_estimate"],   # giá đã đo, không thì dự kiến (trần ngân sách vẫn có tác dụng)
    )
