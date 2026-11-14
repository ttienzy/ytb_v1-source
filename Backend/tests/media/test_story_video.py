"""Workflow Audio v2: văn bản → dòng đọc, phụ đề/ASS, đọc theo dòng có cache, ảnh bìa/thumbnail, video cả truyện / từng chương."""
import asyncio
import io
import json
import math
import struct
import subprocess
import wave
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from app.media import audio_workflow as aw
from app.media import narration, story_art, story_video
from app.media import story_text as st
from app.media.audio_options import AudioOptions
from test_audio_workflow import audio_dirs, needs_ffmpeg  # noqa: F401  (fixture dùng chung)

# ── story_text ───────────────────────────────────────────────────────────────


def test_clean_lines_drops_leading_chapter_number_and_separators():
    text = "1\n\n  Cái chết của ta,  có lẽ…  \n***\n“Chàng về sớm nhé.”\n---\n2 người đi.\n"
    assert st.clean_lines(text) == ["Cái chết của ta, có lẽ…", '"Chàng về sớm nhé."', "2 người đi."]
    assert st.clean_lines("Chương 3\nNội dung")[0] == "Nội dung"
    assert st.clean_lines("Chương 3: Gặp lại\nNội dung")[0] == "Chương 3: Gặp lại", "tiêu đề có tên chương thì giữ (đọc lên tự nhiên)"
    assert st.clean_lines("") == [] and st.clean_lines("\n***\n") == []


def test_names():
    assert st.clean_name("  TA  LÀ TẠ UYỂN ") == "TA LÀ TẠ UYỂN"
    assert st.spoken_name(" TA LÀ TẠ UYỂN") == "Ta là tạ uyển"
    assert st.spoken_name("Ván cờ") == "Ván cờ"


def test_build_cues_offsets_gaps_and_speed():
    cues, end = st.build_cues(["Một.", "Hai."], [2.0, 3.0], offset=10.0, gap=0.5)
    assert [(c.start, c.end, c.text) for c in cues] == [(10.0, 12.0, "Một."), (12.5, 15.5, "Hai.")]
    assert end == pytest.approx(15.5)
    fast, end2 = st.build_cues(["Một.", "Hai."], [2.0, 3.0], gap=0.5, speed=1.25)
    assert fast[1].start == pytest.approx(2.0) and end2 == pytest.approx(4.4), "atempo ×1.25 co mọi mốc (kể cả khoảng lặng)"
    with pytest.raises(ValueError):
        st.build_cues(["a"], [1.0, 2.0])


def test_build_cues_splits_long_line_proportionally():
    line = "Câu thứ nhất khá dài để thử cắt phụ đề. " * 2 + "Câu cuối."
    cues, end = st.build_cues([line], [9.0], max_chars=50)
    # 3 câu (39, 39, 9 ký tự): câu ngắn cuối được gộp với câu trước vì vẫn vừa 50 ký tự.
    assert [len(c.text) for c in cues] == [39, 49] and all(len(c.text) <= 50 for c in cues)
    assert cues[0].end == pytest.approx(9.0 * 39 / 88, abs=0.001), "chia thời lượng theo số ký tự (mốc làm tròn ms)"
    assert cues[0].start == 0 and cues[-1].end == pytest.approx(9.0) and end == pytest.approx(9.0)
    assert all(a.end == pytest.approx(b.start) for a, b in zip(cues, cues[1:])), "các mẩu nối tiếp liền nhau"


def test_plan_parts_never_splits_a_chapter_and_merges_short_tail():
    per_min = int(st.CHARS_PER_SECOND * 60)
    assert st.plan_parts([per_min * 30, per_min * 30], 120 * 60) == [[0, 1]]
    assert st.plan_parts([per_min * 70, per_min * 70, per_min * 70], 120 * 60) == [[0], [1], [2]]
    assert st.plan_parts([per_min * 100, per_min * 10], 100 * 60) == [[0, 1]], "tập cuối < 1/4 ngưỡng gộp vào tập trước"
    assert st.plan_parts([per_min * 200], 60 * 60) == [[0]], "chương dài hơn ngưỡng vẫn nguyên một tập"


def test_chapter_timestamps_and_ass():
    assert st.chapter_timestamps([(0, "Chương 1"), (225.8, "Chương 2"), (3725, "Chương 9")]) == "00:00 Chương 1\n03:45 Chương 2\n1:02:05 Chương 9"
    cues = [st.Cue(0.0, 1.5, "Xin {chào}")]
    ass = st.to_ass(1920, 1080, [st.AssStyle("Sub", 50)], st.subtitle_events(cues))
    assert "PlayResX: 1920" in ass and "Style: Sub,Be Vietnam Pro ExtraBold,50," in ass
    assert "Dialogue: 0,0:00:00.00,0:00:01.50,Sub,,0,0,0,,Xin (chào)" in ass, "ngoặc nhọn là thẻ ASS → phải thay"
    cta = st.cta_events(400, "ĐĂNG KÝ", pos=(100, 200), first=20, every=150, show=7)
    assert len(cta) == 3 and "\\pos(100,200)" in cta[0]
    labels = st.label_events([(0, "Chương 1"), (50, "Chương 2")], 80, pos=(1, 2))
    assert "0:00:50.00,0:01:20.00,Label" in labels[1]


# ── narration ────────────────────────────────────────────────────────────────

RATE = 48000


def _tone(seconds: float) -> bytes:
    frames = int(seconds * RATE)
    return b"".join(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 220 * i / RATE))) for i in range(frames))


def _wav_bytes(seconds: float) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(_tone(seconds))
    return buf.getvalue()


def fake_tts(calls: list, seconds_per_char: float = 0.02):
    """TTS giả: mỗi item một wav dài theo số ký tự (đủ thật để ffmpeg/wave xử lý)."""
    async def tts(items, voice_id):
        calls.append([item["text"] for item in items])
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            manifest = []
            for i, item in enumerate(items):
                zf.writestr(f"vo_{i}.wav", _wav_bytes(max(0.2, len(item["text"]) * seconds_per_char)))
                manifest.append({"index": i, "filename": f"vo_{i}.wav", "duration": 0})
            zf.writestr("manifest.json", json.dumps({"items": manifest}))
        return buf.getvalue()
    return tts


def test_batches_respect_item_and_char_limits(monkeypatch):
    monkeypatch.setattr(narration, "MAX_ITEMS_PER_BATCH", 3)
    monkeypatch.setattr(narration, "MAX_CHARS_PER_BATCH", 10)
    assert narration.batches(["aaaa", "bbbb", "cc", "d", "e", "f"]) == [["aaaa", "bbbb", "cc"], ["d", "e", "f"]]  # 10 ký tự / 3 item
    assert narration.batches(["aaaaaa", "bbbbbb", "c"]) == [["aaaaaa"], ["bbbbbb", "c"]], "vượt 10 ký tự → lô mới"


def test_narrate_joins_with_gaps_and_uses_cache(tmp_path):
    calls: list = []
    lines = ["Một câu.", "Hai câu dài hơn một chút."]
    result = asyncio.run(narration.narrate(lines, "v", fake_tts(calls), tmp_path, gap=0.5))
    assert not result.cached and len(calls) == 1 and calls[0] == lines
    assert result.durations == [pytest.approx(0.2), pytest.approx(0.5)]
    with wave.open(str(result.wav)) as w:
        assert w.getnframes() / w.getframerate() == pytest.approx(0.2 + 0.5 + 0.5, abs=0.01)
    again = asyncio.run(narration.narrate(lines, "v", fake_tts(calls), tmp_path, gap=0.5))
    assert again.cached and len(calls) == 1, "lần hai không gọi TTS"
    asyncio.run(narration.narrate(lines, "giong-khac", fake_tts(calls), tmp_path, gap=0.5))
    assert len(calls) == 2, "đổi giọng → khóa cache khác"


def test_narrate_rejects_short_manifest(tmp_path):
    async def broken(items, voice_id):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("vo_0.wav", _wav_bytes(0.2))
            zf.writestr("manifest.json", json.dumps({"items": [{"index": 0, "filename": "vo_0.wav"}]}))
        return buf.getvalue()
    with pytest.raises(RuntimeError, match="trả 1 đoạn, cần 2"):
        asyncio.run(narration.narrate(["a", "b"], "v", broken, tmp_path))


def test_concat_wavs_streams_with_gap(tmp_path):
    a, b = tmp_path / "a.wav", tmp_path / "b.wav"
    a.write_bytes(_wav_bytes(0.3))
    b.write_bytes(_wav_bytes(0.4))
    out = tmp_path / "out.wav"
    narration.concat_wavs([a, b], 1.0, out, chunk_frames=1000)
    with wave.open(str(out)) as w:
        assert w.getnframes() / RATE == pytest.approx(1.7, abs=0.001)


# ── story_art ────────────────────────────────────────────────────────────────

@pytest.fixture()
def cover(tmp_path) -> Path:
    path = tmp_path / "cover.png"
    Image.new("RGB", (600, 800), (200, 80, 60)).save(path)
    return path


def test_cover_url_and_missing_image(tmp_path):
    assert story_art.cover_url("/img/x.png") == "https://daotruyen.me/img/x.png"
    assert story_art.cover_url("img/x.png") == "https://daotruyen.me/img/x.png"
    assert story_art.cover_url("https://a.b/c.png") == "https://a.b/c.png"
    assert story_art.cover_url("") is None
    with pytest.raises(story_art.CoverError, match="không có ảnh bìa"):
        story_art.download_cover(tmp_path, "slug", None)
    assert story_art.fetch_cover(tmp_path, "slug", None) is None


def test_download_cover_uses_cache_and_reports_errors(tmp_path, monkeypatch):
    import httpx
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, "PNG")
    responses = iter([httpx.ConnectError("mất mạng"), httpx.Response(200, content=buf.getvalue(), request=httpx.Request("GET", "http://x"))])

    def fake_get(url, **kwargs):
        item = next(responses)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(httpx, "get", fake_get)
    path = story_art.download_cover(tmp_path, "ta-la", "/img/a.png")
    assert path.name == "ta-la.png" and path.read_bytes() == buf.getvalue(), "lỗi mạng lần đầu → thử lại thành công"
    monkeypatch.setattr(httpx, "get", lambda *a, **k: pytest.fail("đã có cache thì không tải lại"))
    assert story_art.download_cover(tmp_path, "ta-la", "/img/a.png") == path
    monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(200, content=b"<html>", request=httpx.Request("GET", "http://x")))
    with pytest.raises(story_art.CoverError, match="không tải được"):
        story_art.download_cover(tmp_path, "khac", "/img/b.png")


@pytest.mark.parametrize("aspect", ["16:9", "9:16"])
def test_frame_and_thumbnail_sizes(tmp_path, cover, aspect):
    frame = story_art.compose_frame(cover, aspect, "Con Gái Tôi Chết Trong Bồn Tắm, Máu Nhuộm Đỏ Dòng Nước", tmp_path / "f.png")
    assert Image.open(frame).size == story_art.SIZES[aspect]
    thumb = story_art.compose_thumbnail(cover, aspect, "Một cái tên rất rất dài để kiểm tra xuống dòng của thumbnail", "FULL", tmp_path / "t.jpg")
    assert Image.open(thumb).size == story_art.THUMB_SIZES[aspect]
    placeholder = story_art.placeholder_cover(tmp_path / "p.png")
    assert Image.open(placeholder).size == (900, 1200)


# ── story_video ──────────────────────────────────────────────────────────────

def _story(n_chapters=2, slug="truyen-a", image=None) -> story_video.StoryInput:
    chapters = [story_video.ChapterInput(i, f"Chương {i}", f"{i}\nCâu mở đầu chương {i}.\nCâu thứ hai của chương {i}.") for i in range(1, n_chapters + 1)]
    return story_video.StoryInput(slug=slug, name=" TRUYỆN THỬ NGHIỆM", chapters=chapters, image=image, description="Mô tả truyện.",
                                  categories=["HIỆN ĐẠI", "VẢ MẶT", "NULL"])


def test_plan_units_story_and_chapter_modes():
    story = _story(3)
    units = story_video.plan_units([story], story_video.VideoSpec(unit="story", voice_id="v", aspect="16:9"))
    assert len(units) == 1 and units[0].label == "FULL" and [c.number for c in units[0].chapters] == [1, 2, 3]
    units = story_video.plan_units([story], story_video.VideoSpec(unit="chapter", voice_id="v", aspect="9:16"))
    assert [u.label for u in units] == ["Chương 1", "Chương 2", "Chương 3"]
    assert story_video.video_title(units[1]) == "TRUYỆN THỬ NGHIỆM - Chương 2 | Truyện Audio"


def test_title_and_description():
    unit = story_video.plan_units([_story(2)], story_video.VideoSpec(unit="story", voice_id="v", aspect="16:9"))[0]
    assert story_video.video_title(unit) == "[Truyện Audio Full] TRUYỆN THỬ NGHIỆM"
    text = story_video.video_description(unit, [(0, "Chương 1"), (95, "Chương 2")])
    assert text.startswith("Mô tả truyện.") and "00:00 Chương 1\n01:35 Chương 2" in text
    assert text.endswith("#TruyenAudio #HienDai #VaMat"), "hashtag không dấu, bỏ thể loại NULL"


def _patch_tts(monkeypatch, calls):
    monkeypatch.setattr(aw, "tts_batch", fake_tts(calls))


@needs_ffmpeg
def test_produce_full_story_video(audio_dirs, cover, monkeypatch):
    calls: list = []
    _patch_tts(monkeypatch, calls)
    spec = story_video.VideoSpec(unit="story", voice_id="v", aspect="16:9", options=AudioOptions(voice_speed=1.25))
    unit = story_video.plan_units([_story(2, image=cover)], spec)[0]
    job = aw.create("t", "")
    record = asyncio.run(story_video.produce(job, unit, spec))
    out = aw.AUDIO_DIR / record["file_name"]
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", str(out)],
                                      capture_output=True, text=True).stdout)
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1920, 1080) and any(s["codec_type"] == "audio" for s in probe["streams"])
    # 3 lượt TTS: lời giới thiệu + 2 chương; chương có dòng "Chương N." đọc đầu và KHÔNG đọc dòng số "1"/"2" của dữ liệu crawl.
    assert calls[0] == ["Truyện thử nghiệm."] and calls[1][0] == "Chương 1." and "1" not in calls[1]
    assert record["video_title"] == "[Truyện Audio Full] TRUYỆN THỬ NGHIỆM" and record["chapters"] == [1, 2]
    assert [m["label"] for m in record["chapter_marks"]] == ["Chương 1", "Chương 2"] and record["chapter_marks"][0]["start"] == 0
    assert abs(float(probe["format"]["duration"]) - record["duration_sec"]) < 0.3
    assert (aw.AUDIO_THUMBNAIL_DIR / record["thumbnail_name"]).is_file()
    done = {(item["chapter_number"], item["file_name"]) for item in aw.history()}
    assert {(1, out.name), (2, out.name)} <= done, "mỗi chương của video cả truyện được ghi 'đã làm'"
    assert not list((aw.AUDIO_DIR / ".tmp").glob("*")), "dọn thư mục tạm"
    # Đổi bố cục rồi làm lại: không gọi TTS lần nào nữa (cache theo chương).
    spec2 = story_video.VideoSpec(unit="story", voice_id="v", aspect="9:16", options=AudioOptions(voice_speed=1.25, cta=False))
    before = len(calls)
    asyncio.run(story_video.produce(aw.create("t", ""), story_video.plan_units([_story(2, image=cover)], spec2)[0], spec2))
    assert len(calls) == before


@needs_ffmpeg
def test_produce_without_cover_uses_placeholder_and_warns(audio_dirs, monkeypatch):
    calls: list = []
    _patch_tts(monkeypatch, calls)
    monkeypatch.setattr(story_art, "download_cover", lambda *a, **k: (_ for _ in ()).throw(story_art.CoverError("mất mạng")))
    spec = story_video.VideoSpec(unit="chapter", voice_id="v", aspect="9:16", options=AudioOptions(subtitles=False, cta=False))
    record = asyncio.run(story_video.produce(aw.create("t", ""), story_video.plan_units([_story(1)], spec)[0], spec))
    assert "mất mạng" in record["warnings"][0] and (aw.AUDIO_DIR / record["file_name"]).is_file()


def test_build_ass_respects_toggles():
    cues = [st.Cue(0, 1, "a")]
    marks = [(0.0, "Chương 1"), (5.0, "Chương 2")]
    full = story_video.build_ass(cues, marks, 300, "16:9", AudioOptions())
    assert ",Sub,," in full and ",Label,," in full and ",Cta,," in full
    bare = story_video.build_ass(cues, marks, 300, "16:9", AudioOptions(subtitles=False, cta=False, chapter_label=False))
    assert "Dialogue" not in bare
    classic_title = story_video.build_ass(cues, marks, 300, "9:16", AudioOptions(layout="classic", title_card="always"))
    assert ",Label,," not in classic_title, "classic có thẻ tiêu đề thì không thêm nhãn chương chồng lên"


def test_run_videos_continues_after_failure_and_aborts_on_streak(audio_dirs, monkeypatch):
    calls: list[str] = []

    async def fake_produce(job_id, unit, spec, start=0, end=100):
        calls.append(unit.label)
        if unit.chapters[0].number in fail:
            raise RuntimeError(f"lỗi {unit.label}")
        return {"file_name": f"{unit.label}.mp4"}

    monkeypatch.setattr(story_video, "produce", fake_produce)
    spec = story_video.VideoSpec(unit="chapter", voice_id="v", aspect="9:16")
    fail = {2}
    job = aw.create("q", "")
    asyncio.run(story_video.run_videos(job, [_story(3)], spec))
    state = aw.AUDIO_JOBS[job]
    assert calls == ["Chương 1", "Chương 2", "Chương 3"] and state["status"] == "completed" and state["completed_videos"] == 2
    assert [f["label"] for f in state["failed_chapters"]] == ["Chương 2"] and [s["key"] for s in state["steps"]][0] == "prepare"
    calls.clear()
    fail = {1, 2, 3, 4}
    job = aw.create("q", "")
    asyncio.run(story_video.run_videos(job, [_story(5)], spec))
    assert calls == ["Chương 1", "Chương 2", "Chương 3"] and aw.AUDIO_JOBS[job]["status"] == "error"
