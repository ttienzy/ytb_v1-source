"""Tài khoản Gemini kiểu ChatGPT: kho nhiều account, chuyển cookie cũ, xoay khi lỗi, API cài đặt.

Dùng httpx.MockTransport (không gọi Google thật); dữ liệu nằm trong thư mục tạm (tests/conftest.py cô lập).
"""
from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi import HTTPException

import app.ai.gemini.recap as R
from app.ai.gemini import accounts, pool, router as gemini_router, service
from app.core import storage

TOKENS_PAGE = '"SNlM0e":"AT","cfb2h":"BL","FdrFJe":"FS"'


class FakeGoogle:
    """Phản hồi theo COOKIE của tài khoản: {"SID=c1": "noauth" | "429" | "ok"} (mặc định ok)."""

    def __init__(self, by_cookie=None):
        self.by_cookie = dict(by_cookie or {})
        self.used: list[str] = []

    def _mode(self, request):
        cookie = request.headers.get("cookie", "")
        return cookie, self.by_cookie.get(cookie, "ok")

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        cookie, mode = self._mode(request)
        if url.startswith("https://gemini.google.com/app"):
            return httpx.Response(200, text="<html>Sign in</html>" if mode == "noauth" else TOKENS_PAGE)
        if url == "https://push.clients6.google.com/upload/":
            return httpx.Response(200, headers={"x-goog-upload-url": "https://push.clients6.google.com/upload/s"})
        if url == "https://push.clients6.google.com/upload/s":
            return httpx.Response(200, text="/contrib_service/abc")
        if "StreamGenerate" in url:
            self.used.append(cookie)
            if mode == "429":
                return httpx.Response(429, text="Too many requests")
            return httpx.Response(200, text='[["wrb.fr"]]')
        return httpx.Response(404)


@pytest.fixture()
def google(monkeypatch):
    fake = FakeGoogle()
    real = httpx.Client
    sleeps: list[float] = []
    monkeypatch.setattr(R.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(fake.handler), **kw))
    monkeypatch.setattr(R.time, "sleep", sleeps.append)
    fake.sleeps = sleeps
    fake.refreshed: list[str] = []

    def fake_refresh(on_step=None, account_id=None):
        fake.refreshed.append(account_id)
        raise HTTPException(status_code=408, detail="Hết phiên đăng nhập")  # mặc định: làm mới thất bại

    monkeypatch.setattr(R, "_auto_refresh_cookies", fake_refresh)
    return fake


def status_of(account_id):
    return accounts.get_store().get_account(account_id)["status"]


def call():
    return R._call_gemini_stream("prompt", "p.txt", "q")


# ── kho + chuyển cookie cũ ─────────────────────────────────────────────────────

def test_legacy_config_cookie_becomes_first_account_once(monkeypatch):
    cfg = storage.default_config()
    cfg["gemini"].update(cookies="SID=old; SAPISID=x", user_agent="legacy-ua", cookie_count=2)
    storage.write_config(cfg)
    store = accounts.get_store()
    [acc] = store.list_raw()
    assert acc["cookies"] == "SID=old; SAPISID=x" and acc["ua"] == "legacy-ua"
    assert acc["email"] == accounts.LEGACY_LABEL
    assert acc["partition"] == str(accounts.settings.chrome_profile_dir)  # profile cũ → làm mới được, không phải đăng nhập lại
    assert storage.read_config()["gemini"]["cookies"] == ""  # nguồn duy nhất là kho tài khoản

    # xóa hết account thì KHÔNG chuyển lại lần nữa
    store.delete_account(acc["id"])
    assert accounts.get_store().list_raw() == []


def test_config_cookie_is_ignored_once_accounts_exist(gemini_accounts):
    gemini_accounts(1, cookies="SID=real")
    cfg = storage.read_config()
    cfg["gemini"]["cookies"] = "SID=stale-config"
    storage.write_config(cfg)
    assert R._gemini_config()["cookies"] == "SID=real"


def test_add_account_dedupes_by_email_and_prefers_active_then_oldest_use(gemini_accounts):
    a, b = gemini_accounts(2)
    store = accounts.get_store()
    again = store.add_account(email="acc1@example.com", cookies="SID=new", ua="ua", partition="/profiles/other")
    assert again["id"] == a["id"] and len(store.list_raw()) == 2
    store.touch(a["id"])  # a vừa dùng → b (lâu chưa dùng) lên trước
    assert pool.select()[0]["id"] == b["id"]
    store.set_status(b["id"], "error", pool.AUTH_MESSAGE)  # error xếp sau account active
    assert pool.select()[0]["id"] == a["id"]


def test_no_accounts_is_not_logged_in_error_with_add_instruction():
    with pytest.raises(R.GeminiNotLoggedInError, match=r"\(\+\) Thêm account Gemini"):
        R._gemini_config()


# ── xoay tài khoản ─────────────────────────────────────────────────────────────

def test_rate_limited_account_is_skipped_immediately_when_another_is_available(google, gemini_accounts):
    a, b = gemini_accounts(2)
    first = pool.select()[0]
    other = b if first["id"] == a["id"] else a
    google.by_cookie[first["cookies"]] = "429"
    assert call() == '[["wrb.fr"]]'
    assert google.sleeps == []  # có account khác → KHÔNG chờ 30–60 giây
    assert google.used == [first["cookies"], other["cookies"]]
    assert status_of(first["id"]) == "exhausted" and status_of(other["id"]) == "active"


def test_broken_session_falls_over_to_next_account_and_marks_error(google, gemini_accounts):
    a, b = gemini_accounts(2)
    first = pool.select()[0]
    other = b if first["id"] == a["id"] else a
    google.by_cookie[first["cookies"]] = "noauth"
    assert call() == '[["wrb.fr"]]'
    assert google.refreshed == [first["id"]]  # thử làm mới ĐÚNG tài khoản hỏng một lần
    assert status_of(first["id"]) == "error"
    assert status_of(other["id"]) == "active"


def test_all_accounts_broken_raises_auth_error_and_marks_all(google, gemini_accounts):
    a, b = gemini_accounts(2)
    google.by_cookie.update({a["cookies"]: "noauth", b["cookies"]: "noauth"})
    with pytest.raises(R.GeminiAuthError):
        call()
    assert {status_of(a["id"]), status_of(b["id"])} == {"error"}


def test_error_account_with_working_cookie_heals_on_success(google, gemini_accounts):
    [acc] = gemini_accounts(1)
    accounts.get_store().set_status(acc["id"], "error", pool.AUTH_MESSAGE)
    assert call() == '[["wrb.fr"]]'
    assert status_of(acc["id"]) == "active"


def test_single_account_rate_limit_still_waits_instead_of_giving_up(google, gemini_accounts):
    [acc] = gemini_accounts(1)
    google.by_cookie[acc["cookies"]] = "429"
    with pytest.raises(R.GeminiRateLimitError):
        call()
    assert len(google.sleeps) == R.MAX_RATE_LIMIT_RETRIES  # không còn account nào để đổi → chờ như trước
    assert status_of(acc["id"]) == "exhausted"


def test_check_cookie_state_ok_if_any_account_works(google, gemini_accounts):
    a, b = gemini_accounts(2)
    google.by_cookie[pool.select()[0]["cookies"]] = "noauth"
    assert R.check_cookie_state() == "ok"
    google.by_cookie.update({a["cookies"]: "noauth", b["cookies"]: "noauth"})
    assert R.check_cookie_state() == "auth"


def test_analysis_path_also_rotates_accounts(google, gemini_accounts, monkeypatch):
    from app.workflow import service as wf

    a, b = gemini_accounts(2)
    first = pool.select()[0]
    other = b if first["id"] == a["id"] else a
    google.by_cookie[first["cookies"]] = "noauth"
    monkeypatch.setattr(wf, "_auto_refresh_cookies", R._auto_refresh_cookies)
    monkeypatch.setattr(wf, "_extract_answer_text", lambda raw: "câu trả lời")
    monkeypatch.setattr(wf.httpx, "Client", R.httpx.Client)
    text, provider = wf.execute_gemini_analysis("prompt", [])
    assert (text, provider) == ("câu trả lời", "gemini")
    assert status_of(first["id"]) == "error" and status_of(other["id"]) == "active"


# ── thêm / làm mới / xóa account (service) ─────────────────────────────────────

@pytest.fixture()
def fake_session(monkeypatch):
    sessions: list[dict] = []

    def capture(profile_dir, on_step=None, login_timeout=0, visible=True, cdp_port=None):
        sessions.append({"profile": str(profile_dir), "visible": visible, "timeout": login_timeout})
        return {"cookies": "SID=fresh", "cookie_count": 1, "user_agent": "ua-fresh", "email": "me@gmail.com"}

    monkeypatch.setattr(service, "capture_session", capture)
    return sessions


def test_add_account_creates_own_chrome_profile_and_dedupes(fake_session):
    first = service.add_account()
    again = service.add_account()
    store = accounts.get_store()
    assert first["id"] == again["id"] and len(store.list_raw()) == 1  # cùng email = cập nhật, không nhân đôi
    assert first["email"] == "me@gmail.com" and first["hasProfile"]
    assert fake_session[0]["profile"].startswith(str(accounts.profiles_dir())) and fake_session[0]["visible"] is True


def test_refresh_is_background_and_login_again_is_interactive(fake_session, gemini_accounts):
    [acc] = gemini_accounts(1, cookies="SID=old")
    accounts.get_store().set_status(acc["id"], "error", pool.AUTH_MESSAGE)
    service.refresh_account(acc["id"])
    assert fake_session[-1]["visible"] is False and fake_session[-1]["timeout"] == service.REFRESH_LOGIN_TIMEOUT_SECONDS
    got = accounts.get_store().get_account(acc["id"])
    assert got["cookies"] == "SID=fresh" and got["status"] == "active" and got["message"] == ""
    service.refresh_account(acc["id"], interactive=True)
    assert fake_session[-1]["visible"] is True and fake_session[-1]["timeout"] == service.LOGIN_TIMEOUT_SECONDS


def test_refresh_logged_out_profile_marks_account_error(monkeypatch, gemini_accounts):
    [acc] = gemini_accounts(1)

    def logged_out(*a, **k):
        raise HTTPException(status_code=408, detail="Chưa đăng nhập")

    monkeypatch.setattr(service, "capture_session", logged_out)
    with pytest.raises(HTTPException):
        service.refresh_account(acc["id"])
    got = accounts.get_store().get_account(acc["id"])
    assert got["status"] == "error" and "Đăng nhập lại" in got["message"]


def test_delete_removes_app_profile_but_never_the_legacy_profile(tmp_path, gemini_accounts):
    store = accounts.get_store()
    own = accounts.profiles_dir() / "gemini-1"
    own.mkdir(parents=True)
    legacy = tmp_path / "ChromeProfile"
    legacy.mkdir()
    a = store.add_account(email="own@x.com", cookies="SID=1", ua="ua", partition=str(own))
    b = store.add_account(email="old@x.com", cookies="SID=2", ua="ua", partition=str(legacy))
    assert store.delete_account(a["id"]) and not own.exists()
    assert store.delete_account(b["id"]) and legacy.exists()


# ── API cài đặt ────────────────────────────────────────────────────────────────

def test_settings_lists_accounts_with_counts_and_template_source(gemini_accounts):
    a, b = gemini_accounts(2)
    accounts.get_store().set_status(b["id"], "error", pool.AUTH_MESSAGE)
    data = gemini_router.get_settings()
    assert data["total_accounts_count"] == 2 and data["active_accounts_count"] == 1 and data["has_cookie"] is True
    assert {x["status"] for x in data["accounts"]} == {"active", "error"}
    assert data["template_source"] == "bundled"
    assert not any("cookies" in x for x in data["accounts"])  # cookie không bao giờ ra API


def test_login_endpoint_adds_or_relogins(monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(gemini_router, "add_account", lambda: calls.append(("add",)) or {"id": "n"})
    monkeypatch.setattr(gemini_router, "refresh_account",
                        lambda account_id, on_step=None, interactive=False: calls.append(("relogin", account_id, interactive)) or {"id": account_id})
    asyncio.run(gemini_router.login(None))
    asyncio.run(gemini_router.login(gemini_router.LoginRequest(account_id="abc")))
    assert calls == [("add",), ("relogin", "abc", True)]


def test_delete_unknown_account_is_404():
    with pytest.raises(HTTPException) as err:
        gemini_router.delete_account("nope")
    assert err.value.status_code == 404


def test_workflow_refresh_cookie_without_accounts_is_401_with_instruction():
    from app.workflow import router as wf_router

    with pytest.raises(HTTPException) as err:
        asyncio.run(wf_router.refresh_gemini_cookie())
    assert err.value.status_code == 401 and "(+) Thêm account Gemini" in err.value.detail
