import pytest

from app.veo import media_registry


@pytest.fixture(autouse=True)
def _isolated_media_registry(tmp_path, monkeypatch):
    """Không test nào được đụng tới cache media THẬT (Backend/Data/veo_media_registry.json).

    Trước đây `media_registry.clear_registry_for_test()` xóa luôn file thật; app đang chạy restart xong đọc lại cache rỗng
    và tải video tham chiếu lên Flow thêm một bản mới (đã xảy ra 2026-11-23: nhiều bản "subway-outfit-change…" trong project).
    """
    monkeypatch.setattr(media_registry, "_REGISTRY_FILE", tmp_path / "veo_media_registry.json")
    monkeypatch.setattr(media_registry, "_registry_cache", None)
