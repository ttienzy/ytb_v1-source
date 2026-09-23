import asyncio
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app.config import Settings, settings
from app.engine import VoiceEngine, engine
from app.main import app
from app.routers.tts import speech
from app.schemas import SpeechRequest


class FakeSDK:
    backend = "onnx"
    sample_rate = 48000

    def __init__(self):
        self.batches = []
        self.stream_closed = False

    def list_preset_voices(self):
        return [("A", "A"), ("B", "B")]

    def get_preset_voice(self, name):
        if name not in (None, "A", "B"):
            raise ValueError("Unknown voice")
        return {"description": "new preset", "gender": "male"}

    def infer_batch(self, texts, voice=None, **kwargs):
        self.batches.append((texts, voice))
        return [np.full(self.sample_rate, float(text), dtype=np.float32) for text in texts]

    def infer(self, text, **kwargs):
        return np.zeros(self.sample_rate, dtype=np.float32)

    def infer_stream(self, text, **kwargs):
        try:
            yield np.zeros(480, dtype=np.float32)
            yield np.ones(480, dtype=np.float32) * 0.5
        finally:
            self.stream_closed = True

    def encode_reference(self, ref, **kwargs):
        return np.ones(192, dtype=np.float32), np.ones((2, 16), dtype=np.int64)


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.sdk = FakeSDK()
        self.patches = [patch.object(engine, "vieneu", self.sdk),
                        patch.object(engine, "custom_voices", {})]
        for p in self.patches:
            p.start()
        self.client = TestClient(app)  # No lifespan/model downloads in unit tests.

    def tearDown(self):
        self.client.close()
        for p in reversed(self.patches):
            p.stop()

    def test_mixed_voices_batch_preserves_order_and_both_duration_contracts(self):
        response = self.client.post("/tts/batch", json={"voice_id": "A", "items": [
            {"text": "0.1"}, {"text": "0.2", "voice_id": "B"}, {"text": "0.3"},
        ]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.sdk.batches, [(["0.1", "0.3"], "A"), (["0.2"], "B")])
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            for i, item in enumerate(manifest["items"]):
                self.assertEqual(item["index"], i)
                self.assertEqual(item["duration"], item["duration_sec"])
                self.assertEqual(item["duration_sec"], 1)
                audio, sr = sf.read(io.BytesIO(zf.read(item["filename"])))
                self.assertEqual(sr, 48000)
                self.assertAlmostEqual(float(audio[0]), (i + 1) / 10, places=4)

    def test_invalid_voice_rejected_before_any_batch(self):
        response = self.client.post("/tts/batch", json={"items": [
            {"text": "0.1", "voice_id": "A"}, {"text": "0.2", "voice_id": "missing"},
        ]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.sdk.batches, [])

    def test_blank_and_oversized_inputs_rejected(self):
        for payload in ({"text": "   "}, {"text": "x" * 20001}, {"text": "hello", "temperature": -1}):
            self.assertEqual(self.client.post("/tts", json=payload).status_code, 422)

    def test_pcm_stream_reports_actual_sample_rate(self):
        self.sdk.sample_rate = 24000
        response = self.client.post("/v1/audio/speech", json={"input": "hello", "response_format": "pcm"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Sample-Rate"], "24000")
        self.assertEqual(len(response.content), 1920)
        self.assertTrue(self.sdk.stream_closed)
        self.assertFalse(engine.lock.locked())

    def test_bad_voice_stream_returns_json_error_not_broken_audio(self):
        response = self.client.post("/v1/audio/speech", json={"input": "hello", "voice": "missing"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(engine.lock.locked())

    def test_cancelling_stream_releases_model(self):
        async def run():
            response = await speech(SpeechRequest(input="hello", response_format="pcm"))
            await anext(response.body_iterator)
            self.assertTrue(engine.lock.locked())
            await response.body_iterator.aclose()
            self.assertFalse(engine.lock.locked())
        asyncio.run(run())
        self.assertTrue(self.sdk.stream_closed)

    def test_busy_engine_returns_retryable_status(self):
        with patch.object(settings, "inference_wait_seconds", 0.01):
            engine.lock.acquire()
            try:
                response = self.client.post("/tts", json={"text": "hello"})
            finally:
                engine.lock.release()
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)

    def test_buffered_wav_has_valid_header(self):
        response = self.client.post("/v1/audio/speech", json={"input": "hello", "stream": False})
        audio, sr = sf.read(io.BytesIO(response.content))
        self.assertEqual(len(audio), sr)


class VoicePersistenceTests(unittest.TestCase):
    def test_legacy_migration_keeps_clone_without_overwriting_updated_presets(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "voices.json"
            clone = {"speaker_emb": [1] * 192, "codes": [[1] * 16]}
            old = {"presets": {"A": clone, "abcdef123456": clone}}
            path.write_text(json.dumps(old), encoding="utf-8")
            with patch.object(settings, "voices_file", str(path)), patch.object(settings, "voices_dir", tmp):
                adapter = VoiceEngine()
                adapter.vieneu = FakeSDK()
                adapter._load_custom_voices()
                self.assertEqual(set(adapter.custom_voices), {"abcdef123456"})
                self.assertEqual(adapter.presets()[0]["description"], "new preset")
                adapter._save_custom_voices()
                self.assertEqual(json.loads(path.with_suffix(".json.bak").read_text()), old)
                restored = VoiceEngine()
                restored._load_custom_voices()
                self.assertIsInstance(restored.custom_voices["abcdef123456"]["codes"], np.ndarray)
                adapter.profile = "nano"
                adapter._load_custom_voices()
                self.assertEqual(adapter.custom_voices, {})
                self.assertTrue(path.exists())

    def test_failed_persist_rolls_back_memory(self):
        adapter = VoiceEngine()
        adapter.vieneu = FakeSDK()
        with patch.object(adapter, "_save_custom_voices", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                adapter.register("abcdef123456", Path("ref.wav"))
        self.assertEqual(adapter.custom_voices, {})

    def test_int8_falls_back_without_vnni(self):
        sdk = FakeSDK()
        cfg = Settings(_env_file=None, voice_profile="turbo-int8", onnx_dir=None)
        with patch("app.engine.settings", cfg), patch("app.engine.supports_vnni", return_value=False), \
                patch("vieneu.Vieneu", return_value=sdk) as factory, \
                patch.object(VoiceEngine, "_load_custom_voices"):
            adapter = VoiceEngine()
            adapter.start()
        self.assertTrue(adapter.ready)
        self.assertEqual(factory.call_args.kwargs["precision"], "fp32")
        self.assertEqual(factory.call_args.kwargs["device"], "cpu")
        self.assertTrue(adapter.warning)


if __name__ == "__main__":
    unittest.main()
