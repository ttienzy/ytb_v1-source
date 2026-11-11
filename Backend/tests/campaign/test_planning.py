"""Khối 3 (Kế hoạch): chuẩn hóa, luật nghiệp vụ, executor với LLM giả, sửa tay từng shot."""
import json

import pytest

from app.campaign.executors import fact_sheet, llm, planning

from .conftest import approve_storyboards, approve_look, element_state, prime, run_and_wait

GARMENT_REPLY = json.dumps({
    "category": "oversized t-shirt", "color": "off-white", "pattern": "stripes", "logo_present": True,
    "logo_text": "Haim", "summary": "Striped tee", "summary_vi": "Áo kẻ", "do_not_say": ["100% cotton"],
})


def llm_reply(prompt: str) -> str:
    """LLM giả: nhận biết bước theo nội dung prompt."""
    if "storytelling angles" in prompt:
        return json.dumps({"items": [
            {"key": "angle:1", "id": "lookbook", "title_vi": "Lookbook", "pitch_vi": "Cảnh tĩnh", "needs_motion": "gentle", "risk_note": "ok"},
            {"key": "angle:2", "id": "spin", "title_vi": "Xoay", "pitch_vi": "Xoay người", "needs_motion": "free", "risk_note": "kém"}],
            "chosen": "angle:1"})
    if "scroll-stopping HOOKS" in prompt:
        return "```json\n" + json.dumps({"items": [
            {"type": "contrast", "voiceover": "Áo trơn thành nổi bật", "on_screen_text": "Trước/Sau", "visual": "split", "seconds": 4},
            {"type": "direct", "voiceover": "Nhìn này", "on_screen_text": "Xem", "visual": "to camera", "seconds": 9}]}) + "\n```"
    if "fashion video director" in prompt:
        return json.dumps({"items": [
            {"key": "shot:1", "role": "hook", "duration": 10, "camera": "medium", "motion": "free",
             "on_screen_text": "Áo kẻ", "voiceover": "Xin chào", "keyframe_start": "a", "keyframe_end": "b"},
            {"key": "shot:2", "role": "benefit", "duration": 10, "camera": "close", "motion": "free",
             "on_screen_text": "Chi tiết", "voiceover": "Chất liệu mềm", "keyframe_start": "c", "keyframe_end": "d"},
            {"key": "shot:3", "role": "cta", "duration": 10, "camera": "wide", "motion": "gentle",
             "on_screen_text": "Mua ngay", "voiceover": "Đặt hàng ngay", "keyframe_start": "e", "keyframe_end": "f"}]})
    if "copywriter finalizing" in prompt:
        return json.dumps({"items": [
            {"shot": "shot:1", "voiceover": "Mình đã mua và dùng 3 tháng rồi", "on_screen_text": "Hàng chính hãng"},
            {"shot": "shot:2", "voiceover": "Áo cotton 100% cotton", "on_screen_text": "Chi tiết"},
            {"shot": "shot:9", "voiceover": "?", "on_screen_text": ""}],
            "caption": "Áo đẹp", "hashtags": ["thoitrang", "#ootd", "#ootd"], "cta": "Mua ngay"})
    raise AssertionError("prompt lạ: " + prompt[:80])


@pytest.fixture
def real_plan(env, monkeypatch):
    svc, calls, executors = env
    prompts_seen = []

    def fake_llm(prompt, image_paths=None):
        prompts_seen.append(prompt)
        return (GARMENT_REPLY if "meticulous fashion product inspector" in prompt else llm_reply(prompt)), "gemini"
    monkeypatch.setattr(llm, "call_llm", fake_llm)
    executors["fact_sheet"] = fact_sheet.run_fact_sheet
    for key, spec in planning.SPECS.items():
        executors[key] = planning.make_executor(spec)
    return svc, prompts_seen


def load(svc, cid, step):
    art = svc.list_artifacts(cid, step)[0]
    return json.loads(svc.artifact_file(art["id"])[0].read_text(encoding="utf-8"))


# ── chuẩn hóa thuần ───────────────────────────────────────────────────────────
def test_keyed_preserves_valid_keys_and_fills_gaps():
    out = planning._keyed([{"key": "shot:3"}, {"key": "shot:3"}, {}, {"key": "bad"}], "shot")
    assert [i["key"] for i in out] == ["shot:3", "shot:1", "shot:2", "shot:4"]


def test_shot_plan_clamps_motion_to_garment_risk_and_is_idempotent():
    inputs = {"fact_sheet": [{"path": "x"}]}
    from unittest.mock import patch
    garment = {"risk": {"motion_limit": "minimal"}}
    with patch.object(planning, "_garment", lambda i: garment):
        first = planning.normalize_shot_plan({"items": [
            {"motion": "free", "voiceover": "a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e"},
            {"motion": "gentle"}, {"motion": "minimal", "role": "cta"}]}, inputs, {"duration": 6})
        again = planning.normalize_shot_plan(first, inputs, {"duration": 6})
    assert [s["motion"] for s in first["items"]] == ["minimal", "minimal", "minimal"]
    assert [s["motion_adjusted"] for s in first["items"]] == [True, True, False]
    assert first["items"][0]["duration"] == 6 and first["motion_limit"] == "minimal"
    codes = {w["code"] for w in first["warnings"]}
    assert {"motion_adjusted", "voiceover_too_long"} <= codes
    assert again == first                                              # chuẩn hóa lần 2 không đổi gì


def test_shot_plan_requires_at_least_one_shot():
    with pytest.raises(planning.PlanError):
        planning.normalize_shot_plan({"items": []}, {}, {})


def test_script_lint_flags_testimonial_do_not_say_and_authenticity():
    from unittest.mock import patch
    g = {"logo_present": True, "do_not_say": ["100% cotton"]}
    with patch.object(planning, "_garment", lambda i: g), patch.object(planning, "load_input", lambda i, d: g if d == "fact_sheet" else {"items": [{"key": "shot:1"}, {"key": "shot:2"}]}):
        out = planning.normalize_script({"items": [
            {"shot": "shot:1", "voiceover": "Tôi đã mua và dùng rồi", "on_screen_text": "Hàng chính hãng"},
            {"shot": "shot:7", "voiceover": "áo 100% cotton", "on_screen_text": ""}],
            "hashtags": ["a", "#a", "#b"]}, {}, {})
    codes = [w["code"] for w in out["warnings"]]
    assert codes.count("fake_testimonial") == 1 and "do_not_say" in codes and "authenticity" in codes
    assert "unknown_shot" in codes and "missing_shot" in codes          # shot:7 lạ, shot:2 thiếu
    assert out["hashtags"] == ["#a", "#b"]


# ── executor + engine ─────────────────────────────────────────────────────────
def test_full_plan_runs_and_applies_rules(real_plan):
    svc, prompts = real_plan
    cid = prime(svc)
    svc.set_params(cid, "brief", {"audience": "nữ 18-25", "language": "vi", "price": "199k"})
    approve_look(svc, cid)
    run_and_wait(svc, cid, "script")
    for step in ("fact_sheet", "angle", "shot_plan", "script"):
        assert element_state(svc, cid, step)["state"] == "fresh", step

    shots = load(svc, cid, "shot_plan")
    assert shots["motion_limit"] == "minimal"                          # áo kẻ + logo => rủi ro cao => chuyển động tối thiểu
    assert [s["motion"] for s in shots["items"]] == ["minimal", "minimal", "minimal"]
    assert any(w["code"] == "motion_adjusted" for w in shots["warnings"])

    script = load(svc, cid, "script")
    codes = {w["code"] for w in script["warnings"]}
    assert {"fake_testimonial", "do_not_say", "authenticity", "unknown_shot"} <= codes
    assert script["hashtags"] == ["#thoitrang", "#ootd"]

    shot_prompt = next(p for p in prompts if "fashion video director" in p)
    assert "normally about 4" in shot_prompt and "MAXIMUM SUBJECT MOTION ALLOWED: minimal" in shot_prompt
    assert '"language": "vi"' in shot_prompt and "199k" in shot_prompt


def test_angle_and_hook_defaults_and_choice_flow(real_plan):
    svc, _ = real_plan
    cid = prime(svc)
    run_and_wait(svc, cid, "angle")
    angle = load(svc, cid, "angle")
    assert angle["chosen"] == "angle:1" and len(angle["items"]) == 2

    run_and_wait(svc, cid, "hook")
    hooks = load(svc, cid, "hook")
    assert [h["key"] for h in hooks["items"]] == ["hook:1", "hook:2"]
    assert hooks["items"][1]["seconds"] == 6                           # 9 giây bị kẹp về 6
    assert any(w["code"] == "voiceover_too_long" for w in hooks["warnings"]) is False

    angle["chosen"] = "angle:2"                                        # người dùng chọn góc khác
    svc.edit_artifact(cid, "angle", angle)
    assert element_state(svc, cid, "angle")["state"] == "fresh"
    assert element_state(svc, cid, "hook")["state"] == "stale"         # hook phụ thuộc góc đã chọn
    assert len(svc.list_artifacts(cid, "angle")) == 2


def test_editing_one_shot_keeps_other_shots_fresh_with_real_normalizer(real_plan, env):
    svc, _ = real_plan
    _, calls, executors = env
    cid = prime(svc)
    approve_storyboards(svc, cid)
    run_and_wait(svc, cid, "clip", confirm=True)                        # clip/keyframe dùng executor giả của conftest
    assert all(element_state(svc, cid, "clip", f"shot:{i}")["state"] == "fresh" for i in (1, 2, 3))

    shots = load(svc, cid, "shot_plan")
    shots["items"][1]["panels"] = [{"framing": "closeup", "action": "Cận cảnh chất liệu mềm, thoáng"}]
    shots["items"][1]["motion"] = "free"                               # vượt giới hạn -> bị kẹp lại
    svc.edit_artifact(cid, "shot_plan", shots)
    assert [element_state(svc, cid, "storyboard", f"shot:{i}")["state"] for i in (1, 2, 3)] == ["fresh", "stale", "fresh"]
    assert load(svc, cid, "shot_plan")["items"][1]["motion"] == "minimal"


def test_changing_brief_stales_angle_and_downstream_but_keeps_results(real_plan):
    svc, _ = real_plan
    cid = prime(svc)
    approve_look(svc, cid)
    run_and_wait(svc, cid, "script")
    svc.set_params(cid, "brief", {"price": "299k"})
    assert element_state(svc, cid, "angle")["reasons"] == ["inputs.brief"]
    assert element_state(svc, cid, "script")["state"] == "stale"       # script phụ thuộc brief trực tiếp
    assert len(svc.list_artifacts(cid, "angle")) == 1


def test_preview_planning_prompts_and_missing_garment(real_plan):
    svc, _ = real_plan
    cid = svc.create_campaign("trống")["id"]
    with pytest.raises(Exception, match="Chưa đủ đầu vào"):
        svc.preview_prompt(cid, "angle")
    cid2 = prime(svc)
    run_and_wait(svc, cid2, "fact_sheet")
    p = svc.preview_prompt(cid2, "angle")
    assert "storytelling angles" in p["prompt"] and p["ref_order"] == [] and p["warnings"] == []
    assert p["template"]["template_id"] == "system:angle"


def test_bad_llm_json_is_error_not_retry(env, monkeypatch):
    svc, calls, executors = env
    n = []
    monkeypatch.setattr(llm, "call_llm", lambda p, i=None: (n.append(1), ("không có json", "gemini"))[1])
    executors["fact_sheet"] = lambda ctx: __import__("app.campaign.runner", fromlist=["x"]).ExecResult(
        [__import__("app.campaign.runner", fromlist=["x"]).ArtifactSpec("json", json={"risk": {"motion_limit": "free"}, "pattern": "solid"})])
    executors["angle"] = planning.make_executor(planning.SPECS["angle"])
    cid = prime(svc)
    run_and_wait(svc, cid, "angle")
    run = [r for r in svc.list_runs(cid) if r["step_key"] == "angle"][0]
    assert run["state"] == "error" and "không trả về JSON" in run["error"] and len(n) == 1


# ── GĐ-B: ý đồ shot có cấu trúc + lint ────────────────────────────────────────
def _normalize(items, limit="gentle"):
    from unittest.mock import patch
    with patch.object(planning, "_garment", lambda i: {"risk": {"motion_limit": limit}}):
        return planning.normalize_shot_plan({"items": items}, {}, {})


P = lambda *actions: [{"framing": "medium", "action": a} for a in actions]  # noqa: E731


def test_structured_shot_fields_are_validated_and_detail_never_shows_a_face_or_moves_big():
    out = _normalize([
        {"key": "shot:1", "role": "hook", "board_type": "detail_macro", "framing": "wide", "camera_move": "Push-In", "face_policy": "visible",
         "motion": "free", "panels": P("Close-up of the chest logo", "The camera moves closer to the logo", "The logo fills the frame"), "duration": 8},
        {"key": "shot:2", "role": "cta", "board_type": "weird", "camera_move": "teleport", "face_policy": "??",
         "panels": P("She stands", "She raises her hand", "She smiles"), "duration": 10},
    ], limit="free")
    d, h = out["items"]
    assert (d["board_type"], d["archetype"], d["face_policy"], d["motion"], d["camera_move"], d["duration"]) == ("detail_macro", "detail", "none", "minimal", "push_in", 8)
    assert (h["board_type"], h["archetype"], h["camera_move"], h["face_policy"]) == ("closer_cta", "cta", "static", "visible")   # kiểu sai -> suy từ vai trò
    assert {w["code"] for w in out["warnings"]} == {"camera_static", "expression_missing"}      # chỉ shot 2
    assert {w["where"] for w in out["warnings"]} == {"shot:2"}
    from unittest.mock import patch
    with patch.object(planning, "_garment", lambda i: {"risk": {"motion_limit": "free"}}):
        assert planning.normalize_shot_plan(out, {}, {"total_seconds": 18})["items"] == out["items"]     # chuẩn hóa lần 2 không đổi gì


def test_panel_count_follows_duration_and_mismatches_are_warned():
    assert [planning.panel_count(n) for n in (3, 5, 6, 10, 11, 15)] == [2, 2, 3, 3, 4, 4]
    base = {"role": "hook", "board_type": "hero_walk", "camera_move": "pan", "expression": "smile"}
    codes = lambda **k: {w["code"] for w in _normalize([{"key": "shot:1", **base, **k}])["warnings"]}  # noqa: E731
    assert "panels_few" in codes(duration=12, panels=P("a", "b"))
    assert "panels_many" in codes(duration=4, panels=P("a", "b", "c"))
    assert "panels_missing" in codes(duration=4, panels=[])
    assert "long_shot_cost" in codes(duration=12, panels=P("a", "b", "c", "d"))
    assert not {"panels_few", "panels_many", "panels_missing", "long_shot_cost"} & codes(duration=6, panels=P("a", "b", "c"))


def test_recommended_shot_count_follows_total_seconds_and_user_choice_wins():
    assert [planning.recommended_shots(n) for n in (6, 15, 20, 30, 90)] == [2, 3, 4, 6, 8]
    assert "exactly 4 shots" in planning._shot_rule({"shots": 4, "total_seconds": 30})
    assert "about 6" in planning._shot_rule({"total_seconds": 30})


def test_plan_from_before_v24_gets_panels_from_its_old_frame_fields():
    shot = {"key": "shot:1", "role": "hook", "archetype": "hero", "framing": "wide", "keyframe_start": "She stands by the wall", "end_delta": "She steps forward"}
    out = _normalize([shot])["items"][0]
    assert out["board_type"] == "hero_walk" and [p["action"] for p in out["panels"]] == ["She stands by the wall", "She steps forward"]
    assert [p["action"] for p in planning.shot_panels(shot)] == ["She stands by the wall", "She steps forward"]


def test_detail_shot_with_two_targets_or_a_face_is_warned():
    out = _normalize([{"key": "shot:1", "role": "benefit", "board_type": "detail_macro", "camera_move": "push_in", "duration": 4,
                       "panels": P("Close-up of the chest logo", "The waistband and her smiling face")}])
    codes = {w["code"] for w in out["warnings"]}
    assert {"two_targets", "detail_face"} <= codes


def test_shot_planner_sees_the_approved_look_sheet_and_the_chosen_hook(real_plan, monkeypatch):
    svc, prompts_seen = real_plan
    seen = {}
    real_call = llm.call_llm

    def spy(prompt, image_paths=None):
        if "fashion video director" in prompt:
            seen["images"], seen["prompt"] = list(image_paths or []), prompt
        return real_call(prompt, image_paths)
    monkeypatch.setattr(llm, "call_llm", spy)
    cid = prime(svc)
    approve_look(svc, cid)
    run_and_wait(svc, cid, "shot_plan")
    assert len(seen["images"]) == 1 and seen["images"][0].endswith(".png")        # tờ look sheet đã duyệt
    # hook:1 ("Trước/Sau") hứa hai trạng thái mà ảnh không có -> bị loại khỏi mặc định; hook:2 thể hiện được bằng hình nên được chọn
    assert "CHOSEN HOOK" in seen["prompt"] and "Nhìn này" in seen["prompt"] and "Áo trơn thành nổi bật" not in seen["prompt"]
    hooks = load(svc, cid, "hook")
    assert hooks["chosen"] == "hook:2"
    assert [h["needs_unavailable_visual"] for h in hooks["items"]] == [True, False]
    assert any(w["code"] == "needs_unavailable_visual" and w["where"] == "hook:1" for w in hooks["warnings"])


# ── GĐ-F/G: kịch bản khớp hình, máy quay, biểu cảm, trần chuyển động ───────────
def test_script_claims_that_pictures_cannot_show_are_flagged_with_the_real_campaign_text():
    real = {"key": "shot:1", "role": "hook", "archetype": "hero", "camera_move": "push_in", "expression": "warm half-smile",
            "end_delta": "she steps toward the camera", "subject_action": "steps forward", "keyframe_start": "standing by a wall",
            "on_screen_text": "Từ bình thường -> Siêu cuốn hút!",
            "voiceover": "Đồ ở nhà bình thường thế này... mà khoác nhẹ set trắng đen logo NY lên là lột xác liền!"}
    out = _normalize([real])
    assert any(w["code"] == "script_claims_not_visible" for w in out["warnings"])
    honest = {**real, "on_screen_text": "Set trắng đen tối giản", "voiceover": "Phom rộng thoải mái, logo NY nổi bật."}
    assert not any(w["code"] == "script_claims_not_visible" for w in _normalize([honest])["warnings"])


def test_hook_default_skips_hooks_that_need_an_unavailable_before_state():
    garment = {"risk": {}}
    from unittest.mock import patch
    items = [{"type": "contrast", "voiceover": "Từ đồ ở nhà thành lột xác", "on_screen_text": "", "visual": "plain homewear transitions into the outfit"},
             {"type": "direct", "voiceover": "Nhìn set này nè", "on_screen_text": "", "visual": "model facing camera in the outfit"}]
    with patch.object(planning, "_garment", lambda i: garment):
        out = planning.normalize_hook({"items": items}, {}, {})
        assert out["chosen"] == "hook:2" and [h["needs_unavailable_visual"] for h in out["items"]] == [True, False]
        out2 = planning.normalize_hook({"items": items, "chosen": "hook:1", "chosen_by_user": True}, {}, {})   # người dùng vẫn chọn được
        assert out2["chosen"] == "hook:1"
        allbad = planning.normalize_hook({"items": items[:1]}, {}, {})
        assert allbad["chosen"] == "hook:1"                                                                 # hết lựa chọn thì giữ cái duy nhất, kèm cảnh báo
    assert any(w["code"] == "needs_unavailable_visual" for w in out["warnings"])


def test_static_camera_and_blank_expression_are_warned_and_all_static_plans_are_called_out():
    shots = [{"key": f"shot:{i}", "role": r, "archetype": "hero", "camera_move": "static", "end_delta": "she steps toward the camera",
              "subject_action": "steps", "keyframe_start": "standing"} for i, r in ((1, "hook"), (2, "benefit"), (3, "cta"))]
    out = _normalize(shots)
    codes = [(w["where"], w["code"]) for w in out["warnings"]]
    assert all((f"shot:{i}", "camera_static") in codes and (f"shot:{i}", "expression_missing") in codes for i in (1, 2, 3))
    assert any(w["code"] == "camera_mostly_static" for w in out["warnings"])
    good = [{**s, "camera_move": "push_in", "expression": "confident smile"} for s in shots]
    assert not any(w["code"] in ("camera_static", "expression_missing", "camera_mostly_static") for w in _normalize(good)["warnings"])


def test_user_motion_limit_overrides_the_garment_risk_and_is_recorded_per_shot():
    from unittest.mock import patch
    with patch.object(planning, "_garment", lambda i: {"risk": {"motion_limit": "gentle"}}):
        free = planning.normalize_shot_plan({"items": [{"motion": "free", "role": "hook"}]}, {}, {"motion_limit": "free"})
        default = planning.normalize_shot_plan({"items": [{"motion": "free", "role": "hook"}]}, {}, {})
    assert (free["items"][0]["motion"], free["items"][0]["motion_cap"], free["motion_limit"]) == ("free", "free", "free")
    assert (default["items"][0]["motion"], default["items"][0]["motion_cap"]) == ("gentle", "gentle")
    from app.campaign.executors import clip
    assert clip.effective_motion({"motion": "free", "motion_cap": "free"}, {"risk": {"motion_limit": "gentle"}}) == "free"   # trần của shot thắng áo
    assert clip.effective_motion({"motion": "free"}, {"risk": {"motion_limit": "gentle"}}) == "gentle"                      # kế hoạch cũ: theo áo
