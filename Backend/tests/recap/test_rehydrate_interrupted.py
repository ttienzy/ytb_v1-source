"""Job sống sót qua restart server: job.json + rehydrate + đánh dấu "bị gián đoạn" + resume.

Bối cảnh: dev `--reload` (và crash) khởi động lại backend giữa lúc job chạy → job biến mất khỏi bộ nhớ, giao diện
hiện "đang chạy" và đồng hồ đứng im mãi. Nay job được dựng lại từ đĩa, báo lỗi rõ ràng và Thử lại chạy tiếp.

Chạy: python -m pytest tests/recap/test_rehydrate_interrupted.py
"""
from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import HTTPException

from app.recap import service, state
from app.recap.router import _overall

URL = "https://www.youtube.com/watch?v=abcdefghijk"
RECAP = {"scenes": [{"segments": [{"vietnamese_vo": "a", "duration_sec": 7.0}, {"vietnamese_vo": "b", "duration_sec": 7.0}]}]}


@pytest.fixture()
def jobs(tmp_path):
    """Dựng thư mục job giả trên đĩa (đường dẫn đã được conftest chuyển vào tmp)."""
    root = tmp_path / "jobs"
    made: list[str] = []

    def make(job_id, *, meta=None, recap=None, raw=None, files=()):
        d = root / job_id
        d.mkdir(parents=True, exist_ok=True)
        if meta is not None:
            (d / "job.json").write_text(json.dumps(meta), encoding="utf-8")
        if recap is not None:
            (d / "recap.json").write_text(json.dumps(recap), encoding="utf-8")
        if raw is not None:
            (d / "raw.txt").write_bytes(raw)
        for f in files:
            (d / f).parent.mkdir(parents=True, exist_ok=True)
            (d / f).write_bytes(b"x")
        made.append(job_id)
        return d

    yield make
    for j in made:
        state._JOBS.pop(j, None)
        service._ACTIVE.pop(j, None)


META = {"youtube_url": URL, "voice_id": "v1", "polish_opts": None, "raw_name": "raw.txt",
        "created_at": "2026-11-11T19:41:23+00:00"}


def test_job_dead_during_gemini_is_rebuilt_as_interrupted(jobs):
    jobs("j1", meta=META, raw=b"[0:01] xin chao")  # chết giữa cookie_check/Gemini: chưa có recap.json
    job = service.rehydrate("j1")
    assert job.youtube_url == URL and job.voice_id == "v1"
    assert job.raw_bytes == b"[0:01] xin chao"  # nạp lại transcript, khỏi fetch lại
    assert job.created_at.isoformat() == "2026-11-11T19:41:23+00:00"  # giờ tạo gốc → đồng hồ không về 0
    assert job.recap_status == "error" and job.error == service.INTERRUPTED_MSG
    assert _overall(job) == "error"  # giao diện thấy lỗi thay vì "đang chạy" mãi


def test_partial_job_marks_first_incomplete_phase(jobs):
    jobs("j2", meta=META, recap=RECAP, files=["source/video.mp4"])  # video có, voice chưa
    job = service.rehydrate("j2")
    assert (job.cut_status, job.voice_status) == ("done", "error")
    assert job.merge_status == "idle" and job.error == service.INTERRUPTED_MSG


def test_finished_job_is_not_flagged(jobs):
    jobs("j3", meta=META, recap=RECAP, files=["final_recap.mp4"])
    job = service.rehydrate("j3")
    assert job.merge_status == "done" and job.error is None and _overall(job) == "merged"


def test_old_finished_job_with_cleaned_intermediates_is_not_flagged(jobs):
    # job cũ: không có job.json, đã xoá source/voice sau khi xong; chỉ còn recap.json + video thành phẩm
    jobs("j4", recap=RECAP, files=["final_studio.mp4"])
    job = service.rehydrate("j4")
    assert job.error is None and _overall(job) == "polished"


def test_pending_polish_is_flagged_only_when_bgm_was_requested(jobs):
    jobs("j5", meta={**META, "polish_opts": {"bgm_paths": ["a.mp3"], "volume": 0.1}}, recap=RECAP, files=["final_recap.mp4"])
    assert service.rehydrate("j5").polish_status == "error"
    jobs("j6", meta=META, recap=RECAP, files=["final_recap.mp4"])  # không yêu cầu BGM → xong rồi
    assert service.rehydrate("j6").polish_status == "idle"


def test_nothing_to_rebuild_returns_none(jobs):
    jobs("j7")  # thư mục rỗng: không job.json, không recap.json
    assert service.rehydrate("j7") is None
    assert service.rehydrate("khong-ton-tai") is None


def test_list_disk_jobs_includes_jobs_without_recap(jobs):
    jobs("a1", meta=META)
    jobs("a2", recap=RECAP)
    jobs("a3")  # rỗng
    got = set(service.list_disk_jobs())
    assert {"a1", "a2"} <= got and "a3" not in got


def test_run_persists_job_meta_immediately(jobs, monkeypatch):
    async def fake_pipeline(*a, **k):
        return None

    monkeypatch.setattr(service, "_run_pipeline", fake_pipeline)
    monkeypatch.setattr(service, "record_job_start", lambda *a, **k: None)

    async def go():
        job_id = await service.run(URL, b"[0:01] hi", "raw.txt", "voice9", {"volume": 0.2})
        await asyncio.sleep(0)
        return job_id

    job_id = asyncio.run(go())
    try:
        meta = json.loads(service.job_meta_path(job_id).read_text(encoding="utf-8"))
        assert meta["youtube_url"] == URL and meta["voice_id"] == "voice9" and meta["polish_opts"] == {"volume": 0.2}
        assert meta["created_at"]
    finally:
        state.delete_job(job_id)


def test_interrupted_job_can_be_resumed_from_failed_phase(jobs, monkeypatch):
    """Sau restart: job chết ở Gemini → Thử lại chạy lại từ recap (dùng raw.txt, đúng giọng), không mất công."""
    jobs("j8", meta=META, raw=b"[0:01] xin chao")
    ran: list[str] = []

    async def fake_recap(job_id):
        ran.append("recap")
        assert state.get_job(job_id).raw_bytes == b"[0:01] xin chao"  # không fetch lại transcript
        state.update_job(job_id, recap_status="done", recap=RECAP)
        return True

    async def fake(name):
        async def _f(job_id, *a):
            ran.append(name)
            state.update_job(job_id, **{f"{name}_status": "done"})
        return _f

    async def go():
        monkeypatch.setattr(service, "_stage_recap", fake_recap)
        for n in ("cut", "voice"):
            monkeypatch.setattr(service, n, await fake(n))

        async def stream(job_id, cut_t, voice_t):
            await asyncio.wait([t for t in (cut_t, voice_t) if t])
            ran.append("merge")
            state.update_job(job_id, merge_status="done")

        monkeypatch.setattr(service, "_merge_stream", stream)
        monkeypatch.setattr(service, "record_job_failed", lambda *a, **k: None)
        monkeypatch.setattr(service, "record_job_completed", lambda *a, **k: None)
        monkeypatch.setattr(service, "_overlap_enabled", lambda: True)
        rebuilt = service.rehydrate("j8")
        assert rebuilt.recap_status == "error"
        j = await service.resume_pipeline("j8")  # voice_id lấy từ job.json, không cần nhập lại
        assert j.error is None and j.recap_status == "running"
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not asyncio.current_task()])

    asyncio.run(go())
    assert ran[0] == "recap" and set(ran[1:3]) == {"cut", "voice"} and ran[3] == "merge"


def test_resume_prefers_saved_voice_over_ui_fallback(jobs, monkeypatch):
    """Job đã đọc dở bằng giọng A: Thử lại không được đổi sang giọng B đang chọn trên giao diện."""
    jobs("j9", meta={**META, "voice_id": "giong-A"}, recap=RECAP, files=["source/video.mp4"])
    seen: list[str] = []

    async def fake_voice(job_id, voice_id):
        seen.append(voice_id)
        state.update_job(job_id, voice_status="done")

    async def fake_stream(job_id, cut_t, voice_t):
        await asyncio.wait([t for t in (cut_t, voice_t) if t])
        state.update_job(job_id, merge_status="done")

    monkeypatch.setattr(service, "voice", fake_voice)
    monkeypatch.setattr(service, "_merge_stream", fake_stream)
    monkeypatch.setattr(service, "_overlap_enabled", lambda: True)
    monkeypatch.setattr(service, "record_job_failed", lambda *a, **k: None)
    monkeypatch.setattr(service, "record_job_completed", lambda *a, **k: None)

    async def go():
        service.rehydrate("j9")
        await service.resume_pipeline("j9", voice_id="giong-B")
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not asyncio.current_task()])

    asyncio.run(go())
    assert seen == ["giong-A"]


def test_resume_old_job_without_saved_voice_uses_ui_fallback(jobs, monkeypatch):
    jobs("j10", recap=RECAP, files=["source/video.mp4"])  # job cũ: không có job.json → không biết giọng
    job = service.rehydrate("j10")
    assert job.voice_id is None
    async def go():
        with pytest.raises(HTTPException) as ei:
            await service.resume_pipeline("j10")
        assert ei.value.status_code == 400  # thiếu giọng → báo rõ
        j = await service.resume_pipeline("j10", voice_id="giong-UI")
        assert j.voice_id == "giong-UI"
        for t in [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]:
            t.cancel()
    monkeypatch.setattr(service, "_run_pipeline", lambda *a, **k: asyncio.sleep(0))
    asyncio.run(go())
