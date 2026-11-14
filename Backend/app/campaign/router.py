"""REST API của Campaign engine (docs/PLAN §3.5, §3.6). Prefix: /api/campaigns."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .prompts import PromptError
from .runner import AlreadyRunning, ConfirmRequired, OverBudget
from .service import CampaignError, get_service

router = APIRouter(prefix="/api/campaigns", tags=["Campaigns (AI Workflow v2)"])


def ensure_campaign_tables() -> None:
    get_service()


# ── schema ────────────────────────────────────────────────────────────────────
class CampaignCreate(BaseModel):
    name: str
    niche: str = "fashion"
    platform: str = "tiktok"
    credit_cap: Optional[int] = Field(default=None, ge=0)


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    niche: Optional[str] = None
    platform: Optional[str] = None
    credit_cap: Optional[int] = Field(default=None, ge=0)


class ParamsBody(BaseModel):
    params: dict[str, Any]
    element_key: str = ""


class InputFile(BaseModel):
    artifact_id: str
    role: str = ""


class InputFilesBody(BaseModel):
    files: list[InputFile]


class SelectBody(BaseModel):
    artifact_id: str
    element_key: str = ""


class EditBody(BaseModel):
    content: Any
    element_key: str = ""


class ElementBody(BaseModel):
    element_key: str = ""


class PreviewBody(BaseModel):
    element_key: str = ""
    tier: str = "draft"


class PlanBody(BaseModel):
    target: Optional[str] = None
    tier: str = "draft"
    only_approved: Optional[bool] = None
    elements: Optional[list[str]] = None      # chỉ chạy các phần tử này của bước đích (bước map)


class RunBody(PlanBody):
    confirm_credit: bool = False


class GateBody(BaseModel):
    element_key: str = ""
    artifact_id: Optional[str] = None
    note: str = ""


class ResolveBody(BaseModel):
    outcome: str = "not_sent"


class CastAdd(BaseModel):
    campaign_id: str
    artifact_id: str
    name: str


class CastUse(BaseModel):
    library_id: str


class PromptCreate(BaseModel):
    kind: str = ""
    name: str
    body: Optional[str] = None
    ref_slots: Optional[list[dict[str, Any]]] = None
    base_id: str = ""


class PromptUpdate(BaseModel):
    name: Optional[str] = None
    body: Optional[str] = None
    ref_slots: Optional[list[dict[str, Any]]] = None


class PromptRender(BaseModel):
    template_id: str
    version: Optional[int] = None
    variables: dict[str, Any] = Field(default_factory=dict)
    changes: str = ""
    ref_paths: Optional[list[str]] = None


def _call(fn, *args, **kwargs):
    """Đổi lỗi nghiệp vụ thành HTTP có thông điệp rõ ràng."""
    try:
        return fn(*args, **kwargs)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'\""))
    except (CampaignError, PromptError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except AlreadyRunning as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/meta")
def meta():
    """Backend đang chạy thật sự có những gì. Giao diện dùng để cảnh báo khi backend là bản cũ chưa nạp code mới."""
    from . import graph
    svc = get_service()
    return {"executors": sorted(svc.runner.executors), "gated_steps": sorted(s.key for s in graph.STEPS if s.gate),
            "steps": [s.key for s in graph.STEPS], "blocks": [{"block": n, "title": t} for n, t in graph.BLOCKS.items()],
            "features": ["exports", "formats", "v3"]}


@router.get("/formats")
def list_formats():
    """Các format quảng cáo có sẵn (dữ liệu trong app/campaign/formats/*.json)."""
    return {"formats": get_service().list_formats()}


# ── prompt (đặt trước /{campaign_id} để không bị bắt nhầm) ───────────────────────
@router.get("/prompts")
def list_prompts(kind: Optional[str] = None):
    return {"templates": [t.to_dict() for t in get_service().prompts.list_templates(kind)]}


@router.post("/prompts")
def create_prompt(body: PromptCreate):
    return _call(lambda: get_service().prompts.create(kind=body.kind, name=body.name, body=body.body,
                                                       ref_slots=body.ref_slots, base_id=body.base_id).to_dict())


@router.post("/prompts/render")
def render_prompt(body: PromptRender):
    return _call(lambda: get_service().prompts.render(
        body.template_id, version=body.version, variables=body.variables, changes=body.changes, ref_paths=body.ref_paths))


@router.get("/prompts/{template_id}")
def get_prompt(template_id: str, version: Optional[int] = None):
    t = get_service().prompts.get(template_id, version)
    if t is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy mẫu prompt.")
    return t.to_dict()


@router.get("/prompts/{template_id}/versions")
def prompt_versions(template_id: str):
    return {"versions": [t.to_dict() for t in get_service().prompts.versions(template_id)]}


@router.put("/prompts/{template_id}")
def update_prompt(template_id: str, body: PromptUpdate):
    return _call(lambda: get_service().prompts.update(template_id, name=body.name, body=body.body,
                                                       ref_slots=body.ref_slots).to_dict())


@router.delete("/prompts/{template_id}")
def delete_prompt(template_id: str):
    _call(get_service().prompts.delete, template_id)
    return {"ok": True}


# ── thư viện nhân vật (literal trước /{campaign_id}) ───────────────────────────
@router.get("/cast-library")
def cast_library_list():
    return {"items": get_service().cast_library_list()}


@router.post("/cast-library")
def cast_library_add(body: CastAdd):
    return _call(get_service().cast_library_add, body.campaign_id, body.artifact_id, body.name)


@router.delete("/cast-library/{library_id}")
def cast_library_delete(library_id: str):
    _call(get_service().cast_library_delete, library_id)
    return {"ok": True}


@router.get("/cast-library/{library_id}/file")
def cast_library_file(library_id: str):
    path, mime = _call(get_service().cast_library_file, library_id)
    return FileResponse(path, media_type=mime)


@router.post("/{campaign_id}/cast/use-library")
def cast_use_library(campaign_id: str, body: CastUse):
    return _call(get_service().cast_library_use, campaign_id, body.library_id)


# ── artifact / run (literal trước) ─────────────────────────────────────────────
@router.get("/artifacts/{artifact_id}/file")
def artifact_file(artifact_id: str):
    path, mime = _call(get_service().artifact_file, artifact_id)
    return FileResponse(path, media_type=mime)


@router.post("/runs/{run_id}/resolve")
def resolve_run(run_id: str, body: ResolveBody):
    _call(get_service().resolve_run, run_id, body.outcome)
    return {"ok": True}


# ── chiến dịch ────────────────────────────────────────────────────────────────
@router.post("")
def create_campaign(body: CampaignCreate):
    return _call(get_service().create_campaign, body.name, body.niche, body.platform, body.credit_cap)


@router.get("")
def list_campaigns():
    return {"campaigns": get_service().list_campaigns()}


@router.get("/{campaign_id}")
def get_campaign(campaign_id: str, tier: str = "draft"):
    return _call(get_service().state, campaign_id, tier)


@router.patch("/{campaign_id}")
def update_campaign(campaign_id: str, body: CampaignUpdate):
    return _call(get_service().update_campaign, campaign_id, **body.model_dump(exclude_unset=True))


@router.delete("/{campaign_id}")
def delete_campaign(campaign_id: str):
    _call(get_service().delete_campaign, campaign_id)
    return {"ok": True}


@router.put("/{campaign_id}/steps/{step_key}/params")
def set_params(campaign_id: str, step_key: str, body: ParamsBody):
    return {"params": _call(get_service().set_params, campaign_id, step_key, body.params, body.element_key)}


@router.post("/{campaign_id}/artifacts/upload")
async def upload_artifact(campaign_id: str, file: UploadFile = File(...)):
    data = await file.read()
    return _call(get_service().upload_image, campaign_id, file.filename or "", data)


@router.get("/{campaign_id}/artifacts")
def list_artifacts(campaign_id: str, step_key: Optional[str] = None, element_key: Optional[str] = None):
    return {"artifacts": _call(get_service().list_artifacts, campaign_id, step_key, element_key)}


@router.post("/{campaign_id}/steps/{step_key}/input")
def set_input(campaign_id: str, step_key: str, body: InputFilesBody):
    return _call(get_service().set_input_files, campaign_id, step_key, [f.model_dump() for f in body.files])


@router.post("/{campaign_id}/steps/{step_key}/select")
def select_artifact(campaign_id: str, step_key: str, body: SelectBody):
    _call(get_service().select_artifact, campaign_id, step_key, body.artifact_id, body.element_key)
    return {"ok": True}


@router.put("/{campaign_id}/steps/{step_key}/artifact")
def edit_artifact(campaign_id: str, step_key: str, body: EditBody):
    return _call(get_service().edit_artifact, campaign_id, step_key, body.content, body.element_key)


@router.post("/{campaign_id}/steps/{step_key}/pin")
def pin(campaign_id: str, step_key: str, body: ElementBody):
    _call(get_service().set_pin, campaign_id, step_key, True, body.element_key)
    return {"ok": True}


@router.post("/{campaign_id}/steps/{step_key}/unpin")
def unpin(campaign_id: str, step_key: str, body: ElementBody):
    _call(get_service().set_pin, campaign_id, step_key, False, body.element_key)
    return {"ok": True}


@router.post("/{campaign_id}/steps/{step_key}/reroll")
def reroll(campaign_id: str, step_key: str, body: ElementBody):
    return {"nonce": _call(get_service().reroll, campaign_id, step_key, body.element_key)}


@router.post("/{campaign_id}/steps/{step_key}/suggest")
def suggest_params(campaign_id: str, step_key: str):
    return _call(get_service().suggest_params, campaign_id, step_key)


@router.post("/{campaign_id}/steps/{step_key}/prompt-preview")
def prompt_preview(campaign_id: str, step_key: str, body: PreviewBody):
    return _call(get_service().preview_prompt, campaign_id, step_key, body.element_key, body.tier)


@router.post("/{campaign_id}/gates/{step_key}/approve")
def approve(campaign_id: str, step_key: str, body: GateBody):
    return _call(get_service().decide_gate, campaign_id, step_key, "approved", body.element_key, body.artifact_id, body.note)


@router.post("/{campaign_id}/gates/{step_key}/reject")
def reject(campaign_id: str, step_key: str, body: GateBody):
    return _call(get_service().decide_gate, campaign_id, step_key, "rejected", body.element_key, body.artifact_id, body.note)


@router.post("/{campaign_id}/plan")
def plan(campaign_id: str, body: PlanBody):
    return _call(get_service().plan, campaign_id, body.target, body.tier, body.only_approved, body.elements)


@router.post("/{campaign_id}/run")
def run(campaign_id: str, body: RunBody):
    try:
        return _call(get_service().run, campaign_id, body.target, body.tier, body.only_approved, body.confirm_credit, body.elements)
    except ConfirmRequired as exc:
        return JSONResponse(status_code=409, content={"error": "confirm_required", "detail": str(exc), "plan": exc.plan.to_dict()})
    except OverBudget as exc:
        return JSONResponse(status_code=409, content={"error": "over_budget", "detail": str(exc), "plan": exc.plan.to_dict()})


@router.get("/{campaign_id}/runs")
def list_runs(campaign_id: str, limit: int = 50):
    return {"runs": _call(get_service().list_runs, campaign_id, limit), "active_exec": get_service().runner.active_exec(campaign_id)}


@router.post("/{campaign_id}/cancel")
def cancel(campaign_id: str):
    return {"cancelled": get_service().runner.cancel(campaign_id)}


# ── bản tải phụ của video đã ghép (xóa watermark / không nhạc nền) ─────────────
@router.get("/{campaign_id}/exports")
def export_status(campaign_id: str):
    from . import exports
    return _call(exports.status, get_service(), campaign_id)


@router.post("/{campaign_id}/exports/{variant}")
def export_start(campaign_id: str, variant: str):
    from . import exports
    return _call(exports.start, get_service(), campaign_id, variant)


@router.get("/{campaign_id}/exports/{variant}/file")
def export_file(campaign_id: str, variant: str):
    from . import exports
    path, name = _call(exports.file_path, get_service(), campaign_id, variant)
    return FileResponse(path, media_type="video/mp4", filename=name)
