"""Checked local media operations for workflow exports."""
from __future__ import annotations

import json
import math
from pathlib import Path
import subprocess


def require_media_file(path: Path, label: str) -> Path:
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f"{label} file is missing or empty: {path}")
    return path


def probe_media(path: Path) -> dict:
    require_media_file(path, "Media")
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,width,height:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
    )
    if result.returncode:
        raise RuntimeError(f"Cannot probe media {path.name}: {result.stderr[-500:]}")
    data = json.loads(result.stdout)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    duration = float(data.get("format", {}).get("duration") or 0)
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError(f"Media has no valid duration: {path.name}")
    return {
        "duration": duration,
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "has_audio": any(s.get("codec_type") == "audio" for s in data.get("streams", [])),
    }


def run_ffmpeg(command: list[str], output: Path, label: str, timeout: int = 120) -> Path:
    result = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
    )
    if result.returncode or not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"{label} failed: {(result.stderr or '')[-500:]}")
    return output


def render_audio(
    video: Path, output: Path, *, voiceover: Path | None,
    bgm_paths: list[Path], bgm_volume: float,
    mix_original_audio: bool, veo_ambient_volume: float, work_dir: Path,
) -> Path:
    """Only retain original audio when explicitly enabled with a positive gain."""
    media = probe_media(video)
    command = ["ffmpeg", "-y", "-i", str(video)]
    filters: list[str] = []
    audio_labels: list[str] = []
    if mix_original_audio and veo_ambient_volume > 0 and media["has_audio"]:
        filters.append(f"[0:a:0]volume={veo_ambient_volume}[ambient]")
        audio_labels.append("[ambient]")

    next_input = 1
    if voiceover:
        command.extend(["-i", str(voiceover)])
        filters.append(f"[{next_input}:a:0]apad[vo]")
        audio_labels.append("[vo]")
        next_input += 1
    if bgm_paths:
        if len(bgm_paths) > 1:
            from app.recap.ffmpeg import build_smart_bgm_chain
            bgm = build_smart_bgm_chain(bgm_paths, media["duration"], work_dir / "bgm_chain.mp3", work_dir)
            require_media_file(bgm, "BGM chain")
        else:
            bgm = bgm_paths[0]
        command.extend(["-stream_loop", "-1", "-i", str(bgm)])
        filters.append(f"[{next_input}:a:0]volume={bgm_volume}[bgm]")
        audio_labels.append("[bgm]")

    command.extend(["-map", "0:v:0", "-c:v", "copy"])
    if audio_labels:
        filters.append(
            "".join(audio_labels)
            + f"amix=inputs={len(audio_labels)}:duration=longest:dropout_transition=0:normalize=0[aout]"
        )
        command.extend(["-filter_complex", ";".join(filters), "-map", "[aout]", "-c:a", "aac"])
    else:
        command.append("-an")
    # Pad short VO and cap looping audio to the actual video duration.
    command.extend(["-t", str(media["duration"]), str(output)])
    return run_ffmpeg(command, output, "Workflow audio export", timeout=1800)
