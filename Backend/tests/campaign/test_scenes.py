"""Cảnh (khối 2 và 4): danh sách cảnh trong tham số là nguồn phần tử; ảnh bối cảnh không người; khung chốt theo vai ảnh."""
from pathlib import Path

import pytest

from app.campaign.executors import common, scene_anchor, scene_plate

from .conftest import SCENES, approve_cast_sheet, element_state, elements_of, prime, run_and_wait
from .test_cast_sheet import FakeImageClient


@pytest.fixture
def real_scenes(env, monkeypatch):
    svc, calls, executors = env
    client = FakeImageClient()
    monkeypatch.setattr(common, "image_client", lambda: client)
    executors["scene_plate"] = scene_plate.run_scene_plate
    executors["scene_anchor"] = scene_anchor.run_scene_anchor
    return svc, client


def test_scene_plate_has_no_references_and_describes_one_place(real_scenes):
    svc, client = real_scenes
    cid = prime(svc)
    p = svc.preview_prompt(cid, "scene_plate", "scene:2")
    assert p["ref_order"] == [] and p["scene"] == "scene:2" and p["aspect"] == "9:16"
    assert "Generate a NEW photograph" in p["prompt"] and "no people" in p["prompt"]
    assert "a bright cafe beside a large window" in p["prompt"] and "soft window light from the right" in p["prompt"]
    run_and_wait(svc, cid, "scene_plate", elements=["scene:2"])
    assert client.calls[0]["refs"] == [] and client.calls[0]["prompt"] == p["prompt"]
    assert element_state(svc, cid, "scene_plate", "scene:2")["state"] == "fresh"
    assert element_state(svc, cid, "scene_plate", "scene:1")["state"] == "missing"


def test_scene_plate_prompt_has_no_garment_or_edit_language(real_scenes):
    """Lỗi thật 2026-11-14: phong cách chung của chiến dịch (viết cho ảnh CÓ áo: "do not redraw or alter the garment's logo",
    "highlight garment texture") bị chèn vào ảnh bối cảnh KHÔNG có ảnh đầu vào → ChatGPT hiểu thành SỬA ẢNH và trả lời
    bằng chữ thay vì tạo ảnh (6/6). Prompt bối cảnh chỉ được lấy bảng màu từ phong cách."""
    svc, _ = real_scenes
    cid = prime(svc)
    svc.set_params(cid, "style", {"lighting": "warm tones to highlight garment texture", "palette": "white and warm beige",
                                  "dont": "Do not redraw or alter the garment's logo or text"})
    prompt = svc.preview_prompt(cid, "scene_plate", "scene:1")["prompt"]
    assert "white and warm beige" in prompt                     # bảng màu vẫn giữ để cùng tông với cast sheet
    low = prompt.lower()
    for word in ("garment", "logo or text", "redraw or alter", "highlight", "will later stand"):
        assert word not in low, word
    assert "do not edit" in low and "no input image" in low     # nói rõ đây là ảnh mới, không phải sửa ảnh


def test_scene_without_a_place_is_refused_clearly(svc):
    cid = prime(svc, scenes=[{"key": "scene:1", "name": "trống"}])
    with pytest.raises(Exception, match="chưa ghi nơi quay"):
        svc.preview_prompt(cid, "scene_plate", "scene:1")


def test_scene_anchor_uses_sheet_photo_and_plate_in_that_order(real_scenes):
    svc, client = real_scenes
    cid = prime(svc)
    approve_cast_sheet(svc, cid)
    run_and_wait(svc, cid, "fact_sheet")
    run_and_wait(svc, cid, "scene_plate")
    p = svc.preview_prompt(cid, "scene_anchor", "scene:1")
    assert [r["role"] for r in p["ref_order"]] == ["sheet", "photo", "plate"]
    assert "ACTION: walking slowly toward the camera" in p["prompt"] and "the woman from Image 1" in p["prompt"]
    run_and_wait(svc, cid, "scene_anchor", elements=["scene:1"])
    call = client.calls[-1]
    assert call["refs"][1] == b"shirt-bytes-1" and len(call["refs"]) == 3 and call["aspect"] == "9:16"
    st = element_state(svc, cid, "scene_anchor", "scene:1")
    assert st["state"] == "fresh" and st["gate"] == "need_approval"


def test_regenerating_a_plate_makes_only_that_scene_anchor_stale(svc):
    cid = prime(svc)
    approve_cast_sheet(svc, cid)
    run_and_wait(svc, cid, "scene_anchor")
    assert elements_of(svc, cid, "scene_anchor") == ["scene:1", "scene:2"]
    svc.reroll(cid, "scene_plate", "scene:2")
    run_and_wait(svc, cid, "scene_plate", elements=["scene:2"])
    assert element_state(svc, cid, "scene_anchor", "scene:1")["state"] == "fresh"
    st = element_state(svc, cid, "scene_anchor", "scene:2")
    assert st["state"] == "stale" and st["reasons"] == ["inputs.scene_plate[scene:2]"]


def test_style_change_stales_plates_but_not_the_cast_sheet(svc):
    cid = prime(svc)
    run_and_wait(svc, cid, "cast_sheet")
    run_and_wait(svc, cid, "scene_plate")
    svc.set_params(cid, "style", {"lighting": "hard noon sun"})
    assert element_state(svc, cid, "cast_sheet")["state"] == "fresh"
    assert element_state(svc, cid, "scene_plate", "scene:1")["reasons"] == ["inputs.style"]
