"""Executor `clip` (Khối 6): khung mẫu + storyboard đã duyệt + ảnh áo thật -> clip Ingredients qua Flow (Omni 1.2 r2v). TỐN CREDIT.

Quy tắc bất di bất dịch: KHÔNG BAO GIỜ gửi lại lệnh tạo video.
  * Chỉ lỗi ĐÃ CHẮC CHẮN xảy ra trước khi Flow nhận lệnh (bridge/extension/đăng nhập/captcha/upload ảnh) mới là lỗi thường.
  * Mọi lỗi khác sau khi đã đưa job cho Veo (mất kết nối, quá thời gian, Flow từ chối/hủy...) -> `SubmittedUnknown`:
    run chuyển "unknown", chặn chạy lại cho tới khi người dùng xác nhận.
  * Gửi cùng một vân tay hai lần thì Veo nhận ra (idempotency_key) và trả lại job cũ, không tạo job mới.
Giá credit: chỉ các điểm đã xác minh (graph.FLOW_CREDIT_R2V); điểm khác là giá dự kiến, ghi rõ trên giao diện.
Prompt mặc định CHƯA được hiệu chỉnh bằng clip thật; sửa được trên giao diện.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .. import graph
from ..prompts import PromptLibrary
from ..runner import ArtifactSpec, ExecContext, ExecResult, SubmittedUnknown
from .planning import MIN_DURATION, MAX_DURATION, MOTION_RANK, load_input, shot_panels
from .storyboard import ASPECT_LABEL, LOGO_RULE, STYLE_DEFAULTS

DEFAULT_TEMPLATE = "system:clip_ingredients"
DEFAULT_ASPECT = "9:16"
PROMPT_MAX = 2000                   # giới hạn của VeoJobRequest.prompt
POLL_SECONDS = 3.0
TIMEOUT_SECONDS = 1200.0            # 20 phút
# Veo error_code chắc chắn xảy ra TRƯỚC khi Flow nhận lệnh (không mất credit, thử lại được).
SAFE_ERROR_CODES = {"BRIDGE_OFFLINE", "EXTENSION_DISCONNECTED", "FLOW_AUTH_REQUIRED", "CAPTCHA_QUEUE_BUSY",
                    "CAPTCHA_FAILED", "REFERENCE_INVALID", "NOT_SUBMITTED"}
# Flow ĐÃ nhận lệnh nhưng chính Flow báo render thất bại (kết quả cuối cùng, không còn "không rõ"). Thất bại kiểu này
# thường không bị trừ credit (số dư không đổi trong lần thử thật đầu tiên), nhưng vẫn phải kiểm tra số dư; và vì nguyên nhân
# hay nằm ở nội dung (ảnh/prompt bị bộ lọc) nên chạy lại y nguyên thường lại lỗi: đọc lý do rồi sửa.
RENDER_FAILED_CODES = {"FLOW_RENDER_FAILED"}

MOTION_TEXT = {
    "minimal": "very subtle, natural movement only (breathing, a slight weight shift, gentle hair and fabric movement); "
               "no walking, no turning, no big gestures",
    "gentle": "gentle, natural movement (small steps or a slow pose change, soft gestures); no spinning or fast motion",
    "free": "natural, confident movement that follows the storyboard beats",
}
MOTION_BY_RANK = {v: k for k, v in MOTION_RANK.items()}


class ClipInputError(ValueError):
    pass


def _veo():
    from app.veo import service
    return service


def effective_motion(shot: dict[str, Any], garment: dict[str, Any]) -> str:
    """Chuyển động của shot, không vượt trần: trần ghi trong shot (người dùng có thể đặt) hoặc, với kế hoạch cũ, theo rủi ro của áo."""
    limit = shot.get("motion_cap") or ((garment.get("risk") or {}).get("motion_limit")) or "free"
    want = str(shot.get("motion") or limit)
    rank = min(MOTION_RANK.get(want, MOTION_RANK["free"]), MOTION_RANK.get(limit, MOTION_RANK["free"]))
    return MOTION_BY_RANK[rank]


def timeline(panels: list[dict[str, Any]], duration: int) -> str:
    """Mỗi khung storyboard thành một mốc thời gian `[0-3s] ...`, chia đều theo thời lượng clip."""
    n = len(panels)
    marks = [round(i * duration / n) for i in range(n + 1)]
    return chr(10).join(f"[{marks[i]}-{marks[i + 1]}s] {p['action']}" for i, p in enumerate(panels))


def build_request(prompts: PromptLibrary, params: dict[str, Any], inputs: dict[str, list[dict[str, Any]]],
                  note: str = "") -> dict[str, Any]:
    boards, anchors, photos = inputs.get("storyboard") or [], inputs.get("anchor_frame") or [], inputs.get("garment_source") or []
    items = inputs.get("shot_plan") or []
    photo = next((p for p in photos if p.get("role") == "front"), photos[0] if photos else None)
    if not boards:
        raise ClipInputError("Chưa có storyboard đã duyệt cho shot này (khối 5).")
    if not anchors or photo is None:
        raise ClipInputError("Clip cần khung mẫu đã duyệt (khối 4) và ảnh áo thật (khối 1).")
    if not items or "item" not in items[0]:
        raise ClipInputError("Chưa có shot tương ứng trong kế hoạch.")
    shot = items[0]["item"]
    panels = shot_panels(shot)
    if not panels:
        raise ClipInputError(f"{shot.get('key', 'Shot')} chưa có nhịp nào trong kế hoạch.")
    garment, style = load_input(inputs, "fact_sheet"), load_input(inputs, "style")
    tier = str(params.get("_tier") or "draft")
    if tier not in graph.TIERS:
        raise ClipInputError(f"tier không hợp lệ: {tier}")
    try:
        duration = int(params.get("duration") or shot.get("duration") or 6)
    except (TypeError, ValueError):
        duration = 6
    if not MIN_DURATION <= duration <= MAX_DURATION:
        raise ClipInputError(f"Thời lượng {duration} giây không hợp lệ: Ingredients nhận {MIN_DURATION}–{MAX_DURATION} giây.")
    aspect = str(params.get("aspect") or DEFAULT_ASPECT)
    if aspect not in ("9:16", "16:9"):
        raise ClipInputError(f"Tỉ lệ không hỗ trợ: {aspect}")
    board_aspect = str((boards[0].get("meta") or {}).get("aspect") or "")
    if board_aspect and board_aspect != aspect:
        raise ClipInputError(f"Storyboard được tạo cho tỉ lệ {board_aspect} nhưng clip đang đặt {aspect}. Đặt cùng một tỉ lệ cho cả hai.")
    resolution = graph.TIER_RESOLUTION[tier]
    motion = effective_motion(shot, garment)
    pref = params.get("prompt") or {}
    changes = str(pref.get("changes") or "").strip()
    if note.strip():
        changes = (changes + "; " if changes else "") + "reviewer feedback: " + note.strip()
    move = str(shot.get("camera_move") or "static")
    variables = {
        "aspect_label": ASPECT_LABEL.get(aspect, aspect), "shot": {"duration": duration}, "panel_count": len(panels),
        "cut_rule": ("Hard cuts between the timed beats are allowed." if shot.get("board_type") == "pose_sequence"
                     else "Make it a single continuous shot with no scene cuts."),
        "timeline": timeline(panels, duration), "camera_line": "" if move == "static" else f"a smooth {move.replace('_', ' ')} through the whole shot.",
        "motion_text": MOTION_TEXT[motion],
        "garment": {"summary": garment.get("summary") or "the garment shown in the reference images"},
        "logo_rule": LOGO_RULE if (garment.get("risk") or {}).get("logo_rule") == "reference_only" else "",
        "style": {k: (style.get(k) or STYLE_DEFAULTS[k]) for k in STYLE_DEFAULTS},
    }
    refs = [("anchor", "Khung mẫu (khối 4)", anchors[0]), ("storyboard", "Storyboard (khối 5)", boards[0]), ("photo", "Ảnh áo thật (khối 1)", photo)]
    rendered = prompts.render(pref.get("template_id") or DEFAULT_TEMPLATE, version=pref.get("version"),
                              variables=variables, changes=changes, ref_paths=[r[2]["path"] for r in refs])
    rendered["ref_order"] = [{"role": role, "label": label, "path": r["path"], "artifact_id": r["artifact_id"]} for role, label, r in refs]
    warnings = [w for w in rendered["warnings"] if w["code"] != "ref_count_mismatch"]
    if len(rendered["prompt"]) > PROMPT_MAX:
        warnings.append({"code": "prompt_too_long", "message": f"Prompt dài {len(rendered['prompt'])} ký tự, vượt giới hạn {PROMPT_MAX} của Flow."})
    rendered["warnings"] = warnings
    credit = graph.clip_cost({"duration": duration}, tier)
    rendered.update({
        "tier": tier, "resolution": resolution, "aspect": aspect, "duration": duration, "motion": motion, "mode": "r2v",
        "model": f"macaron_cookie_r2v_{duration}s{'_360p' if resolution == '360p' else ''}",
        "credit": credit, "credit_known": credit is not None, "credit_estimate": graph.clip_cost_estimate({"duration": duration}, tier),
        "shot": shot.get("key", ""),
    })
    return rendered


def _classify_failure(job: Any) -> Exception:
    code = str(getattr(job, "error_code", "") or "")
    message = str(getattr(job, "error_message", "") or "Veo báo lỗi")[:1000]
    if code in SAFE_ERROR_CODES:
        return RuntimeError(f"{message} (chưa mất credit; có thể thử lại)")
    if code == "FLOW_PROMINENT_PEOPLE":
        return RuntimeError(
            "Flow chặn clip vì bộ lọc người nổi tiếng (PROMINENT_PERSON) nhận diện khuôn mặt trong ảnh tham chiếu. "
            "Thường không bị trừ credit, nhưng chạy lại với cùng khuôn mặt sẽ lỗi lại: ĐỪNG chạy lại y nguyên. Dùng nhân vật hư cấu rõ "
            "ràng (ảnh AI tạo mới, không dựa trên ảnh người thật) rồi tạo lại ảnh mẫu và storyboard. Bộ lọc này đôi khi chặn nhầm cả nhân vật "
            f"hư cấu: nếu đúng vậy, báo cáo qua phản hồi của Flow. Job Veo {getattr(job, 'job_id', '')}.")
    if code in RENDER_FAILED_CODES:
        return RuntimeError(f"Flow đã nhận lệnh nhưng render thất bại: {message}. Job Veo {getattr(job, 'job_id', '')}. "
                            "Kiểm tra số dư credit và ô lỗi trong Flow; chạy lại y nguyên thường sẽ lỗi lại — đổi prompt/storyboard trước.")
    return SubmittedUnknown(f"{message} [{code or 'UNKNOWN'}]. Job Veo {getattr(job, 'job_id', '')} có thể đã được gửi lên Flow: "
                            "kiểm tra Flow trước khi chạy lại.")


def run_clip(ctx: ExecContext) -> ExecResult:
    req = build_request(ctx.prompts, {**ctx.params, "_tier": ctx.tier}, ctx.inputs, ctx.note)
    if len(req["prompt"]) > PROMPT_MAX:
        raise ClipInputError(f"Prompt dài {len(req['prompt'])} ký tự, vượt giới hạn {PROMPT_MAX}. Rút gọn prompt rồi chạy lại.")
    veo = _veo()
    from app.veo.schemas import AspectRatio, InputMode, JobStatus, VeoJobRequest

    project = veo.get_active_project()
    if project is None:
        raise ClipInputError("Chưa chọn project Veo. Vào Veo Studio, tạo/chọn project rồi mở project đó trong tab Flow.")
    if ctx.cancelled():
        raise RuntimeError("Đã hủy trước khi gửi lên Flow.")
    paths = [s["path"] for s in req["ref_order"]]
    job_request = VeoJobRequest(
        prompt=req["prompt"], model_display_name=veo.OMNI_12_NAME,
        aspect_ratio=AspectRatio(req["aspect"]), duration_seconds=req["duration"], resolution=req["resolution"],
        num_outputs=1, project_id=project.id, input_mode=InputMode.INGREDIENTS, ingredient_image_paths=paths,
        # Cùng vân tay + cùng lần thử = cùng lệnh (Veo trả lại job cũ). Lần chạy lại sau khi người dùng xác nhận/sửa là
        # lần thử mới: nếu không, Veo sẽ trả về chính job lỗi cũ và không bao giờ gửi lại được.
        idempotency_key=f"cmp-{ctx.fingerprint[:40]}-a{ctx.attempt}",
    )
    try:
        job = veo.submit_job(job_request)           # kiểm tra đầu vào ở đây: lỗi = CHƯA gửi gì
    except ValueError as exc:
        raise ClipInputError(str(exc)) from exc
    ctx.set_external_ref(job.job_id)
    ctx.report(f"Đã đưa job {job.job_id} cho Veo" + (" (dùng lại job cũ cùng vân tay)" if getattr(job, "deduplicated", False) else "") + "…")

    # Từ đây tiền có thể đã/đang bị trừ: bỏ qua yêu cầu hủy, chỉ chờ kết quả, và lỗi nào cũng thận trọng.
    deadline = time.monotonic() + TIMEOUT_SECONDS
    last_step = ""
    while True:
        current = veo.get_job(job.job_id)
        if current is None:
            raise SubmittedUnknown(f"Job Veo {job.job_id} biến mất khỏi backend. Có thể đã gửi lên Flow: kiểm tra Flow trước khi chạy lại.")
        status = getattr(current.status, "value", str(current.status))
        step = f"{status}: {current.current_step}".strip(": ")
        if step != last_step:
            ctx.report(f"Flow — {step}")
            last_step = step
        if status == JobStatus.DONE.value:
            break
        if status == JobStatus.ERROR.value:
            raise _classify_failure(current)
        if time.monotonic() > deadline:
            raise SubmittedUnknown(f"Quá {int(TIMEOUT_SECONDS // 60)} phút chờ Flow. Job Veo {job.job_id} có thể vẫn đang chạy: "
                                   "kiểm tra Flow trước khi chạy lại.")
        time.sleep(POLL_SECONDS)

    files = list(current.output_files or [])
    path = veo.get_video_path(files[0]) if files else None
    if path is None or not Path(path).is_file():
        raise SubmittedUnknown(f"Job Veo {job.job_id} báo xong nhưng không thấy file video. Kiểm tra Flow/Veo Studio rồi nhận kết quả thủ công.")
    data = Path(path).read_bytes()
    return ExecResult(
        [ArtifactSpec("video", ext="mp4", data=data, meta={
            "veo_job_id": job.job_id, "model": req["model"], "tier": ctx.tier, "resolution": req["resolution"],
            "duration": req["duration"], "aspect": req["aspect"], "prompt": req["prompt"], "template": req["template"],
            "motion": req["motion"], "credit_estimated": req["credit_estimate"], "shot": req["shot"], "mode": "r2v",
            "refs": [s["artifact_id"] for s in req["ref_order"]],
        })],
        credit_actual=req["credit_estimate"],          # chưa đo được giá thì tính theo giá dự kiến để trần ngân sách vẫn có tác dụng
    )
