"""REST /api/voices — FE VoicesPage gọi endpoints này. Metadata app.db + forward voice-service."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask
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
    consent: bool = Form(False),
    db: Session = Depends(get_db),
) -> VoiceOut:
    name = name.strip()
    if not consent:
        raise HTTPException(400, "Vui lòng xác nhận quyền sử dụng giọng mẫu.")
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
    try:
        ok = await service.delete_voice(db, voice_id)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
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


@router.post("/{voice_id}/preview/stream")
async def preview_stream(voice_id: str, body: PreviewBody):
    try:
        client, response = await voice_client.open_preview_stream(voice_id, body.text)
    except RuntimeError as error:
        raise HTTPException(502, str(error)) from error
    if response.status_code >= 400:
        try:
            detail = (await response.aread()).decode("utf-8", errors="replace")
            raise HTTPException(response.status_code, detail)
        finally:
            await response.aclose()
            await client.aclose()

    async def close():
        await response.aclose()
        await client.aclose()

    async def content():
        import anyio
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            with anyio.CancelScope(shield=True):
                await close()

    return StreamingResponse(content(), media_type="application/octet-stream",
                             headers={"X-Sample-Rate": response.headers.get("X-Sample-Rate", "48000"),
                                      "Cache-Control": "no-store", "Access-Control-Expose-Headers": "X-Sample-Rate"},
                             background=BackgroundTask(close))
