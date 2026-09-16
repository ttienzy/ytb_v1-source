from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.veo import service
from app.veo.schemas import VeoJobRequest


@pytest.fixture
def image_path(tmp_path):
    image = tmp_path / "image.png"
    image.write_bytes(b"image fixture")
    return str(image)


@pytest.mark.parametrize("mode,fields", [
    ("ingredients", {}), ("ingredients", {"ingredient_image_paths": [""]}),
    ("ingredients", {"ingredient_image_paths": ["missing.png"]}),
    ("frames", {}), ("frames", {"image_path": "missing.png"}),
    ("frames", {"end_image_path": "missing.png"}),
])
def test_missing_images_never_fall_back_to_text(mode, fields):
    with pytest.raises(ValueError):
        service._build_verified_flow_request({"prompt": "product", "input_mode": mode, **fields})


def test_missing_end_frame_is_not_silently_discarded(image_path):
    with pytest.raises(ValueError, match="not found"):
        service._build_verified_flow_request({
            "prompt": "product", "input_mode": "frames", "image_path": image_path, "end_image_path": "missing.png",
        })


def test_partial_ingredients_fail_even_with_valid_start_image(image_path):
    with pytest.raises(ValueError, match="not found"):
        service._build_verified_flow_request({
            "prompt": "product", "input_mode": "ingredients", "image_path": image_path,
            "ingredient_image_paths": [image_path, "missing.png"],
        })


def test_empty_image_rejected(tmp_path):
    path = tmp_path / "empty.png"
    path.touch()
    with pytest.raises(ValueError, match="empty"):
        service._build_verified_flow_request({"prompt": "product", "input_mode": "frames", "image_path": str(path)})


def test_existing_image_preserves_ingredients_mode(image_path):
    request = service._build_verified_flow_request({
        "prompt": "product", "input_mode": "ingredients", "image_path": image_path,
    })
    assert request["input_mode"] == "ingredients"
    assert len(request["ingredient_images"]) == 1


@pytest.mark.parametrize("mode,fields", [
    ("ingredients", {"ingredient_image_paths": ["missing.png"]}),
    ("frames", {"image_path": "missing.png"}),
])
def test_invalid_submission_does_not_persist_or_start_worker(monkeypatch, mode, fields):
    monkeypatch.setattr(service, "get_active_project", lambda: SimpleNamespace(id="test", flow_project_id="flow"))
    monkeypatch.setattr(service, "_jobs", {})
    save = Mock()
    worker = Mock()
    monkeypatch.setattr(service, "_save_jobs", save)
    monkeypatch.setattr(service, "Thread", worker)
    with pytest.raises(ValueError):
        service.submit_job(VeoJobRequest(prompt="product", input_mode=mode, **fields))
    assert service._jobs == {}
    save.assert_not_called()
    worker.assert_not_called()


def test_worker_revalidates_before_provider_dispatch(monkeypatch):
    job = {"job_id": "test", "prompt": "product", "input_mode": "frames", "image_path": "removed.png"}
    monkeypatch.setattr(service, "_jobs", {"test": job})
    monkeypatch.setattr(service, "_save_jobs", Mock())
    monkeypatch.setattr(service.bridge, "is_bridge_running", lambda: True)
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": True})
    monkeypatch.setattr(service.bridge, "get_credentials_pool", lambda: ["test"])
    dispatch = Mock()
    monkeypatch.setattr(service.bridge, "request_captcha", dispatch)
    service._process_job("test")
    assert job["status"] == "error"
    assert "not found" in job["error_message"]
    dispatch.assert_not_called()
