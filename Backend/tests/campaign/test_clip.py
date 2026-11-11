"""Executor clip (khối 6) với dịch vụ Veo GIẢ: không gọi Flow, không tốn credit."""
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.campaign import graph
from app.campaign.executors import clip
from app.campaign.runner import ArtifactSpec, ExecResult

from .conftest import approve_storyboards, element_state, prime, run_and_wait

BOARD = b"\x89PNG-storyboard"


def board(ctx):
    return ExecResult([ArtifactSpec("image", ext="png", data=BOARD + ctx.element_key.encode(), meta={"aspect": "9:16"})])


def fact_sheet(ctx):
    return ExecResult([ArtifactSpec("json", json={"summary": "white tee with NY logo", "risk": {"motion_limit": "gentle", "logo_rule": "reference_only"}})])


class FakeVeo:
    """Giả lập app.veo.service: ghi lại mọi job gửi đi và trả trạng thái theo kịch bản."""
    OMNI_12_NAME = "Omni 1.2 Flash"

    def __init__(self, tmp_path: Path, script=None):
        self.tmp = tmp_path
        self.submitted: list = []
        self.script = script or (lambda n, job: ("done", None))      # (n-th submit, job) -> (status, error)
        self.project = SimpleNamespace(id="proj1")
        self.jobs: dict[str, SimpleNamespace] = {}

    def get_active_project(self):
        return self.project

    def submit_job(self, request):
        n = len(self.submitted) + 1
        self.submitted.append(request)
        job_id = f"veo{n}"
        status, error = self.script(n, request)
        out = None
        if status == "done":
            f = self.tmp / f"{job_id}.mp4"
            f.write_bytes(b"mp4:" + job_id.encode())
            out = [f.name]
        self.jobs[job_id] = SimpleNamespace(job_id=job_id, status=status, current_step="x", error_code=error[0] if error else None,
                                            error_message=error[1] if error else None, output_files=out or [], deduplicated=False)
        if status == "vanish":
            self.jobs.pop(job_id)
        return SimpleNamespace(job_id=job_id, deduplicated=False)

    def get_job(self, job_id):
        j = self.jobs.get(job_id)
        return None if j is None else SimpleNamespace(**{**j.__dict__, "status": SimpleNamespace(value=j.status), "error_code": j.error_code})

    def get_video_path(self, name):
        return self.tmp / name


@pytest.fixture
def cl(env, monkeypatch, tmp_path):
    svc, calls, executors = env
    veo = FakeVeo(tmp_path)
    monkeypatch.setattr(clip, "_veo", lambda: veo)
    monkeypatch.setattr(clip, "POLL_SECONDS", 0.0)
    executors["clip"] = clip.run_clip
    executors["storyboard"] = board
    executors["fact_sheet"] = fact_sheet
    return svc, veo, executors, monkeypatch


def ready(svc):
    cid = prime(svc)
    approve_storyboards(svc, cid)
    return cid


def runs(svc, cid, state=None):
    return [r for r in svc.list_runs(cid) if r["step_key"] == "clip" and (state is None or r["state"] == state)]


def test_preview_shows_references_timeline_motion_cap_and_price(cl):
    svc, veo, _, _ = cl
    cid = ready(svc)
    p = svc.preview_prompt(cid, "clip", "shot:1", "draft")
    assert [r["role"] for r in p["ref_order"]] == ["anchor", "storyboard", "photo"]
    assert "15-second vertical 9:16" in p["prompt"] and "[0-4s] beat 1 of shot 1" in p["prompt"] and "[11-15s] beat 4 of shot 1" in p["prompt"]
    assert "never shows a grid" in p["prompt"] and "single continuous shot" in p["prompt"]
    assert "gentle, natural movement" in p["prompt"] and "LOGO RULE" in p["prompt"] and "white tee with NY logo" in p["prompt"]
    assert (p["resolution"], p["model"], p["credit"], p["credit_known"]) == ("360p", "macaron_cookie_r2v_15s_360p", 20, True)
    f = svc.preview_prompt(cid, "clip", "shot:1", "final")
    assert (f["resolution"], f["model"], f["credit"], f["credit_known"], f["credit_estimate"]) == ("720p", "macaron_cookie_r2v_15s", None, False, 60)


def test_shot_motion_never_exceeds_garment_limit():
    assert clip.effective_motion({"motion": "free"}, {"risk": {"motion_limit": "minimal"}}) == "minimal"
    assert clip.effective_motion({"motion": "minimal"}, {"risk": {"motion_limit": "free"}}) == "minimal"
    assert clip.effective_motion({"motion": "gentle"}, {}) == "gentle"


def test_run_submits_three_ingredients_and_stores_video(cl):
    svc, veo, _, _ = cl
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    assert svc.runner.wait(out["exec_id"], 30)

    assert len(veo.submitted) == 1
    req = veo.submitted[0]
    assert (req.model_display_name, req.input_mode.value, req.aspect_ratio.value, req.duration_seconds, req.resolution, req.num_outputs) == \
        ("Omni 1.2 Flash", "ingredients", "9:16", 15, "360p", 1)
    assert len(req.ingredient_image_paths) == 3 and Path(req.ingredient_image_paths[1]).read_bytes() == BOARD + b"shot:1"
    assert req.image_path is None and req.end_image_path is None
    assert req.idempotency_key.startswith("cmp-") and req.project_id == "proj1"

    st = element_state(svc, cid, "clip", "shot:1")
    assert st["state"] == "fresh" and st["gate"] == "need_approval"
    art = next(a for a in svc.list_artifacts(cid, "clip", "shot:1") if a["kind"] == "video")
    assert svc.artifact_file(art["id"])[0].read_bytes() == b"mp4:veo1"
    assert art["meta"]["veo_job_id"] == "veo1" and art["meta"]["resolution"] == "360p" and art["meta"]["credit_estimated"] == 20 and art["meta"]["mode"] == "r2v"
    run = runs(svc, cid, "done")[0]
    assert run["external_ref"] == "veo1" and run["credit_actual"] == 20
    with svc.session() as s:
        assert svc.engine.spent_credit(s, cid) == 20


def test_idempotency_key_differs_between_draft_and_final(cl):
    svc, veo, _, _ = cl
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    assert svc.runner.wait(out["exec_id"], 30)
    svc.decide_gate(cid, "clip", "approved", element_key="shot:1")
    out = svc.run(cid, "clip", "final", None, True, ["shot:1"])
    assert svc.runner.wait(out["exec_id"], 30)
    keys = [r.idempotency_key for r in veo.submitted]
    assert len(keys) == 2 and keys[0] != keys[1] and all(k.startswith("cmp-") for k in keys)
    assert [r.resolution for r in veo.submitted] == ["360p", "720p"]


def test_failure_before_submit_is_a_normal_error_and_can_be_retried(cl):
    svc, veo, _, _ = cl
    veo.script = lambda n, job: ("error", ("EXTENSION_DISCONNECTED", "Extension chưa kết nối")) if n == 1 else ("done", None)
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    assert svc.runner.wait(out["exec_id"], 30)
    r = runs(svc, cid)[0]
    assert r["state"] == "error" and "chưa mất credit" in r["error"]
    st = element_state(svc, cid, "clip", "shot:1")
    assert st["state"] == "missing" and not st["blockers"]                 # chạy lại được ngay
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    assert svc.runner.wait(out["exec_id"], 30)
    assert element_state(svc, cid, "clip", "shot:1")["state"] == "fresh" and len(veo.submitted) == 2


def test_flow_reported_render_failure_is_final_not_unknown(cl):
    svc, veo, _, _ = cl
    detail = "Flow render ended with status 4 [bản ghi poll: [\"x\",null,4,\"<url>\"]]"
    veo.script = lambda n, job: ("error", ("FLOW_RENDER_FAILED", detail)) if n == 1 else ("done", None)
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    assert svc.runner.wait(out["exec_id"], 30)
    r = runs(svc, cid)[0]
    assert r["state"] == "error" and r["external_ref"] == "veo1"
    assert "render thất bại" in r["error"] and "bản ghi poll" in r["error"] and "Kiểm tra số dư" in r["error"]
    st = element_state(svc, cid, "clip", "shot:1")
    assert st["state"] == "missing" and not st["blockers"]          # không kẹt "chưa rõ": người dùng sửa rồi chạy lại được


def test_prominent_people_filter_explains_the_cause(cl):
    svc, veo, _, _ = cl
    veo.script = lambda n, job: ("error", ("FLOW_PROMINENT_PEOPLE", "render ended with status 4 PROMINENT_PERSON"))
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    assert svc.runner.wait(out["exec_id"], 30)
    r = runs(svc, cid)[0]
    assert r["state"] == "error" and "người nổi tiếng" in r["error"] and "ĐỪNG chạy lại y nguyên" in r["error"]
    assert len(veo.submitted) == 1


def test_rerun_after_failure_uses_a_new_idempotency_key(cl):
    """Cùng vân tay chạy lại phải là job MỚI; nếu dùng lại key cũ, Veo trả về job lỗi cũ và không bao giờ gửi lại."""
    svc, veo, _, _ = cl
    veo.script = lambda n, job: ("error", ("FLOW_RENDER_FAILED", "Flow render ended with status 4")) if n == 1 else ("done", None)
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    assert svc.runner.wait(out["exec_id"], 30)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    assert svc.runner.wait(out["exec_id"], 30)
    keys = [r.idempotency_key for r in veo.submitted]
    assert len(keys) == 2 and keys[0] != keys[1]
    assert keys[0].rsplit("-a", 1)[0] == keys[1].rsplit("-a", 1)[0] and keys[0].endswith("-a1") and keys[1].endswith("-a2")
    assert element_state(svc, cid, "clip", "shot:1")["state"] == "fresh"


@pytest.mark.parametrize("script", [
    lambda n, job: ("error", ("FLOW_EMPTY_RESULT", "Flow không trả video")),
    lambda n, job: ("error", ("FLOW_TIMEOUT", "Timeout chờ kết quả Google Flow")),
    lambda n, job: ("error", ("UNKNOWN_ERROR", "Lỗi lạ")),
    lambda n, job: ("vanish", None),
])
def test_any_failure_after_submit_is_unknown_and_never_resent(cl, script):
    svc, veo, _, _ = cl
    veo.script = script
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    svc.runner.wait(out["exec_id"], 30)
    r = runs(svc, cid)[0]
    assert r["state"] == "unknown" and r["external_ref"] == "veo1" and "kiểm tra Flow" in r["error"]
    st = element_state(svc, cid, "clip", "shot:1")
    assert st["state"] == "blocked" and st["blockers"][0]["dep"] == "run"
    assert svc.run(cid, "clip", "draft", None, True, ["shot:1"])["exec_id"] is None      # không còn gì để chạy
    assert len(veo.submitted) == 1                                                         # KHÔNG gửi lại
    svc.resolve_run(r["id"], "not_sent")
    assert element_state(svc, cid, "clip", "shot:1")["state"] == "missing"


def test_timeout_waiting_for_flow_is_unknown(cl):
    svc, veo, _, mp = cl
    veo.script = lambda n, job: ("generating", None)
    mp.setattr(clip, "TIMEOUT_SECONDS", 0.2)
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    svc.runner.wait(out["exec_id"], 30)
    r = runs(svc, cid)[0]
    assert r["state"] == "unknown" and "Quá" in r["error"] and r["external_ref"] == "veo1"


def test_no_active_veo_project_is_a_clear_error_without_submitting(cl):
    svc, veo, _, _ = cl
    veo.project = None
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    svc.runner.wait(out["exec_id"], 30)
    r = runs(svc, cid)[0]
    assert r["state"] == "error" and "Chưa chọn project Veo" in r["error"] and veo.submitted == []


def test_veo_validation_error_means_nothing_was_sent(cl):
    svc, veo, _, _ = cl

    def reject(request):
        raise ValueError("Image file not found")
    veo.submit_job = reject
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    svc.runner.wait(out["exec_id"], 30)
    r = runs(svc, cid)[0]
    assert r["state"] == "error" and "Image file not found" in r["error"]
    assert element_state(svc, cid, "clip", "shot:1")["state"] == "missing"


def test_each_shot_can_choose_any_duration_from_3_to_15(cl):
    """Thời lượng riêng từng shot: 8 giây có model id đúng, giá chưa đo được ghi là dự kiến, shot khác không đổi."""
    svc, veo, _, _ = cl
    cid = ready(svc)
    svc.set_params(cid, "clip", {"duration": 8}, element_key="shot:1")
    p = svc.preview_prompt(cid, "clip", "shot:1", "draft")
    assert (p["duration"], p["model"], p["credit"], p["credit_estimate"]) == (8, "macaron_cookie_r2v_8s_360p", None, 8)
    assert "[0-2s]" in p["prompt"] and "[6-8s]" in p["prompt"]
    assert svc.preview_prompt(cid, "clip", "shot:2", "draft")["duration"] == 15
    plan = svc.plan(cid, "clip", elements=["shot:1"])
    assert plan["unknown_cost_items"] == 1 and plan["total_credit"] == 0 and plan["estimated_credit"] == 8
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    svc.runner.wait(out["exec_id"], 30)
    assert veo.submitted[0].duration_seconds == 8


@pytest.mark.parametrize("seconds", [2, 16])
def test_duration_outside_3_to_15_is_refused_without_submitting(cl, seconds):
    svc, veo, _, _ = cl
    cid = ready(svc)
    svc.set_params(cid, "clip", {"duration": seconds}, element_key="shot:1")
    with pytest.raises(Exception, match="3–15 giây"):
        svc.preview_prompt(cid, "clip", "shot:1", "draft")
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    svc.runner.wait(out["exec_id"], 30)
    assert veo.submitted == []


def test_price_estimate_matches_every_measured_point():
    for seconds, tier, want in ((13, "final", 48), (15, "draft", 20), (15, "final", 60), (10, "final", 30), (10, "draft", 10), (6, "final", 18)):
        assert graph.clip_cost_estimate({"duration": seconds}, tier) == want
    assert graph.clip_cost({"duration": 13}, "final") == 48 and graph.clip_cost({"duration": 8}, "draft") is None


def test_shot_plan_clamps_durations_to_3_15(cl):
    from app.campaign.executors import planning
    assert [planning.snap_duration(n) for n in (1, 3, 8, 15, 20, "abc", None)] == [3, 3, 8, 15, 15, 6, 6]
    svc, veo, _, _ = cl
    cid = ready(svc)
    shots = svc.engine.store.load_json(_selected(svc, cid, "shot_plan"))
    shots["items"][0]["duration"] = 8
    svc.edit_artifact(cid, "shot_plan", shots)
    assert svc.engine.store.load_json(_selected(svc, cid, "shot_plan"))["items"][0]["duration"] == 8


def test_editing_voiceover_does_not_stale_storyboards_or_clips(cl):
    """Vân tay theo trường: lời thoại/chữ trên màn hình không vào storyboard/clip, nên sửa chúng không làm cũ ảnh và video."""
    svc, veo, _, _ = cl
    cid = ready(svc)
    shots = svc.engine.store.load_json(_selected(svc, cid, "shot_plan"))
    svc.edit_artifact(cid, "shot_plan", shots)                              # chuẩn hóa một lần (kẹp chuyển động theo rủi ro áo)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    svc.runner.wait(out["exec_id"], 30)
    assert element_state(svc, cid, "clip", "shot:1")["state"] == "fresh"
    shots = svc.engine.store.load_json(_selected(svc, cid, "shot_plan"))
    shots["items"][0]["voiceover"] = "Một câu lời thoại hoàn toàn mới"
    shots["items"][0]["on_screen_text"] = "Chữ mới"
    svc.edit_artifact(cid, "shot_plan", shots)
    assert element_state(svc, cid, "storyboard", "shot:1")["state"] == "fresh"
    assert element_state(svc, cid, "clip", "shot:1")["state"] == "fresh"
    shots["items"][0]["panels"][0]["action"] = "She spins on the spot"      # trường có dùng -> phải cũ
    svc.edit_artifact(cid, "shot_plan", shots)
    assert element_state(svc, cid, "storyboard", "shot:1")["state"] == "stale"
    assert element_state(svc, cid, "storyboard", "shot:2")["state"] == "fresh"


def test_clip_refuses_storyboard_made_at_another_aspect(cl):
    svc, veo, executors, _ = cl
    executors["storyboard"] = lambda ctx: ExecResult([ArtifactSpec("image", ext="png", data=BOARD, meta={"aspect": "16:9"})])
    cid = ready(svc)
    with pytest.raises(Exception, match="16:9.*9:16"):
        svc.preview_prompt(cid, "clip", "shot:1", "draft")
    svc.set_params(cid, "clip", {"aspect": "16:9"})                          # cùng tỉ lệ -> được
    assert svc.preview_prompt(cid, "clip", "shot:1", "draft")["aspect"] == "16:9"


def _selected(svc, cid, step, element=""):
    with svc.session() as s:
        art = svc.store.selected(s, cid, step, element)
        s.expunge(art)
        return art


def test_720p_directly_without_360p(cl):
    svc, veo, _, _ = cl
    cid = ready(svc)
    out = svc.run(cid, "clip", "final", None, True, ["shot:2"])
    svc.runner.wait(out["exec_id"], 30)
    assert [r.resolution for r in veo.submitted] == ["720p"]                 # không cần bản 360p nào trước
    assert element_state(svc, cid, "clip", "shot:2", "final")["gate"] != "approved"   # clip 720p mới vẫn chờ duyệt


def test_draft_then_final_only_for_approved_clips(cl):
    svc, veo, _, _ = cl
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True)
    svc.runner.wait(out["exec_id"], 30)
    assert [r.resolution for r in veo.submitted] == ["360p"] * 3
    svc.decide_gate(cid, "clip", "approved", element_key="shot:1")
    plan = svc.plan(cid, "clip", "final", True)
    acts = {i["element_key"]: i["action"] for i in plan["items"] if i["step_key"] == "clip"}
    assert acts == {"shot:1": "run", "shot:2": "skip_not_approved", "shot:3": "skip_not_approved"} and plan["unknown_cost_items"] == 1 and plan["estimated_credit"] == 60
    veo.submitted.clear()
    out = svc.run(cid, "clip", "final", True, True)
    svc.runner.wait(out["exec_id"], 30)
    assert len(veo.submitted) == 1 and veo.submitted[0].resolution == "720p" and veo.submitted[0].duration_seconds == 15
    assert element_state(svc, cid, "clip", "shot:1", "final")["gate"] == "approved"      # final kế thừa quyết định duyệt
    with svc.session() as s:
        assert svc.engine.spent_credit(s, cid) == 3 * 20 + 60


def test_changing_clip_prompt_makes_only_clips_stale(cl):
    svc, veo, _, _ = cl
    cid = ready(svc)
    out = svc.run(cid, "clip", "draft", None, True, ["shot:1"])
    svc.runner.wait(out["exec_id"], 30)
    svc.set_params(cid, "clip", {"prompt": {"template_id": "system:clip_ingredients", "changes": "slower"}})
    st = element_state(svc, cid, "clip", "shot:1")
    assert st["state"] == "stale" and st["reasons"] == ["prompt"]
    assert element_state(svc, cid, "storyboard", "shot:1")["state"] == "fresh"
    assert graph.get_step("clip").default_template == "system:clip_ingredients"


def test_campaign_saved_with_the_old_frames_template_still_previews(cl):
    svc, veo, _, _ = cl
    cid = ready(svc)
    svc.set_params(cid, "clip", {"prompt": {"template_id": "system:clip_video", "version": 3, "changes": "slower"}})
    p = svc.preview_prompt(cid, "clip", "shot:1", "draft")
    assert "never shows a grid" in p["prompt"] and "slower" in p["prompt"]
