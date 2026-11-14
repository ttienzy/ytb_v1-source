"""Executor cast_sheet (khối 2) với client ảnh giả: thứ tự ảnh tham chiếu, cách gọi nhân vật, cảnh báo mặt thật, từ chối kèm ghi chú."""
from pathlib import Path

import pytest

from app.campaign.executors import cast_sheet, common

from .conftest import element_state, prime, run_and_wait


class FakeImageClient:
    def __init__(self):
        self.calls = []

    def generate(self, prompt, dest, ref_paths=None, aspect="9:16", **kw):
        self.calls.append({"prompt": prompt, "refs": [Path(p).read_bytes() for p in (ref_paths or [])], "aspect": aspect})
        Path(dest).write_bytes(b"\x89PNG\r\n\x1a\n" + str(len(self.calls)).encode())
        return dest


@pytest.fixture
def real_sheet(env, monkeypatch):
    svc, calls, executors = env
    client = FakeImageClient()
    monkeypatch.setattr(common, "image_client", lambda: client)
    executors["cast_sheet"] = cast_sheet.run_cast_sheet
    return svc, client


def test_cast_sheet_sends_identity_then_outfit_on_a_plain_background(real_sheet):
    svc, client = real_sheet
    cid = prime(svc)
    run_and_wait(svc, cid, "cast_sheet")
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["refs"] == [b"person-bytes", b"shirt-bytes-1"] and call["aspect"] == "16:9"
    assert "Image 1 = identity reference" in call["prompt"] and "of the woman shown" in call["prompt"]
    assert "plain light-grey seamless studio background" in call["prompt"] and "3 x 2 grid" in call["prompt"]
    assert "her" not in call["prompt"].split()                                   # không gắn cứng giới tính trong thân prompt
    st = element_state(svc, cid, "cast_sheet")
    assert st["state"] == "fresh" and st["gate"] == "need_approval"


def test_preview_matches_what_is_sent_and_warns_about_real_faces(real_sheet):
    svc, client = real_sheet
    cid = prime(svc)
    p = svc.preview_prompt(cid, "cast_sheet")
    assert [r["role"] for r in p["ref_order"]] == ["identity", "outfit"] and p["count"] == 1
    assert any(w["code"] == "extra_garment_photos" for w in p["warnings"])
    assert not any(w["code"] == "real_face" for w in p["warnings"])
    svc.set_params(cid, "cast_profile", {"real_face": "yes", "presentation": "man"})
    p = svc.preview_prompt(cid, "cast_sheet")
    assert any(w["code"] == "real_face" for w in p["warnings"]) and "of the man shown" in p["prompt"]
    run_and_wait(svc, cid, "cast_sheet")
    assert client.calls[0]["prompt"] == p["prompt"]


def test_classic_layout_is_selectable_as_a_template(real_sheet):
    svc, client = real_sheet
    cid = prime(svc)
    svc.set_params(cid, "cast_sheet", {"prompt": {"template_id": "system:cast_sheet_classic"}})
    p = svc.preview_prompt(cid, "cast_sheet")
    assert "headless neck-down turnaround" in p["prompt"] and "plain light-grey" in p["prompt"]


def test_count_makes_several_candidates_and_user_picks_one(real_sheet):
    svc, client = real_sheet
    cid = prime(svc)
    svc.set_params(cid, "cast_sheet", {"count": 3})
    run_and_wait(svc, cid, "cast_sheet")
    assert len(client.calls) == 3
    arts = [a for a in svc.list_artifacts(cid, "cast_sheet") if a["kind"] == "image"]
    assert len(arts) == 3 and {a["meta"]["candidate"] for a in arts} == {1, 2, 3}


def test_rejection_note_goes_into_next_prompt(real_sheet):
    svc, client = real_sheet
    cid = prime(svc)
    run_and_wait(svc, cid, "cast_sheet")
    svc.decide_gate(cid, "cast_sheet", "rejected", note="logo quá to")
    svc.reroll(cid, "cast_sheet")
    run_and_wait(svc, cid, "cast_sheet")
    assert "reviewer feedback: logo quá to" in client.calls[-1]["prompt"]


def test_partial_failure_keeps_images_made(env, monkeypatch):
    svc, calls, executors = env

    class Flaky(FakeImageClient):
        def generate(self, prompt, dest, ref_paths=None, aspect="9:16", **kw):
            if len(self.calls) == 1:
                self.calls.append(None)
                raise RuntimeError("hết hạn mức")
            return super().generate(prompt, dest, ref_paths, aspect)
    flaky = Flaky()
    monkeypatch.setattr(common, "image_client", lambda: flaky)
    executors["cast_sheet"] = cast_sheet.run_cast_sheet
    cid = prime(svc)
    svc.set_params(cid, "cast_sheet", {"count": 3})
    run_and_wait(svc, cid, "cast_sheet")
    arts = [a for a in svc.list_artifacts(cid, "cast_sheet") if a["kind"] == "image"]
    assert len(arts) == 1 and "Chỉ tạo được 1/3" in arts[0]["meta"]["warning"]


def test_total_failure_is_recorded_without_retry(env, monkeypatch):
    svc, calls, executors = env

    class Dead(FakeImageClient):
        def generate(self, *a, **kw):
            raise RuntimeError("tài khoản lỗi")
    monkeypatch.setattr(common, "image_client", lambda: Dead())
    executors["cast_sheet"] = cast_sheet.run_cast_sheet
    cid = prime(svc)
    run_and_wait(svc, cid, "cast_sheet")
    run = [r for r in svc.list_runs(cid) if r["step_key"] == "cast_sheet"]
    assert len(run) == 1 and run[0]["state"] == "error" and "tài khoản lỗi" in run[0]["error"]


def test_preview_without_inputs_explains_what_is_missing(svc):
    cid = svc.create_campaign("trống")["id"]
    with pytest.raises(Exception, match="Chưa đủ đầu vào"):
        svc.preview_prompt(cid, "cast_sheet")
