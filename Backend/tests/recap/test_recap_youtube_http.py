from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from youtube_transcript_api import IpBlocked, TranscriptsDisabled

from app.recap import service, state, transcript, ytdlp
from app.recap.chunker import extract_transcript_entries


URL = "https://youtu.be/tXxdfMguwrY"


def test_get_transcript_returns_timestamped_input_for_chunker(monkeypatch):
    api = Mock()
    monkeypatch.setattr(transcript, "YouTubeTranscriptApi", api)
    tracks = api.return_value.list.return_value
    tracks.find_transcript.return_value.fetch.return_value = [
        SimpleNamespace(start=7.2, text="  Xin\nchào   "),
        SimpleNamespace(start=3670.2, text="Kết thúc"),
    ]

    text = transcript.get_transcript(URL)

    api.return_value.list.assert_called_once_with("tXxdfMguwrY")
    tracks.find_transcript.assert_called_once_with(["vi", "en"])
    assert text == "[0:07] Xin chào\n[61:10] Kết thúc"
    assert [row["start_sec"] for row in extract_transcript_entries(text)] == [7, 3670]


@pytest.mark.parametrize(("error", "message"), [
    (TranscriptsDisabled, "không có phụ đề"),
    (IpBlocked, "giới hạn truy cập"),
])
def test_get_transcript_distinguishes_missing_and_blocked(monkeypatch, error, message):
    api = Mock()
    api.return_value.list.side_effect = error("tXxdfMguwrY")
    monkeypatch.setattr(transcript, "YouTubeTranscriptApi", api)

    with pytest.raises(transcript.TranscriptFetchError, match=message):
        transcript.get_transcript(URL)


def test_download_uses_guest_mode_and_does_not_keep_partial_source(monkeypatch, tmp_path):
    def blocked(cmd, **kwargs):
        assert "--ignore-config" in cmd
        assert "--no-cookies" in cmd
        assert "--no-cookies-from-browser" in cmd
        assert "--cookies" not in cmd
        Path(cmd[cmd.index("-o") + 1].replace("%(ext)s", "mp4")).write_bytes(b"partial")
        return SimpleNamespace(returncode=1, stderr="Sign in to confirm you're not a bot")

    run = Mock(side_effect=blocked)
    monkeypatch.setattr(ytdlp.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="chế độ khách"):
        ytdlp.download_video(URL, tmp_path)
    run.assert_called_once()
    assert list(tmp_path.iterdir()) == []


def test_manual_transcript_resumes_same_job_and_survives_restart(monkeypatch, tmp_path):
    job = state.create_job(URL)
    state.update_job(job.job_id, recap_status="error", error="transcript: bị giới hạn", voice_id="voice")
    raw = "[0:07] Xin chào"
    fetch = Mock(side_effect=AssertionError("Manual transcript must bypass YouTube"))
    monkeypatch.setattr(service, "get_transcript", fetch)
    monkeypatch.setattr(service, "TOOLS_DIR", tmp_path)
    monkeypatch.setattr(service, "_ensure_gemini_cookie", lambda _: True)
    stage_calls = []

    async def generate(job_id):
        current = state.get_job(job_id)
        stage_calls.append(current.raw_bytes)

    async def pipeline(job_id, *_):
        assert await service._stage_recap(job_id)

    monkeypatch.setattr(service, "_generate_for_job", generate)
    monkeypatch.setattr(service, "_run_pipeline", pipeline)

    async def resume():
        resumed = await service.resume_pipeline(job.job_id, raw_text=raw)
        assert resumed.job_id == job.job_id and resumed.recap_status == "running"
        with pytest.raises(HTTPException) as blocked:
            await service.resume_pipeline(job.job_id, raw_text=raw)
        assert blocked.value.status_code == 409
        await service._ACTIVE[job.job_id]

    try:
        asyncio.run(resume())
        assert stage_calls == [raw.encode()]
        assert service.raw_path(job.job_id).read_text(encoding="utf-8") == raw
        fetch.assert_not_called()
    finally:
        state.delete_job(job.job_id)
        service._ACTIVE.pop(job.job_id, None)
