from array import array
import json
import math
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.workflow import export_media, service


@pytest.fixture
def isolated_export(monkeypatch, tmp_path):
    directory = tmp_path / "exports"
    directory.mkdir()
    monkeypatch.setattr(service, "WORKFLOW_EXPORTS_DIR", directory)
    monkeypatch.setattr(service, "EXPORTS_METADATA_FILE", directory / "history.json")
    return directory


@pytest.fixture(scope="module")
def media_files(tmp_path_factory):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("Local FFmpeg and ffprobe required")
    directory = tmp_path_factory.mktemp("workflow_media")
    video = directory / "scene.mp4"
    silent = directory / "silent.mp4"
    vo = directory / "voice.wav"
    bgm = directory / "music.wav"

    def run(args):
        subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, check=True, timeout=30)

    run(["-f", "lavfi", "-i", "color=c=blue:s=160x90:r=25:d=1.2",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-c:v", "libx264", "-c:a", "aac", str(video)])
    run(["-i", str(video), "-c:v", "copy", "-an", str(silent)])
    run(["-f", "lavfi", "-i", "sine=frequency=880:duration=0.4", str(vo)])
    run(["-f", "lavfi", "-i", "sine=frequency=1320:duration=0.4", str(bgm)])
    return SimpleNamespace(video=video, silent=silent, vo=vo, bgm=bgm)


def amplitude(path, frequency):
    result = subprocess.run([
        "ffmpeg", "-v", "error", "-i", str(path), "-ss", "0.08", "-t", "0.2",
        "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1",
    ], capture_output=True, check=True, timeout=30)
    samples = array("f", result.stdout)
    sine = sum(v * math.sin(2 * math.pi * frequency * i / 8000) for i, v in enumerate(samples))
    cosine = sum(v * math.cos(2 * math.pi * frequency * i / 8000) for i, v in enumerate(samples))
    return 2 * math.hypot(sine, cosine) / len(samples)


@pytest.mark.parametrize("voice,bgm,ambient", [
    (False, False, False), (True, False, False), (False, True, False), (True, True, False),
    (False, False, True), (True, False, True), (False, True, True), (True, True, True),
])
def test_export_audio_controls_and_actual_metadata(isolated_export, media_files, voice, bgm, ambient):
    response = service.concat_workflow_scenes(
        [str(media_files.video)], voiceover_audio_path=str(media_files.vo) if voice else None,
        bgm_path=str(media_files.bgm) if bgm else None, bgm_volume=0.3,
        mix_original_audio=ambient, veo_ambient_volume=0.2,
    )
    final = Path(response.file_path)
    media = export_media.probe_media(final)
    assert response.status == "done"
    assert media["duration"] == pytest.approx(1.2, abs=0.06)  # short VO must not truncate video
    assert media["has_audio"] == (voice or bgm or ambient)
    history = json.loads((isolated_export / "history.json").read_text(encoding="utf-8"))[final.name]
    assert (history["width"], history["height"]) == (160, 90)
    assert history["resolution"] == "160x90"
    assert history["aspect_ratio"] == "16:9"
    if media["has_audio"]:
        for frequency, present in [(440, ambient), (880, voice), (1320, bgm)]:
            value = amplitude(final, frequency)
            assert (value > 0.01) if present else (value < 0.002)


def test_ambient_gain_is_applied(isolated_export, media_files):
    outputs = [service.concat_workflow_scenes(
        [str(media_files.video)], mix_original_audio=True, veo_ambient_volume=gain,
    ) for gain in (0.1, 0.4)]
    assert amplitude(outputs[1].file_path, 440) / amplitude(outputs[0].file_path, 440) == pytest.approx(4, rel=0.15)


@pytest.mark.parametrize("with_voice", [False, True])
def test_silent_source_supports_requested_audio(isolated_export, media_files, with_voice):
    result = service.concat_workflow_scenes(
        [str(media_files.silent)], bgm_path=str(media_files.bgm),
        voiceover_audio_path=str(media_files.vo) if with_voice else None,
        mix_original_audio=True, veo_ambient_volume=0.2,
    )
    assert export_media.probe_media(Path(result.file_path))["has_audio"]


@pytest.mark.parametrize("field", ["voiceover_audio_path", "bgm_path"])
def test_missing_required_audio_fails_before_concat(monkeypatch, isolated_export, tmp_path, field):
    video = tmp_path / "scene.mp4"
    video.write_bytes(b"scene")
    concat = Mock()
    monkeypatch.setattr(service, "concat_segments", concat)
    with pytest.raises(ValueError, match="missing or empty"):
        service.concat_workflow_scenes([str(video)], **{field: str(tmp_path / "missing.wav")})
    concat.assert_not_called()
    assert list(isolated_export.glob("*.mp4")) == []


def test_bgm_resolution_error_is_not_swallowed(monkeypatch, isolated_export, tmp_path):
    from app.media import service as media_service
    video = tmp_path / "scene.mp4"
    video.write_bytes(b"scene")
    monkeypatch.setattr(media_service, "resolve_for_polish", Mock(side_effect=ValueError("missing track")))
    concat = Mock()
    monkeypatch.setattr(service, "concat_segments", concat)
    with pytest.raises(ValueError, match="missing track"):
        service.concat_workflow_scenes([str(video)], bgm_track_ids=["invalid"])
    concat.assert_not_called()


@pytest.mark.parametrize("audio", ["voice", "bgm"])
def test_ffmpeg_failure_preserves_existing_export(monkeypatch, isolated_export, media_files, audio):
    existing = isolated_export / "existing.mp4"
    existing.write_bytes(b"previous valid export")
    real_run = subprocess.run

    def fail_audio_mix(command, *args, **kwargs):
        if "-filter_complex" in command:
            Path(command[-1]).write_bytes(b"partial output")
            return SimpleNamespace(returncode=1, stderr="audio encode failed")
        return real_run(command, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", fail_audio_mix)
    options = {"voiceover_audio_path": str(media_files.vo)} if audio == "voice" else {"bgm_path": str(media_files.bgm)}
    with pytest.raises(RuntimeError, match="audio encode failed"):
        service.concat_workflow_scenes([str(media_files.video)], output_filename=existing.name, **options)
    assert existing.read_bytes() == b"previous valid export"
    assert not (isolated_export / "history.json").exists()


def test_voiceover_sync_failure_is_not_ignored(monkeypatch, tmp_path):
    voice = tmp_path / "vo_0.wav"
    voice.write_bytes(b"audio")
    monkeypatch.setattr(service, "ffprobe_duration", lambda _: 10)
    monkeypatch.setattr(subprocess, "run", Mock(return_value=SimpleNamespace(returncode=1, stderr="sync error")))
    with pytest.raises(RuntimeError, match="sync failed"):
        service.sync_voiceover_to_scenes([tmp_path / "scene.mp4"], voice, tmp_path / "work")


def test_probe_rejects_unknown_dimensions_before_publication(monkeypatch, isolated_export, media_files):
    probe = service.probe_media

    def invalid_dimensions(path):
        media = probe(path)
        media.update(width=0, height=0)
        return media

    monkeypatch.setattr(service, "probe_media", invalid_dimensions)
    with pytest.raises(RuntimeError, match="dimensions"):
        service.concat_workflow_scenes([str(media_files.video)])
    assert not list(isolated_export.glob("*.mp4"))
