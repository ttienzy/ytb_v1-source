"""Test: (1) logger/Drive-fail, (2) VO dài hơn khung không bị cắt đuôi, (3) resume theo phase.

Chạy: python -m pytest tests/recap/test_resume_and_sync.py
Phần ffmpeg dùng ffmpeg/ffprobe thật (skip nếu thiếu); phần pipeline mock toàn bộ phase nặng.
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.recap import service, state
from app.recap.ffmpeg import build_cut_and_mux_cmd, cut_and_mux_segment, ffprobe_duration

HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="cần ffmpeg + ffprobe trên PATH")


# ── (2) VO dài hơn khung ─────────────────────────────────────────────────────

def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


@pytest.fixture(scope="module")
def media(tmp_path_factory) -> dict[str, Path]:
    if not HAS_FFMPEG:
        pytest.skip("cần ffmpeg")
    d = tmp_path_factory.mktemp("media")
    src = d / "src.mp4"  # 10s, 25fps, không audio
    _run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-t", "10",
          "-c:v", "libx264", "-pix_fmt", "yuv420p", str(src)])
    out = {"src": src}
    for name, secs in (("vo1", 1), ("vo3", 3), ("vo4", 4)):
        wav = d / f"{name}.wav"
        _run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency=440:duration={secs}", str(wav)])
        out[name] = wav
    return out


def _stream_dur(path: Path, kind: str) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", kind, "-show_entries", "stream=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def test_cmd_vo_shorter_keeps_window_without_tpad():
    cmd, dur = build_cut_and_mux_cmd(Path("s.mp4"), 1.0, 3.0, Path("v.wav"), Path("o.mp4"), voice_dur=1.0)
    assert dur == pytest.approx(3.0)
    assert "tpad" not in " ".join(cmd)


def test_cmd_threads_limits_decoder_and_encoder_only_when_requested():
    full, _ = build_cut_and_mux_cmd(Path("s.mp4"), 1.0, 3.0, Path("v.wav"), Path("o.mp4"), voice_dur=1.0)
    limited, _ = build_cut_and_mux_cmd(Path("s.mp4"), 1.0, 3.0, Path("v.wav"), Path("o.mp4"), voice_dur=1.0, threads=3)
    assert "-threads" not in full
    assert limited.count("-threads") == 2  # 1 cho giải mã (trước -i), 1 cho mã hoá
    assert limited.index("-threads") < limited.index("-i")


def test_cmd_vo_longer_extends_to_voice():
    cmd, dur = build_cut_and_mux_cmd(Path("s.mp4"), 1.0, 2.0, Path("v.wav"), Path("o.mp4"), voice_dur=4.0)
    assert dur == pytest.approx(4.0)
    assert "tpad=stop_mode=clone" in " ".join(cmd)


@needs_ffmpeg
def test_vo_longer_than_window_is_not_truncated(media, tmp_path):
    out = tmp_path / "seg.mp4"
    cut_and_mux_segment(media["src"], 1.0, 3.0, media["vo4"], out)  # khung 2s, VO 4s
    assert _stream_dur(out, "a:0") == pytest.approx(4.0, abs=0.15)  # lời còn nguyên
    assert _stream_dur(out, "v:0") == pytest.approx(4.0, abs=0.15)  # hình kéo dài theo


@needs_ffmpeg
def test_vo_shorter_than_window_keeps_full_footage(media, tmp_path):
    out = tmp_path / "seg.mp4"
    cut_and_mux_segment(media["src"], 1.0, 4.0, media["vo1"], out)  # khung 3s, VO 1s
    assert ffprobe_duration(out) == pytest.approx(3.0, abs=0.15)


@needs_ffmpeg
def test_vo_longer_when_source_ends_freezes_last_frame(media, tmp_path):
    out = tmp_path / "seg.mp4"
    # source dài 10s; khung 9.5→10 (0.5s) nhưng VO 3s → hết source, phải giữ khung cuối
    cut_and_mux_segment(media["src"], 9.5, 10.0, media["vo3"], out)
    assert _stream_dur(out, "a:0") == pytest.approx(3.0, abs=0.15)
    assert _stream_dur(out, "v:0") == pytest.approx(3.0, abs=0.2)


# ── (1)+(3) pipeline / resume (mock phase nặng) ──────────────────────────────

@pytest.fixture()
def job():
    j = state.create_job("https://www.youtube.com/watch?v=abcdefghijk", raw_bytes=b"[0:01] hi", raw_name="raw.txt")
    yield j
    state.delete_job(j.job_id)
    service._ACTIVE.pop(j.job_id, None)


@pytest.fixture()
def calls(monkeypatch):
    """Thay mọi phase nặng bằng stub ghi lại thứ tự gọi + set status như bản thật."""
    class Log(list):
        fail: dict = {}

    log = Log()

    async def fake_recap(job_id):
        log.append("recap")
        state.update_job(job_id, recap_status="done", recap={"scenes": [{"segments": [{}]}]})
        return True

    def mk(name, fail=None):
        async def _f(job_id, *a):
            log.append(name)
            if fail and fail.get("on") == name:
                state.update_job(job_id, **{f"{name}_status": "error"}, error=f"{name}: boom")
                raise HTTPException(status_code=502, detail="boom")
            state.update_job(job_id, **{f"{name}_status": "done"})
            return state.get_job(job_id)
        return _f

    fail = log.fail = {}
    monkeypatch.setattr(service, "_stage_recap", fake_recap)
    for n in ("cut", "voice", "merge", "polish"):
        monkeypatch.setattr(service, n, mk(n, fail))

    # Luồng ghép chồng: stub chờ cut/voice xong rồi ghi "merge" như merge() thật (giữ thứ tự gọi trong assert).
    merge_stub = mk("merge", fail)

    async def merge_stream(job_id, cut_t, voice_t):
        pending = [t for t in (cut_t, voice_t) if t is not None]
        if pending:
            await asyncio.wait(pending)
        return await merge_stub(job_id)

    monkeypatch.setattr(service, "_merge_stream", merge_stream)
    monkeypatch.setattr(service, "record_job_failed", lambda *a, **k: None)
    monkeypatch.setattr(service, "record_job_completed", lambda *a, **k: None)
    return log


def test_service_has_logger():
    import logging
    assert isinstance(service.logger, logging.Logger)


def test_drive_failure_does_not_mark_job_error(job, calls, monkeypatch, tmp_path):
    """Bug #1: logger không tồn tại → NameError → job bị đánh dấu error dù video đã xong."""
    out = tmp_path / "final_recap.mp4"
    out.write_bytes(b"x" * 100)
    monkeypatch.setattr(service, "final_path", lambda _id: out)

    async def boom(_p, _job_id):
        raise RuntimeError("drive down")

    monkeypatch.setattr(service, "_backup_studio_video_to_drive", boom)
    asyncio.run(service._run_pipeline(job.job_id, "v1", None))
    j = state.get_job(job.job_id)
    assert j.merge_status == "done"
    assert j.polish_status != "error"
    assert j.error is None


def test_merge_failure_keeps_merge_error_message(job, calls):
    calls.fail["on"] = "merge"
    asyncio.run(service._run_pipeline(job.job_id, "v1", None))
    j = state.get_job(job.job_id)
    assert j.merge_status == "error" and j.error == "merge: boom"
    assert j.polish_status != "error"  # không bị ghi đè bởi lỗi chung "pipeline: ..."


def test_resume_after_voice_error_runs_only_voice_and_merge(job, calls):
    state.update_job(job.job_id, recap_status="done", recap={"scenes": []}, cut_status="done",
                     voice_status="error", error="voice: x", voice_id="v1")

    async def go():
        j = await service.resume_pipeline(job.job_id)
        # Đồng bộ: FE poll ngay sau resume không được thấy "error"
        assert "error" not in (j.recap_status, j.cut_status, j.voice_status, j.merge_status, j.polish_status)
        assert j.error is None
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not asyncio.current_task()])

    asyncio.run(go())
    assert calls == ["voice", "merge"]  # cut đã done → không tải lại video


def test_resume_after_recap_error_reruns_from_recap(job, calls):
    state.update_job(job.job_id, recap_status="error", error="transcript: x", voice_id="v1")

    async def go():
        await service.resume_pipeline(job.job_id)
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not asyncio.current_task()])

    asyncio.run(go())
    assert calls[0] == "recap" and set(calls[1:3]) == {"cut", "voice"} and calls[3] == "merge"


def test_resume_rejected_while_running(job, calls):
    async def go():
        async def forever():
            await asyncio.sleep(30)

        t = asyncio.create_task(forever())
        service._ACTIVE[job.job_id] = t
        try:
            with pytest.raises(HTTPException) as ei:
                await service.resume_pipeline(job.job_id)
            assert ei.value.status_code == 409
        finally:
            t.cancel()

    asyncio.run(go())
    assert calls == []


def test_resume_without_voice_id_asks_for_it(job, calls):
    state.update_job(job.job_id, recap_status="error", voice_id=None)

    async def go():
        with pytest.raises(HTTPException) as ei:
            await service.resume_pipeline(job.job_id)
        assert ei.value.status_code == 400
        j = await service.resume_pipeline(job.job_id, voice_id="v9")
        assert j.voice_id == "v9"
        await asyncio.gather(*[t for t in asyncio.all_tasks() if t is not asyncio.current_task()])

    asyncio.run(go())


def test_resume_when_everything_done_is_noop(job, calls):
    state.update_job(job.job_id, recap_status="done", recap={"scenes": []}, cut_status="done",
                     voice_status="done", merge_status="done")
    asyncio.run(service.resume_pipeline(job.job_id))
    assert calls == []
