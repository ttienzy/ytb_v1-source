import pytest

from app.campaign.prompts import PromptError, render_body

from .conftest import element_state, prime, run_and_wait


def lib(svc):
    return svc.prompts


def test_system_look_sheet_default_is_user_prompt_verbatim(svc):
    out = lib(svc).render("system:look_sheet", ref_paths=["a.jpg", "b.png"])
    p = out["prompt"]
    assert p.startswith("@Create image REFERENCE ROLES:")
    assert "Image 1 = identity reference" in p and "Image 2 = outfit reference" in p
    assert "headless neck-down turnaround" in p
    assert "OPTIONAL CHANGES" not in p            # ô trống thì không xuất hiện
    assert [r["role"] for r in out["ref_order"]] == ["identity", "outfit"]
    assert out["warnings"] == []
    assert out["template"]["read_only"] is True


def test_optional_changes_slot(svc):
    out = lib(svc).render("system:look_sheet", changes="change hairstyle to short black layered hair")
    assert "[OPTIONAL CHANGES]: change hairstyle to short black layered hair" in out["prompt"]


def test_variables_sections_and_missing():
    text, missing = render_body("A {{garment.summary}} / {{x}}\n{{#note}}NOTE {{note}}{{/note}}\n",
                                {"garment": {"summary": "áo thun"}, "note": ""})
    assert "A áo thun /" in text and "NOTE" not in text
    assert missing == ["x"]


def test_lint_warnings(svc):
    out = lib(svc).render("system:look_sheet", ref_paths=["only-one.png"])
    assert any(w["code"] == "ref_count_mismatch" for w in out["warnings"])
    out = lib(svc).render("system:look_sheet", ref_paths=["a", "b", "c", "d"])
    assert any(w["code"] == "too_many_refs" for w in out["warnings"])
    t = lib(svc).create(kind="clip_video", name="x", body="Người mẫu nói: tôi đã mua và dùng áo này 3 tháng")
    out = lib(svc).render(t.template_id)
    assert any(w["code"] == "fake_testimonial" for w in out["warnings"])


def test_user_templates_are_versioned_and_system_is_read_only(svc):
    t = lib(svc).create(kind="look_sheet", name="Của tôi", base_id="system:look_sheet")
    assert t.version == 1 and t.body == lib(svc).get("system:look_sheet").body and len(t.ref_slots) == 2
    t2 = lib(svc).update(t.template_id, body="Bản 2 {{changes}}")
    assert t2.version == 2
    assert lib(svc).get(t.template_id, 1).body != lib(svc).get(t.template_id, 2).body
    assert [v.version for v in lib(svc).versions(t.template_id)] == [2, 1]
    with pytest.raises(PromptError):
        lib(svc).update("system:look_sheet", body="hack")
    with pytest.raises(PromptError):
        lib(svc).delete("system:look_sheet")
    lib(svc).delete(t.template_id)
    assert lib(svc).get(t.template_id) is None
    assert all(x.template_id != t.template_id for x in lib(svc).list_templates())


def test_editing_prompt_marks_step_stale_without_deleting(svc, calls):
    cid = prime(svc)
    t = lib(svc).create(kind="look_sheet", name="Mine", base_id="system:look_sheet")
    svc.set_params(cid, "look", {"prompt": {"template_id": t.template_id}})
    run_and_wait(svc, cid, "look")
    before = element_state(svc, cid, "look")
    assert before["state"] == "fresh" and before["selected_artifact_id"]

    lib(svc).update(t.template_id, body=lib(svc).get(t.template_id).body + "\nNo extra clothing.")
    after = element_state(svc, cid, "look")
    assert after["state"] == "stale" and "prompt" in after["reasons"]
    assert after["selected_artifact_id"] == before["selected_artifact_id"]      # bản cũ vẫn còn

    # ô "thay đổi tùy chọn" cũng là một phần của vân tay
    svc.set_params(cid, "look", {"prompt": {"template_id": t.template_id, "version": 2, "changes": "short hair"}})
    assert element_state(svc, cid, "look")["state"] == "stale"


def test_missing_template_blocks_instead_of_running(svc):
    cid = prime(svc)
    svc.set_params(cid, "look", {"prompt": {"template_id": "user:khong-ton-tai"}})
    st = element_state(svc, cid, "look")
    assert st["state"] == "blocked" and st["blockers"][0]["dep"] == "prompt"
