"""Kho tài khoản Muse + chọn profile cho job (không mở Chrome)."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.ai.muse.accounts import MuseAccountStore
from app.ai.muse.service import MuseService


@pytest.fixture
def store(tmp_path):
    return MuseAccountStore(tmp_path)


def _add(store: MuseAccountStore, tmp_path: Path, vid: str, **kw) -> dict:
    port = kw.pop("cdp_port", None) or store.allocate_port()
    return store.add_account(
        viewer_id=vid,
        cookies="hatch_sess=x",
        ua="UA",
        partition=str(tmp_path / f"p-{vid}"),
        cdp_port=port,
        **kw,
    )


def test_ports_are_unique_and_in_range(store, tmp_path):
    a = _add(store, tmp_path, "111")
    b = _add(store, tmp_path, "222")
    assert a["cdpPort"] == MuseAccountStore.PORT_MIN
    assert b["cdpPort"] == MuseAccountStore.PORT_MIN + 1
    assert store.allocate_port(taken=[MuseAccountStore.PORT_MIN + 2]) == MuseAccountStore.PORT_MIN + 3


def test_same_viewer_updates_instead_of_duplicating(store, tmp_path):
    a = _add(store, tmp_path, "111", label="Tài khoản A")
    store.set_status(a["id"], "error", "hết phiên")
    again = store.add_account(
        viewer_id="111", cookies="hatch_sess=y", ua="UA2", partition=a["partition"], cdp_port=a["cdpPort"]
    )
    assert again["id"] == a["id"]
    assert again["status"] == "active" and again["message"] == ""
    assert again["label"] == "Tài khoản A"
    assert len(store.list_raw()) == 1
    assert store.get_account(a["id"])["cookies"] == "hatch_sess=y"


def test_public_view_hides_cookies(store, tmp_path):
    a = _add(store, tmp_path, "1403441839517615")
    assert "cookies" not in a and "ua" not in a
    assert a["hasSession"] is True
    assert a["label"].endswith("517615")


def test_error_accounts_are_not_rotated(store, tmp_path):
    a = _add(store, tmp_path, "111")
    b = _add(store, tmp_path, "222")
    store.set_status(a["id"], "error", "hết phiên")
    assert [x["id"] for x in store.usable_accounts()] == [b["id"]]
    store.set_status(b["id"], "error", "hết phiên")
    assert store.pick() is None
    # chỉ định thẳng thì vẫn trả về (người dùng tự chọn)
    assert store.pick(a["id"])["id"] == a["id"]


def test_pick_prefers_free_then_least_recently_used(store, tmp_path):
    a = _add(store, tmp_path, "111")
    b = _add(store, tmp_path, "222")
    store.touch(a["id"])  # a vừa dùng -> b được ưu tiên
    assert store.pick()["id"] == b["id"]
    assert store.pick(busy=[b["id"]])["id"] == a["id"]
    # tất cả đều bận -> vẫn trả một tài khoản (job sẽ xếp hàng chờ khóa)
    assert store.pick(busy=[a["id"], b["id"]]) is not None


def test_find_by_partition_is_path_insensitive(store, tmp_path):
    a = _add(store, tmp_path, "111")
    assert store.find_by_partition(a["partition"].upper())["id"] == a["id"]


@pytest.fixture
def service(store, monkeypatch, tmp_path):
    svc = MuseService()
    monkeypatch.setattr(MuseService, "get_store", staticmethod(lambda: store))
    monkeypatch.setattr(svc, "get_config", lambda: {})
    return svc


def test_no_accounts_means_no_job_and_clear_status(service):
    with pytest.raises(RuntimeError, match="Thêm tài khoản Muse"):
        service._job_target()
    st = service.check_status()
    assert st.is_connected is False and "Thêm tài khoản Muse" in st.message


def test_accounts_exist_but_none_usable_raises(service, store, tmp_path):
    a = _add(store, tmp_path, "111")
    store.set_status(a["id"], "error", "hết phiên")
    with pytest.raises(RuntimeError):
        service._job_target()
    # trạng thái thì không lỗi: trả về tài khoản đầu tiên
    assert service._status_target().account_id == a["id"]


def test_job_target_skips_busy_account(service, store, tmp_path):
    a = _add(store, tmp_path, "111")
    b = _add(store, tmp_path, "222")
    lock = service._lock_for(a["id"])
    lock.acquire()
    try:
        assert service._job_target().account_id == b["id"]
    finally:
        lock.release()


def test_unknown_account_id_is_value_error(service):
    with pytest.raises(ValueError):
        service._job_target("khong-co")


def test_list_accounts_shape(service, store, tmp_path):
    _add(store, tmp_path, "111")
    data = service.list_accounts()
    assert set(data) == {"accounts", "active_accounts_count", "total_accounts_count"}
    assert data["accounts"][0]["running"] is False and "legacy" not in data["accounts"][0]


def test_delete_removes_only_profiles_created_by_app(service, store, tmp_path, monkeypatch):
    from app.ai.muse import service as svc_mod

    monkeypatch.setattr(svc_mod, "MUSE_PROFILES_DIR", tmp_path / "muse-profiles")
    own = tmp_path / "muse-profiles" / "muse-1"
    (own / "Default").mkdir(parents=True)
    other = tmp_path / "SomeOtherProfile"
    (other / "Default").mkdir(parents=True)
    a = store.add_account(viewer_id="1", cookies="c", ua="u", partition=str(own), cdp_port=9301)
    b = store.add_account(viewer_id="2", cookies="c", ua="u", partition=str(other), cdp_port=9302)
    assert service.delete_account(a["id"]) and service.delete_account(b["id"])
    assert not own.exists() and other.exists()
    assert store.list_raw() == []


def test_settings_drop_old_chrome_keys_and_enforce_min_timeout(service, monkeypatch):
    from app.ai.muse import service as svc_mod
    from app.ai.muse.schemas import MuseSettingsPayload

    saved = {"muse": {"app_url": "https://muse.ai/", "cdp_port": 9225, "auto_download": True, "is_connected": True,
                      "timeout_seconds": 120}}
    monkeypatch.setattr(svc_mod, "read_config", lambda: saved)
    monkeypatch.setattr(svc_mod, "write_config", lambda cfg: saved.update(cfg))
    monkeypatch.setattr(service, "get_config", lambda: saved["muse"])
    res = service.update_config(MuseSettingsPayload(download_dir="D:/x", timeout_seconds=120, default_prompt_prefix=" cinematic "))
    assert res.timeout_seconds == 600 and res.download_dir == "D:/x" and res.default_prompt_prefix == "cinematic"
    assert not {"app_url", "cdp_port", "auto_download", "is_connected"} & set(saved["muse"])
