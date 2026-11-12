import json
import random
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.media import audio_workflow as aw
from app.media import background_router, backgrounds, video_service

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="cần ffmpeg + ffprobe")


def _ff(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def _probe(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration",
                          "-of", "json", str(path)], capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    return {"streams": data["streams"], "duration": float(data["format"]["duration"])}


@pytest.fixture()
def lib(tmp_path, monkeypatch):
    monkeypatch.setattr(video_service, "VIDEO_DIR", tmp_path / "videos")
    monkeypatch.setattr(video_service, "STATE_FILE", tmp_path / "videos" / "library.json")
    monkeypatch.setattr(video_service, "MERGE_DIR", tmp_path / "videos" / "MergeVideo")
    backgrounds._STATE.clear()
    yield tmp_path
    backgrounds._STATE.clear()


def add_source(tmp_path, name="a.mp4", size="320x568", seconds=3, audio=True) -> dict:
    src = tmp_path / f"src_{name}"
    args = ["-f", "lavfi", "-i", f"testsrc=s={size}:d={seconds}:r=25"]
    if audio:
        args += ["-f", "lavfi", "-i", "sine=frequency=440:duration=%d" % seconds, "-shortest"]
    _ff(*args, "-pix_fmt", "yuv420p", str(src))
    return video_service.add_video(src.read_bytes(), name)


def wait_ready(video_id, aspect, fit="fill", timeout=20.0):
    end = time.time() + timeout
    while time.time() < end:
        state = backgrounds.clip_state(video_id, aspect, fit)
        if state["status"] in ("ready", "error"):
            return state
        time.sleep(0.05)
    raise AssertionError(f"quá hạn: {state}")


# ── chuẩn hóa một clip ───────────────────────────────────────────────────────

@pytest.mark.parametrize("aspect,size", [("9:16", (1080, 1920)), ("16:9", (1920, 1080))])
@pytest.mark.parametrize("fit", ["fill", "blur"])
def test_prepare_clip_outputs_exact_size_without_audio(lib, aspect, size, fit):
    item = add_source(lib, size="640x360")  # nguồn ngang, khác khổ đích ở khổ dọc
    out = backgrounds.prepare_clip(item, aspect, fit)
    info = _probe(out)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == size and video["codec_name"] == "h264" and video["r_frame_rate"] == "30/1"
    assert not any(s["codec_type"] == "audio" for s in info["streams"]), "nền không mang tiếng"
    assert abs(info["duration"] - 3.0) < 0.3
    assert not list(out.parent.glob("*.part.mp4")), "không để lại file tạm"


def test_prepare_clip_is_cached(lib, monkeypatch):
    item = add_source(lib)
    first = backgrounds.prepare_clip(item, "9:16", "fill")
    mtime = first.stat().st_mtime_ns
    calls = []
    real = subprocess.run
    monkeypatch.setattr(backgrounds.subprocess, "run", lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    assert backgrounds.prepare_clip(item, "9:16", "fill") == first
    assert not calls and first.stat().st_mtime_ns == mtime


def test_prepare_failure_leaves_nothing_behind(lib):
    item = add_source(lib)
    Path(item["file_path"]).write_bytes(b"khong phai video")
    with pytest.raises(RuntimeError, match="ffmpeg exit"):
        backgrounds.prepare_clip(item, "9:16", "fill")
    assert not backgrounds.is_ready(item["video_id"], "9:16", "fill")
    assert not list(backgrounds.prepared_dir("9:16", "fill").glob("*"))


def test_invalid_aspect_or_fit(lib):
    with pytest.raises(ValueError):
        backgrounds.check("1:1", "fill")
    with pytest.raises(ValueError):
        backgrounds.check("9:16", "stretch")


# ── ghép nền cho một chương ──────────────────────────────────────────────────

def test_build_background_concats_by_copy_and_muxes_to_exact_voice_length(lib):
    for i, size in enumerate(["320x568", "640x360", "480x480"]):  # nguồn đủ kiểu khổ
        add_source(lib, f"s{i}.mp4", size=size, seconds=3)
    merged = backgrounds.build_background(8, "16:9", "fill", rng=random.Random(1))
    info = _probe(merged)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1920, 1080)
    assert info["duration"] >= 8, "nền phải đủ dài cho giọng đọc"
    assert not list(video_service.MERGE_DIR.glob(".bg_*.txt")), "file danh sách tạm phải bị xóa"

    voice = lib / "voice.wav"
    _ff("-f", "lavfi", "-i", "sine=frequency=300:duration=8", str(voice))
    final = lib / "final.mp4"
    aw._mux(merged, voice, final, None)
    assert abs(_probe(final)["duration"] - 8.0) < 0.25, "ghép giọng cắt nền thừa đúng độ dài voice"


def test_build_background_prepares_only_what_is_needed(lib):
    for i in range(4):
        add_source(lib, f"s{i}.mp4", seconds=3)
    backgrounds.build_background(2, "9:16", "fill", rng=random.Random(2))
    assert len(list(backgrounds.prepared_dir("9:16", "fill").glob("*.mp4"))) == 1, "2 giây chỉ cần 1 clip 3 giây"
    assert not backgrounds.prepared_dir("16:9", "fill").exists()


def test_build_background_reuses_ready_clips_before_preparing_more(lib, monkeypatch):
    items = [add_source(lib, f"s{i}.mp4", seconds=3) for i in range(3)]
    backgrounds.prepare_clip(items[1], "9:16", "fill")
    prepared = []
    real = backgrounds.prepare_clip
    monkeypatch.setattr(backgrounds, "prepare_clip", lambda item, a, f: (prepared.append(item["video_id"]), real(item, a, f))[1])
    backgrounds.build_background(2, "9:16", "fill", rng=random.Random(3))
    assert prepared == [], "đã có clip sẵn sàng đủ thời lượng thì không chuẩn hóa thêm"


def test_build_background_never_repeats_same_clip_back_to_back(lib, monkeypatch):
    for i in range(2):
        add_source(lib, f"s{i}.mp4", seconds=3)
    listings = []
    real = subprocess.run

    def spy(cmd, **kw):
        if "concat" in cmd:
            listings.append(Path(cmd[cmd.index("-i") + 1]).read_text())
        return real(cmd, **kw)

    monkeypatch.setattr(backgrounds.subprocess, "run", spy)
    for seed in range(5):
        backgrounds.build_background(20, "9:16", "fill", rng=random.Random(seed))
    for text in listings:
        names = [line for line in text.splitlines()]
        assert len(names) >= 7 and all(a != b for a, b in zip(names, names[1:])), names


def test_build_background_skips_broken_source_but_fails_if_none_usable(lib):
    good = add_source(lib, "good.mp4", seconds=3)
    bad = add_source(lib, "bad.mp4", seconds=3)
    Path(bad["file_path"]).write_bytes(b"hong")
    messages = []
    merged = backgrounds.build_background(2, "9:16", "fill", on_status=messages.append, rng=random.Random(4))
    assert merged.exists()
    video_service.remove(good["video_id"])
    with pytest.raises(RuntimeError, match="Không chuẩn bị được video nền nào"):
        backgrounds.build_background(2, "9:16", "fill")


def test_build_background_empty_library(lib):
    with pytest.raises(ValueError, match="Thư viện nền đang trống"):
        backgrounds.build_background(5, "9:16", "fill")
    with pytest.raises(ValueError, match="Thư viện nền đang trống"):
        backgrounds.ensure_sources()


def test_build_background_cleans_output_on_failure(lib, monkeypatch):
    add_source(lib, seconds=3)
    real = subprocess.run

    def fail_concat(cmd, **kw):
        if "concat" in cmd:
            class P:
                returncode, stderr = 1, "boom"
            Path(cmd[-1]).write_bytes(b"partial")
            return P()
        return real(cmd, **kw)

    monkeypatch.setattr(backgrounds.subprocess, "run", fail_concat)
    with pytest.raises(RuntimeError, match="Không nối được video nền"):
        backgrounds.build_background(2, "9:16", "fill")
    assert list(video_service.MERGE_DIR.glob("*")) == []


# ── hàng đợi nền / trạng thái / xóa ──────────────────────────────────────────

def test_enqueue_prepare_reports_states_and_errors(lib):
    ok = add_source(lib, "ok.mp4")
    bad = add_source(lib, "bad.mp4")
    Path(bad["file_path"]).write_bytes(b"hong")
    assert backgrounds.enqueue_prepare(ok["video_id"], "9:16", "fill") in ("queued", "running")
    assert backgrounds.enqueue_prepare(bad["video_id"], "9:16", "fill") in ("queued", "running")
    assert wait_ready(ok["video_id"], "9:16")["status"] == "ready"
    assert backgrounds.enqueue_prepare(ok["video_id"], "9:16", "fill") == "ready"
    failed = wait_ready(bad["video_id"], "9:16")
    assert failed["status"] == "error" and "ffmpeg exit" in failed["error"]
    listing = backgrounds.list_backgrounds("fill")
    by = {item["video_id"]: item for item in listing["items"]}
    assert by[ok["video_id"]]["states"]["9:16"]["status"] == "ready" and by[ok["video_id"]]["states"]["16:9"]["status"] == "missing"
    assert listing["total_seconds"] > 0 and listing["max_clip_seconds"] == backgrounds.MAX_CLIP_SECONDS

    assert backgrounds.prepare_all("fill", ["9:16"]) == 0, "clip lỗi không tự thử lại"
    Path(bad["file_path"]).write_bytes(Path(ok["file_path"]).read_bytes())
    assert backgrounds.prepare_all("fill", ["9:16"], retry_errors=True) == 1
    assert wait_ready(bad["video_id"], "9:16")["status"] == "ready"


def test_prune_orphans_after_source_removed_from_video_page(lib):
    """Xóa video ở khối Video (video_service.remove) không biết tới cache chuẩn hóa -> tự dọn khi liệt kê / ghép nền."""
    keep, drop = add_source(lib, "keep.mp4"), add_source(lib, "drop.mp4")
    for item in (keep, drop):
        for aspect in backgrounds.ASPECTS:
            backgrounds.prepare_clip(item, aspect, "fill")
    backgrounds.prepare_clip(drop, "9:16", "blur")
    assert video_service.remove(drop["video_id"]) is True
    assert backgrounds.is_ready(drop["video_id"], "9:16", "fill"), "chưa dọn thì file cache vẫn còn"
    listing = backgrounds.list_backgrounds("fill")
    assert [i["video_id"] for i in listing["items"]] == [keep["video_id"]]
    assert not any(backgrounds.is_ready(drop["video_id"], a, f) for a in backgrounds.ASPECTS for f in backgrounds.FITS)
    assert all(backgrounds.is_ready(keep["video_id"], a, "fill") for a in backgrounds.ASPECTS), "video còn lại không bị đụng"
    assert backgrounds.prune_orphans() == 0


# ── HTTP ─────────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(lib):
    app = FastAPI()
    app.include_router(background_router.router)
    return TestClient(app)


def test_http_list_and_prepare(lib, client):
    item = add_source(lib)
    data = client.get("/api/audio/backgrounds", params={"fit": "fill"}).json()
    assert [i["video_id"] for i in data["items"]] == [item["video_id"]]
    assert data["items"][0]["states"]["9:16"]["status"] == "missing"
    assert client.post("/api/audio/backgrounds/prepare", json={"fit": "fill", "aspects": ["9:16"]}).json() == {"queued": 1}
    assert wait_ready(item["video_id"], "9:16")["status"] == "ready"
    assert client.post("/api/audio/backgrounds/prepare", json={"fit": "fill", "aspects": ["9:16"]}).json() == {"queued": 0}
    states = client.get("/api/audio/backgrounds", params={"fit": "fill"}).json()["items"][0]["states"]
    assert states["9:16"]["status"] == "ready" and states["16:9"]["status"] == "missing", "chỉ khổ được yêu cầu mới chuẩn hóa"


def test_http_validation(lib, client):
    assert client.get("/api/audio/backgrounds", params={"fit": "stretch"}).status_code == 400
    assert client.post("/api/audio/backgrounds/prepare", json={"fit": "fill", "aspects": ["1:1"]}).status_code == 400
    assert client.post("/api/audio/backgrounds/prepare", json={"fit": "stretch"}).status_code == 400
    assert client.post("/api/audio/backgrounds/prepare", json={"fit": "fill"}).json() == {"queued": 0}
    assert client.get("/api/audio/backgrounds").json()["items"] == []


def test_run_endpoints_reject_empty_library_and_bad_fit(lib):
    from app.media import audio_router
    app = FastAPI()
    app.include_router(audio_router.router)
    client = TestClient(app)
    body = {"story_slug": "s", "chapter_number": 1, "voice_id": "v"}
    r = client.post("/api/audio/run", json=body)
    assert r.status_code == 400 and "Thư viện nền đang trống" in r.json()["detail"]
    r = client.post("/api/audio/run", json={**body, "bg_fit": "stretch"})
    assert r.status_code == 400 and "khớp khung" in r.json()["detail"]
    r = client.post("/api/audio/test-run", json={"text": "xin chào"})
    assert r.status_code == 400 and "Thư viện nền đang trống" in r.json()["detail"]
