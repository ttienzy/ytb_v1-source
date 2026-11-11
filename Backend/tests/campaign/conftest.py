"""Fixture dùng chung: DB SQLite tạm + executor giả (không gọi AI/Flow thật, không tốn credit)."""
from __future__ import annotations

import threading

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.campaign.models import ALL_TABLES
from app.campaign.runner import ArtifactSpec, ExecContext, ExecResult
from app.campaign.service import CampaignService
from app.db import Base


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

    def shots(ctx: ExecContext) -> dict:
        n = int(ctx.params.get("shots") or 3)
        role = lambda i: "hook" if i == 1 else "cta" if i == n else "benefit"  # noqa: E731
        # Dạng đã chuẩn hóa (giống planning.normalize_shot_plan) để sửa tay một shot không làm đổi các shot khác
        return {"items": [{"key": f"shot:{i}", "role": role(i), "board_type": "hero_walk", "archetype": "hero", "framing": "medium", "duration": 15,
                           "camera_move": "static", "face_policy": "visible", "expression": "", "motion": "free", "motion_adjusted": False, "on_screen_text": "",
                           "voiceover": f"shot {i}", "panels": [{"framing": "medium", "action": f"beat {k} of shot {i}"} for k in range(1, 5)]}
                          for i in range(1, n + 1)], "motion_limit": "free", "total_seconds": 15 * n, "warnings": []}

    def image_step(step: str):
        def fn(ctx: ExecContext) -> ExecResult:
            calls.append((step, ctx.element_key, ctx.tier))
            count = int(ctx.params.get("count") or 1)
            return ExecResult([ArtifactSpec("image", ext="png", data=f"png:{ctx.fingerprint}:{i}".encode())
                               for i in range(count)])
        return fn

    def clip(ctx: ExecContext) -> ExecResult:
        calls.append(("clip", ctx.element_key, ctx.tier))
        credit = 20 if ctx.tier == "draft" else 60
        return ExecResult([ArtifactSpec("video", ext="mp4", data=f"mp4:{ctx.fingerprint}".encode())], credit_actual=credit)

    return {
        "fact_sheet": json_step("fact_sheet"),
        "angle": json_step("angle"),
        "hook": json_step("hook"),
        "shot_plan": json_step("shot_plan", shots),
        "script": json_step("script"),
        "look": image_step("look"),
        "anchor_frame": image_step("anchor_frame"),
        "storyboard": image_step("storyboard"),
        "clip": clip,
        "voice": json_step("voice"),
        "assemble": json_step("assemble"),
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


def prime(svc: CampaignService, name: str = "Áo Haim") -> str:
    """Chiến dịch có đủ đầu vào: ảnh áo + ảnh nhân vật + style + brief."""
    cid = svc.create_campaign(name)["id"]
    shirt = svc.upload_image(cid, "shirt.png", b"shirt-bytes-1")
    shirt2 = svc.upload_image(cid, "shirt_back.png", b"shirt-bytes-2")
    person = svc.upload_image(cid, "person.jpg", b"person-bytes")
    svc.set_input_files(cid, "garment_source", [{"artifact_id": shirt["id"], "role": "front"},
                                                {"artifact_id": shirt2["id"], "role": "back"}])
    svc.set_input_files(cid, "cast", [{"artifact_id": person["id"], "role": "identity"}])
    svc.set_params(cid, "style", {"lighting": "soft"})
    svc.set_params(cid, "brief", {"audience": "nữ 18-25"})
    return cid


def run_and_wait(svc: CampaignService, cid: str, target=None, tier="draft", only_approved=None, confirm=False):
    out = svc.run(cid, target, tier, only_approved, confirm)
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


def approve_look(svc: CampaignService, cid: str) -> None:
    """Danh sách shot nhìn ảnh mẫu đã duyệt: mọi test chạy chuỗi kế hoạch phải duyệt ảnh mẫu trước."""
    run_and_wait(svc, cid, "look")
    svc.decide_gate(cid, "look", "approved")
    approve_anchor(svc, cid)


def approve_anchor(svc: CampaignService, cid: str) -> None:
    """Khung mẫu chốt mặt, áo, bối cảnh: mọi storyboard chờ ảnh này được duyệt."""
    run_and_wait(svc, cid, "anchor_frame")
    svc.decide_gate(cid, "anchor_frame", "approved")


def approve_storyboards(svc: CampaignService, cid: str) -> None:
    """Duyệt ảnh mẫu và khung mẫu, tạo storyboard cho mọi shot rồi duyệt hết (cổng trước bước tốn credit)."""
    approve_look(svc, cid)
    run_and_wait(svc, cid, "storyboard")
    keys = [e["element_key"] for b in svc.state(cid)["blocks"] for st in b["steps"] if st["key"] == "storyboard" for e in st["elements"]]
    for k in keys:
        svc.decide_gate(cid, "storyboard", "approved", element_key=k)


def reach_clips(svc: CampaignService, cid: str) -> None:
    """Chạy tới khi có 3 clip nháp (đã duyệt ảnh mẫu và storyboard)."""
    approve_storyboards(svc, cid)
    run_and_wait(svc, cid, "clip", confirm=True)
