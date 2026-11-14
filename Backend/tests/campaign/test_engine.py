"""Hành vi cốt lõi v3: stale không xóa, cache theo vân tay, map theo phần tử (shot, cảnh), dep_element, cổng duyệt, ghim, tier, ngân sách."""
import pytest

from app.campaign import graph
from app.campaign.runner import ConfirmRequired, OverBudget

from .conftest import SCENES, approve_cast_sheet, approve_scene_anchors, element_state, elements_of, prime, reach_clips, run_and_wait


def plan_items(plan, step):
    return [i for i in plan["items"] if i["step_key"] == step]


def _selected(svc, cid, step, element=""):
    with svc.session() as s:
        art = svc.store.selected(s, cid, step, element)
        s.expunge(art)
        return art


def test_states_follow_dependencies(svc, calls):
    cid = prime(svc)
    assert element_state(svc, cid, "fact_sheet")["state"] == "missing"
    assert element_state(svc, cid, "script")["state"] == "blocked"       # cast sheet chưa duyệt
    run_and_wait(svc, cid, "script")                                      # cast sheet chạy nhưng CHỜ duyệt: script chưa chạy
    assert any(b["dep"] == "cast_sheet" and b["reason"] == "chưa duyệt" for b in element_state(svc, cid, "script")["blockers"])
    svc.decide_gate(cid, "cast_sheet", "approved")
    run_and_wait(svc, cid, "script")
    for step in ("fact_sheet", "cast_sheet", "script"):
        assert element_state(svc, cid, step)["state"] == "fresh", step
    assert [c[0] for c in calls] == ["fact_sheet", "cast_sheet", "script"]
    assert run_and_wait(svc, cid, "script")["exec_id"] is None            # không còn gì để chạy


def test_scene_steps_map_over_the_scene_list_in_params(svc, calls):
    cid = prime(svc)
    assert elements_of(svc, cid, "scene_plate") == ["scene:1", "scene:2"]
    run_and_wait(svc, cid, "scene_plate")
    assert sorted(c[1] for c in calls if c[0] == "scene_plate") == ["scene:1", "scene:2"]
    # Sửa cảnh 2 chỉ làm cũ ảnh bối cảnh của cảnh 2
    svc.set_params(cid, "scene_set", {"items": [SCENES[0], {**SCENES[1], "place": "a rooftop at dusk"}]})
    assert element_state(svc, cid, "scene_plate", "scene:1")["state"] == "fresh"
    st = element_state(svc, cid, "scene_plate", "scene:2")
    assert st["state"] == "stale" and st["reasons"] == ["inputs.scene_set[scene:2]"]
    # Thêm cảnh thứ ba -> phần tử mới "chưa có", hai cảnh cũ không đổi
    svc.set_params(cid, "scene_set", {"items": [SCENES[0], SCENES[1], {**SCENES[1], "key": "scene:3", "place": "a park"}]})
    assert element_state(svc, cid, "scene_plate", "scene:3")["state"] == "missing"
    assert element_state(svc, cid, "scene_plate", "scene:1")["state"] == "fresh"


def test_param_change_marks_stale_and_keeps_old_artifact(svc, calls):
    cid = prime(svc)
    approve_cast_sheet(svc, cid)
    run_and_wait(svc, cid, "script")
    old = element_state(svc, cid, "script")["selected_artifact_id"]

    svc.set_params(cid, "format", {"format_id": "detail_first"})
    st = element_state(svc, cid, "script")
    assert st["state"] == "stale" and st["reasons"] == ["inputs.format"]
    assert st["selected_artifact_id"] == old

    run_and_wait(svc, cid, "script")
    assert element_state(svc, cid, "script")["selected_artifact_id"] != old
    assert len(svc.list_artifacts(cid, "script")) == 2                   # bản cũ vẫn còn trong kho
    assert calls.count(("script", "", "draft")) == 2
    assert calls.count(("fact_sheet", "", "draft")) == 1                  # bước không liên quan không chạy lại


def test_reverting_a_param_reuses_cached_artifact_for_free(svc, calls):
    cid = prime(svc)
    approve_cast_sheet(svc, cid)
    run_and_wait(svc, cid, "script")
    first = element_state(svc, cid, "script")["selected_artifact_id"]
    svc.set_params(cid, "format", {"format_id": "detail_first"})
    run_and_wait(svc, cid, "script")
    n_calls = len(calls)

    svc.set_params(cid, "format", {"format_id": "fit_check"})             # quay lại tham số cũ
    st = element_state(svc, cid, "script")
    assert st["state"] == "stale" and st["cached_artifact_id"] == first
    plan = svc.plan(cid, "script")
    assert plan_items(plan, "script")[0]["action"] == "cached" and plan["total_credit"] == 0

    run_and_wait(svc, cid, "script")
    assert len(calls) == n_calls                                          # không gọi executor
    assert element_state(svc, cid, "script")["selected_artifact_id"] == first


def test_changing_input_images_cascades_stale_only_downstream(svc):
    cid = prime(svc)
    run_and_wait(svc, cid, "fact_sheet")
    run_and_wait(svc, cid, "cast_sheet")
    new_img = svc.upload_image(cid, "other.png", b"another-shirt")
    svc.set_input_files(cid, "garment_source", [{"artifact_id": new_img["id"], "role": "front"}])
    assert element_state(svc, cid, "fact_sheet")["state"] == "stale"
    assert element_state(svc, cid, "fact_sheet")["reasons"] == ["inputs.garment_source"]
    assert element_state(svc, cid, "cast_sheet")["state"] == "stale"
    assert element_state(svc, cid, "scene_plate", "scene:1")["state"] == "missing"    # ảnh bối cảnh không dùng ảnh áo


def test_cast_sheet_gate_blocks_downstream_until_approved(svc):
    cid = prime(svc)
    run_and_wait(svc, cid, "cast_sheet")
    assert element_state(svc, cid, "cast_sheet")["gate"] == "need_approval"
    plan = svc.plan(cid, "scene_anchor")
    assert plan_items(plan, "cast_sheet")[0]["action"] == "approval"
    assert element_state(svc, cid, "scene_anchor", "scene:1")["state"] == "blocked"

    svc.decide_gate(cid, "cast_sheet", "approved")
    assert element_state(svc, cid, "cast_sheet")["gate"] == "approved"
    run_and_wait(svc, cid, "scene_anchor")
    assert [element_state(svc, cid, "scene_anchor", k)["state"] for k in ("scene:1", "scene:2")] == ["fresh"] * 2
    assert [element_state(svc, cid, "scene_anchor", k)["gate"] for k in ("scene:1", "scene:2")] == ["need_approval"] * 2


def test_new_cast_sheet_candidate_needs_review_but_does_not_cancel_work(svc):
    cid = prime(svc)
    approve_scene_anchors(svc, cid)
    approved = element_state(svc, cid, "cast_sheet")["selected_artifact_id"]

    svc.reroll(cid, "cast_sheet")
    run_and_wait(svc, cid, "cast_sheet")
    sheet = element_state(svc, cid, "cast_sheet")
    assert sheet["selected_artifact_id"] != approved and sheet["gate"] == "need_approval"
    # khung chốt vẫn dùng bản đã duyệt cũ: không bị xóa, không bị đánh dấu cũ
    assert element_state(svc, cid, "scene_anchor", "scene:1")["state"] == "fresh"

    svc.decide_gate(cid, "cast_sheet", "approved")
    st = element_state(svc, cid, "scene_anchor", "scene:1")
    assert st["state"] == "stale" and st["reasons"] == ["inputs.cast_sheet"]


def test_gate_candidate_can_be_chosen_by_user(svc):
    cid = prime(svc)
    svc.set_params(cid, "cast_sheet", {"count": 3})
    run_and_wait(svc, cid, "cast_sheet")
    arts = svc.list_artifacts(cid, "cast_sheet")
    assert len(arts) == 3
    pick = arts[-1]["id"]
    svc.decide_gate(cid, "cast_sheet", "approved", artifact_id=pick)
    st = element_state(svc, cid, "cast_sheet")
    assert st["selected_artifact_id"] == pick and st["gate"] == "approved"


def test_rejecting_keeps_note_for_next_run(svc):
    cid = prime(svc)
    run_and_wait(svc, cid, "cast_sheet")
    svc.decide_gate(cid, "cast_sheet", "rejected", note="logo bị méo")
    assert element_state(svc, cid, "cast_sheet")["gate"] == "rejected"
    plan = svc.plan(cid, "scene_anchor")
    assert plan_items(plan, "scene_anchor")[0]["action"] == "blocked"


def test_clip_depends_only_on_the_anchor_of_its_own_scene(svc, calls):
    """dep_element: shot ở cảnh 1 dùng khung chốt cảnh 1; duyệt lại khung chốt cảnh 2 KHÔNG làm cũ clip của cảnh 1 (clip tốn credit)."""
    cid = prime(svc, format_id="hero_piece")            # shot 1,4 -> scene:1; shot 2 -> scene:2; shot 3 -> scene:3 (không có) -> scene:1
    reach_clips(svc, cid)
    shots = svc.engine.store.load_json(_selected(svc, cid, "script"))["items"]
    assert [s["scene"] for s in shots] == ["scene:1", "scene:2", "scene:1", "scene:1"]
    assert all(element_state(svc, cid, "clip", f"shot:{i}")["state"] == "fresh" for i in (1, 2, 3, 4))

    svc.reroll(cid, "scene_anchor", "scene:2")
    run_and_wait(svc, cid, "scene_anchor", elements=["scene:2"])
    svc.decide_gate(cid, "scene_anchor", "approved", element_key="scene:2")
    states = {f"shot:{i}": element_state(svc, cid, "clip", f"shot:{i}")["state"] for i in (1, 2, 3, 4)}
    assert states == {"shot:1": "fresh", "shot:2": "stale", "shot:3": "fresh", "shot:4": "fresh"}
    assert element_state(svc, cid, "clip", "shot:2")["reasons"] == ["inputs.scene_anchor[scene:2]"]

    plan = svc.plan(cid, "clip")
    assert [i["element_key"] for i in plan["items"] if i["step_key"] == "clip" and i["action"] == "run"] == ["shot:2"]
    assert plan["total_credit"] == 0 and plan["estimated_credit"] == 5          # 5 s 360p: chưa đo giá, chỉ dự kiến


def test_clip_keeps_the_approved_anchor_until_the_new_one_is_approved(svc, calls):
    cid = prime(svc)
    reach_clips(svc, cid)
    for k in ("shot:1", "shot:2", "shot:3", "shot:4"):
        svc.decide_gate(cid, "clip", "approved", element_key=k)
    svc.reroll(cid, "scene_anchor", "scene:1")
    run_and_wait(svc, cid, "scene_anchor", elements=["scene:1"])
    plan = svc.plan(cid, "clip")
    acts = {i["element_key"]: i["action"] for i in plan["items"] if i["step_key"] == "clip"}
    assert set(acts.values()) == {"fresh"} and plan["total_credit"] == 0        # khung chốt mới chưa duyệt: clip vẫn trỏ bản đã duyệt
    calls.clear()
    run_and_wait(svc, cid, "clip", confirm=True)
    assert calls == []
    svc.decide_gate(cid, "scene_anchor", "approved", element_key="scene:1")
    assert all(element_state(svc, cid, "clip", f"shot:{i}")["state"] == "stale" for i in (1, 2, 3, 4))   # fit_check: cả 4 shot ở cảnh 1


def test_editing_shot_2_only_regenerates_shot_2(svc, calls):
    cid = prime(svc)
    reach_clips(svc, cid)
    old_clip2 = element_state(svc, cid, "clip", "shot:2")["selected_artifact_id"]
    assert svc.plan(cid, "clip")["total_credit"] == 0

    doc = svc.engine.store.load_json(_selected(svc, cid, "script"))
    doc["items"][1]["beats"][0] = "shot 2 sửa lại: đi chậm, quay nghiêng"
    svc.edit_artifact(cid, "script", doc)
    states = lambda: [element_state(svc, cid, "clip", f"shot:{i}")["state"] for i in (1, 2, 3, 4)]   # noqa: E731
    assert states() == ["fresh", "stale", "fresh", "fresh"]

    plan = svc.plan(cid, "clip")
    assert [i["element_key"] for i in plan["items"] if i["step_key"] == "clip" and i["action"] == "run"] == ["shot:2"]
    assert plan["estimated_credit"] == 6                                      # chỉ shot 2 (6 s 360p)
    calls.clear()
    run_and_wait(svc, cid, "clip", confirm=True)
    assert calls == [("clip", "shot:2", "draft")]
    assert element_state(svc, cid, "clip", "shot:2")["selected_artifact_id"] != old_clip2
    assert len(svc.list_artifacts(cid, "clip", "shot:2")) == 2          # clip 2 cũ vẫn xem/khôi phục được


def test_editing_voiceover_does_not_stale_clips(svc):
    cid = prime(svc)
    reach_clips(svc, cid)
    doc = svc.engine.store.load_json(_selected(svc, cid, "script"))
    doc["items"][0]["voiceover"] = "Một câu lời thoại hoàn toàn mới"
    doc["items"][0]["on_screen_text"] = "Chữ mới"
    svc.edit_artifact(cid, "script", doc)
    assert element_state(svc, cid, "clip", "shot:1")["state"] == "fresh"
    assert element_state(svc, cid, "voice")["state"] in ("missing", "stale")


def test_manual_edit_is_fresh_until_upstream_changes(svc):
    cid = prime(svc)
    approve_cast_sheet(svc, cid)
    run_and_wait(svc, cid, "script")
    data = svc.engine.store.load_json(_selected(svc, cid, "script"))
    data["items"][0]["voiceover"] = "tự viết"
    svc.edit_artifact(cid, "script", data)
    assert element_state(svc, cid, "script")["state"] == "fresh"
    svc.set_params(cid, "brief", {"audience": "nam 25-35"})            # upstream đổi
    st = element_state(svc, cid, "script")
    assert st["state"] == "stale" and st["reasons"] == ["inputs.brief"]


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
    assert acts == {f"shot:{i}": "run" for i in (1, 2, 3, 4)}


def test_only_approved_flag_still_limits_final_run(svc, calls):
    cid = prime(svc)
    reach_clips(svc, cid)
    svc.decide_gate(cid, "clip", "approved", element_key="shot:1")
    svc.decide_gate(cid, "clip", "approved", element_key="shot:3")

    plan = svc.plan(cid, "clip", tier="final", only_approved=True)
    acts = {i["element_key"]: i["action"] for i in plan["items"] if i["step_key"] == "clip"}
    assert acts == {"shot:1": "run", "shot:2": "skip_not_approved", "shot:3": "run", "shot:4": "skip_not_approved"}
    assert plan["total_credit"] == 0 and plan["estimated_credit"] == 12 + 12   # 4 s 720p chưa đo giá: dự kiến 3 credit/giây

    calls.clear()
    run_and_wait(svc, cid, "clip", tier="final", only_approved=True, confirm=True)
    assert sorted(calls) == [("clip", "shot:1", "final"), ("clip", "shot:3", "final")]
    assert element_state(svc, cid, "clip", "shot:1", "final")["gate"] == "approved"


def test_credit_confirmation_and_budget(svc):
    cid = prime(svc)
    approve_scene_anchors(svc, cid)
    run_and_wait(svc, cid, "script")
    with pytest.raises(ConfirmRequired) as exc:
        svc.run(cid, "clip", "draft")
    assert exc.value.plan.estimated_credit == 4 + 6 + 4 + 4                # fit_check 360p: 1 credit/giây (dự kiến)

    svc.update_campaign(cid, credit_cap=10)
    with pytest.raises(OverBudget):
        svc.run(cid, "clip", "draft", confirm_credit=True)
    svc.update_campaign(cid, credit_cap=60)
    out = svc.run(cid, "clip", "draft", confirm_credit=True)
    assert svc.runner.wait(out["exec_id"], 30)


def test_unknown_cost_is_reported_not_guessed(svc):
    cid = prime(svc)
    approve_scene_anchors(svc, cid)
    run_and_wait(svc, cid, "script")
    plan = svc.plan(cid, "clip")
    assert plan["unknown_cost_items"] == 4 and plan["total_credit"] == 0 and plan["needs_confirm"] is True and plan["estimated_credit"] == 18
    svc.set_params(cid, "clip", {"duration": 15})                        # 360p 15 s ĐÃ đo: 20
    plan = svc.plan(cid, "clip")
    assert plan["unknown_cost_items"] == 0 and plan["total_credit"] == 80


def test_plan_estimates_unknown_elements_after_upstream(svc):
    cid = prime(svc)
    approve_cast_sheet(svc, cid)
    plan = svc.plan(cid, "clip")                                         # chưa có kịch bản => số shot lấy từ format
    clip = plan_items(plan, "clip")
    assert [i["element_key"] for i in clip] == ["*"] and clip[0]["estimate"] is True
    assert clip[0]["credit"] is None and plan["unknown_cost_items"] == 1 and plan["needs_confirm"] is True


def test_parallel_writes_of_identical_content_do_not_collide(tmp_path):
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
    assert [f.name for f in files] == ["ab" + "0" * 62 + ".png"]


def test_assemble_never_pulls_stale_paid_clips_back_into_a_run(svc, calls):
    cid = prime(svc)
    reach_clips(svc, cid)
    svc.set_params(cid, "voice", {"voice_id": "x"})
    run_and_wait(svc, cid, "voice")
    for k in ("shot:1", "shot:2", "shot:3", "shot:4"):
        svc.decide_gate(cid, "clip", "approved", element_key=k)
    svc.set_params(cid, "clip", {"aspect": "9:16", "model": "other"})                           # đổi tham số clip -> clip thành "cũ"
    assert element_state(svc, cid, "clip", "shot:1")["state"] == "stale"
    plan = svc.plan(cid, "assemble")
    assert [i["step_key"] for i in plan["items"]] == ["assemble"] and plan["total_credit"] == 0 and plan["needs_confirm"] is False
    calls.clear()
    out = run_and_wait(svc, cid, "assemble")
    assert out["exec_id"] and calls == [("assemble", "", "draft")]
    assert element_state(svc, cid, "assemble")["state"] == "fresh"
    run_and_wait(svc, cid, "export_pack")
    assert element_state(svc, cid, "export_pack")["state"] == "fresh"


def test_assemble_is_blocked_with_a_clear_reason_until_clips_are_approved(svc, calls):
    cid = prime(svc)
    plan = svc.plan(cid, "assemble")
    assert [i["step_key"] for i in plan["items"]] == ["assemble"] and plan["items"][0]["action"] in ("blocked", "waiting", "input_missing")
    out = run_and_wait(svc, cid, "assemble")
    assert out["exec_id"] is None and calls == []


def test_full_run_without_a_target_still_runs_every_step(svc, calls):
    assert {s.key for s in graph.STEPS} == graph.needed_for(None)
    assert graph.needed_for("assemble") == {"assemble"} and "clip" in graph.needed_for("clip")
    assert graph.get_step("clip").dep_elements == {"scene_anchor": "scene", "scene_set": "scene"}
