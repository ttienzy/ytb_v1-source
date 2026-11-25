"""Unit tests cho gói gia cố Recap YouTube (P0 + P1 + P2)."""
from __future__ import annotations

import asyncio
import io
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import httpx
import pytest

import app.ai.gemini.recap as R
from app.recap import service, state
from app.recap.ffmpeg import build_smart_bgm_chain, cut_and_mux_segment
from app.recap.merger import validate_timestamp_integrity
from app.recap.router import _overall

HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def _make_zip(n: int) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for k in range(n):
            zf.writestr(f"vo_{k}.wav", b"RIFFfakewav")
        zf.writestr("manifest.json", json.dumps({"items": [{"index": k, "duration": 2.0} for k in range(n)]}))
    return buf.getvalue()


# ── 1) Gemini HTTP 400 / ["er"] -> GeminiAuthError + failover sang tài khoản #2 ──

def test_gemini_400_error_frame_triggers_auth_failover(monkeypatch, gemini_accounts):
    from app.ai.gemini import pool

    gemini_accounts(2)
    seen_cookies: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        ck = request.headers.get("Cookie", "")
        if url.startswith("https://gemini.google.com/app"):
            return httpx.Response(200, text='"SNlM0e":"AT","cfb2h":"BL","FdrFJe":"FS"')
        if "push.clients6.google.com" in url:
            if request.headers.get("x-goog-upload-command") == "start":
                return httpx.Response(200, headers={"x-goog-upload-url": "https://push.clients6.google.com/upload/s1"})
            return httpx.Response(200, text="/contrib_service/ok")
        if "StreamGenerate" in url:
            seen_cookies.append(ck)
            if len(seen_cookies) <= 2:
                # Account 1: HTTP 400 kèm frame ["er"] (kể cả sau refresh 1 lần)
                return httpx.Response(400, text=')]}\'\n\n102\n[["er",null,null,null,null,400]]\n')
            return httpx.Response(200, text='[["wrb.fr"]]')
        return httpx.Response(404)

    real_client = httpx.Client
    monkeypatch.setattr(R.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R, "_auto_refresh_cookies", lambda *a, **k: R._gemini_config())

    out = R._call_gemini_stream("prompt", "p.txt", "q")
    assert out == '[["wrb.fr"]]'
    assert len(seen_cookies) == 3
    assert seen_cookies[0] != seen_cookies[2]
    assert any(a["status"] == "error" for a in pool.get_store().list_raw())


# ── 2) Per-chunk checkpoint skips saved chunk_0.json on re-run ─────────────────

def test_chunk_checkpoint_reuses_saved_chunk_on_resume(tmp_path, monkeypatch):
    ckpt_dir = tmp_path / "chunks"
    calls: list[str] = []

    # Transcript dài ~15 phút -> chia >= 2 chunks
    raw_lines = [f"[{s // 60}:{s % 60:02d}] Line {s}" for s in range(0, 950, 30)]
    raw_bytes = "\n".join(raw_lines).encode("utf-8")

    # Lưu sẵn chunk_0.json hợp lệ
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    (ckpt_dir / "chunk_0.json").write_text(
        json.dumps({
            "chunk_index": 0,
            "chunk_summary_for_next": "summary 0",
            "scenes": [{"scene_title": "S0", "segments": [{"start_time_sec": 0, "end_time_sec": 10, "vietnamese_vo": "Đoạn mở đầu"}]}],
        }),
        encoding="utf-8",
    )

    def fake_stream(prompt_text, filename, query_text="", status_callback=None, **kw):
        calls.append(filename)
        if filename == "caption_prompt.txt":
            payload = json.dumps({"title": "Video test", "description": "desc", "hashtags": ["#food"]})
        else:
            payload = json.dumps({
                "chunk_index": 1,
                "scenes": [{"scene_title": "S1", "segments": [{"start_time_sec": 500, "end_time_sec": 510, "vietnamese_vo": "Đoạn tiếp theo"}]}],
            })
        return json.dumps([["wrb.fr", None, json.dumps([None, None, None, None, [[0, [payload]]]])]])

    monkeypatch.setattr(R, "_call_gemini_stream", fake_stream)
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)

    out = R.generate_recap(
        "https://www.youtube.com/watch?v=abcdefghijk",
        raw_bytes,
        script_prompt="{{video_url}}{{chunk_index}}{{total_chunks}}{{chunk_start_sec}}{{chunk_end_sec}}{{is_first_chunk}}{{is_last_chunk}}{{previous_chunk_summary}}{{target_segments_min}}{{target_segments_max}}{{raw_text}}",
        caption_prompt="{{scene_titles_joined_by_newline}}",
        checkpoint_dir=ckpt_dir,
    )
    assert "chunk_0_prompt.txt" not in calls
    assert "chunk_1_prompt.txt" in calls
    assert (ckpt_dir / "chunk_1.json").is_file()
    assert len(out["scenes"]) == 2


# ── 3) Sanitize chunk + timestamp integrity drop empty VO & fix inverted times ──

def test_sanitize_and_validate_drops_empty_vo_and_clamps_inverted_timestamps():
    cleaned = R._sanitize_chunk_output({
        "scenes": [
            {"scene_title": "A", "segments": [{"start_time_sec": -2, "end_time_sec": -5, "vietnamese_vo": "  Lời chuẩn  "}, {"start_time_sec": 5, "end_time_sec": 9, "vietnamese_vo": "   "}]},
            {"scene_title": "EmptyScene", "segments": [{"start_time_sec": 10, "end_time_sec": 12, "vietnamese_vo": ""}]},
        ]
    })
    assert cleaned is not None and len(cleaned["scenes"]) == 1
    assert len(cleaned["scenes"][0]["segments"]) == 1

    scenes = cleaned["scenes"]
    validate_timestamp_integrity(scenes)
    seg = scenes[0]["segments"][0]
    assert seg["start_time_sec"] == 0.0
    assert seg["end_time_sec"] == 0.5
    assert seg["duration_sec"] == 0.5


# ── 4 & 5) FFmpeg: corrupt BGM rejected, valid multi-BGM + atomic cut_and_mux ───

@pytest.mark.skipif(not HAS_FFMPEG, reason="cần ffmpeg + ffprobe trên PATH")
def test_ffmpeg_bgm_guard_and_atomic_yuv420p_cut_and_mux(tmp_path):
    bad_bgm = tmp_path / "bad.mp3"
    bad_bgm.write_bytes(b"not-a-valid-mp3")
    with pytest.raises(RuntimeError, match="Không đọc được thời lượng"):
        build_smart_bgm_chain([bad_bgm], 30.0, tmp_path / "chain_bad.mp3", tmp_path)

    # Tạo 2 BGM ngắn hợp lệ (1.5s mỗi bài) -> nối thành chain phủ > 15s (không treo, re-encode mp3 chuẩn)
    b1 = tmp_path / "b1.wav"
    b2 = tmp_path / "b2.mp3"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", str(b1)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=1.5", str(b2)], check=True, capture_output=True)
    chain = build_smart_bgm_chain([b1, b2], 5.0, tmp_path / "bgm_chain.mp3", tmp_path)
    assert chain.is_file() and chain.stat().st_size > 1000
    assert not (tmp_path / "bgm_chain.part.mp3").exists()

    # Atomic cut_and_mux_segment + chuẩn yuv420p / 48kHz stereo
    src = tmp_path / "src.mp4"
    vo = tmp_path / "vo.wav"
    out = tmp_path / "seg_0.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(src)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=1.2", str(vo)], check=True, capture_output=True)
    cut_and_mux_segment(src, 0.5, 2.0, vo, out)
    assert out.is_file() and out.stat().st_size > 1000
    assert not (tmp_path / "seg_0.part.mp4").exists()

    probe = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,pix_fmt,sample_rate,channels", "-of", "json", str(out)],
        text=True,
    ))
    v_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    a_stream = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    assert v_stream["pix_fmt"] == "yuv420p"
    assert a_stream["sample_rate"] == "48000" and a_stream["channels"] == 2


# ── 6) VoiceBusyError (429) retries smoothly + _sanitize_vo_text ───────────────

def test_voice_retries_on_voice_busy_and_sanitizes_text(monkeypatch):
    j = state.create_job("https://www.youtube.com/watch?v=abcdefghijk", raw_bytes=b"x", raw_name="raw.txt")
    state.update_job(
        j.job_id,
        recap_status="done",
        recap={"scenes": [{"segments": [{"vietnamese_vo": "  **Xin chào**\u200b thế giới!  ", "duration_sec": 3.0}]}]},
    )
    attempts = {"n": 0}
    seen_texts: list[str] = []

    async def fake_tts_batch(items, voice_id):
        attempts["n"] += 1
        seen_texts.append(items[0]["text"])
        if attempts["n"] <= 2:
            raise service.voice_client.VoiceBusyError("busy 429")
        return _make_zip(len(items))

    sleeps: list[float] = []

    async def fake_sleep(sec):
        sleeps.append(sec)

    monkeypatch.setattr(service.voice_client, "tts_batch", fake_tts_batch)
    monkeypatch.setattr(service.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(service, "VOICE_BUSY_RETRY_DELAYS", (0.01, 0.02, 0.03))
    try:
        asyncio.run(service.voice(j.job_id, "v1"))
        out = state.get_job(j.job_id)
        assert out.voice_status == "done"
        assert attempts["n"] == 3 and len(sleeps) == 2
        assert seen_texts[-1] == "Xin chào thế giới!"
    finally:
        state.delete_job(j.job_id)


# ── 7) _overall() & _batch_overall() recognize rate_limited / refreshing_cookie ──

def test_overall_and_batch_overall_treat_rate_limited_and_refreshing_as_running():
    for st in ("rate_limited", "refreshing_cookie"):
        j = state.JobState(job_id="jx", youtube_url="u", recap_status=st)
        assert _overall(j) == "running"
        assert service._batch_overall(j) == "running"


# ── 8) Batch queue: retry reuses existing job_id + continues after 1 bad URL ───

def test_batch_resumes_existing_job_and_continues_after_bad_url(monkeypatch):
    urls = ["https://www.youtube.com/watch?v=urlbad000001", "https://www.youtube.com/watch?v=urlgood00002"]
    batch = state.create_batch(urls, "v1")
    created_jobs: list[tuple[str, str]] = []
    resumed_jobs: list[str] = []

    async def fake_run_one(url, voice_id, polish_opts, batch_id=None, item_index=None, prompts=None):
        j = state.create_job(url)
        created_jobs.append((j.job_id, url))
        if "urlbad" in url:
            state.update_job(j.job_id, recap_status="error", error="transcript: Video không có phụ đề")
            return j.job_id, "error"
        state.update_job(j.job_id, merge_status="done")
        return j.job_id, "merged"

    async def fake_retry(job_id, url, voice_id, polish_opts, batch_id=None, item_index=None, prompts=None):
        resumed_jobs.append(job_id)
        state.update_job(job_id, recap_status="error", error="transcript: Video không có phụ đề")
        return job_id, "error"

    async def fast_sleep(_sec):
        return None

    monkeypatch.setattr(service, "_run_one_batch_job", fake_run_one)
    monkeypatch.setattr(service, "_retry_existing_batch_job", fake_retry)
    monkeypatch.setattr(service.asyncio, "sleep", fast_sleep)

    try:
        asyncio.run(service._run_batch_worker(batch.batch_id))
        b = state.get_batch(batch.batch_id)
        assert b.status == "done"
        assert b.items[0].status == "error" and b.items[0].retry_count == 1
        assert len(resumed_jobs) == 1 and resumed_jobs[0] == created_jobs[0][0]
        assert b.items[1].status == "done"
        assert len(created_jobs) == 2
    finally:
        for jid, _ in created_jobs:
            state.delete_job(jid)
        state.delete_batch(batch.batch_id)
