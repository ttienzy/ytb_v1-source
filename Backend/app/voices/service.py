"""Voice CRUD: metadata trong ``app.db`` + forward engine state sang voice-service.

Tạo voice: sinh voice_id → ghi app.db.voices → forward register sang voice-service
(add_voice + save_voices). Xoá: xoá app.db + forward remove. List: chỉ đọc app.db
(nhanh, không load engine).
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.voices import voice_client
from app.voices.models import Voice


def _new_voice_id() -> str:
    return uuid.uuid4().hex[:12]


def list_voices(db: Session) -> list[Voice]:
    return list(db.scalars(select(Voice).order_by(Voice.created_at.desc())))


def get_voice(db: Session, voice_id: str) -> Voice | None:
    return db.get(Voice, voice_id)


async def create_voice(db: Session, name: str, ref_audio: bytes, filename: str) -> Voice:
    voice_id = _new_voice_id()
    # 1) register engine (voice-service) TRƯỚC — nếu fail thì không ghi rác vào app.db
    await voice_client.register_voice(voice_id, ref_audio, filename, name)
    # 2) ghi metadata app.db
    voice = Voice(
        voice_id=voice_id,
        name=name,
        ref_path=f"data/voices/{voice_id}.wav",
        tags={"consent_confirmed": True, "consent_at": datetime.now(timezone.utc).isoformat()},
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)
    return voice


async def delete_voice(db: Session, voice_id: str) -> bool:
    voice = db.get(Voice, voice_id)
    if voice is None:
        return False
    # Only remove metadata after the engine confirms deletion.
    await voice_client.remove_voice(voice_id)
    db.delete(voice)
    db.commit()
    return True
