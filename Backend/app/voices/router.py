"""REST /api/voices — FE VoicesPage gọi endpoints này. Metadata app.db + forward voice-service."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import Base, engine, get_db
from app.voices import service, voice_client
from app.voices.models import Voice
from app.voices.schemas import VoiceOut

router = APIRouter(prefix="/api/voices", tags=["Voices"])


class PreviewBody(BaseModel):
    text: str | None = None  # None → voice-service dùng câu mặc định


@router.on_event("startup")
def ensure_voice_table() -> None:
    """Bản cài mới dùng được ngay cả khi chưa chạy Alembic thủ công."""
    Base.metadata.create_all(bind=engine, tables=[Voice.__table__])


@router.get("")
def list_voices(db: Session = Depends(get_db)) -> list[VoiceOut]:
    voices = service.list_voices(db)
    return [VoiceOut.model_validate(v) for v in voices]


@router.get("/presets")
async def list_presets() -> list[dict]:
    """Preset voices của VieNeu (sẵn dùng, không cần clone) — forward voice-service."""
    try:
        return await voice_client.list_presets()
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/health")
async def voice_health() -> dict:
    """Health của engine voice phía sau, dùng để kiểm tra toàn bộ chuỗi BE → TTS."""
    try:
        return await voice_client.health()
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


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


@router.post("/{voice_id}/preview")
async def preview_voice(voice_id: str, body: PreviewBody, db: Session = Depends(get_db)) -> Response:
    """Nghe thử 1 voice → forward voice-service /preview → audio/wav + X-Audio-Duration.

    ``voice_id`` có thể là giọng clone (trong app.db) HOẶC preset VieNeu (vd "Adam",
    "Trúc Ly") — voice-service là nguồn sự thật về voice tồn tại. Không check app.db
    ở đây để preset cũng nghe được (tên preset có dấu/khoảng trắng, FE encode path).
    """
    try:
        wav, duration = await voice_client.preview_voice(voice_id, body.text)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    headers = {"X-Audio-Duration": duration} if duration else {}
    return Response(content=wav, media_type="audio/wav", headers=headers)
