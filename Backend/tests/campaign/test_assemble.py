"""Ghép video hoàn chỉnh: nhịp đoạn, ngắt dòng chữ, ffmpeg thật trên clip tổng hợp, và giọng đọc qua voice-service giả."""
import io
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

from app.campaign.executors import assemble, voice
from app.campaign.runner import ExecContext

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="cần ffmpeg")


def test_plan_segment_follows_the_beat_and_stretches_for_long_voice():
    assert assemble.plan_segment(6.0, 3.0, 0.0) == (3.0, 1.0)                  # không có giọng: đúng nhịp
    assert assemble.plan_segment(6.0, None, 0.0) == (6.0, 1.0)                 # không đặt nhịp: dùng cả clip
    assert assemble.plan_segment(6.0, 99, 0.0) == (6.0, 1.0)                   # nhịp không vượt clip
    seconds, tempo = assemble.plan_segment(6.0, 3.0, 4.0)                      # lời dài hơn nhịp: nới đoạn, chưa cần tăng tốc
    assert seconds == pytest.approx(4.5) and tempo == 1.0
    seconds, tempo = assemble.plan_segment(6.0, 3.0, 9.0)                      # lời dài hơn cả clip: tăng tốc, có trần
    assert seconds == 6.0 and 1.0 < tempo <= assemble.MAX_ATEMPO


def test_wrap_caption_never_exceeds_the_width_unless_a_single_word_does():
    text = assemble.wrap_caption("Bộ thun trắng form rộng năng động cho ngày mới", 22)
    assert all(len(line) <= 22 for line in text.split(chr(10))) and text.replace(chr(10), " ") == "Bộ thun trắng form rộng năng động cho ngày mới"
    assert assemble.wrap_caption("", 22) == "" and assemble.wrap_caption("một", 22) == "một"


def make_clip(path: Path, seconds=3, w=180, h=320, color="red"):
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c={color}:s={w}x{h}:d={seconds}:r=24", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
                    "-t", str(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path)], check=True, capture_output=True)


def make_voice(path: Path, seconds=1.5):
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency=330:duration={seconds}", str(path)], check=True, capture_output=True)


def streams(path: Path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", str(path)],
                         capture_output=True, text=True).stdout
    data = json.loads(out)
    return [s["codec_type"] for s in data["streams"]], float(data["format"]["duration"]), data["streams"]


@pytest.fixture
def parts(tmp_path, svc):
    """3 shot: clip 3s (360p dọc, một clip khác kích thước), lời thoại, chữ."""
    cid = svc.create_campaign("asm")["id"]
    clips, voices, shots = [], [], []
    for i, color in enumerate(("red", "green", "blue"), start=1):
        clip = tmp_path / f"c{i}.mp4"
        make_clip(clip, 3, *((180, 320) if i != 2 else (160, 288)), color=color)          # shot 2 khác kích thước: phải được pad/scale
        clips.append({"element_key": f"shot:{i}", "path": str(clip)})
        shots.append({"key": f"shot:{i}", "beat_seconds": 2.0 if i == 1 else 3.0, "voiceover": f"đoạn {i}",
                      "on_screen_text": f"Chữ số {i} thật dài để thử ngắt dòng"})
        if i != 3:                                                                         # shot 3 không có giọng: phải im lặng chứ không lỗi
            v = tmp_path / f"v{i}.wav"
            make_voice(v, 1.5)
            voices.append({"role": f"shot:{i}", "path": str(v)})
    sc = tmp_path / "script.json"
    # Không có CTA -> không có thẻ kết, để các test về thời lượng giữ nguyên; thẻ kết/hook mở màn thử riêng ở dưới.
    sc.write_text(json.dumps({"items": shots, "hook": {"type": "direct", "on_screen_text": ""}, "cta": ""}), encoding="utf-8")
    inputs = {"clip": clips, "voice": voices, "script": [{"path": str(sc)}]}
    ctx = ExecContext(campaign_id=cid, step_key="assemble", element_key="", tier="draft", params={"edit_style": "shots"}, inputs=inputs, fingerprint="f", note="",
                      store=svc.store, set_external_ref=lambda r: None, cancelled=lambda: False)
    return ctx, tmp_path


def test_assemble_makes_one_complete_video_with_voice_captions_and_silence_for_missing_voice(parts):
    ctx, tmp = parts
    res = assemble.run_assemble(ctx)
    art = res.artifacts[0]
    out = tmp / "final.mp4"
    out.write_bytes(art.data)
    kinds, duration, st = streams(out)
    assert kinds.count("video") == 1 and kinds.count("audio") == 1                       # một video + một luồng tiếng liền mạch
    assert (st[0]["width"], st[0]["height"]) == (180, 320)                               # theo clip đầu, shot 2 được pad về cùng cỡ
    assert duration == pytest.approx(2.0 + 3.0 + 3.0, abs=0.4)                           # 2s (nhịp) + 3s + 3s (nhịp mặc định = cả clip)
    meta = art.meta
    assert meta["with_voice"] is True and [s["voice"] for s in meta["shots"]] == [True, True, False]
    assert all(s["caption"] for s in meta["shots"]) or meta["font"] is None
    assert not list((Path(ctx.store.campaign_dir(ctx.campaign_id)) / "tmp").glob("asm_*"))   # dọn thư mục tạm


def test_assemble_fails_clearly_when_a_shot_has_no_approved_clip(parts):
    ctx, _ = parts
    ctx.inputs["clip"] = ctx.inputs["clip"][:2]
    with pytest.raises(assemble.AssembleError, match="Thiếu clip đã duyệt cho: shot:3"):
        assemble.run_assemble(ctx)


def test_voice_executor_unpacks_the_batch_into_one_wav_per_shot(tmp_path, svc, monkeypatch):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps({"items": [{"index": 0, "duration": 1.1}, {"index": 1, "duration": 2.2}]}))
        zf.writestr("vo_0.wav", b"RIFF-a")
        zf.writestr("vo_1.wav", b"RIFF-b")
    seen = {}
    monkeypatch.setattr(voice, "_tts_batch", lambda items, voice_id: seen.update(items=items, voice=voice_id) or buf.getvalue())
    sc = tmp_path / "s.json"
    sc.write_text(json.dumps({"items": [{"key": "shot:1", "voiceover": "Xin chào"}, {"key": "shot:2", "voiceover": ""},
                                        {"key": "shot:3", "voiceover": "Mua ngay"}]}), encoding="utf-8")
    cid = svc.create_campaign("v")["id"]
    ctx = ExecContext(campaign_id=cid, step_key="voice", element_key="", tier="draft", params={"voice_id": "Trúc Ly"},
                      inputs={"script": [{"path": str(sc)}]}, fingerprint="f", note="", store=svc.store,
                      set_external_ref=lambda r: None, cancelled=lambda: False)
    res = voice.run_voice(ctx)
    assert seen["items"] == [{"text": "Xin chào"}, {"text": "Mua ngay"}] and seen["voice"] == "Trúc Ly"   # shot không có lời bị bỏ
    wavs, bundle = res.artifacts[:-1], res.artifacts[-1]
    assert [w.data for w in wavs] == [b"RIFF-a", b"RIFF-b"] and [w.meta["shot"] for w in wavs] == ["shot:1", "shot:3"]
    assert bundle.kind == "bundle" and bundle.members == [(0, "shot:1"), (1, "shot:3")] and res.primary == 2
    ctx.params = {}
    with pytest.raises(voice.VoiceError, match="Chưa chọn giọng"):
        voice.run_voice(ctx)


def test_caption_file_never_contains_carriage_returns(tmp_path):
    """Windows: write_text đổi LF thành CRLF, drawtext coi là dòng trống -> chữ cách dòng gấp đôi (lỗi thấy ở video thật)."""
    clip = tmp_path / "c.mp4"
    make_clip(clip, 2)
    work = tmp_path / "w"
    work.mkdir()
    font = next((Path(f) for f in assemble.FONT_CANDIDATES if Path(f).is_file()), None)
    if font is None:
        pytest.skip("không có font hệ thống")
    shutil.copyfile(font, work / "font.ttf")
    shutil.copyfile(clip, work / "in.mp4")
    assemble.build_segment(work, 0, work / "in.mp4", 2.0, 1.0, None, "Bộ thun trắng form rộng năng động cho ngày mới", (180, 320), True)
    files = sorted(work.glob("cap_0*.txt"))                       # kiểu mặc định "pop": mỗi dòng một file
    data = b"".join(f.read_bytes() for f in files)
    assert len(files) >= 2 and chr(13).encode() not in data and "năng động".encode() in data
    assemble.build_segment(work, 1, work / "in.mp4", 2.0, 1.0, None, "Bộ thun trắng form rộng năng động cho ngày mới", (180, 320), True, style="box")
    box = (work / "cap_1.txt").read_bytes()                       # kiểu hộp cũ: một file nhiều dòng
    assert chr(13).encode() not in box and box.count(chr(10).encode()) >= 1


# ── nhạc nền từ Thư viện nhạc ─────────────────────────────────────────────────
def _tail_volume(path: Path, start: float) -> float:
    """Âm lượng trung bình (dB) từ giây `start` tới hết; -91 coi như im lặng."""
    err = subprocess.run(["ffmpeg", "-ss", str(start), "-i", str(path), "-af", "volumedetect", "-vn", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    line = next((l for l in err.splitlines() if "mean_volume" in l), "")
    return float(line.split("mean_volume:")[1].split("dB")[0]) if line else -91.0


def test_bgm_volume_is_clamped_and_defaults():
    assert assemble.bgm_volume({}) == assemble.BGM_DEFAULT_VOLUME
    assert assemble.bgm_volume({"bgm_volume": "abc"}) == assemble.BGM_DEFAULT_VOLUME
    assert assemble.bgm_volume({"bgm_volume": 5}) == 0.6 and assemble.bgm_volume({"bgm_volume": 0}) == 0.02


def test_resolve_bgm_reports_missing_tracks_and_files(monkeypatch, tmp_path):
    from app.media import service as media
    assert assemble.resolve_bgm(None) == [] and assemble.resolve_bgm([]) == [] and assemble.resolve_bgm("") == []
    monkeypatch.setattr(media, "get_track", lambda db, tid: None)
    with pytest.raises(assemble.AssembleError, match="không còn trong Thư viện nhạc"):
        assemble.resolve_bgm(["abc"])
    from types import SimpleNamespace
    monkeypatch.setattr(media, "get_track", lambda db, tid: SimpleNamespace(name="Bài mất file", file_path=str(tmp_path / "none.mp3")))
    with pytest.raises(assemble.AssembleError, match="Bài mất file.*không còn trên đĩa"):
        assemble.resolve_bgm("x")
    real = tmp_path / "song.mp3"
    make_voice(real, 2)
    monkeypatch.setattr(media, "get_track", lambda db, tid: SimpleNamespace(name="Bài ổn", file_path=str(real)))
    assert assemble.resolve_bgm(["a"]) == [("Bài ổn", real)]


def test_assemble_mixes_library_music_under_the_voice_and_fills_the_silent_shot(parts, monkeypatch):
    ctx, tmp = parts
    plain = tmp / "plain.mp4"
    plain.write_bytes(assemble.run_assemble(ctx).artifacts[0].data)
    song = tmp / "song.wav"                                                            # nhạc ngắn hơn video: phải lặp cho đủ
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=3", str(song)], check=True, capture_output=True)
    monkeypatch.setattr(assemble, "resolve_bgm", lambda ids: [("Nhạc thử", song)])
    ctx.params = {"edit_style": "shots", "bgm": ["t1"], "bgm_volume": 0.3}
    res = assemble.run_assemble(ctx)
    mixed = tmp / "mixed.mp4"
    mixed.write_bytes(res.artifacts[0].data)
    kinds, duration, st = streams(mixed)
    assert kinds.count("video") == 1 and kinds.count("audio") == 1
    assert duration == pytest.approx(8.0, abs=0.4)                                     # nhạc không kéo dài hay cắt ngắn video
    assert (st[0]["width"], st[0]["height"]) == (180, 320)
    assert res.artifacts[0].meta["bgm"] == ["Nhạc thử"] and res.artifacts[0].meta["bgm_volume"] == 0.3
    # Shot 3 (giây 5.5 tới hết) không có giọng: bản không nhạc im lặng, bản có nhạc phải nghe được nhạc nền
    assert _tail_volume(plain, 5.8) < -60 and _tail_volume(mixed, 5.8) > -40


def test_assemble_stops_early_when_the_chosen_music_is_gone(parts, monkeypatch):
    from app.media import service as media
    monkeypatch.setattr(media, "get_track", lambda db, tid: None)
    ctx, _ = parts
    ctx.params = {"edit_style": "shots", "bgm": ["đã xóa"]}
    with pytest.raises(assemble.AssembleError, match="Thư viện nhạc"):
        assemble.run_assemble(ctx)
    assert not list((Path(ctx.store.campaign_dir(ctx.campaign_id)) / "tmp").glob("asm_*"))      # chưa kịp tạo thư mục tạm


# ── GĐ-H: phụ đề chữ viền, tăng tốc theo nhịp, chuyển cảnh ────────────────────
def test_bundled_vietnamese_font_ships_with_the_backend_and_is_preferred():
    font = assemble.bundled_font()
    assert font is not None and font.name == assemble.FONT_FILE and font.stat().st_size > 50_000
    assert (font.parent / "BeVietnamPro-OFL.txt").is_file()               # giấy phép đi kèm font
    assert assemble.find_font() == font


def test_caption_text_is_cleaned_and_laid_out_inside_the_safe_zone(tmp_path):
    assert assemble.clean_caption("Từ bình thường -> Siêu cuốn hút!") == "Từ bình thường: Siêu cuốn hút!"
    assert assemble.clean_caption("  a   b\n c ") == "a b c"
    filters = assemble.caption_filters(tmp_path, 0, "Set trắng đen tối giản, cá tính cho ngày dạo phố", (720, 1280), "pop", "yellow")
    assert len(filters) >= 2 and all("fontcolor=#FFE600" in f and "borderw=" in f and "box=1" not in f and "alpha=" in f for f in filters)
    ys = [int(f.split(":y=")[1].split(":")[0]) for f in filters]
    fs = int(filters[0].split("fontsize=")[1].split(":")[0])
    assert ys == sorted(ys) and ys[-1] + fs <= 1280 * assemble.CAPTION_SAFE_BOTTOM + 2          # đáy khối chữ không xuống vùng giao diện
    assert assemble.caption_filters(tmp_path, 1, "x", (720, 1280), "none", "white") == [] and assemble.caption_filters(tmp_path, 1, "", (720, 1280), "pop", "white") == []
    box = assemble.caption_filters(tmp_path, 2, "x y", (720, 1280), "box", "white")
    assert len(box) == 1 and "box=1" in box[0]


def test_plan_speed_speeds_the_clip_up_to_fit_the_beat_instead_of_chopping_the_action():
    assert assemble.plan_speed(6.0, 6.0) == 1.0 and assemble.plan_speed(6.0, 5.98) == 1.0
    assert assemble.plan_speed(6.0, 4.0) == pytest.approx(1.5) and assemble.plan_speed(6.0, 5.0) == pytest.approx(1.2)
    assert assemble.plan_speed(6.0, 3.0) == assemble.MAX_SPEED          # quá ngắn: tăng tối đa rồi cắt đuôi


def test_assemble_with_pop_captions_speed_up_and_crossfade_makes_a_shorter_valid_video(parts):
    ctx, tmp = parts
    ctx.params = {"edit_style": "shots", "transition": "fade", "caption_style": "pop", "caption_color": "yellow"}
    res = assemble.run_assemble(ctx)
    out = tmp / "xf.mp4"
    out.write_bytes(res.artifacts[0].data)
    kinds, duration, st = streams(out)
    assert kinds.count("video") == 1 and kinds.count("audio") == 1 and (st[0]["width"], st[0]["height"]) == (180, 320)
    td = assemble.TRANSITION_SECONDS
    assert duration == pytest.approx(2.0 + 3.0 + 3.0 - 2 * td, abs=0.4)         # 3 đoạn, 2 chỗ chuyển cảnh chồng nhau
    meta = res.artifacts[0].meta
    assert meta["transition"] == "fade" and meta["caption_style"] == "pop" and meta["caption_color"] == "yellow"
    assert meta["shots"][0]["speed"] == pytest.approx(1.5, abs=0.01)             # shot 1: clip 3s, nhịp 2s -> tăng tốc 1,5x
    assert meta["shots"][1]["speed"] == 1.0
    assert meta["font"] == assemble.FONT_FILE


@pytest.mark.parametrize("name", ["slide", "zoom"])
def test_every_transition_renders(parts, name):
    ctx, tmp = parts
    ctx.params = {"edit_style": "shots", "transition": name}
    res = assemble.run_assemble(ctx)
    p = tmp / f"{name}.mp4"
    p.write_bytes(res.artifacts[0].data)
    assert streams(p)[1] > 6.0 and res.artifacts[0].meta["transition"] == name


def test_unknown_assemble_options_fall_back_to_safe_defaults(parts):
    ctx, _ = parts
    ctx.params = {"edit_style": "shots", "transition": "spin", "caption_style": "neon", "caption_color": "pink"}
    meta = assemble.run_assemble(ctx).artifacts[0].meta
    assert (meta["transition"], meta["caption_style"], meta["caption_color"]) == ("cut", "pop", "white")


# ── Xóa watermark trên từng clip trước khi dựng ───────────────────────────────
def _fake_cleaner(calls):
    """Thay gwr: 'làm sạch' = tạo clip màu trắng cùng thời lượng (để kiểm video cuối dựng từ bản sạch)."""
    def run(src, dst, on_progress=None, cancelled=None):
        calls.append(Path(src).name)
        if on_progress:
            on_progress(10, 10)
        Path(dst).parent.mkdir(parents=True, exist_ok=True)
        make_clip(Path(dst), 3, 180, 320, color="white")
        return Path(dst)
    return run


def _mean_red(path: Path, at: float) -> float:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(at), "-i", str(path), "-frames:v", "1", "-vf", "scale=8:8", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True).stdout
    return sum(raw[0::3]) / max(1, len(raw) // 3), sum(raw[1::3]) / max(1, len(raw) // 3)


def test_remove_watermark_cleans_every_clip_before_editing_and_reuses_the_cache(parts, monkeypatch):
    from app.watermark import service as wm
    ctx, tmp = parts
    for i, c in enumerate(ctx.inputs["clip"], start=1):
        c["content_hash"] = f"hash{i}"
    calls: list[str] = []
    monkeypatch.setattr(wm, "remove_video_watermark_sync", _fake_cleaner(calls))
    ctx.params = {"edit_style": "shots", "caption_style": "none", assemble.EXPORT_CLEAN: True}
    art = assemble.run_assemble(ctx).artifacts[0]
    assert calls == ["c1.mp4", "c2.mp4", "c3.mp4"]                                   # mỗi clip gốc một lần, đúng thứ tự shot
    assert art.meta["watermark_removed"] is True and art.meta["watermark"] == {"removed": 3, "cached": 0}
    out = tmp / "final_wm.mp4"
    out.write_bytes(art.data)
    r, g = _mean_red(out, 4.0)                                                         # giữa shot 2 (gốc màu xanh lá)
    assert r > 200 and g > 200                                                         # hình là bản đã làm sạch (trắng), không phải bản gốc
    calls.clear()
    art2 = assemble.run_assemble(ctx).artifacts[0]                                     # ghép lại: dùng bản sạch đã lưu đệm
    assert calls == [] and art2.meta["watermark"] == {"removed": 0, "cached": 3}


def test_remove_watermark_failure_stops_instead_of_shipping_a_watermarked_video(parts, monkeypatch):
    from app.watermark import service as wm
    ctx, _ = parts

    def boom(src, dst, on_progress=None, cancelled=None):
        raise wm.WatermarkVideoError("gwr không xóa được watermark: không nhận ra watermark")
    monkeypatch.setattr(wm, "remove_video_watermark_sync", boom)
    ctx.params = {"edit_style": "shots", assemble.EXPORT_CLEAN: True}
    with pytest.raises(assemble.AssembleError, match="Xóa watermark shot:1 lỗi"):
        assemble.run_assemble(ctx)


def test_without_the_option_the_original_clips_are_used_untouched(parts, monkeypatch):
    from app.watermark import service as wm
    ctx, _ = parts
    monkeypatch.setattr(wm, "remove_video_watermark_sync", lambda *a, **k: pytest.fail("không được gọi gwr khi chưa bật"))
    art = assemble.run_assemble(ctx).artifacts[0]
    assert "watermark_removed" not in art.meta


def test_remove_video_watermark_reports_low_confidence_clearly(tmp_path, monkeypatch):
    """gwr dừng (không tạo file) khi không nhận ra watermark: lỗi phải dễ hiểu và không để lại file tạm."""
    from app.watermark import service as wm
    src = tmp_path / "in.mp4"
    make_clip(src, 1)
    script = tmp_path / "fake_gwr.py"
    script.write_text("import sys\nsys.stderr.reconfigure(encoding='utf-8')\nsys.stderr.write('[video] 12%\\n' + chr(0x89c6) + '频水印检测置信度偏低，已停止导出。\\n')\n", encoding="utf-8")
    import sys as _sys
    monkeypatch.setattr(wm, "_resolve_gwr_runtime", lambda: wm.GwrRuntime(command=(_sys.executable, str(script)), source="test", env_overrides={}, video_available=True))
    seen = []
    with pytest.raises(wm.WatermarkVideoError, match="không nhận ra watermark"):
        wm.remove_video_watermark_sync(src, tmp_path / "out" / "clean.mp4", on_progress=lambda d, t: seen.append(d))
    assert not list((tmp_path / "out").glob("*"))


def test_export_without_music_skips_the_mix_but_keeps_voice(parts, monkeypatch):
    ctx, tmp = parts
    monkeypatch.setattr(assemble, "mix_bgm", lambda *a, **k: pytest.fail("không được trộn nhạc ở bản không nhạc nền"))
    song = tmp / "song.mp3"
    make_voice(song, 4)
    monkeypatch.setattr(assemble, "resolve_bgm", lambda ids: [("Nhạc thử", song)])
    ctx.params = {"edit_style": "shots", "bgm": ["x"], assemble.EXPORT_NO_BGM: True}
    art = assemble.run_assemble(ctx).artifacts[0]
    assert art.meta["bgm"] == [] and art.meta["no_bgm"] is True and art.meta["with_voice"] is True


def test_opening_hook_end_card_and_ai_label_are_added_when_the_script_has_them(parts):
    ctx, tmp = parts
    sc = Path(ctx.inputs["script"][0]["path"])
    doc = json.loads(sc.read_text(encoding="utf-8"))
    doc["hook"] = {"type": "direct", "on_screen_text": "Hôm nay mặc gì?"}
    doc["cta"] = "Mua ngay tại shop"
    sc.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    ctx.params = {"edit_style": "shots"}
    res = assemble.run_assemble(ctx)
    out = tmp / "card.mp4"
    out.write_bytes(res.artifacts[0].data)
    kinds, duration, st = streams(out)
    assert kinds.count("video") == 1 and kinds.count("audio") == 1
    assert duration == pytest.approx(8.0 + assemble.END_CARD_SECONDS, abs=0.4)          # thẻ kết dán sau clip cuối
    meta = res.artifacts[0].meta
    assert meta["opening_text"] == "Hôm nay mặc gì?" and meta["end_card"] is True and meta["ai_label"] is True
    ctx.params = {"edit_style": "shots", "end_card": False, "ai_label": "0", "opening_text": False}
    meta = assemble.run_assemble(ctx).artifacts[0].meta
    assert meta["opening_text"] == "" and meta["end_card"] is False and meta["ai_label"] is False
    ctx.params = {"edit_style": "micro"}
    res = assemble.run_assemble(ctx)
    out2 = tmp / "card_micro.mp4"
    out2.write_bytes(res.artifacts[0].data)
    assert res.artifacts[0].meta["end_card"] is True and streams(out2)[1] > assemble.END_CARD_SECONDS
