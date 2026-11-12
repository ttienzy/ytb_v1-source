"""Test TTS theo lô + merge chạy chồng lên voice (ghép đoạn nào có giọng là ghép ngay).

Chạy: python -m pytest tests/recap/test_voice_merge_pipeline.py
Không gọi voice-service / ffmpeg thật: TTS, cắt-ghép được giả lập; thứ tự sự kiện được kiểm tra.
"""
from __future__ import annotations

import asyncio
import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.recap import service, state, timing


def make_zip(n: int, durations: dict[int, float] | None = None) -> bytes:
    durations = durations or {}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for k in range(n):
            zf.writestr(f"vo_{k}.wav", b"RIFFfakewav%d" % k)
        zf.writestr("manifest.json", json.dumps({"items": [{"index": k, "duration": durations.get(k, 7.0)} for k in range(n)]}))
    return buf.getvalue()


@pytest.fixture()
def env(tmp_path, monkeypatch):
    vdir = tmp_path / "voice"
    monkeypatch.setattr(service, "voice_dir", lambda _id: vdir)
    monkeypatch.setattr(service, "voice_path", lambda _id, i: vdir / f"voice_{i}.wav")
    monkeypatch.setattr(timing, "timings_path", lambda _id: tmp_path / "timings.json")
    monkeypatch.setattr(service, "record_job_failed", lambda *a, **k: None)
    monkeypatch.setattr(service, "record_job_completed", lambda *a, **k: None)

    class E:
        pass

    e = E()
    e.vdir, e.tmp, e.mp = vdir, tmp_path, monkeypatch
    e.jobs = []

    def new_job(n_segs: int, **fields):
        j = state.create_job("https://www.youtube.com/watch?v=abcdefghijk", raw_bytes=b"x", raw_name="raw.txt")
        state.update_job(j.job_id, recap_status="done",
                         recap={"scenes": [{"segments": [{"vietnamese_vo": f"câu {i}", "duration_sec": 7.0} for i in range(n_segs)]}]},
                         **fields)
        e.jobs.append(j.job_id)
        return j

    e.new_job = new_job
    yield e
    for jid in e.jobs:
        state.delete_job(jid)
        service._ACTIVE.pop(jid, None)


def stub_tts(env, fail_on_call: int | None = None, durations=None):
    calls: list[int] = []

    async def fake(items, voice_id):
        calls.append(len(items))
        if fail_on_call is not None and len(calls) == fail_on_call:
            raise RuntimeError("voice-service down")
        return make_zip(len(items), durations)

    env.mp.setattr(service.voice_client, "tts_batch", fake)
    return calls


# ── TTS theo lô ──────────────────────────────────────────────────────────────

def test_voice_runs_in_batches_and_writes_every_file(env):
    job = env.new_job(19)
    calls = stub_tts(env, durations={1: 2.0})  # đoạn 1 chỉ 2s so với 7s → low coverage
    asyncio.run(service.voice(job.job_id, "v1"))
    j = state.get_job(job.job_id)
    assert calls == [8, 8, 3]
    assert sorted(p.name for p in env.vdir.glob("*.wav")) == sorted(f"voice_{i}.wav" for i in range(19))
    assert list(env.vdir.glob("*.part")) == []  # ghi nguyên tử, không để lại file dang dở
    assert j.voice_status == "done" and j.progress_voice["done"] == 19
    # stub áp durations theo chỉ số CỤC BỘ trong lô → local 1 của mỗi lô (0-7, 8-15, 16-18) = toàn cục 1, 9, 17
    assert j.overspeed == [1, 9, 17]
    d = j.timings["voice"]["detail"]
    assert d["batches"] == 3 and d["resumed_batches"] == 0 and d["tts_sec"] >= 0


def test_voice_resume_skips_batches_already_on_disk(env):
    job = env.new_job(19)
    env.vdir.mkdir(parents=True)
    for i in range(8):
        (env.vdir / f"voice_{i}.wav").write_bytes(b"old")
    calls = stub_tts(env)
    asyncio.run(service.voice(job.job_id, "v1"))
    assert calls == [8, 3]  # lô đầu đã có → không TTS lại
    assert (env.vdir / "voice_0.wav").read_bytes() == b"old"  # không ghi đè
    assert state.get_job(job.job_id).timings["voice"]["detail"]["resumed_batches"] == 1


def test_voice_failure_midway_keeps_finished_batches(env):
    job = env.new_job(19)
    stub_tts(env, fail_on_call=2)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(service.voice(job.job_id, "v1"))
    assert ei.value.status_code == 502
    j = state.get_job(job.job_id)
    assert j.voice_status == "error" and "voice-service down" in j.error
    assert len(list(env.vdir.glob("voice_*.wav"))) == 8  # lô 1 còn nguyên → resume không mất công
    assert j.timings["voice"]["ok"] is False


def test_status_from_disk_voice_done_only_when_every_segment_present(env):
    env.vdir.mkdir(parents=True)
    for i in range(3):
        (env.vdir / f"voice_{i}.wav").write_bytes(b"x")
    assert service._status_from_disk("nojob", 8)["voice_status"] == "idle"  # mới có 3/8 (lô dở)
    for i in range(3, 8):
        (env.vdir / f"voice_{i}.wav").write_bytes(b"x")
    assert service._status_from_disk("nojob", 8)["voice_status"] == "done"


# ── Merge chồng lên voice ───────────────────────────────────────────────────

class Harness:
    """Giả lập cut/voice task + ghi lại thứ tự sự kiện để chứng minh merge chạy chồng."""

    def __init__(self, env, n):
        self.env, self.n, self.events = env, n, []
        self.merge_fail_at: int | None = None
        env.mp.setattr(service, "_merge_source", lambda _id: (Path("src.mp4"), 100.0))

        self.throttle: dict[int, bool] = {}

        def one(job_id, i, seg, source, source_dur, throttle=False):
            if self.merge_fail_at == i:
                raise RuntimeError("ffmpeg cut_and_mux thất bại")
            self.events.append(f"merge{i}")
            self.throttle[i] = throttle
            return 0.01

        env.mp.setattr(service, "_merge_one_segment", one)
        env.mp.setattr(service, "_concat_all", lambda job_id, n_: self.events.append("concat"))

    async def cut(self, delay=0.05, fail=False):
        await asyncio.sleep(delay)
        if fail:
            raise RuntimeError("yt-dlp lỗi")

    async def voice(self, job_id, gap=0.8, fail_after_first_batch=False):
        self.env.vdir.mkdir(parents=True, exist_ok=True)
        half = self.n // 2
        for i in range(half):
            (self.env.vdir / f"voice_{i}.wav").write_bytes(b"x")
        self.events.append("voice_batch1_done")
        await asyncio.sleep(gap)
        if fail_after_first_batch:
            raise RuntimeError("voice-service down")
        for i in range(half, self.n):
            (self.env.vdir / f"voice_{i}.wav").write_bytes(b"x")
        self.events.append("voice_batch2_done")


def test_merge_stream_merges_early_segments_before_tts_finishes(env):
    job = env.new_job(8, cut_status="running", voice_status="running")
    h = Harness(env, 8)

    async def go():
        cut_t = asyncio.ensure_future(h.cut())
        voice_t = asyncio.ensure_future(h.voice(job.job_id))
        await asyncio.gather(cut_t, voice_t, service._merge_stream(job.job_id, cut_t, voice_t))

    asyncio.run(go())
    ev = h.events
    # 4 đoạn đầu được ghép TRƯỚC khi lô TTS thứ 2 xong → thật sự chồng
    assert ev.index("merge3") < ev.index("voice_batch2_done")
    assert ev[-1] == "concat" and ev.count("concat") == 1
    assert [e for e in ev if e.startswith("merge")] == [f"merge{i}" for i in range(8)]  # đúng thứ tự
    # TTS còn chạy khi ghép 4 đoạn đầu → nhường CPU (throttle); TTS xong rồi thì chạy hết tốc lực
    assert [h.throttle[i] for i in range(4)] == [True] * 4
    assert [h.throttle[i] for i in range(4, 8)] == [False] * 4
    j = state.get_job(job.job_id)
    assert j.merge_status == "done" and j.progress_merge == {"done": 8, "total": 8}
    assert j.timings["merge"]["detail"]["segments"] == 8


def test_merge_stream_aborts_quietly_when_voice_fails(env):
    job = env.new_job(8, cut_status="running", voice_status="running")
    h = Harness(env, 8)

    async def go():
        cut_t = asyncio.ensure_future(h.cut())
        voice_t = asyncio.ensure_future(h.voice(job.job_id, gap=0.2, fail_after_first_batch=True))
        return await asyncio.gather(cut_t, voice_t, service._merge_stream(job.job_id, cut_t, voice_t), return_exceptions=True)

    res = asyncio.run(go())
    assert isinstance(res[1], RuntimeError) and res[2] is None  # chỉ voice lỗi; luồng merge dừng êm, không ném lỗi
    assert [e for e in h.events if e.startswith("merge")] == ["merge0", "merge1", "merge2", "merge3"]  # đã ghép phần có giọng
    assert "concat" not in h.events
    assert state.get_job(job.job_id).merge_status == "idle"  # không để kẹt "running"


def test_merge_stream_does_nothing_when_cut_fails(env):
    job = env.new_job(8, cut_status="running", voice_status="running")
    h = Harness(env, 8)

    async def go():
        cut_t = asyncio.ensure_future(h.cut(fail=True))
        voice_t = asyncio.ensure_future(h.voice(job.job_id, gap=0.05))
        return await asyncio.gather(cut_t, voice_t, service._merge_stream(job.job_id, cut_t, voice_t), return_exceptions=True)

    res = asyncio.run(go())
    assert isinstance(res[0], RuntimeError) and res[2] is None
    assert [e for e in h.events if e.startswith("merge") or e == "concat"] == []
    assert state.get_job(job.job_id).merge_status == "idle"


def test_merge_stream_ffmpeg_error_sets_merge_error(env):
    job = env.new_job(8, cut_status="running", voice_status="running")
    h = Harness(env, 8)
    h.merge_fail_at = 2

    async def go():
        cut_t = asyncio.ensure_future(h.cut())
        voice_t = asyncio.ensure_future(h.voice(job.job_id, gap=0.05))
        return await asyncio.gather(cut_t, voice_t, service._merge_stream(job.job_id, cut_t, voice_t), return_exceptions=True)

    res = asyncio.run(go())
    assert isinstance(res[2], HTTPException) and res[2].status_code == 502
    j = state.get_job(job.job_id)
    assert j.merge_status == "error" and j.error.startswith("merge: ffmpeg")
    assert j.timings["merge"]["ok"] is False


# ── Điều phối thật (_run_pipeline_stages) với luồng merge thật ──────────────

def test_pipeline_overlaps_merge_with_voice_end_to_end(env):
    job = env.new_job(8)
    h = Harness(env, 8)

    async def fake_cut(job_id):
        await h.cut()
        state.update_job(job_id, cut_status="done")

    async def fake_voice(job_id, voice_id):
        state.update_job(job_id, voice_status="running")
        await h.voice(job_id)
        state.update_job(job_id, voice_status="done")

    env.mp.setattr(service, "cut", fake_cut)
    env.mp.setattr(service, "voice", fake_voice)
    asyncio.run(service._run_pipeline(job.job_id, "v1", None))
    ev = h.events
    assert ev.index("merge3") < ev.index("voice_batch2_done")
    assert ev[-1] == "concat"
    j = state.get_job(job.job_id)
    assert (j.cut_status, j.voice_status, j.merge_status) == ("done", "done", "done")
    assert "total" in j.timings  # video xong → chốt tổng thời gian


def test_pipeline_voice_failure_stops_before_final_concat(env):
    job = env.new_job(8)
    h = Harness(env, 8)

    async def fake_cut(job_id):
        await h.cut()
        state.update_job(job_id, cut_status="done")

    async def fake_voice(job_id, voice_id):
        state.update_job(job_id, voice_status="running")
        try:
            await h.voice(job_id, gap=0.2, fail_after_first_batch=True)
        except RuntimeError as exc:
            state.update_job(job_id, voice_status="error", error=f"voice: {exc}")
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    env.mp.setattr(service, "cut", fake_cut)
    env.mp.setattr(service, "voice", fake_voice)
    asyncio.run(service._run_pipeline(job.job_id, "v1", None))
    j = state.get_job(job.job_id)
    assert j.voice_status == "error" and j.merge_status == "idle"
    assert "concat" not in h.events and "total" not in j.timings


# ── Công tắc chồng/tuần tự (máy yếu) ────────────────────────────────────────

def test_overlap_enabled_env_override_and_cpu_default(monkeypatch):
    monkeypatch.delenv("RECAP_OVERLAP_MERGE", raising=False)
    monkeypatch.setattr(service.os, "cpu_count", lambda: 4)
    assert service._overlap_enabled() is False  # máy ít nhân: mặc định tuần tự
    monkeypatch.setattr(service.os, "cpu_count", lambda: 16)
    assert service._overlap_enabled() is True
    monkeypatch.setenv("RECAP_OVERLAP_MERGE", "0")
    assert service._overlap_enabled() is False  # ép tắt dù nhiều nhân
    monkeypatch.setattr(service.os, "cpu_count", lambda: 2)
    monkeypatch.setenv("RECAP_OVERLAP_MERGE", "1")
    assert service._overlap_enabled() is True  # ép bật dù ít nhân
    monkeypatch.setenv("RECAP_OVERLAP_MERGE", "abc")  # giá trị lạ → quay về mặc định theo CPU
    assert service._overlap_enabled() is False


def test_pipeline_runs_merge_after_voice_when_overlap_disabled(env):
    job = env.new_job(8)
    h = Harness(env, 8)
    env.mp.setattr(service, "_overlap_enabled", lambda: False)

    async def boom(*a, **k):
        raise AssertionError("không được dùng luồng merge chồng khi đã tắt")

    async def fake_cut(job_id):
        await h.cut()
        state.update_job(job_id, cut_status="done")

    async def fake_voice(job_id, voice_id):
        state.update_job(job_id, voice_status="running")
        await h.voice(job_id, gap=0.05)
        state.update_job(job_id, voice_status="done")

    async def fake_merge(job_id):
        h.events.append("standalone_merge")
        state.update_job(job_id, merge_status="done")

    env.mp.setattr(service, "_merge_stream", boom)
    env.mp.setattr(service, "cut", fake_cut)
    env.mp.setattr(service, "voice", fake_voice)
    env.mp.setattr(service, "merge", fake_merge)
    asyncio.run(service._run_pipeline(job.job_id, "v1", None))
    assert h.events == ["voice_batch1_done", "voice_batch2_done", "standalone_merge"]  # tuần tự như cũ
    assert state.get_job(job.job_id).merge_status == "done"
