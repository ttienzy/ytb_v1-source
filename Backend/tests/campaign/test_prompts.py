import pytest

from app.campaign.prompts import PromptError, render_body

from .conftest import element_state, prime, run_and_wait


def lib(svc):
    return svc.prompts


def test_system_cast_sheet_default_renders_with_roles(svc):
    out = lib(svc).render("system:cast_sheet", variables={"presentation": "woman", "garment": {"summary": "white tee"}, "logo_rule": ""},
                          ref_paths=["a.jpg", "b.png"])
    p = out["prompt"]
    assert p.startswith("@Create image REFERENCE ROLES:")
    assert "Image 1 = identity reference" in p and "Image 2 = outfit reference" in p and "3 x 2 grid" in p
    assert "OPTIONAL CHANGES" not in p and "LOGO RULE" not in p
    assert [r["role"] for r in out["ref_order"]] == ["identity", "outfit"]
    assert out["warnings"] == [] and out["template"]["read_only"] is True


def test_look_sheet_still_exists_for_motion_control(svc):
    out = lib(svc).render("system:look_sheet", ref_paths=["a.jpg", "b.png"])
    assert "headless neck-down turnaround" in out["prompt"]


def test_optional_changes_slot(svc):
    out = lib(svc).render("system:cast_sheet", variables={"presentation": "person"}, changes="change hairstyle to short black layered hair")
    assert "[OPTIONAL CHANGES]: change hairstyle to short black layered hair" in out["prompt"]


def test_variables_sections_and_missing():
    text, missing = render_body("A {{garment.summary}} / {{x}}\n{{#note}}NOTE {{note}}{{/note}}\n",
                                {"garment": {"summary": "áo thun"}, "note": ""})
    assert "A áo thun /" in text and "NOTE" not in text
    assert missing == ["x"]


def test_lint_warnings(svc):
    out = lib(svc).render("system:cast_sheet", ref_paths=["only-one.png"])
    assert any(w["code"] == "ref_count_mismatch" for w in out["warnings"])
    out = lib(svc).render("system:cast_sheet", ref_paths=["a", "b", "c", "d"])
    assert any(w["code"] == "too_many_refs" for w in out["warnings"])
    t = lib(svc).create(kind="clip", name="x", body="Người mẫu nói: tôi đã mua và dùng áo này 3 tháng")
    out = lib(svc).render(t.template_id)
    assert any(w["code"] == "fake_testimonial" for w in out["warnings"])


def test_user_templates_are_versioned_and_system_is_read_only(svc):
    mine = lib(svc).create(kind="cast_sheet", name="Của tôi", base_id="system:cast_sheet")
    assert mine.version == 1 and mine.owner == "user" and mine.body_hash == lib(svc).get("system:cast_sheet").body_hash
    v2 = lib(svc).update(mine.template_id, body="Phiên bản mới {{changes}}")
    assert v2.version == 2 and [t.version for t in lib(svc).versions(mine.template_id)] == [2, 1]
    assert lib(svc).get(mine.template_id, 1).body == mine.body
    with pytest.raises(PromptError):
        lib(svc).update("system:cast_sheet", body="x")
    with pytest.raises(PromptError):
        lib(svc).delete("system:cast_sheet")
    lib(svc).delete(mine.template_id)
    assert lib(svc).get(mine.template_id) is None


def test_editing_prompt_marks_step_stale_without_deleting(svc, calls):
    cid = prime(svc)
    run_and_wait(svc, cid, "cast_sheet")
    first = element_state(svc, cid, "cast_sheet")["selected_artifact_id"]
    mine = lib(svc).create(kind="cast_sheet", name="Của tôi", base_id="system:cast_sheet")
    svc.set_params(cid, "cast_sheet", {"prompt": {"template_id": mine.template_id}})
    assert element_state(svc, cid, "cast_sheet")["reasons"] == ["prompt"]      # đổi mẫu (dù cùng nội dung) là đổi đầu vào, bản cũ vẫn giữ
    lib(svc).update(mine.template_id, body="khác hẳn {{changes}}")
    st = element_state(svc, cid, "cast_sheet")
    assert st["state"] == "stale" and st["reasons"] == ["prompt"] and st["selected_artifact_id"] == first
    svc.set_params(cid, "cast_sheet", {"prompt": {"template_id": mine.template_id, "changes": "short hair"}})
    assert element_state(svc, cid, "cast_sheet")["reasons"] == ["prompt"]


def test_missing_template_blocks_instead_of_running(svc):
    cid = prime(svc)
    svc.set_params(cid, "cast_sheet", {"prompt": {"template_id": "user:khongco"}})
    st = element_state(svc, cid, "cast_sheet")
    assert st["state"] == "blocked" and st["blockers"][0]["dep"] == "prompt"


def test_retired_template_ids_resolve_to_v3(svc):
    assert lib(svc).get("system:clip_ingredients").template_id == "system:clip_v3"
    assert lib(svc).get("system:shot_plan").template_id == "system:script_v3"
    assert lib(svc).get("system:storyboard") is None
