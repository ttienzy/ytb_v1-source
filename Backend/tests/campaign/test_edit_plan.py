"""Kiểu dựng micro-cut: nhịp nhạc, chọn đoạn nhiều chuyển động, chia cú cắt, và ghép thật bằng ffmpeg."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.campaign.executors import assemble, edit_plan
from app.campaign.runner import ExecContext

ffmpeg_needed = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="cần ffmpeg")


def click_track(bpm: float, seconds: float, hop: float) -> list[float]:
    n, period = int(seconds / hop), round(60 / bpm / hop)
    return [1.0 if i % period == 3 else 0.02 for i in range(n)]


def test_beat_grid_finds_tempo_and_phase_of_a_regular_track():
    hop = 256 / 11025
    grid = edit_plan.beat_grid_from_envelope(click_track(120, 30, hop), hop)
    assert grid is not None and grid.period == pytest.approx(0.5, abs=0.03) and grid.phase == pytest.approx(3 * hop, abs=0.03)


def test_beat_grid_refuses_music_without_a_clear_pulse():
    hop = 256 / 11025
    assert edit_plan.beat_grid_from_envelope([], hop) is None
    assert edit_plan.beat_grid_from_envelope([0.0] * 500, hop) is None
    irregular = [1.0 if (i * i) % 97 == 0 else 0.0 for i in range(1300)]
    assert edit_plan.beat_grid_from_envelope(irregular, hop) is None


def test_pick_windows_prefers_motion_stays_in_order_and_inside_the_clip():
    curve = [0.0] * 8 + [5.0] * 8 + [0.0] * 8                 # 6 giây, chuyển động dồn ở giây 2-4
    assert edit_plan.pick_windows(curve, 0.25, 6.0, [2.0]) == [2.0]
    starts = edit_plan.pick_windows(curve, 0.25, 6.0, [2.0, 2.0])
    assert starts[0] + 2.0 <= starts[1] and starts[1] + 2.0 <= 6.0
    assert edit_plan.pick_windows([], 0.25, 6.0, [2.0, 2.0]) == [0.0, 2.0]           # không đọc được chuyển động: cắt đều


def test_pick_windows_always_leaves_room_for_later_cuts():
    curve = [0.0] * 20 + [9.0] * 4                             # đỉnh ở cuối clip không được ăn hết chỗ của cú sau
    starts = edit_plan.pick_windows(curve, 0.25, 6.0, [2.0, 2.0, 2.0])
    assert starts == [0.0, 2.0, 4.0]


def test_split_slot_keeps_target_length_and_snaps_to_beats():
    parts = edit_plan.split_slot(0.0, 6.0, 2.0, [2.2, 3.9])
    assert parts == [(0.0, 2.2), (2.2, 3.9), (3.9, 6.0)]
    assert edit_plan.split_slot(0.0, 2.0, 2.2, []) == [(0.0, 2.0)]
    assert all(b - a >= edit_plan.MIN_CUT for a, b in edit_plan.split_slot(0.0, 3.0, 1.2, [1.0, 1.1, 2.9]))


def test_snap_up_only_moves_the_shot_end_later_and_within_the_clip():
    assert edit_plan.snap_up(4.0, [3.9, 4.2], 6.0) == 4.2
    assert edit_plan.snap_up(4.0, [5.0], 6.0) == 4.0                                  # phách quá xa
    assert edit_plan.snap_up(4.0, [4.2], 4.1) == 4.0                                  # vượt độ dài clip


def test_punch_alternates_so_consecutive_cuts_differ_and_cut_length_is_clamped():
    assert edit_plan.punch_for("hero", 0) != edit_plan.punch_for("hero", 1)
    assert edit_plan.punch_for("detail", 2) > edit_plan.punch_for("hero", 2)
    assert (edit_plan.clamp_cut(None), edit_plan.clamp_cut(0.1), edit_plan.clamp_cut(99), edit_plan.clamp_cut("x")) == (edit_plan.DEFAULT_CUT, edit_plan.MIN_CUT, edit_plan.MAX_CUT, edit_plan.DEFAULT_CUT)


def _clip(path: Path, seconds: int, color: str):
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"testsrc=s=180x320:d={seconds}:r=24", "-vf", f"drawbox=c={color}:t=20", "-t", str(seconds),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True, capture_output=True)


def _duration(path: Path) -> tuple[float, list[str]]:
    data = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", str(path)],
                                     capture_output=True, text=True).stdout)
    return float(data["format"]["duration"]), [s["codec_type"] for s in data["streams"]]


@ffmpeg_needed
def test_micro_edit_makes_many_short_cuts_with_voice_inside_each_shot(tmp_path, svc):
    cid = svc.create_campaign("m")["id"]
    clips, voices, shots, script = [], [], [], []
    for i, (color, arch) in enumerate((("red", "hero"), ("green", "detail")), start=1):
        p = tmp_path / f"c{i}.mp4"
        _clip(p, 6, color)
        clips.append({"element_key": f"shot:{i}", "path": str(p)})
        shots.append({"key": f"shot:{i}", "archetype": arch, "framing": "medium", "beat_seconds": 6})
        script.append({"shot": f"shot:{i}", "voiceover": "x", "on_screen_text": f"Chữ {i}"})
    v = tmp_path / "v.wav"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", str(v)], check=True, capture_output=True)
    voices.append({"role": "shot:1", "path": str(v)})
    sp, sc = tmp_path / "s.json", tmp_path / "t.json"
    sp.write_text(json.dumps({"items": shots}), encoding="utf-8")
    sc.write_text(json.dumps({"items": script}), encoding="utf-8")
    ctx = ExecContext(campaign_id=cid, step_key="assemble", element_key="", tier="final", params={"edit_style": "micro", "cut_seconds": 2.0}, fingerprint="f", note="",
                      inputs={"clip": clips, "voice": voices, "shot_plan": [{"path": str(sp)}], "script": [{"path": str(sc)}]},
                      store=svc.store, set_external_ref=lambda r: None, cancelled=lambda: False)
    art = assemble.run_assemble(ctx).artifacts[0]
    out = tmp_path / "f.mp4"
    out.write_bytes(art.data)
    duration, kinds = _duration(out)
    meta = art.meta
    assert meta["edit_style"] == "micro" and kinds.count("video") == 1 and kinds.count("audio") == 1
    assert meta["cuts"] >= 3 and [s["cuts"] for s in meta["shots"]] == [2, 2]
    assert duration == pytest.approx(sum(s["seconds"] for s in meta["shots"]), abs=0.4)
    assert all(s["caption"] for s in meta["shots"]) and meta["beat_period"] is None     # không có nhạc: lưới đều
