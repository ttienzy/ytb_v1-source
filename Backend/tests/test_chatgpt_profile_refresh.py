"""Làm mới cookie ChatGPT từ profile Chrome ấm.

Lỗi gốc: Chrome bị TerminateProcess ngay sau khi đăng nhập nên session-token không kịp ghi xuống ổ đĩa; profile "ấm" thực
ra đã đăng xuất và nút làm mới luôn hỏng. Các test dưới đây khóa: tắt Chrome êm trước khi giết cứng, đọc đúng trạng thái
session-token trong DB cookie, và cooldown auto-heal tính riêng từng profile.
"""
from __future__ import annotations

import sqlite3
import subprocess
import time
from pathlib import Path

import pytest

from app.ai.image_gen import service
from app.ai.image_gen.gptimage import autoheal

_EPOCH_US = 11644473600 * 1_000_000


def _chrome_us(unix_seconds: float) -> int:
    return int(unix_seconds * 1_000_000) + _EPOCH_US


def _make_cookie_db(profile: Path, rows: list[tuple[str, str, int]]) -> None:
    db = profile / "Default" / "Network" / "Cookies"
    db.parent.mkdir(parents=True)
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE cookies (host_key TEXT, name TEXT, expires_utc INTEGER)")
    conn.executemany("INSERT INTO cookies VALUES (?, ?, ?)", rows)
    conn.commit()
    conn.close()


def test_session_state_none_without_db(tmp_path):
    assert service.profile_session_cookie_state(tmp_path) is None


def test_session_state_false_when_logged_out(tmp_path):
    # Đúng như profile hỏng thật: chỉ còn csrf-token + callback-url, không có session-token.
    _make_cookie_db(tmp_path, [
        ("chatgpt.com", "__Host-next-auth.csrf-token", 0),
        ("chatgpt.com", "__Secure-next-auth.callback-url", 0),
        (".chatgpt.com", "__cf_bm", _chrome_us(time.time() + 600)),
    ])
    assert service.profile_session_cookie_state(tmp_path) is False


def test_session_state_false_when_token_expired(tmp_path):
    _make_cookie_db(tmp_path, [("chatgpt.com", "__Secure-next-auth.session-token.0", _chrome_us(time.time() - 60))])
    assert service.profile_session_cookie_state(tmp_path) is False


def test_session_state_true_for_chunked_token(tmp_path):
    exp = _chrome_us(time.time() + 86400)
    _make_cookie_db(tmp_path, [
        ("chatgpt.com", "__Secure-next-auth.session-token.0", exp),
        ("chatgpt.com", "__Secure-next-auth.session-token.1", exp),
    ])
    assert service.profile_session_cookie_state(tmp_path) is True


def test_capture_skips_chrome_for_logged_out_profile(tmp_path, monkeypatch):
    _make_cookie_db(tmp_path, [("chatgpt.com", "__Host-next-auth.csrf-token", 0)])
    monkeypatch.setattr(service.subprocess, "Popen", lambda *a, **k: pytest.fail("không được mở Chrome"))
    assert service.chatgpt_capture(str(tmp_path), timeout_seconds=1) is None


class _FakeCdp:
    def __init__(self, log):
        self.log = log

    def send(self, method):
        self.log.append(method)
        raise RuntimeError("Target closed")  # Chrome đóng → kết nối CDP đứt: phải được bỏ qua


class _FakeBrowser:
    def __init__(self, log):
        self.log = log

    def new_browser_cdp_session(self):
        return _FakeCdp(self.log)

    def close(self):
        self.log.append("disconnect")


class _FakeProc:
    def __init__(self, log, exits: bool):
        self.log, self.exits, self.done = log, exits, False

    def wait(self, timeout=None):
        if self.exits or self.done:
            self.done = True
            return 0
        raise subprocess.TimeoutExpired("chrome", timeout)

    def poll(self):
        return 0 if self.done else None

    def terminate(self):
        self.log.append("terminate")
        self.done = True

    def kill(self):
        self.log.append("kill")
        self.done = True


def test_close_gracefully_does_not_kill_when_chrome_exits():
    log: list[str] = []
    assert service.close_chrome_gracefully(_FakeBrowser(log), _FakeProc(log, exits=True), wait_seconds=0.1) is True
    assert log == ["Browser.close", "disconnect"]


def test_close_gracefully_falls_back_to_terminate():
    log: list[str] = []
    assert service.close_chrome_gracefully(_FakeBrowser(log), _FakeProc(log, exits=False), wait_seconds=0.1) is False
    assert log == ["Browser.close", "disconnect", "terminate"]


def test_autoheal_cooldown_is_per_profile(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(service, "chatgpt_capture", lambda p: calls.append(p) or {"cookies": "x"})
    monkeypatch.setattr(autoheal, "_LAST", {})
    assert autoheal.capture("profile-a") == {"cookies": "x"}
    assert autoheal.capture("profile-b") == {"cookies": "x"}  # tài khoản khác không bị chặn bởi cooldown của A
    assert autoheal.capture("profile-a") is None               # cùng profile trong 60 giây → bỏ qua
    assert calls == ["profile-a", "profile-b"]
