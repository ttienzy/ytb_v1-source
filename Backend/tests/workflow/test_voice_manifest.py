import asyncio
import io
import json
import zipfile

import pytest

from app.workflow import service
from app.voices import voice_client


@pytest.mark.parametrize("duration_key", ["duration", "duration_sec"])
def test_voiceover_uses_manifest_duration_without_ffprobe(monkeypatch, tmp_path, duration_key):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("vo_0.wav", b"test-audio")
        zf.writestr("manifest.json", json.dumps({"items": [{"index": 0, duration_key: 2.75}]}))

    async def batch(items, voice_id):
        return buf.getvalue()

    def unexpected_probe(*args):
        pytest.fail("Valid manifest must not need ffprobe")

    monkeypatch.setattr(voice_client, "tts_batch", batch)
    monkeypatch.setattr(service, "VOICEOVER_DIR", tmp_path)
    monkeypatch.setattr(service, "ffprobe_duration", unexpected_probe)
    result = asyncio.run(service.generate_voiceover_batch("voice", ["hello"], combine_all=False))
    assert result.items[0].duration_sec == 2.75
    assert result.total_duration_sec == 2.75
