"""Hành vi cốt lõi: stale không xóa, cache theo vân tay, map theo phần tử, cổng duyệt, ghim, tier, ngân sách."""
import pytest

from app.campaign import graph
from app.campaign.runner import ConfirmRequired, OverBudget

from .conftest import approve_anchor, approve_storyboards, approve_look, element_state, prime, reach_clips, run_and_wait


def plan_items(plan, step):
    return [i for i in plan["items"] if i["step_key"] == step]


def test_states_follow_dependencies(svc, calls):
    cid = prime(svc)
    assert element_state(svc, cid, "fact_sheet")["state"] == "missing"
    assert element_state(svc, cid, "script")["state"] == "blocked"     # shot_plan chưa có
    run_and_wait(svc, cid, "script")                                    # chưa duyệt ảnh mẫu: shot_plan (nhìn ảnh mẫu) CHỜ, script chưa chạy
    assert any(b["dep"] == "look" and b["reason"] == "chưa duyệt" for b in element_state(svc, cid, "shot_plan")["blockers"])
    assert element_state(svc, cid, "script")["state"] == "blocked"
    svc.decide_gate(cid, "look", "approved")
    run_and_wait(svc, cid, "script")
    for step in ("fact_sheet", "angle", "shot_plan", "script"):
        assert element_state(svc, cid, step)["state"] == "fresh", step
    assert [c[0] for c in calls if c[0] != "look"] == ["fact_sheet", "angle", "hook", "shot_plan", "script"]   # shot_plan dùng hook đã chọn
    assert run_and_wait(svc, cid, "script")["exec_id"] is None          # không còn gì để chạy


def test_param_change_marks_stale_and_keeps_old_artifact(svc, calls):
    cid = prime(svc)
    approve_look(svc, cid)
    run_and_wait(svc, cid, "script")
    old = element_state(svc, cid, "shot_plan")["selected_artifact_id"]

    svc.set_params(cid, "shot_plan", {"shots": 2})
    st = element_state(svc, cid, "shot_plan")
    assert st["state"] == "stale" and st["reasons"] == ["params.shots"]
    assert st["selected_artifact_id"] == old
    assert element_state(svc, cid, "script")["state"] == "fresh"       # chưa chạy lại shot_plan => script chưa đổi

    run_and_wait(svc, cid, "script")
    assert element_state(svc, cid, "shot_plan")["selected_artifact_id"] != old
    assert len(svc.list_artifacts(cid, "shot_plan")) == 2              # bản cũ vẫn còn trong kho
    assert calls.count(("shot_plan", "", "draft")) == 2
    assert calls.count(("fact_sheet", "", "draft")) == 1                # bước không liên quan không chạy lại


def test_reverting_a_param_reuses_cached_artifact_for_free(svc, calls):
    cid = prime(svc)
    approve_look(svc, cid)
    run_and_wait(svc, cid, "shot_plan")
    first = element_state(svc, cid, "shot_plan")["selected_artifact_id"]
    svc.set_params(cid, "shot_plan", {"shots": 2})
    run_and_wait(svc, cid, "shot_plan")
    n_calls = len(calls)

    svc.set_params(cid, "shot_plan", {"shots": None})                  # quay lại tham số cũ
    st = element_state(svc, cid, "shot_plan")
    assert st["state"] == "stale" and st["cached_artifact_id"] == first
    plan = svc.plan(cid, "shot_plan")
    assert plan_items(plan, "shot_plan")[0]["action"] == "cached" and plan["total_credit"] == 0

    run_and_wait(svc, cid, "shot_plan")
    assert len(calls) == n_calls                                        # không gọi executor
    assert element_state(svc, cid, "shot_plan")["selected_artifact_id"] == first


def test_changing_input_images_cascades_stale_only_downstream(svc):
    cid = prime(svc)
    run_and_wait(svc, cid, "angle")
    new_img = svc.upload_image(cid, "other.png", b"another-shirt")
    svc.set_input_files(cid, "garment_source", [{"artifact_id": new_img["id"], "role": "front"}])
    assert element_state(svc, cid, "fact_sheet")["state"] == "stale"
    assert element_state(svc, cid, "fact_sheet")["reasons"] == ["inputs.garment_source"]
    assert element_state(svc, cid, "angle")["state"] == "fresh"        # chưa chạy lại fact_sheet nên angle chưa đổi
    run_and_wait(svc, cid, "angle")
    assert element_state(svc, cid, "angle")["state"] == "fresh"


def test_look_gate_blocks_downstream_until_approved(svc):
    cid = prime(svc)
    run_and_wait(svc, cid, "look")
    assert element_state(svc, cid, "look")["gate"] == "need_approval"
    plan = svc.plan(cid, "storyboard")
    assert plan_items(plan, "look")[0]["action"] == "approval"
    assert any(b["dep"] == "look" and b["reason"] == "chưa duyệt" for b in element_state(svc, cid, "shot_plan")["blockers"])   # kế hoạch shot nhìn ảnh mẫu đã duyệt
    assert element_state(svc, cid, "storyboard", "")["state"] == "blocked"

    svc.decide_gate(cid, "look", "approved")
    assert element_state(svc, cid, "look")["gate"] == "approved"
    approve_anchor(svc, cid)
    run_and_wait(svc, cid, "storyboard")
    assert [element_state(svc, cid, "storyboard", f"shot:{i}")["state"] for i in (1, 2, 3)] == ["fresh"] * 3


def test_new_look_candidate_needs_review_but_does_not_cancel_work(svc):
    cid = prime(svc)
    approve_look(svc, cid)
    run_and_wait(svc, cid, "storyboard")
    approved = element_state(svc, cid, "look")["selected_artifact_id"]

    svc.reroll(cid, "look")
    run_and_wait(svc, cid, "look")
    look = element_state(svc, cid, "look")
    assert look["selected_artifact_id"] != approved and look["gate"] == "need_approval"
    # khung mẫu vẫn dùng bản đã duyệt cũ: không bị xóa, không bị đánh dấu cũ
    assert element_state(svc, cid, "anchor_frame")["state"] == "fresh"

    svc.decide_gate(cid, "look", "approved")
    st = element_state(svc, cid, "anchor_frame")
    assert st["state"] == "stale" and st["reasons"] == ["inputs.look"]
    assert element_state(svc, cid, "storyboard", "shot:1")["state"] == "fresh"     # chỉ cũ khi khung mẫu thực sự được làm lại


def test_gate_candidate_can_be_chosen_by_user(svc):
    cid = prime(svc)
    svc.set_params(cid, "look", {"count": 3})
    run_and_wait(svc, cid, "look")
    arts = svc.list_artifacts(cid, "look")
    assert len(arts) == 3
    pick = arts[-1]["id"]                                               # ứng viên bất kỳ
    svc.decide_gate(cid, "look", "approved", artifact_id=pick)
    st = element_state(svc, cid, "look")
    assert st["selected_artifact_id"] == pick and st["gate"] == "approved"


def test_rejecting_look_keeps_note_for_next_run(svc):
    cid = prime(svc)
    run_and_wait(svc, cid, "shot_plan")
    run_and_wait(svc, cid, "look")
    svc.decide_gate(cid, "look", "rejected", note="logo bị méo")
    assert element_state(svc, cid, "look")["gate"] == "rejected"
    plan = svc.plan(cid, "storyboard")
    assert plan_items(plan, "storyboard")[0]["action"] in ("blocked",)


def test_editing_shot_2_only_regenerates_shot_2(svc, calls):
    """Hành vi cũ: sửa shot 2 xóa clip 2 VÀ clip 3 (60 credit). Mới: chỉ clip 2 (10 credit nháp)."""
    cid = prime(svc)
    reach_clips(svc, cid)
    for i in (1, 2, 3):
        assert element_state(svc, cid, "clip", f"shot:{i}")["state"] == "fresh"
    old_clip2 = element_state(svc, cid, "clip", "shot:2")["selected_artifact_id"]
    plan_items_before = svc.plan(cid, "clip")
    assert plan_items_before["total_credit"] == 0

    shots = svc.engine.store.load_json(_selected(svc, cid, "shot_plan"))
    shots["items"][1]["panels"][0]["action"] = "shot 2 sửa lại: đi chậm, quay nghiêng"
    svc.edit_artifact(cid, "shot_plan", shots)

    # Clip chỉ "cũ" khi storyboard của nó THỰC SỰ được tạo lại; đổi đầu vào chưa chạy lại thì storyboard cũ, còn clip 2 thì do nhịp đổi.
    shot_states = lambda step: [element_state(svc, cid, step, f"shot:{i}")["state"] for i in (1, 2, 3)]   # noqa: E731
    assert shot_states("storyboard") == ["fresh", "stale", "fresh"]
    assert shot_states("clip") == ["fresh", "stale", "fresh"]

    # Bước 1: chỉ làm lại storyboard shot 2 (0 credit). Clip 2 CHỜ người duyệt storyboard mới.
    plan = svc.plan(cid, "clip")
    acts = {i["step_key"] + ":" + i["element_key"]: i["action"] for i in plan["items"] if i["step_key"] in ("storyboard", "clip")}
    assert acts == {"storyboard:shot:1": "fresh", "storyboard:shot:2": "run", "storyboard:shot:3": "fresh",
                    "clip:shot:1": "approval", "clip:shot:2": "waiting", "clip:shot:3": "approval"}
    assert plan["total_credit"] == 0 and plan["images"] == 1
    calls.clear()
    run_and_wait(svc, cid, "clip")
    assert calls == [("storyboard", "shot:2", "draft")]
    assert element_state(svc, cid, "storyboard", "shot:2")["gate"] == "need_approval"
    assert element_state(svc, cid, "clip", "shot:2")["selected_artifact_id"] == old_clip2

    # Bước 2: duyệt storyboard mới -> chỉ clip 2 chạy lại, 20 credit nháp
    svc.decide_gate(cid, "storyboard", "approved", element_key="shot:2")
    plan = svc.plan(cid, "clip")
    assert [i["step_key"] + ":" + i["element_key"] for i in plan["items"] if i["action"] == "run"] == ["clip:shot:2"]
    assert plan["total_credit"] == 20
    calls.clear()
    run_and_wait(svc, cid, "clip", confirm=True)
    assert calls == [("clip", "shot:2", "draft")]
    assert element_state(svc, cid, "clip", "shot:2")["selected_artifact_id"] != old_clip2
    assert len(svc.list_artifacts(cid, "clip", "shot:2")) == 2          # clip 2 cũ vẫn xem/khôi phục được


def _selected(svc, cid, step, element=""):
    with svc.session() as s:
        art = svc.store.selected(s, cid, step, element)
        s.expunge(art)
        return art


def test_manual_edit_is_fresh_until_upstream_changes(svc):
    cid = prime(svc)
    approve_look(svc, cid)
    run_and_wait(svc, cid, "shot_plan")
    data = svc.engine.store.load_json(_selected(svc, cid, "shot_plan"))
    data["items"][0]["voiceover"] = "tự viết"
    svc.edit_artifact(cid, "shot_plan", data)
    assert element_state(svc, cid, "shot_plan")["state"] == "fresh"
    svc.set_params(cid, "style", {"lighting": "hard"})                 # upstream đổi
    st = element_state(svc, cid, "shot_plan")
    assert st["state"] == "stale" and st["reasons"] == ["inputs.style"]


def test_pin_freezes_step(svc, calls):
    cid = prime(svc)
    run_and_wait(svc, cid, "fact_sheet")
    svc.set_pin(cid, "fact_sheet", True)
    img = svc.upload_image(cid, "o.png", b"zzz")
    svc.set_input_files(cid, "garment_source", [{"artifact_id": img["id"]}])
    st = element_state(svc, cid, "fact_sheet")
    assert st["state"] == "pinned" and st["stale"] is True
    assert svc.plan(cid, "fact_sheet")["items"][-1]["action"] == "pinned"
    n = len(calls)
    run_and_wait(svc, cid, "fact_sheet")
    assert len(calls) == n
    svc.set_pin(cid, "fact_sheet", False)
    assert element_state(svc, cid, "fact_sheet")["state"] == "stale"


def test_720p_is_a_free_choice_not_gated_by_360p_approval(svc, calls):
    cid = prime(svc)
    reach_clips(svc, cid)
    svc.decide_gate(cid, "clip", "approved", element_key="shot:1")
    plan = svc.plan(cid, "clip", tier="final")
    acts = {i["element_key"]: i["action"] for i in plan["items"] if i["step_key"] == "clip"}
    assert acts == {"shot:1": "run", "shot:2": "run", "shot:3": "run"}       # 720p không bắt duyệt bản 360p trước


def test_only_approved_flag_still_limits_final_run(svc, calls):
    cid = prime(svc)
    reach_clips(svc, cid)
    svc.decide_gate(cid, "clip", "approved", element_key="shot:1")
    svc.decide_gate(cid, "clip", "approved", element_key="shot:3")

    plan = svc.plan(cid, "clip", tier="final", only_approved=True)
    acts = {i["element_key"]: i["action"] for i in plan["items"] if i["step_key"] == "clip"}
    assert acts == {"shot:1": "run", "shot:2": "skip_not_approved", "shot:3": "run"}
    assert plan["unknown_cost_items"] == 2 and plan["estimated_credit"] == 120

    calls.clear()
    run_and_wait(svc, cid, "clip", tier="final", only_approved=True, confirm=True)
    assert sorted(calls) == [("clip", "shot:1", "final"), ("clip", "shot:3", "final")]
    # bản final kế thừa quyết định đã duyệt; clip 2 vẫn là bản nháp
    assert element_state(svc, cid, "clip", "shot:1", "final")["gate"] == "approved"
    with svc.session() as s:
        assert svc.engine.spent_credit(s, cid) == 3 * 20 + 2 * 60       # 3 clip nháp + 2 clip final


def test_credit_confirmation_and_budget(svc):
    cid = prime(svc)
    approve_storyboards(svc, cid)
    with pytest.raises(ConfirmRequired) as exc:
        svc.run(cid, "clip", "draft")
    assert exc.value.plan.total_credit == 60

    svc.update_campaign(cid, credit_cap=20)
    with pytest.raises(OverBudget):
        svc.run(cid, "clip", "draft", confirm_credit=True)
    svc.update_campaign(cid, credit_cap=60)
    out = svc.run(cid, "clip", "draft", confirm_credit=True)
    assert svc.runner.wait(out["exec_id"], 30)


def test_unknown_cost_is_reported_not_guessed(svc):
    cid = prime(svc)
    approve_storyboards(svc, cid)
    svc.set_params(cid, "clip", {"duration": 6})                      # 360p 6s chưa có số liệu giá
    plan = svc.plan(cid, "clip")
    assert plan["unknown_cost_items"] == 3 and plan["total_credit"] == 0 and plan["needs_confirm"] is True and plan["estimated_credit"] == 18


def test_plan_estimates_unknown_elements_after_upstream(svc):
    cid = prime(svc)
    # ảnh mẫu chưa duyệt thì kế hoạch shot còn bị chặn nên chưa ước lượng được số shot: duyệt trước
    approve_look(svc, cid)
    plan = svc.plan(cid, "clip")                                         # chưa có shot_plan => chưa biết bao nhiêu shot
    clip = plan_items(plan, "clip")
    assert [i["element_key"] for i in clip] == ["*"] and clip[0]["estimate"] is True
    assert clip[0]["credit"] is None                                     # chưa có kế hoạch shot thì chưa biết thời lượng: không đoán giá
    assert plan["unknown_cost_items"] == 1 and plan["needs_confirm"] is True


def test_parallel_writes_of_identical_content_do_not_collide(tmp_path):
    """Hai việc song song tạo cùng một ảnh (cùng hash) không được tranh file tạm (lỗi Windows 'file đang được dùng')."""
    import threading
    from app.campaign.store import ArtifactStore
    store = ArtifactStore(tmp_path)
    errors = []

    def write():
        try:
            for _ in range(40):
                store._write_file("camp", "ab" + "0" * 62, "png", b"same-bytes")
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=write) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == []
    files = list((tmp_path / "camp" / "artifacts" / "ab").iterdir())
    assert [f.name for f in files] == ["ab" + "0" * 62 + ".png"]       # không còn file .part nào sót lại


def test_assemble_never_pulls_stale_paid_clips_back_into_a_run(svc, calls):
    """Nâng prompt làm clip đã duyệt thành "cũ": ghép video (0 credit) vẫn dùng clip đã duyệt, không kéo clip (tốn credit) chạy lại."""
    cid = prime(svc)
    reach_clips(svc, cid)
    run_and_wait(svc, cid, "script")
    svc.set_params(cid, "voice", {"voice_id": "x"})
    run_and_wait(svc, cid, "voice")
    for k in ("shot:1", "shot:2", "shot:3"):
        svc.decide_gate(cid, "clip", "approved", element_key=k)                                    # người dùng duyệt clip
    svc.set_params(cid, "clip", {"aspect": "9:16", "mode": "i2v", "model": "other"})              # rồi đổi tham số clip -> clip thành "cũ"
    assert element_state(svc, cid, "clip", "shot:1")["state"] == "stale"
    plan = svc.plan(cid, "assemble")
    assert [i["step_key"] for i in plan["items"]] == ["assemble"] and plan["total_credit"] == 0 and plan["needs_confirm"] is False
    calls.clear()
    out = run_and_wait(svc, cid, "assemble")                                                       # KHÔNG cần confirm_credit
    assert out["exec_id"] and calls == [("assemble", "", "draft")]
    assert element_state(svc, cid, "assemble")["state"] == "fresh"


def test_assemble_is_blocked_with_a_clear_reason_until_clips_are_approved(svc, calls):
    cid = prime(svc)
    plan = svc.plan(cid, "assemble")
    assert [i["step_key"] for i in plan["items"]] == ["assemble"] and plan["items"][0]["action"] in ("blocked", "waiting", "input_missing")
    out = run_and_wait(svc, cid, "assemble")
    assert out["exec_id"] is None and calls == []                                                  # không chạy gì, không kéo bước nào


def test_full_run_without_a_target_still_runs_every_step(svc, calls):
    cid = prime(svc)
    assert {s.key for s in graph.STEPS} == graph.needed_for(None)
    assert graph.needed_for("assemble") == {"assemble"} and "clip" in graph.needed_for("clip")
