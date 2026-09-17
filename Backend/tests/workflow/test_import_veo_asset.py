import base64
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.workflow.service import (
    WORKFLOW_ASSETS_DIR,
    _parse_image_data,
    import_veo_image_to_workflow,
)


@pytest.fixture
def client():
    return TestClient(app)


def test_import_veo_asset_from_local_file(tmp_path, monkeypatch):
    from app.veo import service as veo_service

    dummy_image = tmp_path / "dummy_veo.jpg"
    dummy_image.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 50)

    monkeypatch.setattr(veo_service, "get_image_file_path", lambda img_id: dummy_image if img_id == "mock_img_1" else None)

    res = import_veo_image_to_workflow("mock_img_1", kind="product")
    assert res.id
    assert res.kind == "product"
    assert res.preview_url == f"/api/workflow/assets/{res.id}"
    assert Path(res.backend_path).exists()
    assert res.size_bytes == len(dummy_image.read_bytes())
    assert res.data_url is not None
    assert res.data_url.startswith("data:image/jpeg;base64,")


def test_import_veo_asset_not_found():
    with pytest.raises(FileNotFoundError, match="Không tìm thấy ảnh"):
        import_veo_image_to_workflow("non_existent_id_999", kind="product")


def test_import_veo_asset_endpoint(client, tmp_path, monkeypatch):
    from app.veo import service as veo_service

    dummy_image = tmp_path / "frame_test.jpg"
    dummy_image.write_bytes(b"\xff\xd8\xff\xe0" + b"\x01" * 60)

    monkeypatch.setattr(veo_service, "get_image_file_path", lambda img_id: dummy_image if img_id == "frame_test_1" else None)

    resp = client.post("/api/workflow/assets/from-veo", json={"image_id": "frame_test_1", "kind": "model"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["kind"] == "model"
    assert data["preview_url"].startswith("/api/workflow/assets/")
    assert Path(data["backend_path"]).exists()
    assert data["data_url"] is not None


def test_parse_image_data_with_workflow_asset_url(tmp_path, monkeypatch):
    # Tạo một asset trong WORKFLOW_ASSETS_DIR
    dummy_asset = WORKFLOW_ASSETS_DIR / "testasset123_photo.jpg"
    dummy_asset.write_bytes(b"\xff\xd8\xff\xe0" + b"\x02" * 40)

    try:
        raw_bytes, name, mime = _parse_image_data("/api/workflow/assets/testasset123")
        assert len(raw_bytes) == len(dummy_asset.read_bytes())
        assert mime == "image/jpeg"
        assert name == dummy_asset.name
    finally:
        dummy_asset.unlink(missing_ok=True)
