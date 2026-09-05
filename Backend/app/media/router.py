"""REST /api/bgm — FE "Thư viện nhạc" gọi endpoints này. Metadata app.db + file local."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import Base, engine, get_db
from app.media import service
from app.media.models import BgmTrack
from app.media.schemas import BgmOut

router = APIRouter(prefix="/api/bgm", tags=["BGM"])


@router.on_event("startup")
def ensure_bgm_table() -> None:
    """Cho phép upload ngay cả khi máy chưa chạy Alembic migration 0003."""
    Base.metadata.create_all(bind=engine, tables=[BgmTrack.__table__])


def _track_path(track: BgmTrack):
    """Resolve file_path → Path absolute (fallback relative-to-repo)."""
    from app.core.config import TOOLS_DIR
    from pathlib import Path

    p = Path(track.file_path)
    return p if p.is_absolute() else (TOOLS_DIR / p)


class ImportBody(BaseModel):
    folder: str


@router.get("", response_model=list[BgmOut])
def list_tracks(db: Session = Depends(get_db)) -> list[BgmOut]:
    return [BgmOut.model_validate(t) for t in service.list_tracks(db)]


@router.post("", response_model=BgmOut)
async def create_track(
    name: str = Form(...),
    audio: UploadFile = File(...),
    needs_attribution: bool = Form(False),
    description: str | None = Form(None),
    db: Session = Depends(get_db),
) -> BgmOut:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tên track không được rỗng.")
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Audio rỗng.")
    track = service.create_track(
        db, name, data, audio.filename or "track.mp3", needs_attribution, description
    )
    return BgmOut.model_validate(track)


@router.post("/import", response_model=list[BgmOut])
def import_folder(body: ImportBody, db: Session = Depends(get_db)) -> list[BgmOut]:
    """Nhập toàn bộ audio từ thư mục (scan đệ quy; description.txt cùng thư mục → attribution)."""
    folder = body.folder.strip()
    if not folder:
        raise HTTPException(status_code=400, detail="folder rỗng.")
    try:
        tracks = service.import_from_folder(db, folder)
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return [BgmOut.model_validate(t) for t in tracks]


@router.get("/{track_id}/audio")
def get_audio(track_id: str, db: Session = Depends(get_db)):
    """Serve file audio gốc — FileResponse hỗ trợ range (seek)."""
    track = service.get_track(db, track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy track.")
    p = _track_path(track)
    if not p.exists() or not p.stat().st_size:
        raise HTTPException(status_code=404, detail="File audio không tồn tại.")
    return FileResponse(p, media_type="audio/mpeg", filename=p.name)


@router.delete("/{track_id}")
def delete_track(track_id: str, db: Session = Depends(get_db)) -> dict:
    ok = service.delete_track(db, track_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy track.")
    return {"ok": True}
