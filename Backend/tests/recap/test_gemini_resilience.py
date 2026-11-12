"""Test độ bền của bước Gemini: phân loại lỗi mạng / auth / rate-limit, timeout, retry vòng ngoài.

Bối cảnh: lỗi mạng thoáng qua (GET /app bị ngắt) từng bị coi là "cookie hết hạn" → mở Chrome refresh →
job Recap mất 10+ phút. Các test dưới dùng httpx.MockTransport (không gọi Gemini thật).

Chạy: python -m pytest tests/recap/test_gemini_resilience.py
"""
from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

import app.ai.gemini.recap as R
from app.recap import service, state

TOKENS_PAGE = '"SNlM0e":"AT","cfb2h":"BL","FdrFJe":"FS"'
UPLOAD_START = "https://push.clients6.google.com/upload/"
UPLOAD_URL = "https://push.clients6.google.com/upload/session-1"


class FakeGemini:
    """Kịch bản phản hồi theo từng endpoint; mỗi lần gọi lấy 1 bước từ plan (hết plan → "ok")."""

    def __init__(self, app_plan=(), stream_plan=()):
        self.app_plan = list(app_plan)
        self.stream_plan = list(stream_plan)
        self.calls = {"app": 0, "stream": 0}

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.startswith("https://gemini.google.com/app"):
            self.calls["app"] += 1
            step = self.app_plan.pop(0) if self.app_plan else "ok"
            if step == "drop":
                raise httpx.RemoteProtocolError("Server disconnected without sending a response.", request=request)
            if step == "500":
                return httpx.Response(503, text="unavailable")
            if step == "noauth":
                return httpx.Response(200, text="<html>Sign in</html>")
            return httpx.Response(200, text=TOKENS_PAGE)
        if url == UPLOAD_START:
            return httpx.Response(200, headers={"x-goog-upload-url": UPLOAD_URL})
        if url == UPLOAD_URL:
            return httpx.Response(200, text="/contrib_service/abc")
        if "StreamGenerate" in url:
            self.calls["stream"] += 1
            step = self.stream_plan.pop(0) if self.stream_plan else "ok"
            if step == "429":
                return httpx.Response(429, text="Too many requests")
            return httpx.Response(200, text='[["wrb.fr"]]')
        return httpx.Response(404)


@pytest.fixture()
def env(monkeypatch):
    """Cài FakeGemini + chặn sleep thật + đếm số lần mở Chrome refresh."""
    sleeps: list[float] = []
    refresh_calls: list[int] = []
    client_kwargs: list[dict] = []
    real_client = httpx.Client
    fake = FakeGemini()

    def make_client(**kw):
        client_kwargs.append(kw)
        return real_client(transport=httpx.MockTransport(fake.handler), **kw)

    monkeypatch.setattr(R.httpx, "Client", make_client)
    monkeypatch.setattr(R.time, "sleep", sleeps.append)
    monkeypatch.setattr(R, "_gemini_config", lambda: {"cookies": "c", "inner_template": [None], "user_agent": "ua"})

    def fake_refresh(*a, **k):
        refresh_calls.append(1)
        return R._gemini_config()

    monkeypatch.setattr(R, "_auto_refresh_cookies", fake_refresh)

    class Env:
        pass

    e = Env()
    e.fake, e.sleeps, e.refresh_calls, e.client_kwargs = fake, sleeps, refresh_calls, client_kwargs
    e.monkeypatch = monkeypatch
    return e


def call(statuses=None):
    return R._call_gemini_stream("prompt", "p.txt", "q", status_callback=(statuses.append if statuses is not None else None))


# ── (1) phân loại lỗi: mạng ≠ cookie ─────────────────────────────────────────

def test_network_blip_on_token_fetch_retries_without_opening_chrome(env):
    env.fake.app_plan = ["drop", "drop"]  # đúng lỗi đã gặp: "Server disconnected"
    statuses: list[str] = []
    assert call(statuses) == '[["wrb.fr"]]'
    assert env.refresh_calls == []  # KHÔNG mở Chrome
    assert env.sleeps == list(R.NET_RETRY_DELAYS)
    assert statuses.count("network_retry") == 2


def test_network_down_raises_transient_not_auth(env):
    env.fake.app_plan = ["drop", "drop", "drop"]
    with pytest.raises(R.GeminiTransientError):
        call()
    assert env.refresh_calls == []


def test_google_5xx_is_transient_not_auth(env):
    env.fake.app_plan = ["500", "500", "500"]
    with pytest.raises(R.GeminiTransientError):
        call()
    assert env.refresh_calls == []


def test_real_auth_failure_refreshes_once_then_succeeds(env):
    env.fake.app_plan = ["noauth"]  # Google trả trang không có token → cookie hết hạn thật
    statuses: list[str] = []
    assert call(statuses) == '[["wrb.fr"]]'
    assert env.refresh_calls == [1]
    assert "refreshing_cookie" in statuses


def test_refresh_failure_raises_auth_error_with_detail(env):
    env.fake.app_plan = ["noauth"]

    def boom(*a, **k):
        env.refresh_calls.append(1)
        raise HTTPException(status_code=504, detail="Chrome không mở CDP")

    env.monkeypatch.setattr(R, "_auto_refresh_cookies", boom)
    with pytest.raises(R.GeminiAuthError, match="Chrome không mở CDP"):
        call()
    assert env.refresh_calls == [1]


def test_still_unauthenticated_after_refresh_stops(env):
    env.fake.app_plan = ["noauth", "noauth"]
    with pytest.raises(R.GeminiAuthError):
        call()
    assert env.refresh_calls == [1]  # refresh đúng 1 lần, không lặp


# ── (2) timeout ngắn cho GET/upload, dài cho stream ─────────────────────────

def test_timeouts_are_short_for_handshake_and_long_for_stream(env):
    # 3 lần thử × 10s + chờ 1s,3s ≈ 34s tối đa (trước: 3×30s + 7s ≈ 97s khi mạng treo)
    assert 3 * R.HTTP_TIMEOUT.read + sum(R.NET_RETRY_DELAYS) < 40
    call()
    assert env.client_kwargs[0]["timeout"] is R.HTTP_TIMEOUT
    assert R.HTTP_TIMEOUT.read == 10.0 and R.HTTP_TIMEOUT.connect == 5.0
    assert R.STREAM_TIMEOUT.read == 180.0  # đợi Gemini sinh nội dung


# ── (3) pre-check cookie ở service ────────────────────────────────────────────

def test_check_cookie_state_ok_auth_network(env):
    assert R.check_cookie_state() == "ok"
    env.fake.app_plan = ["noauth"]
    assert R.check_cookie_state() == "auth"
    env.fake.app_plan = ["drop", "drop", "drop"]
    assert R.check_cookie_state() == "network"


@pytest.fixture()
def job():
    j = state.create_job("https://www.youtube.com/watch?v=abcdefghijk")
    yield j
    state.delete_job(j.job_id)


def test_precheck_network_error_skips_refresh(job, monkeypatch):
    refreshed: list[int] = []
    monkeypatch.setattr(service, "check_cookie_state", lambda: "network")
    monkeypatch.setattr(service, "_auto_refresh_cookies", lambda *a, **k: refreshed.append(1))
    assert service._ensure_gemini_cookie(job.job_id) is True
    assert refreshed == []
    assert state.get_job(job.job_id).recap_status != "error"


def test_precheck_auth_refreshes_and_continues(job, monkeypatch):
    refreshed: list[int] = []
    monkeypatch.setattr(service, "check_cookie_state", lambda: "auth")
    monkeypatch.setattr(service, "_auto_refresh_cookies", lambda *a, **k: refreshed.append(1))
    assert service._ensure_gemini_cookie(job.job_id) is True
    assert refreshed == [1]
    assert state.get_job(job.job_id).recap_status == "running"


def test_precheck_auth_refresh_failure_reports_detail(job, monkeypatch):
    def boom(*a, **k):
        raise HTTPException(status_code=409, detail="Không thể mở Chrome thật")

    monkeypatch.setattr(service, "check_cookie_state", lambda: "auth")
    monkeypatch.setattr(service, "_auto_refresh_cookies", boom)
    assert service._ensure_gemini_cookie(job.job_id) is False
    j = state.get_job(job.job_id)
    assert j.recap_status == "error" and "Không thể mở Chrome thật" in j.error


def test_precheck_missing_config_reports_error(job, monkeypatch):
    def no_cfg():
        raise R.RecapConfigError("Chưa có cookies Gemini")

    monkeypatch.setattr(service, "check_cookie_state", no_cfg)
    assert service._ensure_gemini_cookie(job.job_id) is False
    assert "Chưa có cookies" in state.get_job(job.job_id).error


# ── (4) rate-limit có trần + vòng ngoài không retry lỗi vô ích ──────────────

def test_rate_limit_is_capped_instead_of_looping_forever(env):
    env.fake.stream_plan = ["429"] * 20
    with pytest.raises(R.GeminiRateLimitError, match="giới hạn tốc độ"):
        call()
    assert env.fake.calls["stream"] == R.MAX_RATE_LIMIT_RETRIES + 1
    assert env.sleeps == [30, 45, 60, 60]


GOOD = {"scenes": [{"segments": [{"vietnamese_vo": "Chào cả nhà! Cảm ơn các bạn đã theo dõi, hẹn gặp lại nhé."}]}],
        "chunk_summary_for_next": "x"}


@pytest.fixture()
def outer(monkeypatch, tmp_path):
    """generate_recap với _call_gemini_stream giả (đếm số lần gọi) và parse trả GOOD."""
    sleeps: list[float] = []
    monkeypatch.setattr(R.time, "sleep", sleeps.append)
    monkeypatch.setattr(R, "TOOLS_DIR", tmp_path)  # response.txt không ghi đè file ở repo root
    monkeypatch.setattr(R, "_parse_gemini_response", lambda _t: GOOD)

    class O:
        pass

    o = O()
    o.sleeps, o.calls = sleeps, []
    return o


def gen():
    return R.generate_recap("https://www.youtube.com/watch?v=abcdefghijk", b"[0:01] xin chao\n[0:20] thu nghiem")


def test_outer_loop_does_not_retry_auth_error(outer, monkeypatch):
    def fake(**kw):
        outer.calls.append(1)
        raise R.GeminiAuthError("cookie hỏng")

    monkeypatch.setattr(R, "_call_gemini_stream", lambda *a, **k: fake())
    with pytest.raises(R.GeminiAuthError):
        gen()
    assert len(outer.calls) == 1 and outer.sleeps == []  # trước đây: 3 lần + 3 lần mở Chrome


def test_outer_loop_does_not_retry_rate_limit(outer, monkeypatch):
    def fake():
        outer.calls.append(1)
        raise R.GeminiRateLimitError("429")

    monkeypatch.setattr(R, "_call_gemini_stream", lambda *a, **k: fake())
    with pytest.raises(R.GeminiRateLimitError):
        gen()
    assert len(outer.calls) == 1


def test_outer_loop_retries_transient_with_backoff_then_succeeds(outer, monkeypatch):
    def fake():
        outer.calls.append(1)
        if len(outer.calls) <= 2:
            raise R.GeminiTransientError("mạng đứt")
        return "ok"

    monkeypatch.setattr(R, "_call_gemini_stream", lambda *a, **k: fake())
    out = gen()
    assert out["scenes"]
    assert outer.sleeps[:2] == [2.0, 5.0]
    assert len(outer.calls) >= 3


def test_outer_loop_exhaustion_reports_last_error(outer, monkeypatch):
    def fake():
        outer.calls.append(1)
        raise R.GeminiTransientError("mạng đứt hoài")

    monkeypatch.setattr(R, "_call_gemini_stream", lambda *a, **k: fake())
    with pytest.raises(RuntimeError, match="Lỗi cuối: mạng đứt hoài"):
        gen()
    assert len(outer.calls) == len(R.OUTER_RETRY_DELAYS)
