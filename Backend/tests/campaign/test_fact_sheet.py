"""Hồ sơ áo (Gemini giả), luật rủi ro, sửa tay, thư viện nhân vật."""
import json
from pathlib import Path

import pytest

from app.campaign.executors import fact_sheet

from .conftest import element_state, prime, run_and_wait

GEMINI_REPLY = """```json
{
  "category": "oversized t-shirt", "color": "off-white", "material": "cotton jersey", "fit": "oversized",
  "length": "hip-length", "neckline": "crew neck", "sleeves": "short sleeve with folded cuff", "pattern": "solid",
  "logo_present": true, "logo_text": "Haim + smiley + #savofandi (chest center)",
  "details": ["woven neck label", "folded sleeve cuffs"], "sizes": "unknown",
  "summary": "Off-white oversized cotton t-shirt with a navy 'Haim' logo.", "summary_vi": "Áo thun trắng ngà form rộng in chữ Haim.",
  "do_not_say": ["100% cotton"]
}
```"""


@pytest.fixture
def real_fact(env, monkeypatch):
    svc, calls, executors = env
    executors["fact_sheet"] = fact_sheet.run_fact_sheet
    sent = []

    def fake(prompt, paths):
        sent.append((prompt, list(paths)))
        return GEMINI_REPLY, "gemini"
    monkeypatch.setattr(fact_sheet, "_gemini", fake)
    return svc, sent


def test_extract_json_variants():
    assert fact_sheet.extract_json('{"a": 1}') == {"a": 1}
    assert fact_sheet.extract_json("Đây là kết quả:\n```json\n{\"a\": 2}\n```\nHết") == {"a": 2}
    with pytest.raises(fact_sheet.FactSheetError, match="không trả về JSON"):
        fact_sheet.extract_json("Xin lỗi, tôi không thể giúp")
    with pytest.raises(fact_sheet.FactSheetError, match="không hợp lệ"):
        fact_sheet.extract_json("{broken json,}")


def test_normalize_fills_defaults_and_auto_do_not_say():
    g = fact_sheet.normalize({"category": " tee ", "pattern": "Small Print", "logo_present": "true", "do_not_say": "100% cotton"})
    assert g["category"] == "tee" and g["pattern"] == "small_print" and g["logo_present"] is True
    assert g["logo_text"] == "unknown" and g["details"] == [] and g["color"] == ""
    assert "100% cotton" in g["do_not_say"]
    assert any("chính hãng" in x for x in g["do_not_say"])
    assert fact_sheet.normalize({"pattern": "weird"})["pattern"] == "other"


@pytest.mark.parametrize("fields,level,motion,logo_rule", [
    ({"pattern": "solid"}, "low", "free", "none"),
    ({"pattern": "stripes"}, "medium", "gentle", "none"),
    ({"pattern": "lace"}, "high", "minimal", "none"),
    ({"pattern": "solid", "logo_present": True}, "medium", "gentle", "reference_only"),
    ({"pattern": "small_print", "logo_present": True}, "high", "minimal", "reference_only"),
])
def test_risk_rules(fields, level, motion, logo_rule):
    risk = fact_sheet.normalize(fields)["risk"]
    assert (risk["level"], risk["motion_limit"], risk["logo_rule"]) == (level, motion, logo_rule)
    assert (risk["reasons"] == []) == (level == "low")


def test_run_fact_sheet_sends_all_garment_photos_and_stores_profile(real_fact):
    svc, sent = real_fact
    cid = prime(svc)
    svc.set_params(cid, "fact_sheet", {"prompt": {"template_id": "system:fact_sheet", "changes": "Chú ý tay áo gập"}})
    run_and_wait(svc, cid, "fact_sheet")

    prompt, paths = sent[0]
    assert "meticulous fashion product inspector" in prompt and "Extra instructions from the user: Chú ý tay áo gập" in prompt
    assert [Path(p).read_bytes() for p in paths] == [b"shirt-bytes-1", b"shirt-bytes-2"]   # cả 2 ảnh, đúng thứ tự
    st = element_state(svc, cid, "fact_sheet")
    assert st["state"] == "fresh"
    art = svc.list_artifacts(cid, "fact_sheet")[0]
    data = json.loads(svc.artifact_file(art["id"])[0].read_text(encoding="utf-8"))
    assert data["category"] == "oversized t-shirt" and data["risk"]["level"] == "medium"
    assert art["meta"]["provider"] == "gemini" and art["meta"]["prompt"] == prompt


def test_preview_lists_photos_with_roles(real_fact):
    svc, sent = real_fact
    cid = prime(svc)
    p = svc.preview_prompt(cid, "fact_sheet")
    assert [r["role"] for r in p["ref_order"]] == ["front", "back"] and p["template"]["template_id"] == "system:fact_sheet"
    assert p["warnings"] == []


def test_bad_gemini_reply_is_a_clear_error_without_retry(env, monkeypatch):
    svc, calls, executors = env
    executors["fact_sheet"] = fact_sheet.run_fact_sheet
    n = []
    monkeypatch.setattr(fact_sheet, "_gemini", lambda p, i: (n.append(1), ("Xin lỗi, không thể", "gemini"))[1])
    cid = prime(svc)
    run_and_wait(svc, cid, "fact_sheet")
    run = [r for r in svc.list_runs(cid) if r["step_key"] == "fact_sheet"][0]
    assert run["state"] == "error" and "không trả về JSON" in run["error"] and len(n) == 1
    assert element_state(svc, cid, "fact_sheet")["state"] == "missing"


def test_manual_edit_recomputes_risk_and_keeps_original(real_fact):
    svc, _ = real_fact
    cid = prime(svc)
    run_and_wait(svc, cid, "fact_sheet")
    original = svc.list_artifacts(cid, "fact_sheet")[0]
    data = json.loads(svc.artifact_file(original["id"])[0].read_text(encoding="utf-8"))
    data["pattern"] = "lace"
    data["color"] = "trắng kem"
    edited = svc.edit_artifact(cid, "fact_sheet", data)
    new = json.loads(svc.artifact_file(edited["id"])[0].read_text(encoding="utf-8"))
    assert new["risk"]["level"] == "high" and new["color"] == "trắng kem"       # rủi ro tính lại từ hồ sơ đã sửa
    assert edited["meta"]["manual"] is True and len(svc.list_artifacts(cid, "fact_sheet")) == 2
    assert element_state(svc, cid, "fact_sheet")["state"] == "fresh"
    with pytest.raises(Exception):
        svc.edit_artifact(cid, "fact_sheet", ["không phải dict"])


def test_changing_garment_photos_makes_fact_sheet_stale_but_keeps_it(real_fact):
    svc, _ = real_fact
    cid = prime(svc)
    run_and_wait(svc, cid, "fact_sheet")
    img = svc.upload_image(cid, "new.png", b"new-shirt")
    svc.set_input_files(cid, "garment_source", [{"artifact_id": img["id"], "role": "front"}])
    st = element_state(svc, cid, "fact_sheet")
    assert st["state"] == "stale" and st["reasons"] == ["inputs.garment_source"] and st["selected_artifact_id"]


def test_style_no_longer_stales_the_look_step(real_fact, env):
    svc, calls, executors = env
    cid = prime(svc)
    run_and_wait(svc, cid, "look")
    svc.set_params(cid, "style", {"lighting": "hard"})
    assert element_state(svc, cid, "look")["state"] == "fresh"


# ── thư viện nhân vật ────────────────────────────────────────────────────────
def test_cast_library_roundtrip_between_campaigns(svc):
    a = prime(svc, "A")
    person = svc.list_artifacts(a, "cast")[0]["meta"]["members"][0]["artifact_id"]
    item = svc.cast_library_add(a, person, "Linh")
    assert svc.cast_library_list()[0]["name"] == "Linh"
    assert svc.cast_library_file(item["id"])[0].read_bytes() == b"person-bytes"

    b = svc.create_campaign("B")["id"]
    bundle = svc.cast_library_use(b, item["id"])
    assert bundle["kind"] == "bundle" and element_state(svc, b, "cast")["state"] == "fresh"
    member = bundle["meta"]["members"][0]
    assert member["role"] == "identity"
    assert svc.artifact_file(member["artifact_id"])[0].read_bytes() == b"person-bytes"

    svc.cast_library_delete(item["id"])
    assert svc.cast_library_list() == []
    assert element_state(svc, b, "cast")["state"] == "fresh"                       # chiến dịch B không bị ảnh hưởng


def test_cast_library_validation(svc):
    cid = prime(svc)
    shirt = svc.list_artifacts(cid, "garment_source")[0]["meta"]["members"][0]["artifact_id"]
    with pytest.raises(Exception):
        svc.cast_library_add(cid, shirt, "  ")
    with pytest.raises(Exception):
        svc.cast_library_add(cid, "khong-co", "X")
    with pytest.raises(LookupError):
        svc.cast_library_use(cid, "khong-co")
