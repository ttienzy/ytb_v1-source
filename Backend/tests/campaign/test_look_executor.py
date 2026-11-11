"""Executor `look` với client ảnh giả (không gọi ChatGPT thật)."""
import pytest

from app.campaign.executors import look

from .conftest import element_state, prime, run_and_wait

PNG = b"\x89PNG\r\n\x1a\n" + b"fake-image-data"


class FakeClient:
    def __init__(self, fail_after: int | None = None):
        self.calls: list[dict] = []
        self.fail_after = fail_after

    def generate(self, prompt, dest, ref_paths=None, ref_labels=None, timeout=300, aspect="9:16"):
        if self.fail_after is not None and len(self.calls) >= self.fail_after:
            raise RuntimeError("Đụng giới hạn tài khoản")
        self.calls.append({"prompt": prompt, "refs": list(ref_paths or []), "aspect": aspect})
        with open(dest, "wb") as f:
            f.write(PNG + str(len(self.calls)).encode())
        return dest


@pytest.fixture
def real_look(env, monkeypatch):
    svc, calls, executors = env
    executors["look"] = look.run_look
    fake = FakeClient()
    monkeypatch.setattr(look, "_client", lambda: fake)
    return svc, fake


def test_look_sends_identity_then_outfit_with_user_prompt(real_look):
    svc, fake = real_look
    cid = prime(svc)
    svc.set_params(cid, "look", {"prompt": {"template_id": "system:look_sheet", "changes": "short black hair"}})
    run_and_wait(svc, cid, "look")

    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["aspect"] == "16:9"
    assert "Image 1 = identity reference" in call["prompt"]
    assert "[OPTIONAL CHANGES]: short black hair" in call["prompt"]
    # thứ tự: Image 1 = nhân vật, Image 2 = áo (ưu tiên ảnh role "front")
    from pathlib import Path
    assert [Path(p).read_bytes() for p in call["refs"]] == [b"person-bytes", b"shirt-bytes-1"]
    st = element_state(svc, cid, "look")
    assert st["state"] == "fresh" and st["gate"] == "need_approval"
    art = svc.list_artifacts(cid, "look")[0]
    assert art["kind"] == "image" and art["meta"]["prompt"] == call["prompt"]
    assert art["meta"]["template"]["template_id"] == "system:look_sheet"


def test_preview_matches_what_is_sent(real_look):
    svc, fake = real_look
    cid = prime(svc)
    preview = svc.preview_prompt(cid, "look")
    assert [s["role"] for s in preview["ref_order"]] == ["identity", "outfit"]
    ids = {a["id"]: a for a in svc.list_artifacts(cid)}
    assert ids[preview["ref_order"][0]["artifact_id"]]["meta"]["filename"] == "person.jpg"
    assert ids[preview["ref_order"][1]["artifact_id"]]["meta"]["filename"] == "shirt.png"   # role front
    assert any(w["code"] == "extra_garment_photos" for w in preview["warnings"])            # có thêm ảnh mặt sau

    run_and_wait(svc, cid, "look")
    assert fake.calls[0]["prompt"] == preview["prompt"]


def test_count_makes_several_candidates_and_user_picks_one(real_look):
    svc, fake = real_look
    cid = prime(svc)
    svc.set_params(cid, "look", {"count": 3})
    run_and_wait(svc, cid, "look")
    arts = svc.list_artifacts(cid, "look")
    assert len(fake.calls) == 3 and len(arts) == 3
    assert svc.plan(cid, "look")["images"] == 0                          # đã có kết quả, không tạo thêm


def test_rejection_note_goes_into_next_prompt(real_look):
    svc, fake = real_look
    cid = prime(svc)
    run_and_wait(svc, cid, "look")
    svc.decide_gate(cid, "look", "rejected", note="logo bị méo")
    svc.reroll(cid, "look")
    run_and_wait(svc, cid, "look")
    assert len(fake.calls) == 2
    assert "logo bị méo" in fake.calls[1]["prompt"] and "logo bị méo" not in fake.calls[0]["prompt"]
    assert len(svc.list_artifacts(cid, "look")) == 2                      # ảnh bị từ chối vẫn còn


def test_partial_failure_keeps_images_made(env, monkeypatch):
    svc, calls, executors = env
    executors["look"] = look.run_look
    fake = FakeClient(fail_after=2)
    monkeypatch.setattr(look, "_client", lambda: fake)
    cid = prime(svc)
    svc.set_params(cid, "look", {"count": 4})
    run_and_wait(svc, cid, "look")
    arts = svc.list_artifacts(cid, "look")
    assert len(arts) == 2
    assert any("Chỉ tạo được 2/4" in (a["meta"].get("warning") or "") for a in arts)
    assert element_state(svc, cid, "look")["state"] == "fresh"


def test_total_failure_is_recorded_without_retry(env, monkeypatch):
    svc, calls, executors = env
    executors["look"] = look.run_look
    fake = FakeClient(fail_after=0)
    monkeypatch.setattr(look, "_client", lambda: fake)
    cid = prime(svc)
    run_and_wait(svc, cid, "look")
    runs = [r for r in svc.list_runs(cid) if r["step_key"] == "look"]
    assert len(runs) == 1 and runs[0]["state"] == "error" and "giới hạn" in runs[0]["error"]
    assert element_state(svc, cid, "look")["state"] == "missing"


def test_preview_without_inputs_explains_what_is_missing(real_look):
    svc, _ = real_look
    cid = svc.create_campaign("trống")["id"]
    with pytest.raises(Exception) as exc:
        svc.preview_prompt(cid, "look")
    assert "Chưa đủ đầu vào" in str(exc.value)
    with pytest.raises(Exception):
        svc.preview_prompt(cid, "fact_sheet")                              # bước chưa có prompt
