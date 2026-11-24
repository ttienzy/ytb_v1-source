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


@pytest.fixture(autouse=True)
def _isolated_config_and_gemini_accounts(tmp_path, monkeypatch):
    """Không test nào được đụng config.json / gemini_accounts.json THẬT của máy dev.

    Migration cookie Gemini cũ ghi lại config.json; trước khi cô lập, một test quên monkeypatch sẽ xóa cookie thật."""
    from app.ai.gemini import accounts
    from app.core import storage

    monkeypatch.setattr(storage.settings, "config_file", tmp_path / "config.json")
    monkeypatch.setattr(accounts, "DATA_DIR", tmp_path)


@pytest.fixture
def gemini_accounts():
    """Nhà máy tài khoản Gemini THẬT trong thư mục tạm: gemini_accounts(2) → [account, account]."""
    from app.ai.gemini.accounts import get_store

    def make(n: int = 1, **fields) -> list[dict]:
        store = get_store()
        out = []
        for i in range(n):
            rec = store.add_account(
                email=fields.get("email", f"acc{i + 1}@example.com") if n == 1 else f"acc{i + 1}@example.com",
                cookies=fields.get("cookies", f"SID=c{i + 1}"), ua="ua", partition=f"/profiles/p{i + 1}")
            out.append(store.get_account(rec["id"]))  # bản đầy đủ (có cookies) — API công khai không bao giờ trả cookie
        return out
    return make
