"""Helper audio: numpy waveform (float32) -> WAV bytes + đo duration.

Engine Vieneu v3 Turbo sinh ra ``np.ndarray`` float32 48 kHz mono. Các endpoint
TTS trả về ``audio/wav`` nên cần encode PCM_16 + tính độ dài (s) cho header
``X-Audio-Duration`` (main backend đo lệch → atempo sync, xem plan §3.3).
"""
from __future__ import annotations

import io

import numpy as np
import soundfile as sf


def audio_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    """Encode waveform float32 [-1, 1] thành WAV PCM_16 bytes (in-memory)."""
    buf = io.BytesIO()
    # soundfile tự clip/convert float32 -> int16 theo subtype.
    sf.write(buf, np.asarray(audio, dtype=np.float32), sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def duration_of(audio: np.ndarray, sample_rate: int) -> float:
    """Độ dài (giây) của waveform theo sample rate."""
    n = len(np.asarray(audio))
    return float(n) / float(sample_rate) if sample_rate else 0.0
