import asyncio
import re
import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app.media import audio_router, backgrounds, overlays, video_service
from app.media import audio_workflow as aw
from app.media.audio_options import AudioOptions
from test_audio_workflow import _fake_zip, _patch_pipeline, audio_dirs  # noqa: F401  (fixture + helper dùng chung)
from test_backgrounds import _ff, _probe, add_source, lib  # noqa: F401

pytestmark = pytest.mark.skipif(not __import__("shutil").which("ffmpeg"), reason="cần ffmpeg")


def lufs(path: Path) -> float:
    r = subprocess.run(["ffmpeg", "-nostats", "-i", str(path), "-af", "ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True)
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)[-1])


def mean_db(path: Path, start: float | None = None, dur: float | None = None) -> float:
    cmd = ["ffmpeg", "-nostats", *(["-ss", str(start)] if start is not None else []), *(["-t", str(dur)] if dur else []), "-i", str(path), "-af", "volumedetect", "-vn", "-f", "null", "-"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return float(re.search(r"mean_volume: (-?[\d.]+) dB", r.stderr).group(1))


def frame(path: Path, at: float, out: Path) -> Image.Image:
    _ff("-ss", str(at), "-i", str(path), "-frames:v", "1", str(out))
    return Image.open(out).convert("RGB")


def brightness(img: Image.Image) -> float:
    return sum(img.convert("L").getdata()) / (img.size[0] * img.size[1])


def changed_pixels(a: Image.Image, b: Image.Image, box: tuple[int, int, int, int]) -> int:
    ca, cb = a.crop(box), b.crop(box)
    return sum(1 for pa, pb in zip(ca.getdata(), cb.getdata()) if sum(abs(x - y) for x, y in zip(pa, pb)) > 60)


# ── Tùy chọn ─────────────────────────────────────────────────────────────────

def test_options_defaults_and_needs_overlay():
    o = AudioOptions()
    assert (o.voice_speed, o.bgm_volume, o.bgm_duck, o.loudnorm, o.bg_mode) == (1.0, 0.22, "normal", True, "library")
    assert not o.needs_overlay()
    for change in ({"dim": 0.2}, {"title_card": "intro"}, {"waveform": True}, {"logo_id": "abcdef012345"}):
        assert AudioOptions(**change).needs_overlay(), change


@pytest.mark.parametrize("bad", [{"voice_speed": 3}, {"voice_speed": 0.2}, {"bgm_volume": 2}, {"dim": 0.9}, {"logo_id": "../etc"}, {"title_card": "x"}, {"bg_mode": "gif"}, {"fade_out_sec": 30}])
def test_options_reject_out_of_range(bad):
    with pytest.raises(ValidationError):
        AudioOptions(**bad)


# ── Bộ lọc âm thanh ──────────────────────────────────────────────────────────

def test_audio_filter_variants():
    plain = aw.build_audio_filter(False, duration=60)
    assert plain.startswith("[1:a]loudnorm") and "afade=t=out:st=58.500:d=1.500" in plain and plain.endswith("[aout]")
    assert "sidechaincompress" not in plain and "amix" not in plain
    normal = aw.build_audio_filter(True, bgm_volume=0.3, duck="normal", duration=60)
    assert "volume=0.300" in normal and "threshold=0.03:ratio=6" in normal and "normalize=0" in normal
    assert "threshold=0.02:ratio=10" in aw.build_audio_filter(True, duck="strong", duration=60)
    off = aw.build_audio_filter(True, duck="off", duration=60)
    assert "sidechaincompress" not in off and "[1:a][music]amix" in off
    assert "loudnorm" not in aw.build_audio_filter(True, loudnorm=False, duration=60)
    assert "afade" not in aw.build_audio_filter(True, fade_out=0, duration=60)
    assert "afade" not in aw.build_audio_filter(True, fade_out=5, duration=3), "video ngắn hơn thời gian fade thì bỏ fade"
    assert "volume=1.000" in aw.build_audio_filter(True, bgm_volume=9, duration=60), "âm lượng nhạc bị chặn tối đa 1"


# ── Âm thanh thật ────────────────────────────────────────────────────────────

@pytest.fixture()
def av(lib):
    video = lib / "v.mp4"
    _ff("-f", "lavfi", "-i", "testsrc=s=320x240:d=12:r=25", "-pix_fmt", "yuv420p", str(video))
    quiet = lib / "quiet.wav"
    _ff("-f", "lavfi", "-i", "anoisesrc=d=10:c=pink:a=0.02", str(quiet))
    bgm = lib / "bgm.mp3"
    _ff("-f", "lavfi", "-i", "anoisesrc=d=4:c=brown:a=0.4", str(bgm))
    return video, quiet, bgm


def test_loudnorm_brings_quiet_voice_to_target(av, lib):
    video, quiet, _ = av
    off, on = lib / "off.mp4", lib / "on.mp4"
    aw._mux(video, quiet, off, None, loudnorm=False, fade_out=0)
    aw._mux(video, quiet, on, None, loudnorm=True, fade_out=0)
    assert lufs(off) < -30, "giọng nhỏ gốc"
    assert abs(lufs(on) - (-16)) < 2.5, lufs(on)


def test_fade_out_makes_tail_quieter(av, lib):
    video, quiet, _ = av
    out = lib / "fade.mp4"
    aw._mux(video, quiet, out, None, loudnorm=False, fade_out=3.0, duration=10.0)
    assert mean_db(out, 9.0, 0.9) < mean_db(out, 3.0, 2.0) - 8


def test_bgm_volume_and_duck_modes_run(av, lib):
    video, quiet, bgm = av
    loud, soft = lib / "loud.mp4", lib / "soft.mp4"
    aw._mux(video, quiet, loud, bgm, 1.0, duck="off", loudnorm=False, fade_out=0)
    aw._mux(video, quiet, soft, bgm, 0.05, duck="off", loudnorm=False, fade_out=0)
    assert mean_db(loud) > mean_db(soft) + 6, "âm lượng nhạc nền có tác dụng"
    for duck in ("normal", "strong"):
        out = lib / f"duck_{duck}.mp4"
        aw._mux(video, quiet, out, bgm, 0.3, duck=duck)
        assert abs(_probe(out)["duration"] - 10.0) < 0.3


def test_voice_speed_changes_duration_not_original(av, lib):
    _, quiet, _ = av
    assert aw.apply_voice_speed(quiet, lib / "same.wav", 1.0) == quiet
    fast = aw.apply_voice_speed(quiet, lib / "fast.wav", 1.25)
    slow = aw.apply_voice_speed(quiet, lib / "slow.wav", 0.8)
    assert abs(_probe(fast)["duration"] - 8.0) < 0.15 and abs(_probe(slow)["duration"] - 12.5) < 0.2


# ── Lớp phủ ──────────────────────────────────────────────────────────────────

def test_title_lines_wraps_and_truncates():
    lines = overlays.title_lines("Ta Là Tạ Uyển Một Cái Tên Truyện Rất Rất Dài Để Kiểm Tra Việc Xuống Dòng", 12, "Chương 12 · Một tiêu đề cũng dài không kém gì tên truyện kia", "9:16")
    assert 2 <= len(lines) <= 4 and lines[-1].startswith("Chương 12") and lines[-1].endswith("…")
    assert all(len(line) <= 31 for line in lines[:-1])
    assert overlays.title_lines("A", 3, "Chương 3", "16:9") == ["A", "Chương 3"], "tiêu đề trùng nhãn thì không lặp"
    assert overlays.title_lines("A", None, "", "9:16") == ["A"]


def test_filter_graph_strings():
    full = AudioOptions(dim=0.3, title_card="intro", title_seconds=5, waveform=True, logo_id="abcdef012345", logo_position="bl")
    graph, label = overlays.build_filter_graph(full, "9:16", 60, has_title=True, voice_index=1, logo_index=2)
    assert "lutyuv=y='val*0.700'" in graph and "showwaves=s=1080x192" in graph and "fontfile=font.ttf:textfile=title.txt" in graph
    assert "alpha='if(gt(t,5.0)" in graph and "x=43:y=H-h-43" in graph and label == "v4"
    always, _ = overlays.build_filter_graph(AudioOptions(title_card="always"), "16:9", 60, has_title=True, voice_index=None, logo_index=None)
    assert "alpha" not in always and "y=48" in always
    with pytest.raises(ValueError):
        overlays.build_filter_graph(AudioOptions(), "9:16", 60, has_title=False, voice_index=None, logo_index=None)


@pytest.fixture()
def base_video(lib):
    path = lib / "base.mp4"
    _ff("-f", "lavfi", "-i", "color=c=0x808080:s=1080x1920:d=4:r=30", "-pix_fmt", "yuv420p", str(path))
    return path


@pytest.fixture()
def tone(lib):
    path = lib / "tone.wav"
    _ff("-f", "lavfi", "-i", "anoisesrc=d=4:c=pink:a=0.5", str(path))
    return path


def render(base_video, tone, lib, **opts) -> Path:
    options = AudioOptions(**opts)
    logo = None
    if options.logo_id:
        logo = lib / "logo.png"
        Image.new("RGBA", (300, 300), (255, 0, 0, 255)).save(logo)
    return overlays.render_overlays(base_video, tone, logo, lib / "work", aspect="9:16", duration=4.0, options=options,
                                    lines=["Ta Là Tạ Uyển", "Chương 1 · Mở đầu"])


def test_overlay_dim_darkens_by_requested_amount(base_video, tone, lib):
    out = render(base_video, tone, lib, dim=0.5)
    info = _probe(out)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920) and abs(info["duration"] - 4.0) < 0.2
    assert not any(s["codec_type"] == "audio" for s in info["streams"])
    original = brightness(frame(base_video, 1, lib / "a.png"))
    dimmed = brightness(frame(out, 1, lib / "b.png"))
    assert 0.40 < dimmed / original < 0.62, (original, dimmed)


def test_overlay_title_intro_fades_out_and_always_stays(base_video, tone, lib):
    box = (0, 500, 1080, 1300)
    base0 = frame(base_video, 1.0, lib / "b0.png")
    intro = render(base_video, tone, lib, title_card="intro", title_seconds=2.5)
    assert changed_pixels(base0, frame(intro, 1.2, lib / "i1.png"), box) > 3000, "thẻ tiêu đề hiện ở đầu"
    assert changed_pixels(base0, frame(intro, 3.6, lib / "i2.png"), box) < 200, "sau khi hết thời gian thì biến mất"
    always = render(base_video, tone, lib, title_card="always")
    assert changed_pixels(base0, frame(always, 3.6, lib / "a2.png"), (0, 40, 1080, 300)) > 1500, "chế độ luôn hiện còn ở cuối video"


def test_overlay_waveform_draws_in_lower_third(base_video, tone, lib):
    out = render(base_video, tone, lib, waveform=True)
    base = frame(base_video, 2.0, lib / "w0.png")
    assert changed_pixels(base, frame(out, 2.0, lib / "w1.png"), (0, 1450, 1080, 1700)) > 1500
    assert changed_pixels(base, frame(out, 2.0, lib / "w2.png"), (0, 0, 1080, 800)) < 50, "không vẽ lên phần trên"


@pytest.mark.parametrize("position,inside,outside", [("tl", (20, 20, 250, 250), (800, 1650, 1060, 1900)), ("br", (800, 1650, 1060, 1900), (20, 20, 250, 250))])
def test_overlay_logo_in_chosen_corner(base_video, tone, lib, position, inside, outside):
    out = render(base_video, tone, lib, logo_id="abcdef012345", logo_position=position, logo_size=0.2, logo_opacity=1.0)
    base = frame(base_video, 1.0, lib / "l0.png")
    shot = frame(out, 1.0, lib / "l1.png")
    assert changed_pixels(base, shot, inside) > 20000 and changed_pixels(base, shot, outside) < 50


def test_overlay_without_font_still_applies_other_effects(base_video, tone, lib, monkeypatch):
    monkeypatch.setattr(overlays, "stage_font", lambda work: False)
    out = render(base_video, tone, lib, dim=0.3, title_card="intro")
    assert brightness(frame(out, 1, lib / "nf.png")) < brightness(frame(base_video, 1, lib / "nf0.png")) * 0.8


def test_overlay_all_effects_together(base_video, tone, lib):
    out = render(base_video, tone, lib, dim=0.2, title_card="intro", waveform=True, logo_id="abcdef012345")
    assert abs(_probe(out)["duration"] - 4.0) < 0.2


# ── Nền ảnh bìa ──────────────────────────────────────────────────────────────

@pytest.fixture()
def cover(lib):
    path = lib / "cover.jpg"
    _ff("-f", "lavfi", "-i", "testsrc2=s=1200x1600:d=1:r=1", "-frames:v", "1", str(path))
    return path


def test_cover_background_zoom_loop_is_cached_and_long_enough(lib, cover, monkeypatch):
    monkeypatch.setattr(backgrounds, "COVER_LOOP_SECONDS", 4)
    clip = backgrounds.prepare_cover_clip(cover, "9:16")
    info = _probe(clip)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"], video["r_frame_rate"]) == (1080, 1920, "30/1") and abs(info["duration"] - 4.0) < 0.2
    first, second = frame(clip, 0.1, lib / "z0.png"), frame(clip, 2.0, lib / "z1.png")
    assert changed_pixels(first, second, (0, 0, 1080, 1920)) > 50000, "hình thật sự zoom theo thời gian"
    mtime = clip.stat().st_mtime_ns
    assert backgrounds.prepare_cover_clip(cover, "9:16") == clip and clip.stat().st_mtime_ns == mtime
    merged = backgrounds.build_cover_background(cover, 10, "9:16")
    assert _probe(merged)["duration"] >= 10 and not list(video_service.MERGE_DIR.glob(".bg_*.txt"))
    landscape = backgrounds.prepare_cover_clip(cover, "16:9")
    assert next(s for s in _probe(landscape)["streams"] if s["codec_type"] == "video")["width"] == 1920


def test_cover_background_needs_existing_image(lib):
    with pytest.raises(ValueError, match="thumbnail"):
        backgrounds.prepare_cover_clip(lib / "khong_co.jpg", "9:16")


# ── Tích hợp pipeline ────────────────────────────────────────────────────────

def test_run_one_applies_speed_overlay_and_cover(audio_dirs, lib, monkeypatch, cover):
    monkeypatch.setattr(backgrounds, "COVER_LOOP_SECONDS", 4)
    voice = lib / "voice10.wav"
    _ff("-f", "lavfi", "-i", "anoisesrc=d=10:c=pink:a=0.1", str(voice))
    import io, json, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.json", json.dumps({"items": [{"filename": "vo_0.wav"}]}))
        z.writestr("vo_0.wav", voice.read_bytes())

    async def fake_tts(items, voice_id):
        return buf.getvalue()

    monkeypatch.setattr(aw, "tts_batch", fake_tts)
    steps = []
    original = aw._set
    monkeypatch.setattr(aw, "_set", lambda job_id, **v: (steps.append(v["step"]) if "step" in v else None, original(job_id, **v))[1])
    logo_dir = aw.logo_dir()
    logo_dir.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (200, 200), (0, 255, 0, 255)).save(logo_dir / "abcdef012345.png")

    options = AudioOptions(voice_speed=1.25, bg_mode="cover", title_card="intro", waveform=True, logo_id="abcdef012345", dim=0.2)
    job_id = aw.create("Ta Là Tạ Uyển", "Chương 1")
    name = asyncio.run(aw._run_one(job_id, "Ta Là Tạ Uyển", "Mở đầu", "nội dung", "v", "9:16", 1, cover, None, options=options))
    out = aw.AUDIO_DIR / name
    info = _probe(out)
    assert abs(info["duration"] - 8.0) < 0.4, "10 giây ×1.25 → 8 giây"
    assert steps.index("merge") < steps.index("overlay") < steps.index("mux")
    assert aw.AUDIO_JOBS[job_id]["skipped_steps"] == ["bgm"]
    assert not list((aw.AUDIO_DIR / ".tmp").glob("*")), "dọn sạch file tạm kể cả overlay"


def test_run_one_clear_errors(audio_dirs, lib, monkeypatch):
    _patch_pipeline(monkeypatch, lib, [])
    job = aw.create("T", "C")
    with pytest.raises(RuntimeError, match="thumbnail"):
        asyncio.run(aw._run_one(job, "T", "C", "x", "v", "9:16", 1, None, None, options=AudioOptions(bg_mode="cover")))
    with pytest.raises(RuntimeError, match="logo"):
        asyncio.run(aw._run_one(job, "T", "C", "x", "v", "9:16", 1, None, None, options=AudioOptions(logo_id="abcdef012345")))


# ── API ──────────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(audio_dirs):
    app = FastAPI()
    app.include_router(audio_router.router)
    return TestClient(app)


def test_logo_upload_serve_and_validation(client, monkeypatch):
    png = lib_png = None
    import io
    buf = io.BytesIO()
    Image.new("RGBA", (40, 40), (1, 2, 3, 255)).save(buf, "PNG")
    r = client.post("/api/audio/logo", files={"file": ("logo.png", buf.getvalue(), "image/png")})
    assert r.status_code == 201
    logo_id = r.json()["logo_id"]
    assert re.fullmatch(r"[a-f0-9]{12}", logo_id)
    assert client.get(f"/api/audio/logo/{logo_id}").status_code == 200
    assert client.get("/api/audio/logo/aaaaaaaaaaaa").status_code == 404
    assert client.get("/api/audio/logo/..%2Fx").status_code in (404, 422)
    assert client.post("/api/audio/logo", files={"file": ("x.gif", b"GIF89a", "image/gif")}).status_code == 400
    assert client.post("/api/audio/logo", files={"file": ("x.png", b"", "image/png")}).status_code == 400
    monkeypatch.setattr(audio_router, "MAX_LOGO_BYTES", 10)
    assert client.post("/api/audio/logo", files={"file": ("x.png", b"x" * 50, "image/png")}).status_code == 400


def test_run_validates_options_and_preflight(client, lib):
    body = {"story_slug": "s", "chapter_number": 1, "voice_id": "v"}
    assert client.post("/api/audio/run", json={**body, "options": {"voice_speed": 5}}).status_code == 422
    r = client.post("/api/audio/run", json={**body, "options": {"bg_mode": "cover", "logo_id": "abcdef012345"}})
    assert r.status_code == 400 and "logo" in r.json()["detail"]
    r = client.post("/api/audio/run", json=body)
    assert r.status_code == 400 and "Thư viện nền" in r.json()["detail"]
    # chế độ ảnh bìa không cần thư viện nền: qua được bước kiểm tra này (sau đó mới tới tra truyện)
    r = client.post("/api/audio/run", json={**body, "options": {"bg_mode": "cover"}})
    assert "Thư viện nền" not in str(r.json().get("detail", ""))


def test_pick_bgm_pool_specific_track(tmp_path):
    from types import SimpleNamespace
    files = [tmp_path / f"{n}.mp3" for n in ("a", "b")]
    for f in files:
        f.write_bytes(b"x")
    tracks = [SimpleNamespace(track_id="t1", file_path=str(files[0])), SimpleNamespace(track_id="t2", file_path=str(files[1])), SimpleNamespace(track_id="t3", file_path=str(tmp_path / "missing.mp3"))]
    original = audio_router.bgm_service.list_tracks
    audio_router.bgm_service.list_tracks = lambda db: tracks
    try:
        assert audio_router._pick_bgm_pool(None, AudioOptions()) == files
        assert audio_router._pick_bgm_pool(None, AudioOptions(bgm_track_id="t2")) == [files[1]]
        with pytest.raises(Exception, match="bài nhạc nền đã chọn"):
            audio_router._pick_bgm_pool(None, AudioOptions(bgm_track_id="t3"))
    finally:
        audio_router.bgm_service.list_tracks = original


def test_preview_endpoint(client, lib, cover, monkeypatch):
    monkeypatch.setattr(backgrounds, "COVER_LOOP_SECONDS", 4)
    r = client.post("/api/audio/preview", json={})
    assert r.status_code == 400 and "Thư viện nền" in r.json()["detail"]
    r = client.post("/api/audio/preview", json={"options": {"bg_mode": "cover"}})
    assert r.status_code == 400 and "thumbnail" in r.json()["detail"]
    assert client.post("/api/audio/preview", json={"seconds": 99}).status_code == 422

    add_source(lib, "p.mp4", size="320x568", seconds=4)
    plain = client.post("/api/audio/preview", json={"seconds": 3})
    assert plain.status_code == 200
    assert client.get(f"/api/audio/preview/{plain.json()['file_name']}").headers["content-type"] == "video/mp4"
    styled = client.post("/api/audio/preview", json={"seconds": 3, "aspect": "16:9", "options": {"dim": 0.3, "title_card": "always", "waveform": True}})
    assert styled.status_code == 200
    file = audio_router._previews_dir() / styled.json()["file_name"]
    video = next(s for s in _probe(file)["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1920, 1080)
    assert not list(audio_router._previews_dir().glob(".w_*")) and not list(video_service.MERGE_DIR.glob("bg_*.mp4")), "dọn thư mục tạm + nền tạm"
    assert client.get("/api/audio/preview/..%2F..%2Fx.mp4").status_code in (404, 422)
    assert client.get("/api/audio/preview/notpreview.mp4").status_code == 404


def test_preview_keeps_only_latest_files(client, lib, monkeypatch):
    add_source(lib, "p.mp4", size="320x568", seconds=4)
    monkeypatch.setattr(audio_router, "PREVIEW_KEEP", 2)
    for _ in range(4):
        assert client.post("/api/audio/preview", json={"seconds": 3}).status_code == 200
    assert len(list(audio_router._previews_dir().glob("preview_*.mp4"))) == 2
