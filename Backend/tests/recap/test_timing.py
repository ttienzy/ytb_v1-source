"""Test đo thời gian phase của recap job (app.recap.timing + hook trong service).

Chạy: python -m pytest tests/recap/test_timing.py
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime

import pytest

from app.recap import service, state, timing


@pytest.fixture()
def job(tmp_path, monkeypatch):
    monkeypatch.setattr(timing, "timings_path", lambda _id: tmp_path / "timings.json")
    j = state.create_job("https://www.youtube.com/watch?v=abcdefghijk", raw_bytes=b"[0:01] hi", raw_name="raw.txt")
    yield j
    state.delete_job(j.job_id)


def test_timed_records_duration_and_persists(job, tmp_path):
    with timing.timed(job.job_id, "merge"):
        time.sleep(0.05)
    t = state.get_job(job.job_id).timings["merge"]
    assert t["ok"] is True and t["attempts"] == 1
    assert t["duration_sec"] >= 0.05
    datetime.fromisoformat(t["started_at"])
    datetime.fromisoformat(t["ended_at"])
    # persist → rehydrate đọc lại được
    assert json.loads((tmp_path / "timings.json").read_text(encoding="utf-8"))["merge"]["ok"] is True
    assert timing.load(job.job_id)["merge"]["attempts"] == 1


def test_timed_marks_failure_and_resume_increments_attempts(job):
    with pytest.raises(RuntimeError):
        with timing.timed(job.job_id, "cut"):
            raise RuntimeError("x")
    assert state.get_job(job.job_id).timings["cut"]["ok"] is False
    with timing.timed(job.job_id, "cut"):
        pass
    t = state.get_job(job.job_id).timings["cut"]
    assert t["ok"] is True and t["attempts"] == 2


def test_record_total_uses_job_created_at(job):
    timing.record_total(job.job_id)
    t = state.get_job(job.job_id).timings["total"]
    assert t["duration_sec"] >= 0 and t["started_at"] == job.created_at.isoformat()


def test_load_missing_or_corrupt_returns_empty(job, tmp_path):
    assert timing.load(job.job_id) == {}
    (tmp_path / "timings.json").write_text("{not json", encoding="utf-8")
    assert timing.load(job.job_id) == {}


def test_gemini_detail_chunks_ratelimit_and_cookie(job, tmp_path, monkeypatch):
    """_generate_for_job gom số liệu chi tiết từ callback của generate_recap."""
    monkeypatch.setattr(service, "recap_path", lambda _id: tmp_path / "recap.json")
    monkeypatch.setattr(service, "record_job_metadata", lambda *a, **k: None)

    def fake_generate(url, raw, name, prompt_template_path=None, progress_callback=None, status_callback=None):
        status_callback("rate_limited:30")
        status_callback("running")
        status_callback("refreshing_cookie")
        time.sleep(0.02)
        status_callback("running")
        progress_callback(1, 2)
        progress_callback(2, 2)
        return {"scenes": [{"segments": []}], "caption": {"title": "t"}}

    monkeypatch.setattr(service, "generate_recap", fake_generate)
    asyncio.run(service._generate_for_job(job.job_id))
    g = state.get_job(job.job_id).timings["gemini"]
    assert g["ok"] is True
    d = g["detail"]
    assert len(d["chunks"]) == 2
    assert d["rate_limit_wait_sec"] == 30
    assert d["cookie_refresh_sec"] >= 0.0
    assert d["tail_sec"] >= 0.0


def test_job_out_exposes_timings(job):
    from app.recap.router import _to_out

    assert _to_out(state.get_job(job.job_id)).timings is None  # chưa có phase nào
    with timing.timed(job.job_id, "polish"):
        pass
    out = _to_out(state.get_job(job.job_id))
    assert out.timings["polish"]["ok"] is True
