"""Node "Cắt video": chuẩn hóa đoạn giữ lại, lệnh ffmpeg, cắt thật bằng ffmpeg và dải khung hình (cần ffmpeg trên PATH)."""

import shutil
import subprocess
from pathlib import Path

import pytest

from app.workflow import muse_cut, muse_merge

needs_ffmpeg = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="cần ffmpeg + ffprobe")


def seg(a, b):
    return muse_cut.CutSegment(start=a, end=b)


def test_plan_segments_sorts_clamps_and_merges():
    # sắp theo thời gian, cắt vào độ dài video, bỏ đoạn quá ngắn, gộp đoạn chồng / liền nhau
    planned = muse_cut.plan_segments([seg(5, 9), seg(0, 2), seg(2.01, 3), seg(8, 40), seg(3.5, 3.55)], duration=10)
    assert planned == [(0.0, 3.0), (5.0, 10.0)]
    # chỉ có đoạn quá ngắn / tổng quá ngắn -> lỗi trước khi chạy ffmpeg
    with pytest.raises(ValueError, match="tối thiểu"):
        muse_cut.plan_segments([seg(1, 1.05)], duration=10)
    with pytest.raises(ValueError, match="tối thiểu"):
        muse_cut.plan_segments([seg(1, 1.2)], duration=10)  # 0.2s < 0.3s


def test_cut_command_trims_each_segment_and_concats(tmp_path):
    cmd = muse_cut.build_cut_command(Path("in.mp4"), tmp_path / "o.mp4", [(0.0, 3.0), (5.0, 10.0)], has_audio=True)
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "[0:v]trim=start=0.000:end=3.000,setpts=PTS-STARTPTS[v0]" in graph
    assert "[0:a]atrim=start=5.000:end=10.000,asetpts=PTS-STARTPTS[a1]" in graph
    assert "[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][a]" in graph
    silent = muse_cut.build_cut_command(Path("in.mp4"), tmp_path / "o.mp4", [(1.0, 2.0)], has_audio=False)
    assert "atrim" not in silent[silent.index("-filter_complex") + 1] and "-c:a" not in silent


@pytest.fixture
def sample(tmp_path, monkeypatch):
    """Video 6 giây có hình + tiếng (nhóm khung hình đổi màu mỗi giây để kiểm tra đúng đoạn)."""
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(muse_cut, "_upload_dir", lambda: uploads)
    monkeypatch.setattr(muse_cut, "STRIP_DIR", tmp_path / "strips")
    monkeypatch.setattr(muse_cut, "CUT_DIR", tmp_path / "cuts")
    src = uploads / "src_sample.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=180x320:rate=24:duration=6",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(src)],
        check=True, timeout=60,
    )
    return src


@needs_ffmpeg
def test_cut_video_keeps_only_selected_segments(sample):
    req = muse_cut.MuseCutRequest(path=str(sample), segments=[seg(4, 6), seg(0, 1.5)])  # thứ tự lộn xộn, bỏ 1.5–4
    out = muse_cut.cut_video(req)
    assert out["ok"] and out["cached"] is False
    assert out["segments"] == [{"start": 0.0, "end": 1.5}, {"start": 4.0, "end": 6.0}]
    assert abs(out["duration"] - 3.5) < 0.2                    # 1.5 + 2.0
    info = muse_merge.probe_video(Path(out["file_path"]))
    assert (info["width"], info["height"]) == (180, 320) and info["has_audio"]
    assert out["preview_url"].startswith("/api/workflow/muse/video-cut/file?name=cut_") and Path(out["file_path"]).parent == muse_cut.CUT_DIR
    # video đã cắt dùng tiếp làm nguồn được (nối tiếp node Cắt video)
    chained = muse_cut.cut_video(muse_cut.MuseCutRequest(path=out["file_path"], segments=[seg(0, 1)]))
    assert chained["file_path"] != out["file_path"] and abs(chained["duration"] - 1.0) < 0.2
    # cùng nguồn + cùng đoạn -> dùng lại file (không mã hóa lại)
    again = muse_cut.cut_video(req)
    assert again["cached"] is True and again["file_path"] == out["file_path"]
    # bỏ tiếng
    mute = muse_cut.cut_video(muse_cut.MuseCutRequest(path=str(sample), segments=[seg(0, 2)], keep_audio=False))
    assert muse_merge.probe_video(Path(mute["file_path"]))["has_audio"] is False
    assert not list(muse_cut.CUT_DIR.glob("*.part.mp4"))       # không để lại file tạm


@needs_ffmpeg
def test_cut_rejects_paths_outside_the_app_and_non_video(sample, tmp_path):
    outside = tmp_path / "elsewhere.mp4"
    shutil.copy(sample, outside)
    with pytest.raises(PermissionError):
        muse_cut.resolve_source(str(outside))
    with pytest.raises(ValueError, match="Không phải file video"):
        muse_cut.resolve_source(str(sample.with_suffix(".txt")))
    with pytest.raises(FileNotFoundError):
        muse_cut.resolve_source(str(sample.parent / "missing.mp4"))


@needs_ffmpeg
def test_video_strip_is_an_image_with_the_requested_size_and_is_cached(sample):
    data = muse_cut.video_strip(sample, 480, 48)
    assert data[:2] == b"\xff\xd8"                              # JPEG
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", "-"],
                           input=data, capture_output=True, timeout=30)
    assert probe.stdout.decode().strip() == "480x48"
    assert len(list((sample.parent.parent / "strips").glob("*.jpg"))) == 1
    assert muse_cut.video_strip(sample, 480, 48) == data       # lần hai đọc cache


@needs_ffmpeg
def test_endpoints(sample):
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    r = client.post("/api/workflow/muse/video-cut", json={"path": str(sample), "segments": [{"start": 0, "end": 2}, {"start": 3, "end": 5}]})
    assert r.status_code == 200, r.text
    assert abs(r.json()["duration"] - 4.0) < 0.2
    played = client.get(r.json()["preview_url"])
    assert played.status_code == 200 and played.headers["content-type"] == "video/mp4" and len(played.content) > 1000
    assert client.get("/api/workflow/muse/video-cut/file", params={"name": "cut_000000000000.mp4"}).status_code == 404
    assert client.get("/api/workflow/muse/video-cut/file", params={"name": "../../etc/passwd.mp4"}).status_code == 404
    assert client.post("/api/workflow/muse/video-cut", json={"path": str(sample), "segments": [{"start": 1, "end": 1.1}]}).status_code == 400
    assert client.post("/api/workflow/muse/video-cut", json={"path": str(sample.parent / "x.mp4"), "segments": [{"start": 0, "end": 2}]}).status_code == 404
    s = client.get("/api/workflow/muse/video-strip", params={"path": str(sample), "w": 400, "h": 40})
    assert s.status_code == 200 and s.headers["content-type"] == "image/jpeg" and s.content[:2] == b"\xff\xd8"
