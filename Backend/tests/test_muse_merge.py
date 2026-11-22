"""Muse Canvas → Ghép video: lập kế hoạch, đường dẫn an toàn, ghép thật bằng ffmpeg trên clip tổng hợp (gwr được giả)."""
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.workflow import muse_merge
from app.workflow.router import router

FFMPEG = shutil.which("ffmpeg")
needs_ffmpeg = pytest.mark.skipif(not FFMPEG, reason="cần ffmpeg")


def make_clip(path: Path, seconds=2.0, size="320x568", color="red", audio=True, fps=24):
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c={color}:s={size}:r={fps}:d={seconds}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", *(["-c:a", "aac", "-shortest"] if audio else []), str(path)]
    subprocess.run(cmd, check=True)
    return path


@pytest.fixture()
def env(tmp_path, monkeypatch):
    veo = tmp_path / "veo_outputs"
    veo.mkdir()
    monkeypatch.setattr(muse_merge, "_roots", lambda: [veo.resolve(), (tmp_path / "exports").resolve()])
    monkeypatch.setattr(muse_merge, "CLEAN_DIR", tmp_path / "veo_clean")
    return {"veo": veo, "tmp": tmp_path}


def test_plan_length_and_trim_validation():
    assert muse_merge.plan_length(8.0, 1.0, 0.5) == 6.5
    with pytest.raises(ValueError, match="chỉ còn 0.3s"):
        muse_merge.plan_length(8.0, 4.0, 3.7)
    with pytest.raises(ValueError):
        muse_merge.plan_length(1.0, 0.8, 0)


def test_normalize_command_cuts_and_pads_silent_audio():
    cmd = muse_merge.normalize_command(Path("a.mp4"), Path("o.mp4"), start=1.5, length=6.0, width=720, height=1280, fps=24, has_audio=False)
    assert cmd[cmd.index("-ss") + 1] == "1.500" and cmd[cmd.index("-t") + 1] == "6.000"
    assert "anullsrc=channel_layout=stereo:sample_rate=48000" in cmd and "-shortest" in cmd
    assert "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280" in cmd[cmd.index("-vf") + 1]
    with_audio = muse_merge.normalize_command(Path("a.mp4"), Path("o.mp4"), start=0, length=4, width=720, height=1280, fps=24, has_audio=True)
    assert "-ss" not in with_audio and "anullsrc" not in " ".join(with_audio) and with_audio[with_audio.index("-map", with_audio.index("0:v:0")) + 1] == "0:a:0"


def test_resolve_video_accepts_bare_veo_file_names(env, monkeypatch):
    # job Veo ghi output_files là tên file trần, không có thư mục
    from app.veo import service as veo

    clip = env["veo"] / "84a4a553-fab.mp4"
    clip.write_bytes(b"x")
    monkeypatch.setattr(veo, "get_video_path", lambda name: clip if Path(name).stem == "84a4a553-fab" else None)
    assert muse_merge.resolve_video("84a4a553-fab.mp4") == clip.resolve()
    with pytest.raises(FileNotFoundError):
        muse_merge.resolve_video("khong-co.mp4")


def test_resolve_video_only_inside_app_video_folders(env):
    ok = env["veo"] / "a.mp4"
    ok.write_bytes(b"x")
    assert muse_merge.resolve_video(str(ok)) == ok.resolve()
    outside = env["tmp"] / "outside.mp4"
    outside.write_bytes(b"x")
    with pytest.raises(PermissionError):
        muse_merge.resolve_video(str(outside))
    with pytest.raises(ValueError):
        muse_merge.resolve_video(str(env["veo"] / "note.txt"))
    with pytest.raises(FileNotFoundError):
        muse_merge.resolve_video(str(env["veo"] / "missing.mp4"))
    with pytest.raises(PermissionError):  # đi vòng bằng ..
        muse_merge.resolve_video(str(env["veo"] / ".." / "outside.mp4"))


@needs_ffmpeg
def test_prepare_reports_which_clip_is_wrong(env):
    a = make_clip(env["veo"] / "a.mp4", 2.0)
    req = muse_merge.MuseMergeRequest(clips=[{"path": str(a)}, {"path": str(a), "trim_start": 1.5, "trim_end": 1.0}])
    with pytest.raises(ValueError, match="^Clip 2: "):
        muse_merge.prepare(req)


def wait_done(job_id, timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        job = muse_merge.get_job(job_id)
        if job and job["status"] != "running":
            return job
        time.sleep(0.3)
    raise AssertionError("job không xong")


@needs_ffmpeg
def test_merge_trims_normalizes_and_saves(env, monkeypatch):
    from app.workflow import muse_finish

    # clip khác kích thước / fps / không có tiếng: vẫn phải ghép được
    a = make_clip(env["veo"] / "a.mp4", 3.0, "320x568", "red", audio=True, fps=24)
    b = make_clip(env["veo"] / "b.mp4", 3.0, "360x640", "blue", audio=False, fps=30)
    captured = {}

    def fake_finish(req):
        captured["req"] = req
        durations = [muse_merge.probe_video(Path(p))["duration"] for p in req.video_paths]
        infos = [muse_merge.probe_video(Path(p)) for p in req.video_paths]
        captured["durations"], captured["infos"] = durations, infos
        return {"filename": "muse_final_x.mp4", "file_path": "x", "video_url": "/x", "duration_sec": sum(durations), "title": req.title}

    monkeypatch.setattr(muse_finish, "finish_video", fake_finish)
    req = muse_merge.MuseMergeRequest(
        clips=[{"path": str(a), "trim_end": 0.5}, {"path": str(b), "trim_start": 1.0}],
        remove_watermark=False, title="Bộ 2 clip", mute_original=True, original_volume=0.2,
        bgm_track_ids=["t1"], bgm_volume=0.4, label_text="@kenh",
    )
    job = wait_done(muse_merge.start_merge(req))
    assert job["status"] == "done", job
    assert job["result"]["filename"] == "muse_final_x.mp4"
    r = captured["req"]
    assert (r.mute_original, r.original_volume, r.bgm_track_ids, r.bgm_volume, r.label_text, r.title) == (True, 0.2, ["t1"], 0.4, "@kenh", "Bộ 2 clip")
    assert [round(d, 1) for d in captured["durations"]] == [2.5, 2.0]  # 3-0.5 và 3-1.0
    a_info, b_info = captured["infos"]
    assert (b_info["width"], b_info["height"]) == (a_info["width"], a_info["height"]) == (320, 568)  # theo clip đầu
    assert a_info["fps"] == b_info["fps"] == 24
    assert a_info["has_audio"] and b_info["has_audio"]  # clip không có tiếng được thêm tiếng im


@needs_ffmpeg
def test_watermark_removed_per_clip_before_merge_and_cached(env, monkeypatch):
    from app.workflow import muse_finish
    import app.watermark.service as wm

    a = make_clip(env["veo"] / "a.mp4", 2.0, color="red")
    calls = []

    def fake_gwr(src, dest, on_progress=None, cancelled=None):
        calls.append(Path(src).name)
        on_progress and on_progress(5, 10)
        shutil.copy(src, dest)
        return dest

    monkeypatch.setattr(wm, "remove_video_watermark_sync", fake_gwr)
    monkeypatch.setattr(muse_finish, "finish_video", lambda req: {"filename": "f.mp4", "file_path": "x", "video_url": "/x", "duration_sec": 1, "title": ""})
    req = muse_merge.MuseMergeRequest(clips=[{"path": str(a)}], remove_watermark=True)
    assert wait_done(muse_merge.start_merge(req))["status"] == "done"
    assert calls == ["a.mp4"]
    assert muse_merge.clean_cache_path(a.resolve()).is_file()
    assert wait_done(muse_merge.start_merge(req))["status"] == "done"
    assert calls == ["a.mp4"]  # lần ghép lại dùng cache, không chạy gwr thêm


@needs_ffmpeg
def test_watermark_failure_is_reported_not_skipped(env, monkeypatch):
    import app.watermark.service as wm

    a = make_clip(env["veo"] / "a.mp4", 2.0)

    def boom(*args, **kwargs):
        raise RuntimeError("gwr từ chối")

    monkeypatch.setattr(wm, "remove_video_watermark_sync", boom)
    job = wait_done(muse_merge.start_merge(muse_merge.MuseMergeRequest(clips=[{"path": str(a)}], remove_watermark=True)))
    assert job["status"] == "error" and "Clip 1: không xóa được watermark" in job["error"] and "Tắt “Xóa watermark Flow”" in job["error"]


@needs_ffmpeg
def test_http_routes_frame_and_job_lookup(env, monkeypatch):
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    a = make_clip(env["veo"] / "a.mp4", 2.0, color="green")
    for at in ("first", "last"):
        res = client.get("/api/workflow/muse/merge/frame", params={"path": str(a), "at": at, "w": 160})
        assert res.status_code == 200 and res.headers["content-type"] == "image/jpeg" and res.content[:2] == b"\xff\xd8"
    assert client.get("/api/workflow/muse/merge/frame", params={"path": str(env["tmp"] / "x.mp4")}).status_code in (400, 404)
    assert client.get("/api/workflow/muse/merge/frame", params={"path": str(a), "at": "middle"}).status_code == 422
    assert client.get("/api/workflow/muse/merge/doesnotexist").status_code == 404
    bad = client.post("/api/workflow/muse/merge", json={"clips": [{"path": str(a), "trim_start": 1.9, "trim_end": 0}]})
    assert bad.status_code == 400 and "Clip 1" in bad.json()["detail"]
    assert client.post("/api/workflow/muse/merge", json={"clips": []}).status_code == 422


@needs_ffmpeg
def test_cut_video_skips_watermark_removal_but_flow_clip_does_not(env, monkeypatch):
    """Video của node Cắt video (đã mã hóa lại) đi kèm `remove_watermark: false`: không chạy gwr cho riêng nó (gwr chỉ làm
    đúng trên clip Flow gốc, chạy vào là hỏng cả lần ghép); clip Flow gốc cùng lần ghép vẫn được xóa watermark."""
    from app.workflow import muse_finish
    import app.watermark.service as wm

    flow_clip = make_clip(env["veo"] / "flow.mp4", 2.0, color="red")
    cut = make_clip(env["veo"] / "cut_abc.mp4", 2.0, color="blue")
    calls = []

    def fake_gwr(src, dest, on_progress=None, cancelled=None):
        calls.append(Path(src).name)
        shutil.copy(src, dest)
        return dest

    monkeypatch.setattr(wm, "remove_video_watermark_sync", fake_gwr)
    monkeypatch.setattr(muse_finish, "finish_video", lambda req: {"filename": "f.mp4", "file_path": "x", "video_url": "/x", "duration_sec": 1, "title": ""})
    req = muse_merge.MuseMergeRequest(clips=[{"path": str(flow_clip)}, {"path": str(cut), "remove_watermark": False}], remove_watermark=True)
    assert wait_done(muse_merge.start_merge(req))["status"] == "done"
    assert calls == ["flow.mp4"]
    # cờ riêng = None -> theo cài đặt chung (giữ hành vi cũ)
    assert muse_merge.MergeClip(path="x.mp4").remove_watermark is None


def test_cut_folder_is_an_allowed_merge_source(tmp_path, monkeypatch):
    """Thư mục video của node Cắt video (Data/media/muse_cuts) nằm trong các thư mục ghép được."""
    from app.workflow import muse_cut

    cuts = tmp_path / "muse_cuts"
    cuts.mkdir()
    monkeypatch.setattr(muse_cut, "CUT_DIR", cuts)
    assert cuts.resolve() in muse_merge._roots()
    f = cuts / "cut_123456789abc.mp4"
    f.write_bytes(b"x" * 64)
    assert muse_merge.resolve_video(str(f)) == f.resolve()
