import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.veo import media_registry, service
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
        "resolution": "720p",
        "reference_video_id": "uploaded-video-media-id",
        "reference_video_start_seconds": 0,
        "reference_video_end_seconds": 10,
    })
    assert request["input_mode"] == "video_edit"
    assert request["provider_model_id"] == "macaron_cookie_edit"   # Omni 1.2 (HAR flow.google_video_motion.com)
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


def test_video_edit_multiple_outputs_only_on_the_http_path():
    """Nhiều video một lệnh chỉ có trên đường HTTP (HAR x3). Yêu cầu không đủ điều kiện HTTP thì chặn trước khi gửi."""
    base = {"prompt": "product", "input_mode": "video_edit", "resolution": "720p", "reference_video_id": "uploaded-video-media-id"}
    with pytest.raises(ValueError, match="chỉ chạy qua đường HTTP"):
        service._build_verified_flow_request({**base, "num_outputs": 2})
    with pytest.raises(ValueError, match="1–4 video"):
        service._build_verified_flow_request({**base, "num_outputs": 5})


def test_video_edit_encodes_optional_image_reference_fresh(monkeypatch, image_path):
    registry_lookup = Mock(return_value="stale-image-media-id")
    monkeypatch.setattr(media_registry, "get_cached_media_id", registry_lookup)
    request = service._build_verified_flow_request({
        "prompt": "Transfer the motion to the person in the image.",
        "input_mode": "video_edit",
        "resolution": "720p",
        "reference_video_id": "uploaded-video-media-id",
        "ingredient_image_paths": [image_path],
        "force_fresh_assets": True,
    })
    assert request["input_mode"] == "video_edit"
    assert len(request["ingredient_images"]) == 1
    assert request["ingredient_media_ids"] == []
    assert request["ingredient_images"][0]["mime"] == "image/png"
    assert request["force_fresh_assets"] is True
    registry_lookup.assert_not_called()


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


def test_duplicate_idempotency_key_returns_existing_job_without_starting_worker(monkeypatch):
    monkeypatch.setattr(service, "get_active_project", lambda: SimpleNamespace(id="test", flow_project_id="flow"))
    monkeypatch.setattr(service, "_jobs", {})
    monkeypatch.setattr(service, "_save_jobs", Mock())
    worker = Mock()
    monkeypatch.setattr(service, "Thread", worker)
    request = VeoJobRequest(
        prompt="same motion request",
        input_mode="video_edit",
        resolution="720p",
        reference_video_id="uploaded-video-media-id",
        idempotency_key="motion-click-1",
    )

    first = service.submit_job(request)
    second = service.submit_job(request)

    assert first.job_id == second.job_id
    assert second.deduplicated is True
    worker.assert_called_once()


def test_same_active_payload_without_key_is_deduplicated(monkeypatch):
    monkeypatch.setattr(service, "get_active_project", lambda: SimpleNamespace(id="test", flow_project_id="flow"))
    monkeypatch.setattr(service, "_jobs", {})
    monkeypatch.setattr(service, "_save_jobs", Mock())
    worker = Mock()
    monkeypatch.setattr(service, "Thread", worker)
    request = VeoJobRequest(
        prompt="same active request",
        input_mode="video_edit",
        resolution="720p",
        reference_video_id="uploaded-video-media-id",
    )

    first = service.submit_job(request)
    second = service.submit_job(request)

    assert first.job_id == second.job_id
    assert second.deduplicated is True
    worker.assert_called_once()


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
        ("Google Flow: FLOW_UI: Flow control not found: requested asset in picker", "generating", "FLOW_UI_CONTROL_MISSING", "generation"),
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


def test_prominent_people_filter_is_its_own_non_retryable_error():
    message = 'Google Flow: Flow render ended with status 4 [bản ghi poll: [4,[3,"PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED"],["PROMINENT_PERSON"]]]'
    details = service._classify_job_error(message, "generating")
    assert details["error_code"] == "FLOW_PROMINENT_PEOPLE"
    assert details["error_retryable"] is False
    assert "khuôn mặt" in details["error_hint"]


def test_job_api_corrects_legacy_picker_error_without_rewriting_history(monkeypatch):
    legacy = {
        "job_id": "92dcf37f-f20", "status": "error",
        "error_message": "Google Flow: FLOW_UI: Flow control not found: requested asset in picker",
        "error_code": "REFERENCE_INVALID", "error_stage": "reference_upload",
        "error_hint": "Choose the file again.", "error_retryable": True,
        "updated_at": "2026-10-03T02:34:44.685659+00:00",
    }
    snapshot = dict(legacy)
    monkeypatch.setattr(service, "_jobs", {legacy["job_id"]: legacy})
    save = Mock()
    monkeypatch.setattr(service, "_save_jobs", save)
    for output in [service.get_job(legacy["job_id"]), *service.get_all_jobs()]:
        assert output.error_code == "FLOW_UI_CONTROL_MISSING"
        assert output.error_stage == "generation"
        assert output.error_message == legacy["error_message"]
        assert output.error_hint != legacy["error_hint"]
        assert output.updated_at == legacy["updated_at"]
    assert legacy == snapshot
    save.assert_not_called()


def test_video_edit_is_treated_as_native_ui_mode_without_captcha_wait(monkeypatch):
    job = {
        "job_id": "test_motion",
        "prompt": "Dance along with reference",
        "input_mode": "video_edit",
        "reference_video_id": "b2f66204-99b7-4548-a4ae-f0e52d1c8836",
        "reference_video_start_seconds": 0,
        "reference_video_end_seconds": 8,
        "ingredient_image_paths": [],
        "ingredient_media_ids": [],
    }
    monkeypatch.setattr(service, "_jobs", {"test_motion": job})
    monkeypatch.setattr(service, "_save_jobs", Mock())
    monkeypatch.setattr(service.bridge, "is_bridge_running", lambda: True)
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": True})
    monkeypatch.setattr(service.bridge, "get_credentials_pool", lambda: ["test"])
    monkeypatch.setattr(service.bridge, "request_captcha", Mock(return_value="req-123"))

    wait_captcha = Mock()
    monkeypatch.setattr(service.bridge, "wait_captcha_result", wait_captcha)
    wait_flow = Mock(return_value={"ok": True, "result": {"ok": True, "video_url": "https://flow-content.google/video.mp4", "media_id": "out-123"}})
    monkeypatch.setattr(service.bridge, "wait_flow_result", wait_flow)
    monkeypatch.setattr(service, "_download_flow_video", Mock(return_value=Path("test_motion.mp4")))

    service._process_job("test_motion")

    wait_captcha.assert_not_called()
    wait_flow.assert_called_once_with("req-123", timeout=1080.0)
    assert job["status"] == "done"



HTTP_EDIT = {
    "prompt": "Apply the motion to the person in the image.", "input_mode": "video_edit", "model_display_name": "Omni 1.2 Flash",
    "resolution": "720p", "aspect_ratio": "9:16", "reference_video_id": "77eeeaaf-d50d-402a-80e5-261d572cdf9b",
    "reference_video_start_seconds": 0, "reference_video_end_seconds": 13.63,
    "ingredient_media_ids": ["fc71a31e-abef-4728-9285-97e4fe119c26"],
}


def test_omni_12_video_edit_uses_macaron_edit_and_rejects_unverified_360p_and_omni_11():
    base = {"prompt": "Apply the motion to the person in the image.", "input_mode": "video_edit", "reference_video_id": "vid",
            "model_display_name": "Omni 1.2 Flash", "resolution": "720p"}
    assert service._build_verified_flow_request(dict(base))["provider_model_id"] == "macaron_cookie_edit"
    # 360p chỉ đi HTTP: yêu cầu không đủ điều kiện HTTP (mã video mẫu giả) thì bị chặn
    with pytest.raises(ValueError, match="360p"):
        service._build_verified_flow_request({**base, "resolution": "360p"})
    with pytest.raises(ValueError, match="Omni 1.1"):
        service._build_verified_flow_request({**base, "model_display_name": "Omni 1.1 Flash"})


def _motion_request(end_seconds):
    return VeoJobRequest(
        prompt="motion", input_mode="video_edit", resolution="720p", reference_video_id="uploaded-video-media-id",
        reference_video_start_seconds=0, reference_video_end_seconds=end_seconds,
    )


def _isolated_submit(monkeypatch):
    monkeypatch.setattr(service, "get_active_project", lambda: SimpleNamespace(id="test", flow_project_id="flow"))
    monkeypatch.setattr(service, "_jobs", {})
    save = Mock()
    worker = Mock()
    monkeypatch.setattr(service, "_save_jobs", save)
    monkeypatch.setattr(service, "Thread", worker)
    return save, worker


@pytest.mark.parametrize("ext_info,end,allowed", [
    ({"connected": True}, 13, False),                                                      # extension cũ (không báo gì) -> 10 s
    ({"connected": True, "capabilities": {}}, 13, False),
    ({"connected": True}, 10, True),                                                       # đúng giới hạn cũ vẫn chạy
    ({"connected": True, "capabilities": {"motion_ref_max_seconds": 15}}, 13, True),       # extension mới
    ({"connected": True, "capabilities": {"motion_ref_max_seconds": 15}}, 15, True),
    ({"connected": True, "capabilities": {"motion_ref_max_seconds": "x"}}, 13, False),     # báo hỏng -> coi như cũ
    ({"connected": False}, 13, True),                                                      # chưa kết nối: để các kiểm tra khác lo
])
def test_extension_motion_limit_guard(monkeypatch, ext_info, end, allowed):
    save, worker = _isolated_submit(monkeypatch)
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: ext_info)
    if allowed:
        service.submit_job(_motion_request(end))
        worker.assert_called_once()
    else:
        with pytest.raises(ValueError) as e:
            service.submit_job(_motion_request(end))
        msg = str(e.value)
        assert "bản cũ" in msg and "Reload" in msg and "chưa mất credit" in msg and "10 giây" in msg
        # chặn trước khi tạo job: không lưu, không chạy worker => không thể tốn credit
        assert service._jobs == {}
        save.assert_not_called()
        worker.assert_not_called()


def test_heartbeat_capabilities_are_stored_and_reset(monkeypatch):
    """Heartbeat bản mới báo năng lực; bản cũ (không có trường) xóa năng lực cũ để backend không tin số liệu thừa."""
    from app.veo import bridge as br

    monkeypatch.setattr(br, "_extension_info", dict(br._extension_info))
    br.apply_heartbeat({"version": "2.2.0", "capabilities": {"motion_ref_max_seconds": 15}, "tab_count": 1})
    info = br.get_extension_info()
    assert info["connected"] is True and info["capabilities"] == {"motion_ref_max_seconds": 15}
    br.apply_heartbeat({"version": "2.2.0"})                       # extension bản cũ
    assert br.get_extension_info()["capabilities"] == {}
    br.apply_heartbeat({"capabilities": "hỏng"})
    assert br.get_extension_info()["capabilities"] == {}
    # và guard của service đọc đúng số đã lưu
    br.apply_heartbeat({"capabilities": {"motion_ref_max_seconds": 12}})
    monkeypatch.setattr(service.bridge, "get_extension_info", br.get_extension_info)
    assert service._extension_motion_ref_limit() == 12


def _variant_request(variant, key):
    return VeoJobRequest(
        prompt="same ingredients request", input_mode="video_edit", resolution="720p",
        reference_video_id="uploaded-video-media-id", reference_video_start_seconds=0, reference_video_end_seconds=8,
        idempotency_key=key, variant=variant,
    )


def test_variants_with_identical_content_become_separate_jobs(monkeypatch):
    """Lỗi thật (2026-11-23): biến thể 2 giống hệt biến thể 1 về nội dung chỉ khác idempotency_key nên bị fingerprint coi là
    bản trùng của job đang chạy -> trả lại job của biến thể 1 (2 ô theo dõi cùng 1 job, chỉ có 1 video)."""
    _isolated_submit(monkeypatch)
    worker = Mock()
    monkeypatch.setattr(service, "Thread", worker)
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": False})
    v1 = service.submit_job(_variant_request(1, "k-a1-v1"))
    v2 = service.submit_job(_variant_request(2, "k-a1-v2"))
    v3 = service.submit_job(_variant_request(3, "k-a1-v3"))
    assert len({v1.job_id, v2.job_id, v3.job_id}) == 3
    assert not (v1.deduplicated or v2.deduplicated or v3.deduplicated)
    assert worker.call_count == 3
    assert [service._jobs[j.job_id]["variant"] for j in (v1, v2, v3)] == [1, 2, 3]


def test_same_variant_is_still_deduplicated(monkeypatch):
    """Bấm đúp / gửi lại CÙNG biến thể thì vẫn không tạo thêm job (chống tốn credit)."""
    _isolated_submit(monkeypatch)
    worker = Mock()
    monkeypatch.setattr(service, "Thread", worker)
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": False})
    first = service.submit_job(_variant_request(2, "k-a1-v2"))
    again_same_key = service.submit_job(_variant_request(2, "k-a1-v2"))
    again_new_key = service.submit_job(_variant_request(2, "k-a2-v2"))   # khác khóa nhưng cùng nội dung + cùng biến thể + job còn chạy
    assert again_same_key.job_id == first.job_id and again_same_key.deduplicated
    assert again_new_key.job_id == first.job_id and again_new_key.deduplicated
    assert worker.call_count == 1


def test_variant_is_not_sent_to_flow(monkeypatch):
    """`variant` chỉ để chống trùng: không được lọt vào request gửi Flow."""
    job = {"input_mode": "video_edit", "prompt": "p", "model_display_name": "Omni 1.2 Flash", "duration_seconds": 8, "resolution": "720p",
           "aspect_ratio": "9:16", "num_outputs": 1, "reference_video_id": "50cd26f1-45d8-44eb-95a6-030f6a90293a",
           "reference_video_start_seconds": 0, "reference_video_end_seconds": 8, "variant": 3, "flow_project_id": "flow"}
    req = service._build_verified_flow_request(job)
    assert "variant" not in req and "variant" not in json.dumps(req)


def test_queue_message_names_the_job_in_front(monkeypatch):
    monkeypatch.setattr(service, "_jobs", {"d0afb250-a4c": {
        "job_id": "d0afb250-a4c", "input_mode": "video_edit",
        "created_at": (datetime.now(timezone.utc) - timedelta(minutes=9, seconds=20)).isoformat(),
    }})
    text = service._describe_flow_holder("video:d0afb250-a4c")
    assert "Motion Control" in text and "d0afb250-a4c" in text and "đã 9 phút" in text
    assert service._describe_flow_holder("") == ""
    assert service._describe_flow_holder("video:khong-co") == "video:khong-co"   # không tra được thì giữ nguyên chữ gốc


def test_http_three_variants_as_sent_by_the_muse_canvas_node(monkeypatch, tmp_path):
    """Hợp đồng frontend ↔ backend: đúng bộ trường node Ingredients gửi (museCanvasNodes.buildVideoIngrRequest) -> 3 POST
    /api/veo/jobs khác nhau chỉ ở `variant` + khóa chống trùng phải ra 3 job riêng, mỗi job num_outputs = 1."""
    from fastapi.testclient import TestClient
    from app.main import app

    images = []
    for i in range(3):
        p = tmp_path / f"ref{i}.png"
        p.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 64)
        images.append(str(p))
    _isolated_submit(monkeypatch)
    worker = Mock()
    monkeypatch.setattr(service, "Thread", worker)
    monkeypatch.setattr(service, "get_project", lambda pid: SimpleNamespace(id=pid, flow_project_id="flow-abc"))
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": True, "capabilities": {"motion_ref_max_seconds": 15}})

    def body(variant):
        return {
            "prompt": "Recreate the exact pacing…", "model_display_name": "Omni 1.2 Flash", "input_mode": "video_edit",
            "aspect_ratio": "9:16", "duration_seconds": 13, "resolution": "720p", "num_outputs": 1, "variant": variant,
            "project_id": "vp-1", "ingredient_image_paths": images, "reference_video_id": "50cd26f1-45d8-44eb-95a6-030f6a90293a",
            "reference_video_start_seconds": 0, "reference_video_end_seconds": 13.0,
            "idempotency_key": f"musevingr-vingr-x-abc-a1-v{variant}",
        }

    client = TestClient(app)
    got = [client.post("/api/veo/jobs", json=body(v)) for v in (1, 2, 3)]
    assert [r.status_code for r in got] == [200, 200, 200], [r.text[:200] for r in got]
    ids = [r.json()["job_id"] for r in got]
    assert len(set(ids)) == 3 and not any(r.json()["deduplicated"] for r in got)
    assert worker.call_count == 3
    # bấm đúp biến thể 2 -> vẫn là job cũ của biến thể 2, không tạo thêm
    again = client.post("/api/veo/jobs", json=body(2))
    assert again.json()["job_id"] == ids[1] and again.json()["deduplicated"] is True and worker.call_count == 3
    # extension bản cũ + đoạn 13 s -> bị chặn trước khi tạo job (400, câu hướng dẫn Reload)
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": True})
    blocked = client.post("/api/veo/jobs", json={**body(4), "idempotency_key": "other"})
    assert blocked.status_code == 400 and "Reload" in blocked.json()["detail"] and "chưa mất credit" in blocked.json()["detail"]
    assert worker.call_count == 3



def test_video_edit_360p_and_three_outputs_follow_the_har():
    """HAR flow.google_video_2311.com: x3 + 360p = model macaron_cookie_edit_360p, đi HTTP, num_outputs giữ nguyên cho extension."""
    req = service._build_verified_flow_request({**HTTP_EDIT, "resolution": "360p", "num_outputs": 3})
    assert req["provider_model_id"] == "macaron_cookie_edit_360p"
    assert req["http_no_captcha"] is True and req["num_outputs"] == 3
    req720 = service._build_verified_flow_request({**HTTP_EDIT, "num_outputs": 4})
    assert req720["provider_model_id"] == "macaron_cookie_edit" and req720["http_no_captcha"] is True
    # khớp canUseHttpVideo của extension: hậu tố model phải khớp resolution; 5 video thì không
    assert service._http_video_eligible({**req, "resolution": "720p"}) is False
    assert service._http_video_eligible({**req, "num_outputs": 5}) is False
    assert service._http_video_eligible({**req, "num_outputs": 1}) is True


@pytest.mark.parametrize("caps,n,res,allowed", [
    ({}, 1, "720p", True),
    ({}, 3, "720p", False),                                                     # extension cũ: không báo -> 1 video
    ({}, 1, "360p", False),
    ({"motion_max_outputs": 4, "motion_360p": True}, 3, "360p", True),
    ({"motion_max_outputs": 2, "motion_360p": True}, 3, "720p", False),
])
def test_extension_must_support_multi_output_and_360p(monkeypatch, caps, n, res, allowed):
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": True, "capabilities": caps})
    if allowed:
        service._require_extension_motion_features(n, res)
    else:
        with pytest.raises(ValueError, match="Reload.*chưa mất credit"):
            service._require_extension_motion_features(n, res)


def _batch_job(monkeypatch, job_id="batch-1", n=3):
    job = {"job_id": job_id, "status": "generating", "input_mode": "video_edit", "num_outputs": n, "project_id": None,
           "prompt": "p", "model_display_name": "Omni 1.2 Flash", "aspect_ratio": "9:16", "duration_seconds": 13, "resolution": "360p"}
    monkeypatch.setattr(service, "_jobs", {job_id: job})
    monkeypatch.setattr(service, "_save_jobs", Mock())
    downloaded = []

    def fake_download(j, result, name_suffix=""):
        downloaded.append((result["media_id"], name_suffix))
        return Path(f"{j['job_id']}{name_suffix}.mp4")

    monkeypatch.setattr(service, "_download_flow_video", fake_download)
    return job, downloaded


def test_multi_output_each_variant_has_its_own_outcome(monkeypatch):
    """Đúng kết cục trong HAR: biến thể 1 bị bộ lọc người nổi tiếng chặn, 2 và 3 xong."""
    job, downloaded = _batch_job(monkeypatch)
    url = "https://flow-content.google/video/x"
    service._finish_multi_output_job(job, {"ok": True, "provider_model_id": "macaron_cookie_edit_360p", "outputs": [
        {"index": 0, "ok": False, "media_id": "m0", "error": "Flow render ended with status 4 [PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED]"},
        {"index": 1, "ok": True, "media_id": "m1", "video_url": url},
        {"index": 2, "ok": True, "media_id": "m2", "video_url": url},
    ]})
    assert job["status"] == "done"
    assert job["output_files"] == ["batch-1_v2.mp4", "batch-1_v3.mp4"]
    assert downloaded == [("m1", "_v2"), ("m2", "_v3")]
    assert [o["status"] for o in job["outputs"]] == ["error", "done", "done"]
    assert job["outputs"][0]["error_code"] == "FLOW_PROMINENT_PEOPLE"
    assert job["outputs"][1]["file"] == "batch-1_v2.mp4"
    assert job["provider_media_id"] == "m1" and job["provider_media_ids"] == ["m0", "m1", "m2"]
    assert "2/3" in job["current_step"]
    out = service._job_to_out(job)
    assert [o["status"] for o in out.outputs] == ["error", "done", "done"]


def test_multi_output_all_failed_is_an_error_and_rejects_reused_media(monkeypatch):
    job, _ = _batch_job(monkeypatch, n=2)
    service._jobs["other"] = {"job_id": "other", "status": "done", "provider_media_id": "m1"}
    url = "https://flow-content.google/video/x"
    service._finish_multi_output_job(job, {"ok": True, "outputs": [
        {"index": 0, "ok": False, "media_id": "m0", "error": "Timed out waiting for Flow render"},
        {"index": 1, "ok": True, "media_id": "m1", "video_url": url},     # đã thuộc job khác -> từ chối, không nhận nhầm
    ]})
    assert job["status"] == "error"
    assert job["output_files"] == []
    assert "đã thuộc về job other" in job["outputs"][1]["error"]


def _run_motion_job(monkeypatch, envelope, n=1):
    job = {"job_id": "mj", "prompt": "p", "input_mode": "video_edit", "num_outputs": n, **{k: HTTP_EDIT[k] for k in (
        "reference_video_id", "reference_video_start_seconds", "reference_video_end_seconds", "ingredient_media_ids")},
        "ingredient_image_paths": [], "model_display_name": "Omni 1.2 Flash", "aspect_ratio": "9:16", "resolution": "720p", "duration_seconds": 13}
    monkeypatch.setattr(service, "_jobs", {"mj": job})
    monkeypatch.setattr(service, "_save_jobs", Mock())
    monkeypatch.setattr(service.bridge, "is_bridge_running", lambda: True)
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": True})
    monkeypatch.setattr(service.bridge, "get_credentials_pool", lambda: ["test"])
    monkeypatch.setattr(service.bridge, "request_captcha", Mock(return_value="req-1"))
    monkeypatch.setattr(service.bridge, "wait_flow_result", Mock(return_value=envelope))
    recover = Mock(return_value=False)
    monkeypatch.setattr(service, "_try_recover_completed_scene", recover)
    service._process_job("mj")
    return job, recover


def test_extension_failure_flag_not_submitted_means_no_credit_and_no_recovery(monkeypatch):
    """Lỗi kiểu "Failed to fetch" trước khi Flow nhận lệnh: extension báo submitted=false -> nói rõ chưa mất credit."""
    job, recover = _run_motion_job(monkeypatch, {"result": None, "error": "Failed to fetch",
                                                  "failure": {"submitted": False, "media_id": None, "media_ids": []}})
    assert job["status"] == "error"
    assert job["error_message"].startswith("Chưa gửi lên Flow (không mất credit)")
    recover.assert_not_called()


def test_extension_failure_after_submit_keeps_media_ids_and_skips_recovery_for_batches(monkeypatch):
    job, recover = _run_motion_job(monkeypatch, {"result": None, "error": "Flow render ended with status 4",
                                                  "failure": {"submitted": True, "media_id": "a", "media_ids": ["a", "b"]}}, n=2)
    assert job["status"] == "error" and "Chưa gửi" not in job["error_message"]
    assert job["provider_media_ids"] == ["a", "b"]
    recover.assert_not_called()          # khôi phục scene chỉ lấy được 1 video bất kỳ -> không dùng cho lệnh nhiều video
    # 1 video + extension cũ (không có `failure`): vẫn thử khôi phục như trước
    job, recover = _run_motion_job(monkeypatch, {"result": None, "error": "Failed to fetch"})
    recover.assert_called_once()



FIVE_IDS = [f"fc71a31e-abef-4728-9285-97e4fe119c{i:02d}" for i in range(6)]


def test_video_edit_accepts_up_to_five_reference_images_on_http(monkeypatch):
    """Chỉnh video: 1–5 ảnh (người dùng xác nhận trên Flow); đi HTTP; 6 ảnh thì không."""
    for n in (4, 5):
        req = service._build_verified_flow_request({**HTTP_EDIT, "ingredient_media_ids": FIVE_IDS[:n]})
        assert req["http_no_captcha"] is True and len(req["ingredient_inputs"]) == n
    assert service._motion_image_order({"ingredient_media_ids": FIVE_IDS[:6]}) is None
    # schema: trần chung 5 (lỗi cũ "List should have at most 3 items" khi gửi 4 ảnh)
    VeoJobRequest(prompt="p", input_mode="video_edit", reference_video_id="v", ingredient_media_ids=FIVE_IDS[:5])
    with pytest.raises(Exception, match="at most 5"):
        VeoJobRequest(prompt="p", input_mode="video_edit", reference_video_id="v", ingredient_media_ids=FIVE_IDS[:6])


def test_more_than_three_images_need_http_and_a_new_extension(monkeypatch):
    # không đủ điều kiện HTTP (mã video mẫu giả) + 4 ảnh -> chặn trước khi gửi
    with pytest.raises(ValueError, match="hơn 3 ảnh"):
        service._build_verified_flow_request({**HTTP_EDIT, "reference_video_id": "vid", "ingredient_media_ids": FIVE_IDS[:4]})
    # extension cũ (chỉ nhận 3 ảnh) -> chặn kèm hướng dẫn Reload
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": True, "capabilities": {"motion_max_outputs": 4, "motion_360p": True}})
    with pytest.raises(ValueError, match="4 ảnh tham chiếu.*Reload"):
        service._require_extension_motion_features(1, "720p", 4)
    service._require_extension_motion_features(1, "720p", 3)
    monkeypatch.setattr(service.bridge, "get_extension_info", lambda: {"connected": True, "capabilities": {"motion_max_images": 5}})
    service._require_extension_motion_features(1, "720p", 5)


def test_r2v_ingredients_still_limited_to_three(monkeypatch):
    """Ingredients r2v (node Clip) chưa ai xác nhận hơn 3 ảnh: giữ 1–3."""
    with pytest.raises(ValueError, match="1–3"):
        service._build_verified_flow_request({"prompt": "p", "input_mode": "ingredients", "model_display_name": "Omni 1.2 Flash",
                                              "duration_seconds": 8, "resolution": "720p", "ingredient_media_ids": FIVE_IDS[:4]})
