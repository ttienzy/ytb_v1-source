"""Muse Canvas → Hoàn thiện video (ffmpeg thật, clip tổng hợp vài giây) + clip Muse trong Thư Viện Video."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.workflow import muse_finish as mf
from app.workflow import service as wf_service

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _clip(path: Path, seconds: float = 2.0, audio: bool = True) -> Path:
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size=360x640:rate=24:duration={seconds}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "aac", "-shortest"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)]
    subprocess.run(cmd, check=True, capture_output=True)
    return path


def _streams(path: Path) -> set[str]:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return {s["codec_type"] for s in json.loads(out)["streams"]}


@pytest.fixture
def exports_dir(tmp_path, monkeypatch):
    d = tmp_path / "exports"
    monkeypatch.setattr(wf_service, "WORKFLOW_EXPORTS_DIR", d)
    monkeypatch.setattr(wf_service, "EXPORTS_METADATA_FILE", d / "exports_history.json")
    monkeypatch.setattr(wf_service, "VEO_DATA_DIR", tmp_path / "no_veo")
    return d


def test_label_filter_positions_and_logo():
    graph, out = mf.build_label_filter(720, 1280, has_label=True, label_position="br", label_size="m")
    assert out == "vlabel"
    assert "drawtext=fontfile=font.ttf:textfile=label.txt" in graph
    assert "fontsize=38" in graph  # 1280 * 0.03
    assert "x=w-text_w-28:y=h-text_h-28" in graph
    graph, out = mf.build_label_filter(720, 1280, has_label=True, label_position="tc", logo_index=1, logo_position="tl")
    assert out == "vlabel" and graph.index("overlay") < graph.index("drawtext")  # chữ nằm trên logo
    assert "[1:v]scale=115:-1" in graph and "overlay=x=28:y=28" in graph
    assert "x=(w-text_w)/2:y=28" in graph
    _, out = mf.build_label_filter(720, 1280, has_label=False, logo_index=1, logo_position="br")
    assert out == "vlogo"
    with pytest.raises(ValueError):
        mf.build_label_filter(720, 1280, has_label=False)


@pytest.mark.skipif(not HAS_FFMPEG, reason="cần ffmpeg")
def test_finish_video_label_mute_bgm_goes_to_library(tmp_path, exports_dir, monkeypatch):
    clip = _clip(tmp_path / "muse_canvas_video_1.mp4")
    bgm = tmp_path / "bgm.m4a"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=1", "-c:a", "aac", str(bgm)],
                   check=True, capture_output=True)
    import app.media.service as media_service

    monkeypatch.setattr(media_service, "resolve_for_polish", lambda db, ids: ([bgm], ""))
    res = mf.finish_video(mf.MuseFinishRequest(
        video_paths=[str(clip)], title="3 bộ xanh", mute_original=True, bgm_track_ids=["t1"], bgm_volume=0.4,
        label_text="@kenh_test", label_position="br"))
    out = Path(res["file_path"])
    assert out.parent == exports_dir and out.name.startswith("muse_final_")
    assert res["video_url"] == f"/api/workflow/exports/{out.name}" and res["title"] == "3 bộ xanh"
    assert _streams(out) == {"video", "audio"}  # tiếng gốc tắt, còn nhạc nền
    assert abs(res["duration_sec"] - 2.0) < 0.3
    assert not any(p.name.startswith("temp_muse_") for p in exports_dir.iterdir())  # dọn thư mục tạm
    items = wf_service.list_exported_videos()
    item = next(i for i in items if i["filename"] == out.name)
    assert item["source_type"] == "export" and item["title"] == "3 bộ xanh"
    assert item["model_display_name"] == "Muse + FFmpeg"
    assert "tắt tiếng gốc" in item["prompt"] and "nhãn @kenh_test" in item["prompt"]


@pytest.mark.skipif(not HAS_FFMPEG, reason="cần ffmpeg")
def test_finish_video_concat_and_mute_without_music_is_silent(tmp_path, exports_dir):
    a = _clip(tmp_path / "muse_a.mp4", 1.0)
    b = _clip(tmp_path / "muse_b.mp4", 1.0)
    res = mf.finish_video(mf.MuseFinishRequest(video_paths=[str(a), str(b)], mute_original=True))
    out = Path(res["file_path"])
    assert _streams(out) == {"video"}
    assert abs(res["duration_sec"] - 2.0) < 0.3
    # giữ tiếng gốc
    res2 = mf.finish_video(mf.MuseFinishRequest(video_paths=[str(a)], mute_original=False, original_volume=0.8))
    assert _streams(Path(res2["file_path"])) == {"video", "audio"}


def test_finish_video_missing_clip_or_logo(tmp_path, exports_dir, monkeypatch):
    monkeypatch.setattr(mf, "muse_video_dir", lambda: tmp_path)
    with pytest.raises(FileNotFoundError):
        mf.finish_video(mf.MuseFinishRequest(video_paths=[str(tmp_path / "khong_co.mp4")]))
    clip = tmp_path / "muse_x.mp4"
    clip.write_bytes(b"x")
    with pytest.raises(FileNotFoundError, match="logo"):
        mf.finish_video(mf.MuseFinishRequest(video_paths=[str(clip)], logo_id="abcdefabcdef"))


def test_muse_clips_listed_streamed_and_deleted(tmp_path, exports_dir, monkeypatch):
    d = tmp_path / "muse_dl"
    d.mkdir()
    monkeypatch.setattr(mf, "muse_video_dir", lambda: d)
    (d / "muse_canvas_video_20261115_091039.mp4").write_bytes(b"v1")
    mf.write_sidecar(d / "muse_canvas_video_20261115_091039.mp4",
                     {"prompt": "Create the video…", "chat_title": "Muse Canvas · Video · 3 bộ", "account_label": "acc 1",
                      "created_at": "2026-11-15T09:10:39+00:00", "duration_sec": 28.3})
    (d / "custom_name.mp4").write_bytes(b"v2")
    mf.write_sidecar(d / "custom_name.mp4", {"chat_title": "Có sidecar"})
    (d / "holiday.mp4").write_bytes(b"x")  # mp4 lạ trong thư mục tải: không liệt kê
    items = {i["filename"]: i for i in wf_service.list_exported_videos()}
    assert set(items) == {"muse_canvas_video_20261115_091039.mp4", "custom_name.mp4"}
    it = items["muse_canvas_video_20261115_091039.mp4"]
    assert it["source_type"] == "muse_clip" and it["title"] == "Muse Canvas · Video · 3 bộ"
    assert it["duration_sec"] == 28.3 and it["model_display_name"] == "Meta Muse · acc 1"
    assert it["video_url"] == "/api/workflow/exports/muse_canvas_video_20261115_091039.mp4"

    from fastapi.testclient import TestClient
    from app.main import app
    import app.workflow.router as wf_router

    monkeypatch.setattr(wf_router, "WORKFLOW_EXPORTS_DIR", exports_dir)
    monkeypatch.setattr(wf_router, "VEO_DATA_DIR", tmp_path / "no_veo")
    c = TestClient(app)
    r = c.get("/api/workflow/exports/muse_canvas_video_20261115_091039.mp4")
    assert r.status_code == 200 and r.content == b"v1"
    assert c.get("/api/workflow/exports/holiday.mp4").status_code == 404
    assert mf.find_muse_clip("../holiday.mp4") is None
    assert wf_service.delete_exported_video("custom_name.mp4") is True
    assert not (d / "custom_name.mp4").exists() and not (d / "custom_name.muse.json").exists()
    assert wf_service.delete_exported_video("holiday.mp4") is False
