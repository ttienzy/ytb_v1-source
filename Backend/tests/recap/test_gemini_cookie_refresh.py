"""Test luồng lấy lại cookie Gemini qua Chrome (login_and_save_cookie) — Chrome/Playwright được giả lập.

Mục tiêu: thất bại SỚM và đúng lý do (trước đây chờ 30s/60s rồi báo chung chung), chỉ lưu cookie đã kiểm tra
dùng được, và báo từng bước để giao diện không "đứng im".

Chạy: python -m pytest tests/recap/test_gemini_cookie_refresh.py
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.ai.gemini import service as G
from app.recap import service as S
from app.recap import state

SID = {"name": "SID", "value": "abc"}


class FakePage:
    def __init__(self, url="https://gemini.google.com/app"):
        self.url = url

    def evaluate(self, _js):
        return "Mozilla/5.0 FakeUA"

    def goto(self, url):
        self.url = url


class FakeContext:
    def __init__(self, cookies, pages):
        self._cookies, self.pages = cookies, pages

    def cookies(self, _urls):
        return list(self._cookies)


class FakeBrowser:
    def __init__(self, ctx):
        self.contexts = [ctx]

    def close(self):
        pass


class FakePlaywright:
    def __init__(self, browser):
        self.chromium = self
        self._browser = browser

    def connect_over_cdp(self, _url):
        return self._browser

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeProc:
    def __init__(self, exited: bool):
        self._exited = exited
        self.terminated = False

    def poll(self):
        return 1 if self._exited else None

    def terminate(self):
        self.terminated = True

    def wait(self, timeout=None):
        return 0

    def kill(self):
        pass


class Resp:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture()
def chrome(monkeypatch, tmp_path):
    """Dựng Chrome giả; trả về object cấu hình được (cookie, trang, proc đã thoát?, CDP lên?)."""
    exe = tmp_path / "chrome.exe"
    exe.write_text("x")
    monkeypatch.setattr(G.settings, "chrome_executable", exe)
    monkeypatch.setattr(G.settings, "chrome_profile_dir", tmp_path / "profile")
    monkeypatch.setattr(G.time, "sleep", lambda s: None)  # không chờ thật

    class C:
        cookies = [SID]
        pages = [FakePage()]
        proc_exited = False
        cdp_up = True
        valid: bool | None = True
        saved: dict = {}
        urlopen_calls = 0

    c = C()
    c.proc = None

    def popen(*a, **k):
        c.proc = FakeProc(c.proc_exited)
        return c.proc

    def urlopen(url, timeout=None):
        c.urlopen_calls += 1
        if not c.cdp_up:
            raise OSError("refused")
        return Resp()

    monkeypatch.setattr(G.subprocess, "Popen", popen)
    monkeypatch.setattr(G.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(G, "sync_playwright", lambda: FakePlaywright(FakeBrowser(FakeContext(c.cookies, c.pages))))
    monkeypatch.setattr(G, "_session_valid", lambda header, ua: c.valid)
    monkeypatch.setattr(G, "read_config", lambda: {"gemini": {}})
    monkeypatch.setattr(G, "write_config", lambda cfg: c.saved.update(cfg["gemini"]))
    return c


def run(**kw):
    steps: list[str] = []
    try:
        res = G.login_and_save_cookie(on_step=steps.append, **kw)
        return res, steps, None
    except HTTPException as exc:
        return None, steps, exc


def test_happy_path_saves_verified_cookie_and_reports_steps(chrome):
    res, steps, err = run()
    assert err is None and res["ok"] and res["cookie_count"] == 1
    assert chrome.saved["cookies"] == "SID=abc" and chrome.saved["user_agent"] == "Mozilla/5.0 FakeUA"
    assert steps == ["Mở Chrome (profile Gemini)", "Kết nối Chrome", "Đọc phiên đăng nhập", "Lưu cookie"]
    assert chrome.proc.terminated  # luôn đóng Chrome do mình mở


def test_chrome_exits_immediately_fails_fast_with_clear_reason(chrome):
    chrome.proc_exited, chrome.cdp_up = True, False
    _, _, err = run()
    assert err.status_code == 409 and "Chrome tắt ngay" in err.detail
    assert chrome.urlopen_calls == 1  # trước đây: 30 vòng chờ ≈ 30s rồi mới báo lỗi


def test_existing_chrome_instance_is_reused_when_new_process_exits(chrome):
    # Tiến trình mới thoát (giao việc cho Chrome đang chạy) nhưng CDP vẫn lên → vẫn dùng được, không báo "bị đóng"
    chrome.proc_exited, chrome.cdp_up = True, True
    res, _, err = run()
    assert err is None and res["ok"]


def test_cdp_never_opens_times_out_with_clear_message(chrome):
    chrome.cdp_up = False  # proc vẫn sống nhưng không mở cổng debug
    chrome.proc_exited = False
    clock = iter(range(0, 1000, 5))  # mỗi lần gọi monotonic tiến 5s → hết 20s sau vài vòng
    chrome_time = G.time
    orig = chrome_time.monotonic
    try:
        chrome_time.monotonic = lambda: next(clock)
        _, _, err = run()
    finally:
        chrome_time.monotonic = orig
    assert err.status_code == 504 and "không mở CDP" in err.detail


def test_not_logged_in_waits_for_user_then_reports_login_hint(chrome):
    chrome.cookies = []  # profile chưa đăng nhập
    chrome.pages = [FakePage("https://accounts.google.com/signin")]
    res, steps, err = run(login_timeout=0)
    assert err.status_code == 408 and "Cài đặt → Đăng nhập Gemini" in err.detail
    assert any(s.startswith("Chưa đăng nhập: hãy đăng nhập Google trong cửa sổ Chrome (còn 0s)") for s in steps)


def test_stale_cookie_is_not_saved(chrome):
    chrome.valid = False  # có cookie nhưng Google không nhận (hết hạn/đã đăng xuất)
    res, steps, err = run(login_timeout=0)
    assert err.status_code == 408 and chrome.saved == {}  # KHÔNG lưu cookie hỏng (trước đây vẫn lưu rồi pipeline lỗi)
    assert any("Chờ Gemini xác nhận phiên đăng nhập" in s for s in steps)


def test_unknown_validity_due_to_network_does_not_block(chrome):
    chrome.valid = None  # không kiểm tra được (mạng) → vẫn lưu, để bước gọi Gemini báo lỗi mạng rõ ràng
    res, _, err = run()
    assert err is None and res["ok"] and chrome.saved["cookies"] == "SID=abc"


def test_chrome_closed_by_user_midway_is_reported(chrome):
    chrome.cookies = []
    chrome.pages = [FakePage("https://accounts.google.com/signin")]

    calls = {"n": 0}
    orig_poll = FakeProc.poll

    def poll(self):
        calls["n"] += 1
        return None if calls["n"] <= 2 else 1  # sống lúc khởi động, bị đóng khi đang chờ đăng nhập

    FakeProc.poll = poll
    try:
        _, _, err = run(login_timeout=30)
    finally:
        FakeProc.poll = orig_poll
    assert err.status_code == 408 and "đã bị đóng" in err.detail


# ── Báo bước lên giao diện ──────────────────────────────────────────────────

@pytest.fixture()
def job():
    j = state.create_job("https://www.youtube.com/watch?v=abcdefghijk")
    yield j
    state.delete_job(j.job_id)


def test_set_cookie_step_sets_and_clears_progress(job):
    S._set_cookie_step(job.job_id, "Mở Chrome (profile Gemini)")
    p = state.get_job(job.job_id).progress_recap
    assert p["phase"] == "cookie" and p["step"] == "Mở Chrome (profile Gemini)"
    S._set_cookie_step(job.job_id, None)
    p = state.get_job(job.job_id).progress_recap
    assert "step" not in p and p["phase"] == "chunk_llm"


def test_precheck_refresh_reports_steps_then_clears(job, monkeypatch):
    seen: list[str | None] = []

    def fake_refresh(on_step=None):
        on_step("Mở Chrome (profile Gemini)")
        seen.append(state.get_job(job.job_id).progress_recap.get("step"))
        on_step("Lưu cookie")
        seen.append(state.get_job(job.job_id).progress_recap.get("step"))

    monkeypatch.setattr(S, "check_cookie_state", lambda: "auth")
    monkeypatch.setattr(S, "_auto_refresh_cookies", fake_refresh)
    assert S._ensure_gemini_cookie(job.job_id) is True
    assert seen == ["Mở Chrome (profile Gemini)", "Lưu cookie"]  # bước hiện trong lúc refresh
    assert "step" not in state.get_job(job.job_id).progress_recap  # xong thì xoá


def test_precheck_refresh_failure_clears_step(job, monkeypatch):
    def fake_refresh(on_step=None):
        on_step("Chưa đăng nhập: hãy đăng nhập Google trong cửa sổ Chrome (còn 50s)")
        raise HTTPException(status_code=408, detail="Chưa đăng nhập được Gemini sau 60 giây.")

    monkeypatch.setattr(S, "check_cookie_state", lambda: "auth")
    monkeypatch.setattr(S, "_auto_refresh_cookies", fake_refresh)
    assert S._ensure_gemini_cookie(job.job_id) is False
    j = state.get_job(job.job_id)
    assert "step" not in j.progress_recap and "Chưa đăng nhập được Gemini" in j.error
