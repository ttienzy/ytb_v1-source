import tempfile
from pathlib import Path
import pytest
from app.veo import media_registry

@pytest.fixture(autouse=True)
def setup_teardown_registry():
    media_registry.clear_registry_for_test()
    yield
    media_registry.clear_registry_for_test()

def test_compute_file_sha256(tmp_path: Path):
    test_file = tmp_path / "sample.png"
    test_file.write_bytes(b"dummy image data for testing hash")
    h = media_registry.compute_file_sha256(test_file)
    assert isinstance(h, str)
    assert len(h) == 64
    # Cùng nội dung phải sinh cùng hash
    test_file_2 = tmp_path / "sample_copy.png"
    test_file_2.write_bytes(b"dummy image data for testing hash")
    assert media_registry.compute_file_sha256(test_file_2) == h

def test_register_and_get_cached_media_id():
    pid = "flow-proj-alpha"
    fake_hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    
    # Trước khi register
    assert media_registry.get_cached_media_id(pid, fake_hash) is None

    # Sau khi register
    media_registry.register_media(
        project_id=pid,
        file_hash=fake_hash,
        media_id="media-uuid-9999",
        filename="model.png",
        mime_type="image/png",
        kind="image",
    )

    cached_id = media_registry.get_cached_media_id(pid, fake_hash)
    assert cached_id == "media-uuid-9999"

    # Khác project_id thì không bị trùng
    assert media_registry.get_cached_media_id("flow-proj-beta", fake_hash) is None

def test_persistence_reloads():
    pid = "flow-proj-persist"
    fake_hash = "1122334455667788990011223344556677889900112233445566778899001122"
    media_registry.register_media(pid, fake_hash, "media-persistent-123")

    # Xóa cache in-memory để ép đọc từ disk
    media_registry._registry_cache = None
    cached = media_registry.get_cached_media_id(pid, fake_hash)
    assert cached == "media-persistent-123"
