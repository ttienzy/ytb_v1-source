"""Node "Tạo ảnh nhân vật mới" của Motion Control: prompt look sheet, thứ tự ảnh, lưu asset, lỗi đầu vào. Không gọi ChatGPT thật."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.workflow import motion_character
from app.workflow import service as wf_service

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

client = TestClient(app)


class FakeImageClient:
    def __init__(self):
        self.calls = []

    def generate(self, prompt, dest, ref_paths=None, aspect="9:16", **_):
        self.calls.append({"prompt": prompt, "ref_paths": list(ref_paths or []), "aspect": aspect})
        Path(dest).write_bytes(PNG)
        return dest


@pytest.fixture()
def images(tmp_path):
    identity = tmp_path / "me.jpg"
    outfit = tmp_path / "ao.png"
    identity.write_bytes(b"\xff\xd8\xff" + b"\x00" * 32)
    outfit.write_bytes(PNG)
    return identity, outfit


@pytest.fixture()
def fake(monkeypatch, tmp_path):
    fake_client = FakeImageClient()
    monkeypatch.setattr(motion_character, "_client", lambda: fake_client)
    monkeypatch.setattr(wf_service, "WORKFLOW_ASSETS_DIR", tmp_path / "assets")
    return fake_client


def test_prompt_is_the_campaign_look_sheet_with_identity_then_outfit(images):
    identity, outfit = images
    req = motion_character.build_request(identity, outfit, "  mặc   thêm kính râm ")
    assert req["template"]["template_id"] == "system:look_sheet"
    assert "Image 1 = identity reference" in req["prompt"]
    assert "Image 2 = outfit reference" in req["prompt"]
    assert "[OPTIONAL CHANGES]: mặc thêm kính râm" in req["prompt"]
    assert [s["path"] for s in req["ref_order"]] == [str(identity), str(outfit)]
    assert [s["role"] for s in req["ref_order"]] == ["identity", "outfit"]
    assert req["aspect"] == "16:9"


def test_no_changes_means_no_optional_section(images):
    req = motion_character.build_request(*images)
    assert "OPTIONAL CHANGES" not in req["prompt"]


@pytest.mark.parametrize("bad", ["", "C:/khong/co/anh.png", "C:/x/video.mp4"])
def test_rejects_missing_or_non_image_files(bad, images):
    with pytest.raises(motion_character.CharacterSheetError):
        motion_character.build_request(bad, images[1])


def test_generate_saves_a_workflow_asset(fake, images, tmp_path):
    result = motion_character.generate(*images, changes="")
    asset = result["asset"]
    saved = Path(asset.backend_path)
    assert saved.is_file() and saved.read_bytes() == PNG
    assert saved.parent == (tmp_path / "assets").resolve()
    assert asset.kind == "model" and asset.file_name.endswith(".png")
    assert asset.preview_url == f"/api/workflow/assets/{asset.id}"
    assert fake.calls[0]["ref_paths"] == [str(images[0]), str(images[1])]
    assert fake.calls[0]["aspect"] == "16:9"


def test_endpoint_returns_asset_without_inline_data(fake, images):
    resp = client.post("/api/workflow/motion/character-sheet",
                       json={"identity_path": str(images[0]), "outfit_path": str(images[1]), "changes": "tóc buộc cao"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["asset"]["data_url"] is None
    assert body["asset"]["backend_path"]
    assert "tóc buộc cao" in body["prompt"]
    assert body["template"]["template_id"] == "system:look_sheet"


def test_endpoint_reports_bad_input_as_400_without_calling_chatgpt(fake, images):
    resp = client.post("/api/workflow/motion/character-sheet",
                       json={"identity_path": "C:/khong/co/anh.png", "outfit_path": str(images[1])})
    assert resp.status_code == 400
    assert "ảnh nhân vật" in resp.json()["detail"]
    assert fake.calls == []


def test_second_request_while_busy_is_409(fake, images):
    assert motion_character._lock.acquire(blocking=False)
    try:
        resp = client.post("/api/workflow/motion/character-sheet",
                           json={"identity_path": str(images[0]), "outfit_path": str(images[1])})
    finally:
        motion_character._lock.release()
    assert resp.status_code == 409
    assert fake.calls == []


def test_chatgpt_failure_is_502_and_releases_the_lock(monkeypatch, images, tmp_path):
    class Broken:
        def generate(self, **_):
            raise RuntimeError("Tất cả tài khoản ChatGPT đều không khả dụng")

    monkeypatch.setattr(motion_character, "_client", lambda: Broken())
    monkeypatch.setattr(wf_service, "WORKFLOW_ASSETS_DIR", tmp_path / "assets")
    resp = client.post("/api/workflow/motion/character-sheet",
                       json={"identity_path": str(images[0]), "outfit_path": str(images[1])})
    assert resp.status_code == 502
    assert "không khả dụng" in resp.json()["detail"]
    assert not motion_character._lock.locked()
