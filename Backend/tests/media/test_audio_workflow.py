import asyncio
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app.media import audio_workflow as aw
from app.media import fonts, video_service

needs_ffmpeg = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="cần ffmpeg + ffprobe")


def _ff(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def _mean_db(path: Path) -> float:
    r = subprocess.run(["ffmpeg", "-i", str(path), "-af", "volumedetect", "-vn", "-f", "null", "-"], capture_output=True, text=True)
    return float(re.search(r"mean_volume: (-?[\d.]+) dB", r.stderr).group(1))


@pytest.fixture()
def audio_dirs(tmp_path, monkeypatch):
    root = tmp_path / "Viaudio"
    monkeypatch.setattr(aw, "AUDIO_DIR", root)
    monkeypatch.setattr(aw, "AUDIO_MANIFEST", root / "outputs.json")
    monkeypatch.setattr(aw, "AUDIO_HISTORY", root / "audio_history.json")
    monkeypatch.setattr(aw, "AUDIO_THUMBNAIL_DIR", root / "thumbnails")
    aw.AUDIO_JOBS.clear()
    return root


# ── font ─────────────────────────────────────────────────────────

def test_find_font_returns_existing_file():
    font = fonts.find_font()
    assert font is not None and font.is_file()


@needs_ffmpeg
def test_video_label_uses_fontfile(tmp_path, monkeypatch):
    monkeypatch.setattr(video_service, "OUTPUT_DIR", tmp_path / "out")
    src = tmp_path / "in.mp4"
    _ff("-f", "lavfi", "-i", "color=c=red:s=320x240:d=1", "-pix_fmt", "yuv420p", str(src))
    item = {"video_id": "v1", "file_path": str(src), "duration_sec": 1.0, "name": "in.mp4"}
    out = video_service.transform(item, {"aspect": "9:16", "label": "Xin chào: thế giới", "remove_audio": True})
    assert out.exists() and out.stat().st_size > 0


# ── mux ──────────────────────────────────────────────────────────────────────

@needs_ffmpeg
def test_mux_with_bgm_does_not_halve_voice_level(tmp_path):
    vid, voice, bgm = tmp_path / "v.mp4", tmp_path / "voice.wav", tmp_path / "bgm.mp3"
    _ff("-f", "lavfi", "-i", "color=c=red:s=320x240:d=12", "-pix_fmt", "yuv420p", str(vid))
    _ff("-f", "lavfi", "-i", "sine=frequency=300:duration=10", "-af", "volume=0.5", str(voice))
    _ff("-f", "lavfi", "-i", "sine=frequency=900:duration=5", str(bgm))
    plain, mixed = tmp_path / "plain.mp4", tmp_path / "mixed.mp4"
    aw._mux(vid, voice, plain, None)
    aw._mux(vid, voice, mixed, bgm)
    # Trước khi sửa amix mặc định: giảm ~5.8 dB. Giờ nhạc nền chỉ được làm nhỏ/đệm thêm, không được kéo tụt giọng.
    assert _mean_db(mixed) > _mean_db(plain) - 2.0


# ── video_service ────────────────────────────────────────────────────────────

# ── voice-service bận / timeout ──────────────────────────────────────────────

def test_tts_retries_when_voice_busy(audio_dirs, monkeypatch):
    monkeypatch.setattr(aw, "TTS_BUSY_DELAY_SEC", 0)
    calls = {"n": 0}

    async def flaky(items, voice_id):
        calls["n"] += 1
        if calls["n"] < 3:
            raise aw.VoiceBusyError("busy")
        return b"zip"

    monkeypatch.setattr(aw, "tts_batch", flaky)
    job_id = aw.create("S", "C")
    assert asyncio.run(aw._tts_with_retry(job_id, [{"text": "x"}], "v")) == b"zip"
    assert calls["n"] == 3


def test_tts_gives_up_after_retries_with_clear_message(audio_dirs, monkeypatch):
    monkeypatch.setattr(aw, "TTS_BUSY_DELAY_SEC", 0)
    monkeypatch.setattr(aw, "TTS_BUSY_RETRIES", 2)
    calls = {"n": 0}

    async def always_busy(items, voice_id):
        calls["n"] += 1
        raise aw.VoiceBusyError("busy")

    monkeypatch.setattr(aw, "tts_batch", always_busy)
    with pytest.raises(RuntimeError, match="vẫn bận sau 2 lần"):
        asyncio.run(aw._tts_with_retry(aw.create("S", "C"), [{"text": "x"}], "v"))
    assert calls["n"] == 3


def test_tts_does_not_retry_other_errors(audio_dirs, monkeypatch):
    async def broken(items, voice_id):
        raise RuntimeError("giọng không tồn tại")

    monkeypatch.setattr(aw, "tts_batch", broken)
    with pytest.raises(RuntimeError, match="giọng không tồn tại"):
        asyncio.run(aw._tts_with_retry(aw.create("S", "C"), [{"text": "x"}], "v"))


def _voice_client_with(monkeypatch, handler):
    import httpx
    from app.voices import voice_client
    monkeypatch.setattr(voice_client, "_client", lambda timeout: httpx.AsyncClient(base_url="http://voice.test", transport=httpx.MockTransport(handler)))
    return voice_client


def test_voice_client_429_raises_busy_error(monkeypatch):
    import httpx
    vc = _voice_client_with(monkeypatch, lambda req: httpx.Response(429, text="Voice Service đang bận"))
    with pytest.raises(vc.VoiceBusyError):
        asyncio.run(vc.tts_batch([{"text": "x"}], "v"))


def test_voice_client_timeout_not_reported_as_connection_failure(monkeypatch):
    import httpx

    def slow(req):
        raise httpx.ReadTimeout("slow", request=req)

    vc = _voice_client_with(monkeypatch, slow)
    with pytest.raises(RuntimeError) as exc:
        asyncio.run(vc.tts_batch([{"text": "x"}], "v"))
    assert "timeout" in str(exc.value) and "Không kết nối được" not in str(exc.value)

    def refused(req):
        raise httpx.ConnectError("refused", request=req)

    vc = _voice_client_with(monkeypatch, refused)
    with pytest.raises(RuntimeError, match="Không kết nối được"):
        asyncio.run(vc.tts_batch([{"text": "x"}], "v"))


# ── thumbnail_index khớp thumbnail_path ──────────────────────────────────────

def test_thumbnail_index_matches_thumbnail_path(audio_dirs):
    thumbs = audio_dirs / "thumbnails"
    thumbs.mkdir(parents=True)
    (thumbs / "truyen-a.jpg").write_bytes(b"x")
    (thumbs / "truyen-a.png").write_bytes(b"x")      # png ưu tiên hơn jpg
    (thumbs / "truyen-b.webp").write_bytes(b"x")
    (thumbs / "truyen-c.png").write_bytes(b"")        # rỗng -> bỏ qua
    (thumbs / "Ten_chuong_1_ab12.jpg").write_bytes(b"x")  # poster của video, không phải thumbnail truyện
    index = aw.thumbnail_index()
    for slug in ("truyen-a", "truyen-b", "truyen-c", "khong-co"):
        path = aw.thumbnail_path(slug)
        assert index.get(aw._safe_name(slug)) == (path.name if path else None), slug


# ── /api/audio/config + /stories ─────────────────────────────────────────────

def _audio_client(audio_dirs):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.core.database import Base
    from app.db import get_db
    from app.media import audio_router
    from app.stories.models import CrawledChapter, CrawledStory, StorySummary

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        db.add_all([
            CrawledStory(story_slug="b-story", name="B"),
            CrawledStory(story_slug="a-story", name="A"),
            CrawledStory(story_slug="a2-story", name="A"),  # trùng tên với a-story
            CrawledStory(story_slug="c-story", name="C", description="x" * 1000),
        ])
        db.flush()
        db.add_all([
            CrawledChapter(chapter_key="a-story:2", story_slug="a-story", chapter_number=2, title="Hai", paragraph="p2"),
            CrawledChapter(chapter_key="a-story:1", story_slug="a-story", chapter_number=1, title="Một", paragraph="p1"),
            CrawledChapter(chapter_key="a-story:3", story_slug="a-story", chapter_number=3, title="Ba", paragraph="p3"),
            CrawledChapter(chapter_key="a2-story:1", story_slug="a2-story", chapter_number=1, title="A2-1", paragraph="q"),
            CrawledChapter(chapter_key="c-story:1", story_slug="c-story", chapter_number=1, title="C1", paragraph="r"),
        ])
        db.add(StorySummary(story_slug="a-story", summary="tóm tắt", chapters_count=3))
        db.commit()
    aw._write_history([
        {"story_slug": "a-story", "story_name": "A", "chapter_number": 1, "file_name": "f.mp4", "status": "uploaded", "drive_uploaded": True},
        {"story_slug": None, "story_name": "C", "chapter_number": 1, "file_name": "g.mp4", "status": "completed"},   # chỉ khớp theo tên
        {"story_slug": "a-story", "story_name": "A", "chapter_number": 3, "file_name": "h.mp4", "status": "error"},  # lỗi -> không tính
        {"story_slug": "b-story", "story_name": "B", "chapter_number": 99, "file_name": "i.mp4", "status": "completed"},  # chương không tồn tại
    ])
    (audio_dirs / "thumbnails").mkdir(parents=True)
    (audio_dirs / "thumbnails" / "a-story.png").write_bytes(b"x")

    app = FastAPI()
    app.include_router(audio_router.router)

    def override():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = override
    return TestClient(app), engine


def test_config_endpoint(audio_dirs):
    client, _ = _audio_client(audio_dirs)
    assert client.get("/api/audio/config").json() == {"output_dir": str(audio_dirs)}


def test_stories_list_is_light_with_counts(audio_dirs):
    client, _ = _audio_client(audio_dirs)
    data = client.get("/api/audio/stories").json()
    assert all(set(item) == {"story_slug", "name", "thumbnail_name", "has_cover", "total_chapters", "done_chapters", "has_summary"} for item in data), "không trả chương/cột nặng"
    by = {item["story_slug"]: item for item in data}
    assert [item["story_slug"] for item in data] == ["a-story", "a2-story", "b-story", "c-story"]  # theo tên rồi slug
    assert by["a-story"]["thumbnail_name"] == "a-story.png" and by["b-story"]["thumbnail_name"] is None
    assert (by["a-story"]["total_chapters"], by["a-story"]["done_chapters"]) == (3, 1)
    assert (by["a2-story"]["total_chapters"], by["a2-story"]["done_chapters"]) == (1, 1), "tên trùng 'A' + chương 1 => cũng tính là đã làm (giữ đúng logic cũ)"
    assert (by["b-story"]["total_chapters"], by["b-story"]["done_chapters"]) == (0, 0), "chương 99 không tồn tại thì không được đếm"
    assert (by["c-story"]["total_chapters"], by["c-story"]["done_chapters"]) == (1, 1), "khớp theo tên (không có slug)"
    assert [item["has_summary"] for item in data] == [True, False, False, False], "chỉ a-story có bản tóm tắt"


def test_stories_list_uses_constant_number_of_queries(audio_dirs):
    from sqlalchemy import event
    client, engine = _audio_client(audio_dirs)
    count = {"n": 0}

    @event.listens_for(engine, "before_cursor_execute")
    def _count(*args, **kwargs):
        count["n"] += 1

    client.get("/api/audio/stories")
    assert count["n"] <= 4, f"N+1 quay lại? {count['n']} truy vấn"


def test_chapter_content_endpoint(audio_dirs):
    client, _ = _audio_client(audio_dirs)
    data = client.get("/api/audio/stories/a-story/chapters/2").json()
    assert data == {"story_slug": "a-story", "chapter_number": 2, "title": "Hai", "paragraph": "p2", "chars": 2}
    assert client.get("/api/audio/stories/a-story/chapters/99").status_code == 404
    assert client.get("/api/audio/stories/khong-co/chapters/1").status_code == 404


def test_story_chapters_endpoint(audio_dirs):
    client, _ = _audio_client(audio_dirs)
    data = client.get("/api/audio/stories/a-story/chapters").json()
    assert data["story_slug"] == "a-story"
    assert data["chapters"] == [
        {"chapter_number": 1, "title": "Một", "completed": True, "drive_uploaded": True},
        {"chapter_number": 2, "title": "Hai", "completed": False, "drive_uploaded": False},
        {"chapter_number": 3, "title": "Ba", "completed": False, "drive_uploaded": False},
    ]
    assert client.get("/api/audio/stories/khong-co/chapters").status_code == 404


# ── merge_done_videos: chia nhóm khi quá nhiều clip ──────────────────────────

def _make_done_library(tmp_path, monkeypatch, clips=3, seconds=4, audio=True):
    monkeypatch.setattr(video_service, "VIDEO_DIR", tmp_path / "videos")
    monkeypatch.setattr(video_service, "DONE_FILE", tmp_path / "videos" / "done.json")
    monkeypatch.setattr(video_service, "MERGE_DIR", tmp_path / "videos" / "MergeVideo")
    (tmp_path / "videos").mkdir()
    done = []
    for i in range(clips):
        p = tmp_path / "videos" / f"clip{i}.mp4"
        args = ["-f", "lavfi", "-i", f"testsrc=s=320x568:d={seconds}:r=25"]
        if audio:
            args += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest"]
        _ff(*args, "-pix_fmt", "yuv420p", str(p))
        done.append({"done_id": f"d{i}", "name": p.name, "file_path": str(p), "aspect": "9:16"})
    video_service.DONE_FILE.write_text(json.dumps(done), encoding="utf-8")


def _duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True)
    return float(r.stdout.strip())


@needs_ffmpeg
@pytest.mark.parametrize("max_inputs", [60, 2])
def test_merge_hits_target_duration_single_and_chunked(tmp_path, monkeypatch, max_inputs):
    _make_done_library(tmp_path, monkeypatch, clips=3, seconds=4)
    monkeypatch.setattr(video_service, "MAX_CONCAT_INPUTS", max_inputs)  # 2 => buộc đi đường chia nhóm
    result = video_service.merge_done_videos(11, None, True, "9:16")
    out = Path(result["file_path"])
    assert out.exists()
    assert abs(_duration(out) - 11.0) < 0.35, _duration(out)
    assert not list(video_service.MERGE_DIR.glob(".parts_*")), "thư mục đoạn tạm phải bị xóa"
    assert [p.name for p in video_service.MERGE_DIR.glob("*")] == [out.name]


@needs_ffmpeg
def test_merge_chunked_failure_cleans_up(tmp_path, monkeypatch):
    _make_done_library(tmp_path, monkeypatch, clips=2, seconds=3, audio=False)
    monkeypatch.setattr(video_service, "MAX_CONCAT_INPUTS", 1)

    def boom(*a, **k):
        raise RuntimeError("ffmpeg hỏng")

    monkeypatch.setattr(video_service, "_concat_clips", boom)
    with pytest.raises(RuntimeError, match="ffmpeg hỏng"):
        video_service.merge_done_videos(5, None, True, "9:16")
    assert list(video_service.MERGE_DIR.glob("*")) == []
