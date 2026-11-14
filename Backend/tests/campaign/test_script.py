"""Khối 3 (Kịch bản v3): khung theo format, chuẩn hóa, luật âm tiết/giây, sửa JSON và thử lại, sửa tay từng shot."""
import json

import pytest

from app.campaign import formats
from app.campaign.executors import common, llm, script

from .conftest import SCENES, approve_cast_sheet, element_state, prime, run_and_wait

GARMENT = {"summary": "Striped tee", "logo_present": True, "do_not_say": ["100% cotton"], "risk": {"motion_limit": "gentle"}}
INPUTS = {"fact_sheet": [{"item": GARMENT}], "format": [{"params": {"format_id": "fit_check"}}],
          "scene_set": [{"params": {"items": SCENES}}], "brief": [{"params": {"language": "vi"}}]}


def llm_reply(items=None, **over):
    data = {"angle_vi": "Outfit tối giản", "hook": {"type": "direct", "on_screen_text": "Hôm nay mặc gì?"},
            "items": items if items is not None else [
                {"key": "shot:1", "beats": ["She turns to camera", "She tugs the hem straight"], "expression": "warm half-smile", "voiceover": "Hôm nay mặc gì cho gọn?", "on_screen_text": "Mặc gì hôm nay"},
                {"key": "shot:2", "beats": ["a", "b", "c"], "expression": "calm", "voiceover": "Form rộng dễ mặc", "on_screen_text": "Form rộng"},
                {"key": "shot:3", "beats": ["hands touch the logo", "the camera tilts down"], "expression": "", "voiceover": "Logo thêu nổi", "on_screen_text": "Logo thêu"},
                {"key": "shot:4", "beats": ["final pose", "small smile"], "expression": "confident smile", "voiceover": "Mua ngay hôm nay", "on_screen_text": "Mua ngay"}],
            "caption": "Set đồ đi chơi", "hashtags": ["ootd", "#ootd", "#streetstyle"], "cta": "Mua ngay"}
    data.update(over)
    return json.dumps(data, ensure_ascii=False)


# ── luật thuần ────────────────────────────────────────────────────────────────
def test_syllable_rule_is_measured_vietnamese_not_three_words_per_second():
    assert common.syllables("Đồ tối giản nhưng thần thái street style không lẫn vào đâu được.") == 13
    assert common.max_syllables(4) == 17 and common.max_syllables(6) == 26        # 3,7 âm tiết/giây + 15 %
    assert script.beats_for(4) == 2 and script.beats_for(8) == 3 and script.beats_for(12) == 4


def test_skeleton_follows_the_format_and_caps_motion_by_garment_risk():
    fmt = formats.get_format("hero_piece")
    skel = script.skeleton(fmt, [{"key": "scene:1"}, {"key": "scene:2"}], {"risk": {"motion_limit": "minimal"}})
    assert [s["key"] for s in skel] == ["shot:1", "shot:2", "shot:3", "shot:4"]
    assert [s["scene"] for s in skel] == ["scene:1", "scene:2", "scene:1", "scene:1"]       # cảnh 3 không có -> cảnh 1
    assert all(s["motion"] == "minimal" for s in skel)
    assert skel[0]["camera"] == {"angle": "eye-level", "lens": "35mm", "move": "handheld tracking"}
    assert script.shot_lines(skel, SCENES).count("EXACTLY") == 4


def test_normalize_fills_the_skeleton_and_lints():
    out = script.normalize_script(json.loads(llm_reply()), INPUTS, {})
    assert out["format_id"] == "fit_check" and out["total_seconds"] == 18 and out["motion_limit"] == "gentle"
    s1, s3 = out["items"][0], out["items"][2]
    assert s1["scene"] == "scene:1" and s1["duration"] == 4 and s1["beats"] == ["She turns to camera", "She tugs the hem straight"]
    assert s1["max_syllables"] == 17 and s1["needs_face"] is True and s1["garment_ref"] == "front"
    assert s3["needs_face"] is False and s3["expression"] == "" and s3["garment_ref"] == "detail" and s3["motion"] == "minimal"
    assert out["hook"] == {"type": "direct", "on_screen_text": "Hôm nay mặc gì?"}
    assert out["hashtags"] == ["#ootd", "#streetstyle"]
    assert out["warnings"] == []


def test_normalize_truncates_extra_beats_and_warns_on_long_voiceover_and_bad_claims():
    reply = json.loads(llm_reply())
    reply["items"][0]["beats"] = ["a", "b", "c", "d"]
    reply["items"][0]["voiceover"] = " ".join(["từ"] * 30)
    reply["items"][1]["voiceover"] = "Áo 100% cotton, mình đã mua và dùng 3 tháng, hàng chính hãng"
    reply["items"][3]["beats"] = []
    reply["hook"] = {"type": "transformation", "on_screen_text": "Lột xác"}
    out = script.normalize_script(reply, INPUTS, {})
    assert out["items"][0]["beats"] == ["a", "b"]
    codes = {w["code"] for w in out["warnings"]}
    assert {"voiceover_too_long", "do_not_say", "fake_testimonial", "authenticity", "beats_missing"} <= codes
    assert out["hook"]["type"] == "direct"                                     # kiểu lạ -> kiểu đầu của format


def test_llm_json_repair_and_one_retry(monkeypatch):
    replies = iter(['{"a": 1,}', '```json\n{"a": [1, 2,], "b": "x"\n```', 'not json', 'still not', '{"ok": true}'])
    monkeypatch.setattr(llm, "call_llm", lambda prompt, image_paths=None: (next(replies), "gemini"))
    assert llm.extract_json('{"a": 1,}') == {"a": 1}
    assert llm.call_llm_json("p")[0] == {"a": 1}
    assert llm.call_llm_json("p")[0] == {"a": [1, 2], "b": "x"}
    with pytest.raises(llm.LlmJsonError):
        llm.call_llm_json("p", retries=1)                                       # 'not json' + 'still not'
    assert llm.call_llm_json("p")[0] == {"ok": True}


# ── executor thật với LLM giả ─────────────────────────────────────────────────
@pytest.fixture
def real_script(env, monkeypatch):
    svc, calls, executors = env
    seen = []

    def fake(prompt, image_paths=None):
        seen.append((prompt, list(image_paths or [])))
        return llm_reply(), "gemini"
    monkeypatch.setattr(llm, "call_llm", fake)
    executors["script"] = script.run_script
    executors["fact_sheet"] = lambda ctx: __import__("app.campaign.runner", fromlist=["ExecResult"]).ExecResult(
        [__import__("app.campaign.runner", fromlist=["ArtifactSpec"]).ArtifactSpec("json", json=GARMENT)])
    return svc, seen


def load(svc, cid, step):
    art = svc.list_artifacts(cid, step)[0]
    return json.loads(svc.artifact_file(art["id"])[0].read_text(encoding="utf-8"))


def test_script_executor_sees_the_cast_sheet_and_the_fixed_shot_list(real_script):
    svc, seen = real_script
    cid = prime(svc)
    approve_cast_sheet(svc, cid)
    run_and_wait(svc, cid, "script")
    prompt, images = seen[-1]
    assert len(images) == 1 and images[0].endswith(".png")                       # cast sheet đã duyệt
    assert "Fit check / OOTD" in prompt and "- shot:1 | role: hook | scene: scene:1 (Phố) | 4 s | EXACTLY 2 beats" in prompt
    assert "voiceover max 17 syllables" in prompt and "direct, pain_question, number_signal" in prompt
    doc = load(svc, cid, "script")
    assert [s["key"] for s in doc["items"]] == ["shot:1", "shot:2", "shot:3", "shot:4"] and doc["warnings"] == []
    assert element_state(svc, cid, "script")["state"] == "fresh"
    preview = svc.preview_prompt(cid, "script")
    assert preview["prompt"] == prompt and preview["format_id"] == "fit_check"


def test_user_edit_keeps_their_fields_and_renormalizes(real_script):
    svc, _ = real_script
    cid = prime(svc)
    approve_cast_sheet(svc, cid)
    run_and_wait(svc, cid, "script")
    doc = load(svc, cid, "script")
    doc["items"][1]["duration"] = 8
    doc["items"][1]["camera"]["move"] = "static"
    doc["items"][1]["motion"] = "free"                                          # vượt trần gentle -> bị kẹp
    doc["items"][1]["beats"] = ["x"]
    svc.edit_artifact(cid, "script", doc)
    edited = load(svc, cid, "script")
    s2 = edited["items"][1]
    assert s2["duration"] == 8 and s2["camera"]["move"] == "static" and s2["motion"] == "gentle" and s2["beats"] == ["x"]
    assert any(w["code"] == "beats_few" and w["where"] == "shot:2" for w in edited["warnings"])
    assert edited["items"][0]["beats"] == ["She turns to camera", "She tugs the hem straight"]        # shot khác giữ nguyên


def test_bad_llm_json_is_retried_once_then_fails_clearly(env, monkeypatch):
    svc, calls, executors = env
    replies = iter(["{broken", "{still broken"])
    monkeypatch.setattr(llm, "call_llm", lambda prompt, image_paths=None: (next(replies), "gemini"))
    executors["script"] = script.run_script
    from app.campaign.runner import ArtifactSpec, ExecResult
    executors["fact_sheet"] = lambda ctx: ExecResult([ArtifactSpec("json", json=GARMENT)])
    cid = prime(svc)
    approve_cast_sheet(svc, cid)
    run_and_wait(svc, cid, "script")
    run = [r for r in svc.list_runs(cid) if r["step_key"] == "script"][0]
    assert run["state"] == "error" and "JSON" in run["error"]
    assert len([r for r in svc.list_runs(cid) if r["step_key"] == "script"]) == 1
