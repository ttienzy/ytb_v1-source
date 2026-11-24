"""Assemble narrated shots using the same local voice and ffmpeg services as Campaign."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import quote

from app.campaign.executors import assemble
from app.voices import voice_client
from app.workflow import muse_projects
from app.workflow.muse_canvas import MuseCanvasGraph
from . import store


def workspace(ep):
    root = store.ROOT / ep["id"]
    root.mkdir(parents=True, exist_ok=True)
    return root


def narrate(ep, scene):
    voice, _ = asyncio.run(voice_client.preview_voice(ep["channel"]["voice_id"] or None, scene["narration"]))
    path = workspace(ep) / f"{scene['scene']}-{uuid.uuid4().hex[:10]}.wav"
    path.write_bytes(voice)
    if assemble.audio_seconds(path) <= 0:
        raise ValueError("Dịch vụ giọng đọc trả về file âm thanh rỗng.")
    return str(path)


def segment(ep, scene, assets):
    # Extend the final frame when needed so an approved sentence is never cut off.
    clip, voice = Path(assets["clip"]), Path(assets["voice"])
    clip_seconds = assemble.probe(clip)["duration"]
    duration = max(
        scene["seconds"], assemble.audio_seconds(voice) + assemble.VOICE_LEAD + assemble.VOICE_TAIL
    )
    size = (720, 1280) if ep["channel"]["aspect"] == "9:16" else (1280, 720)
    with tempfile.TemporaryDirectory(dir=workspace(ep)) as tmp:
        work = Path(tmp)
        if duration > clip_seconds:
            padded = work / "padded.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(clip),
                    "-an",
                    "-vf",
                    f"tpad=stop_mode=clone:stop_duration={duration - clip_seconds + 0.1:.3f}",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    str(padded),
                ],
                check=True,
                timeout=300,
            )
            clip = padded
        part = assemble.build_segment(work, scene["scene"], clip, duration, 1, voice, "", size, False)
        dest = work.parent / f"{scene['scene']}-{uuid.uuid4().hex[:10]}.mp4"
        os.replace(part, dest)
    return str(dest)


def draft(ep):
    from shutil import copyfile

    with tempfile.TemporaryDirectory(dir=workspace(ep)) as tmp:
        work = Path(tmp)
        segments = []
        for scene in ep["script"]["scenes"]:
            index = scene["scene"]
            path = work / f"scene-{index}.mp4"
            copyfile(ep["media"][str(index)]["segment"], path)
            segments.append(path)
        out = assemble.join_segments(work, segments, "cut")
        assemble.probe(out)
        dest = work.parent / f"draft-{uuid.uuid4().hex[:10]}.mp4"
        os.replace(out, dest)
    return str(dest)


def canvas_snapshot(ep):
    """A versioned snapshot. Never overwrite a user's subsequent Canvas edits."""
    key = json.dumps([ep["manifest"], ep["media"]], sort_keys=True).encode()
    pid = ep["id"][:16] + hashlib.sha256(key).hexdigest()[:12]
    nodes = []

    def add(number, kind, col, data):
        nodes.append(
            {
                "id": f"{pid}-{number}-{col}",
                "type": kind,
                "position": {"x": 40 + 420 * col, "y": 40 + 550 * (number - 1)},
                "data": data,
            }
        )

    for scene, shot in zip(ep["script"]["scenes"], ep["manifest"]["scenes"]):
        n = scene["scene"]
        label = f"Cảnh {n} · {scene['seconds']} giây"
        add(
            n,
            "musePromptBox",
            0,
            {
                "title": label,
                "text": "\n\n".join([scene["narration"], shot["image_prompt"], shot["motion_prompt"]]),
            },
        )
        for asset, kind, col, field in (
            ("image", "museSceneImage", 1, "image"),
            ("clip", "museVideoRef", 2, "video"),
        ):
            raw = ep["media"].get(str(n), {}).get(asset)
            if raw and Path(raw).is_file():
                path = Path(raw)
                # Use the stable Muse library URL so later revisions do not change an older snapshot.
                endpoint = "stream" if asset == "clip" else "output"
                ref = {
                    "id": path.stem,
                    "name": path.name,
                    "path": str(path),
                    "size": path.stat().st_size,
                    "previewUrl": f"/api/ai/muse/{endpoint}?file={quote(path.name)}",
                }
                if asset == "clip":
                    ref.update(durationSec=scene["seconds"], source="library")
                add(n, kind, col, {"title": label, "label": label, field: ref})
    req = muse_projects.MuseProjectCreate(
        name=ep["script"]["title"][:110], graph=MuseCanvasGraph(nodes=nodes), activate=False
    )
    return muse_projects.create_project(req, project_id=pid).id
