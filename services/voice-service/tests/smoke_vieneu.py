"""Opt-in real-model smoke. Uses the selected profile and an isolated voice registry.

Run from voice-service: .venv/Scripts/python -m tests.smoke_vieneu
Downloads missing models; output metrics, no persistent generated audio.
"""
import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from app.config import settings
from app.engine import VoiceEngine


def main():
    with tempfile.TemporaryDirectory() as tmp:
        settings.voices_file = str(Path(tmp) / "voices.json")
        settings.voices_dir = tmp
        adapter = VoiceEngine()
        adapter.start()
        if not adapter.ready:
            raise RuntimeError(adapter.error)
        try:
            sdk = adapter.vieneu
            voice = sdk.list_preset_voices()[0][1]
            start = time.perf_counter()
            audio = sdk.infer("Xin chào, đây là bản kiểm tra giọng đọc tiếng Việt.", voice=voice)
            elapsed = time.perf_counter() - start
            assert len(audio) > 0 and np.isfinite(audio).all() and np.max(np.abs(audio)) > 0
            start = time.perf_counter()
            chunks = sdk.infer_stream("Hôm nay chúng ta cùng thử nghe âm thanh trực tiếp.", voice=voice)
            first = next(chunks)
            ttfa = time.perf_counter() - start
            streamed = np.concatenate([first, *chunks])
            assert streamed.size > 0 and np.isfinite(streamed).all()
            if "--clone" in sys.argv:
                # Synthetic preset reference, isolated from all user recordings.
                ref = Path(tmp) / "abcdef123456.wav"
                sf.write(ref, audio, sdk.sample_rate)
                with adapter.session():
                    adapter.register("abcdef123456", ref)
                    adapter._load_custom_voices()
                    cloned = sdk.infer("Giọng đã lưu được nạp lại thành công.",
                                       voice=adapter.resolve_voice("abcdef123456"))
                assert len(cloned) > 0 and np.isfinite(cloned).all()
            print(json.dumps({**adapter.status(), "test_voice": voice,
                              "audio_seconds": len(audio) / sdk.sample_rate,
                              "synthesis_seconds": elapsed, "first_chunk_seconds": ttfa,
                              "stream_seconds": len(streamed) / sdk.sample_rate}, ensure_ascii=False))
        finally:
            adapter.vieneu.close()


if __name__ == "__main__":
    main()
