"""Lưu ref audio ra ``data/voices/{voice_id}<ext>`` + đường dẫn ``data/voices.json``.

Voice-service KHÔNG có DB — chỉ file ref audio + ``voices.json`` (engine state).
Metadata (name/tags/created_at) do main backend quản lý trong ``app.db``.
"""
from pathlib import Path

from app.config import settings


def voices_dir() -> Path:
    p = Path(settings.voices_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p


def voices_file_path() -> Path:
    p = Path(settings.voices_file)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def save_ref_audio(voice_id: str, data: bytes, suffix: str = ".wav") -> Path:
    """Lưu ref audio upload với id + extension gốc (để Vieneu nhận diện định dạng)."""
    suffix = suffix or ".wav"
    if not suffix.startswith("."):
        suffix = "." + suffix
    path = voices_dir() / f"{voice_id}{suffix}"
    path.write_bytes(data)
    return path


def delete_ref_audio(voice_id: str) -> None:
    """Xoá mọi file ``{voice_id}.*`` trong data/voices/."""
    for f in voices_dir().glob(f"{voice_id}.*"):
        try:
            f.unlink()
        except OSError:
            pass
