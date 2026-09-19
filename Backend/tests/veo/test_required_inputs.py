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


def test_uploaded_video_media_id_builds_video_edit_request():
    request = service._build_verified_flow_request({
        "prompt": "Keep the same subject and motion in a sunny garden.",
        "input_mode": "video_edit",
        "resolution": "360p",
        "reference_video_id": "uploaded-video-media-id",
        "reference_video_start_seconds": 0,
        "reference_video_end_seconds": 10,
    })
    assert request["input_mode"] == "video_edit"
    assert request["provider_model_id"] == "abra_edit_360p"
    assert request["reference_video_id"] == "uploaded-video-media-id"
    assert request["reference_video_start_seconds"] == 0
    assert request["reference_video_end_seconds"] == 10


def test_video_edit_requires_uploaded_media_id():
    with pytest.raises(ValueError, match="reference_video_id"):
        service._build_verified_flow_request({
            "prompt": "product",
            "input_mode": "video_edit",
        })


@pytest.mark.parametrize("resolution", ["1080p", "4k"])
def test_video_edit_rejects_generation_resolution_above_720p(resolution):
    with pytest.raises(ValueError, match="360p or 720p"):
        service._build_verified_flow_request({
            "prompt": "product",
            "input_mode": "video_edit",
            "resolution": resolution,
            "reference_video_id": "uploaded-video-media-id",
        })


def test_video_edit_rejects_multiple_outputs_until_adapter_supports_them():
    with pytest.raises(ValueError, match="exactly one output"):
        service._build_verified_flow_request({
            "prompt": "product",
            "input_mode": "video_edit",
            "resolution": "360p",
            "num_outputs": 2,
            "reference_video_id": "uploaded-video-media-id",
        })


def test_video_edit_encodes_optional_image_reference(image_path):
    request = service._build_verified_flow_request({
        "prompt": "Transfer the motion to the person in the image.",
        "input_mode": "video_edit",
        "resolution": "360p",
        "reference_video_id": "uploaded-video-media-id",
        "ingredient_image_paths": [image_path],
    })
    assert request["input_mode"] == "video_edit"
    assert len(request["ingredient_images"]) == 1
    assert request["ingredient_images"][0]["mime"] == "image/png"


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
    assert job["error_code"] == "REFERENCE_INVALID"
    assert job["error_stage"] == "reference_upload"
    assert job["error_retryable"] is True
    dispatch.assert_not_called()


@pytest.mark.parametrize(
    "message,previous_status,expected_code,expected_stage",
    [
        ("Bridge Server không hoạt động", "captcha", "BRIDGE_OFFLINE", "connection"),
        ("Extension chưa kết nối", "captcha", "EXTENSION_DISCONNECTED", "connection"),
        ("Giải reCAPTCHA thất bại: Timeout", "captcha", "CAPTCHA_FAILED", "captcha"),
        ("Timeout chờ kết quả Google Flow", "generating", "FLOW_TIMEOUT", "generation"),
        ("Google Flow: Flow render ended with status 4", "generating", "FLOW_RENDER_FAILED", "generation"),
        ("Google Flow: Flow page returned no result", "generating", "FLOW_EMPTY_RESULT", "generation"),
        ("Google Flow: insufficient credits", "generating", "FLOW_REJECTED", "generation"),
        ("Không tải video được", "downloading", "DOWNLOAD_FAILED", "download"),
    ],
)
def test_job_errors_include_stable_ui_metadata(message, previous_status, expected_code, expected_stage):
    details = service._classify_job_error(message, previous_status)
    assert details["error_code"] == expected_code
    assert details["error_stage"] == expected_stage
    assert details["error_hint"]
    assert details["error_retryable"] is True
