"""REST /api/voices — FE VoicesPage gọi endpoints này. Metadata app.db + forward voice-service."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.db import get_db
from app.voices import service
from app.voices.schemas import VoiceOut

router = APIRouter(prefix="/api/voices", tags=["Voices"])


@router.get("")
def list_voices(db: Session = Depends(get_db)) -> list[VoiceOut]:
    voices = service.list_voices(db)
    return [VoiceOut.model_validate(v) for v in voices]


@router.post("")
async def create_voice(
    name: str = Form(...),
    ref_audio: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> VoiceOut:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tên giọng không được để trống.")
    data = await ref_audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Audio mẫu rỗng.")
    try:
        voice = await service.create_voice(db, name, data, ref_audio.filename or "ref.wav")
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return VoiceOut.model_validate(voice)


@router.delete("/{voice_id}")
async def delete_voice(voice_id: str, db: Session = Depends(get_db)) -> dict:
    ok = await service.delete_voice(db, voice_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy giọng.")
    return {"ok": True}
