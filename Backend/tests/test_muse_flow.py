"""Muse Canvas → Flow: kiểm tra project mở được trên tab Flow (bridge / extension giả, không chạm Flow thật)."""
from datetime import datetime, timezone
from types import SimpleNamespace

from app.workflow import muse_canvas, muse_flow


class FakeClock:
    def __init__(self):
        self.t = 1_000_000.0

    def now(self):
        return self.t

    def sleep(self, s):
        self.t += s


def iso(t):
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat()


class FakeBridge:
    def __init__(self, clock, *, connected=True, tabs_after=None, switch=None):
        self.clock = clock
        self.connected = connected
        self.tabs_after = tabs_after  # tab heartbeat báo SAU khi chuyển (None = chưa có heartbeat mới)
        self.switch = switch if switch is not None else {"ok": True}
        self.switched = []
        self.old_beat = iso(clock.t - 40)  # heartbeat cuối TRƯỚC khi kiểm tra (đứng yên)
        self.pool = {
            "old@x.com": {"credit": 0, "pushed_at": iso(clock.t - 3600)},
            "new@x.com": {"credit": 1200, "pushed_at": iso(clock.t - 60)},
        }

    def is_bridge_running(self):
        return True

    def get_credentials_pool(self):
        return self.pool

    def get_extension_info(self):
        info = {"connected": self.connected, "tabs": [{"url": "https://labs.google/fx/tools/flow"}], "last_heartbeat": self.old_beat}
        if self.switched and self.tabs_after is not None:
            info = {**info, "tabs": self.tabs_after, "last_heartbeat": iso(self.clock.t)}
        return info

    def request_switch_project(self, pid, email=""):
        self.switched.append(pid)
        return "rid1"

    def wait_switch_result(self, rid, timeout=0):
        return self.switch

    def cancel_request(self, rid):
        return True


def setup(monkeypatch, bridge, project=True):
    proj = SimpleNamespace(id="p1", name="Muse 16/11", flow_project_id="flow-abc", account_email="old@x.com") if project else None
    monkeypatch.setattr(muse_flow, "_bridge", lambda: bridge)
    monkeypatch.setattr(muse_flow, "_veo", lambda: SimpleNamespace(get_project=lambda pid: proj))


def test_project_open_on_current_account(monkeypatch):
    clock = FakeClock()
    b = FakeBridge(clock, tabs_after=[{"url": "https://labs.google/fx/tools/flow/project/flow-abc"}])
    setup(monkeypatch, b)
    r = muse_flow.check_project("p1", now=clock.now, sleep=clock.sleep)
    assert r["ok"] is True and r["state"] == "open" and b.switched == ["flow-abc"]
    assert [a["email"] for a in r["accounts"]] == ["new@x.com", "old@x.com"]  # tài khoản mới thấy nhất lên đầu


def test_project_redirected_after_account_switch(monkeypatch):
    clock = FakeClock()
    b = FakeBridge(clock, tabs_after=[{"url": "https://labs.google/fx/tools/flow"}])  # Flow đẩy về trang chủ
    setup(monkeypatch, b)
    r = muse_flow.check_project("p1", now=clock.now, sleep=clock.sleep)
    assert r["ok"] is False and r["state"] == "redirected" and "tài khoản Google" in r["message"]


def test_missing_project_no_extension_unknown_and_switch_failed(monkeypatch):
    clock = FakeClock()
    setup(monkeypatch, FakeBridge(clock), project=False)
    assert muse_flow.check_project("p1", now=clock.now, sleep=clock.sleep)["state"] == "missing"

    b = FakeBridge(clock, connected=False)
    setup(monkeypatch, b)
    r = muse_flow.check_project("p1", now=clock.now, sleep=clock.sleep)
    assert r["state"] == "no_extension" and b.switched == []

    b = FakeBridge(clock, tabs_after=None)  # extension chưa gửi heartbeat mới trong thời gian chờ
    setup(monkeypatch, b)
    start = clock.t
    r = muse_flow.check_project("p1", now=clock.now, sleep=clock.sleep)
    assert r["state"] == "unknown" and clock.t - start >= muse_flow.HEARTBEAT_WAIT_SECONDS

    b = FakeBridge(clock, switch={"ok": False, "error": "Không thể chuyển sang tab project flow-abc"})
    setup(monkeypatch, b)
    assert muse_flow.check_project("p1", now=clock.now, sleep=clock.sleep)["state"] == "redirected"


def test_config_keeps_flow_settings():
    cfg = muse_canvas.MuseCanvasConfig(flow_project_id=" p1 ", flow_aspect="16:9", flow_resolution="360p")
    assert (cfg.flow_project_id, cfg.flow_aspect, cfg.flow_resolution) == ("p1", "16:9", "360p")
    d = muse_canvas.MuseCanvasConfig()
    assert (d.flow_project_id, d.flow_aspect, d.flow_resolution) == ("", "9:16", "720p")
