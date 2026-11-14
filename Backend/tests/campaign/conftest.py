"""Fixture dùng chung: DB SQLite tạm + executor giả (không gọi AI/Flow thật, không tốn credit). Đồ thị v3 (format + cảnh)."""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.campaign import formats
from app.campaign.executors import common, script
from app.campaign.models import ALL_TABLES
from app.campaign.runner import ArtifactSpec, ExecContext, ExecResult
from app.campaign.service import CampaignService
from app.db import Base

SCENES = [
    {"key": "scene:1", "name": "Phố", "place": "a quiet city sidewalk with blurred shopfronts", "time": "late afternoon",
     "light": "warm sun from the left", "mood": "easy, urban", "action": "walking slowly toward the camera"},
    {"key": "scene:2", "name": "Cà phê", "place": "a bright cafe beside a large window", "time": "morning",
     "light": "soft window light from the right", "mood": "calm, cozy", "action": "sitting at the window table"},
]


def make_executors(calls: list[tuple[str, str, str]]) -> dict:
    """Mỗi executor ghi (step, element, tier) vào `calls` rồi trả artifact xác định theo vân tay."""

    def json_step(step: str, extra=None):
        def fn(ctx: ExecContext) -> ExecResult:
            calls.append((step, ctx.element_key, ctx.tier))
            content = {"step": step, "fp": ctx.fingerprint}
            if extra:
                content.update(extra(ctx))
            return ExecResult([ArtifactSpec("json", json=content)])
        return fn

    def script_doc(ctx: ExecContext) -> dict:
        """Kịch bản giả nhưng qua chuẩn hóa THẬT (khung theo format), để sửa tay một shot không làm đổi các shot khác."""
        fmt = formats.resolve(common.load_input(ctx.inputs, "format"))
        skel = script.skeleton(fmt, script.scenes_of(ctx.inputs), common.garment_of(ctx.inputs))
        items = [{"key": sk["key"], "beats": [f"beat {k} of {sk['key']}" for k in range(1, sk["beats_n"] + 1)],
                  "expression": "soft smile", "voiceover": f"lời {sk['key']}", "on_screen_text": f"chữ {sk['key']}"} for sk in skel]
        return script.normalize_script({"items": items, "hook": {"type": "direct", "on_screen_text": "Hook"}, "angle_vi": "ý",
                                        "caption": "caption", "hashtags": ["#ootd"], "cta": "Mua ngay"}, ctx.inputs, ctx.params)

    def image_step(step: str):
        def fn(ctx: ExecContext) -> ExecResult:
            calls.append((step, ctx.element_key, ctx.tier))
            count = int(ctx.params.get("count") or 1) if step == "cast_sheet" else 1
            return ExecResult([ArtifactSpec("image", ext="png", data=f"png:{ctx.fingerprint}:{i}".encode(), meta={"aspect": "9:16" if step != "cast_sheet" else "16:9"})
                               for i in range(count)])
        return fn

    def clip(ctx: ExecContext) -> ExecResult:
        calls.append(("clip", ctx.element_key, ctx.tier))
        credit = 20 if ctx.tier == "draft" else 60
        return ExecResult([ArtifactSpec("video", ext="mp4", data=f"mp4:{ctx.fingerprint}".encode())], credit_actual=credit)

    return {
        "fact_sheet": json_step("fact_sheet"),
        "cast_sheet": image_step("cast_sheet"),
        "scene_plate": image_step("scene_plate"),
        "script": json_step("script", script_doc),
        "scene_anchor": image_step("scene_anchor"),
        "clip": clip,
        "voice": json_step("voice"),
        "assemble": json_step("assemble"),
        "export_pack": json_step("export_pack"),
    }


@pytest.fixture
def env(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 't.db').as_posix()}",
                           connect_args={"check_same_thread": False, "timeout": 30})
    Base.metadata.create_all(engine, tables=ALL_TABLES)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    calls: list[tuple[str, str, str]] = []
    executors = make_executors(calls)
    svc = CampaignService(factory, tmp_path / "campaigns", engine_bind=engine, executors=executors)
    yield svc, calls, executors
    engine.dispose()


@pytest.fixture
def svc(env):
    return env[0]


@pytest.fixture
def calls(env):
    return env[1]


def prime(svc: CampaignService, name: str = "Áo Haim", format_id: str = "fit_check", scenes: list | None = None) -> str:
    """Chiến dịch có đủ đầu vào: ảnh áo + ảnh nhân vật + hồ sơ nhân vật + cảnh + phong cách + brief + format."""
    cid = svc.create_campaign(name)["id"]
    shirt = svc.upload_image(cid, "shirt.png", b"shirt-bytes-1")
    shirt2 = svc.upload_image(cid, "shirt_back.png", b"shirt-bytes-2")
    detail = svc.upload_image(cid, "shirt_logo.png", b"shirt-bytes-3")
    person = svc.upload_image(cid, "person.jpg", b"person-bytes")
    svc.set_input_files(cid, "garment_source", [{"artifact_id": shirt["id"], "role": "front"},
                                                {"artifact_id": shirt2["id"], "role": "back"},
                                                {"artifact_id": detail["id"], "role": "detail"}])
    svc.set_input_files(cid, "cast", [{"artifact_id": person["id"], "role": "identity"}])
    svc.set_params(cid, "cast_profile", {"presentation": "woman"})
    svc.set_params(cid, "scene_set", {"items": SCENES if scenes is None else scenes})
    svc.set_params(cid, "style", {"lighting": "soft"})
    svc.set_params(cid, "brief", {"audience": "nữ 18-25"})
    svc.set_params(cid, "format", {"format_id": format_id})
    return cid


def run_and_wait(svc: CampaignService, cid: str, target=None, tier="draft", only_approved=None, confirm=False, elements=None):
    out = svc.run(cid, target, tier, only_approved, confirm, elements)
    if out["exec_id"]:
        assert svc.runner.wait(out["exec_id"], timeout=30)
    return out


def element_state(svc: CampaignService, cid: str, step: str, element: str = "", tier: str = "draft") -> dict:
    state = svc.state(cid, tier)
    for block in state["blocks"]:
        for st in block["steps"]:
            if st["key"] == step:
                for e in st["elements"]:
                    if e["element_key"] == element:
                        return e
    raise AssertionError(f"không thấy {step}[{element}]")


def elements_of(svc: CampaignService, cid: str, step: str) -> list[str]:
    return [e["element_key"] for b in svc.state(cid)["blocks"] for st in b["steps"] if st["key"] == step for e in st["elements"]]


def approve_cast_sheet(svc: CampaignService, cid: str) -> None:
    """Kịch bản và khung chốt nhìn cast sheet đã duyệt: mọi test chạy chuỗi phải duyệt cast sheet trước."""
    run_and_wait(svc, cid, "cast_sheet")
    svc.decide_gate(cid, "cast_sheet", "approved")


def approve_scene_anchors(svc: CampaignService, cid: str) -> None:
    """Duyệt cast sheet, tạo ảnh bối cảnh + khung chốt cho mọi cảnh rồi duyệt hết (cổng trước bước tốn credit)."""
    approve_cast_sheet(svc, cid)
    run_and_wait(svc, cid, "scene_anchor")
    for k in elements_of(svc, cid, "scene_anchor"):
        svc.decide_gate(cid, "scene_anchor", "approved", element_key=k)


def reach_clips(svc: CampaignService, cid: str) -> None:
    """Chạy tới khi có clip nháp cho mọi shot (đã duyệt cast sheet, kịch bản, khung chốt)."""
    approve_scene_anchors(svc, cid)
    run_and_wait(svc, cid, "script")
    run_and_wait(svc, cid, "clip", confirm=True)
