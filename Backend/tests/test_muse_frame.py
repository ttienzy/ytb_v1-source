"""Test endpoint & logic "Tách khung hình" (app/workflow/muse_frame.py)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.workflow import muse_frame, muse_merge, router


def _make_sample_video(dest: Path, duration: float = 2.0) -> Path:
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", f"testsrc=size=128x224:rate=15:duration={duration}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(dest),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr
    return dest


def test_extract_frame_modes_and_cache(tmp_path: Path, monkeypatch):
    video = _make_sample_video(tmp_path / "sample.mp4", duration=2.0)
    frame_dir = tmp_path / "frames"
    monkeypatch.setattr(muse_frame, "FRAME_DIR", frame_dir)
    monkeypatch.setattr(muse_merge, "resolve_video", lambda _raw: video)

    # first
    r_first = muse_frame.extract_frame_file(muse_frame.MuseFrameRequest(path=str(video), mode="first"))
    assert r_first["ok"] is True
    assert r_first["mode"] == "first"
    assert r_first["time_sec"] == 0.0
    assert r_first["width"] == 128 and r_first["height"] == 224
    assert r_first["cached"] is False
    assert Path(r_first["file_path"]).is_file()
    assert Path(r_first["file_path"]).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert r_first["preview_url"].startswith("/api/workflow/muse/frame/file?name=frame_")

    # last + cache hit on second call
    r_last_1 = muse_frame.extract_frame_file(muse_frame.MuseFrameRequest(path=str(video), mode="last"))
    assert r_last_1["cached"] is False
    assert r_last_1["time_sec"] > 1.8
    r_last_2 = muse_frame.extract_frame_file(muse_frame.MuseFrameRequest(path=str(video), mode="last"))
    assert r_last_2["cached"] is True
    assert r_last_2["file_path"] == r_last_1["file_path"]

    # time + clamping when time_sec > duration
    r_time = muse_frame.extract_frame_file(muse_frame.MuseFrameRequest(path=str(video), mode="time", time_sec=1.0))
    assert r_time["time_sec"] == 1.0
    r_clamped = muse_frame.extract_frame_file(muse_frame.MuseFrameRequest(path=str(video), mode="time", time_sec=99.0))
    assert r_clamped["time_sec"] < 2.0


def test_frame_file_route_rejects_invalid_and_traversal(tmp_path: Path, monkeypatch):
    frame_dir = tmp_path / "frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(muse_frame, "FRAME_DIR", frame_dir)

    with pytest.raises(HTTPException) as exc1:
        router.muse_frame_file("../secret.png")
    assert exc1.value.status_code == 404

    with pytest.raises(HTTPException) as exc2:
        router.muse_frame_file("frame_missing.png")
    assert exc2.value.status_code == 404

    valid = frame_dir / "frame_abc123.png"
    valid.write_bytes(b"\x89PNG\r\n\x1a\n")
    res = router.muse_frame_file("frame_abc123.png")
    assert res.media_type == "image/png"
    assert Path(res.path) == valid
