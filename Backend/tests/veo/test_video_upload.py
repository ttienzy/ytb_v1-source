from unittest.mock import Mock

from app.veo import bridge, media_registry
from app.veo.router import VideoUploadRequest, upload_video_reference


def test_cached_video_is_reused_by_default(monkeypatch):
    monkeypatch.setattr(media_registry, "get_cached_media_id", lambda *_: "cached-media-id")
    dispatch = Mock()
    monkeypatch.setattr(bridge, "request_video_upload", dispatch)

    result = upload_video_reference(VideoUploadRequest(
        project_id="flow-project",
        video_base64="ZmFrZS12aWRlbw==",
        video_filename="reference.mp4",
    ))

    assert result["media_id"] == "cached-media-id"
    assert result["cached"] is True
    dispatch.assert_not_called()


def test_force_fresh_video_bypasses_registry_and_reaches_extension(monkeypatch):
    monkeypatch.setattr(media_registry, "get_cached_media_id", lambda *_: "stale-media-id")
    monkeypatch.setattr(bridge, "get_extension_info", lambda: {"connected": True})
    dispatch = Mock(return_value="upload-request-id")
    monkeypatch.setattr(bridge, "request_video_upload", dispatch)
    monkeypatch.setattr(
        bridge,
        "wait_video_upload_result",
        lambda *_args, **_kwargs: {"ok": True, "media_id": "fresh-media-id", "project_id": "flow-project"},
    )
    register = Mock()
    monkeypatch.setattr(media_registry, "register_media", register)

    result = upload_video_reference(VideoUploadRequest(
        project_id="flow-project",
        video_base64="ZmFrZS12aWRlbw==",
        video_filename="reference.mp4",
        force_fresh=True,
    ))

    assert result["media_id"] == "fresh-media-id"
    assert result["cached"] is False
    dispatch.assert_called_once_with(
        project_id="flow-project",
        video_base64="ZmFrZS12aWRlbw==",
        video_mime="video/mp4",
        video_filename="reference.mp4",
        force_fresh=True,
    )
    register.assert_called_once()
