"""BGM CRUD: metadata trong ``app.db`` + file trong ``Backend/Data/media/bgm/``.

Mirror ``app.voices.service``. Import từ thư mục: scan đệ quy ``*.mp3``/``*.wav``,
mỗi file tìm ``description.txt`` CÙNG THƯ MỤC → nếu có thì ``needs_attribution=True``
+ ``description`` = nội dung file đó (CC BY...). Copy file vào ``Data/media/bgm/``.
Idempotent theo ``name`` (skip nếu trùng).
"""
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import TOOLS_DIR
from app.media.models import BgmTrack
from app.recap.ffmpeg import ffprobe_duration

BGM_DIR: Path = TOOLS_DIR / "Backend" / "Data" / "media" / "bgm"
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg"}


def _new_track_id() -> str:
    return uuid.uuid4().hex[:12]


def list_tracks(db: Session) -> list[BgmTrack]:
    return list(db.scalars(select(BgmTrack).order_by(BgmTrack.created_at.desc())))


def get_track(db: Session, track_id: str) -> BgmTrack | None:
    return db.get(BgmTrack, track_id)


def _resolve_path(file_path: str) -> Path:
    """file_path lưu absolute; fallback relative-to-repo cho khả năng di chuyển."""
    p = Path(file_path)
    return p if p.is_absolute() else (TOOLS_DIR / p)


def delete_track(db: Session, track_id: str) -> bool:
    track = db.get(BgmTrack, track_id)
    if track is None:
        return False
    # xoá file (chấp nhận fail — vẫn xoá metadata để không mồ côi)
    try:
        p = _resolve_path(track.file_path)
        if p.exists():
            p.unlink()
    except OSError:
        pass
    db.delete(track)
    db.commit()
    return True


def _save_audio(data: bytes, filename: str, track_id: str) -> Path:
    """Ghi bytes audio vào ``BGM_DIR/{track_id}.{ext}``; trả path absolute."""
    BGM_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix or ".mp3"
    out = BGM_DIR / f"{track_id}{suffix}"
    out.write_bytes(data)
    return out


def create_track(
    db: Session,
    name: str,
    audio_bytes: bytes,
    filename: str,
    needs_attribution: bool = False,
    description: str | None = None,
) -> BgmTrack:
    track_id = _new_track_id()
    path = _save_audio(audio_bytes, filename, track_id)
    duration = ffprobe_duration(path)
    track = BgmTrack(
        track_id=track_id,
        name=name,
        file_path=str(path),
        needs_attribution=needs_attribution,
        description=(description.strip() if description else None),
        duration_sec=duration,
    )
    db.add(track)
    db.commit()
    db.refresh(track)
    return track


def import_from_folder(db: Session, folder_path: str) -> list[BgmTrack]:
    """Scan thư mục audio; mỗi file → 1 BgmTrack.

    ``description.txt`` cùng thư mục với file audio → ``needs_attribution=True`` +
    ``description`` = nội dung. Idempotent theo ``name`` (tên file không ext) —
    đã có track cùng name → skip. Trả list track đã import (mới + đã có).
    """
    root = Path(folder_path)
    if not root.is_dir():
        raise RuntimeError(f"Thư mục không tồn tại: {folder_path}")

    # Map name → track_id đã có (idempotent).
    existing = {t.name: t for t in list_tracks(db)}
    imported: list[BgmTrack] = []

    audio_files = sorted(
        p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO_EXTS
    )
    for af in audio_files:
        name = af.stem  # tên file không extension
        if name in existing:
            imported.append(existing[name])
            continue

        # description.txt cùng thư mục với file audio.
        desc_file = af.parent / "description.txt"
        needs_attr = False
        description: str | None = None
        if desc_file.exists():
            try:
                description = desc_file.read_text(encoding="utf-8", errors="replace").strip()
                needs_attr = bool(description)
            except OSError:
                description = None
                needs_attr = False

        track_id = _new_track_id()
        data = af.read_bytes()
        path = _save_audio(data, af.name, track_id)
        duration = ffprobe_duration(path)
        track = BgmTrack(
            track_id=track_id,
            name=name,
            file_path=str(path),
            needs_attribution=needs_attr,
            description=description,
            duration_sec=duration,
        )
        db.add(track)
        db.commit()
        db.refresh(track)
        existing[name] = track
        imported.append(track)

    return imported


def resolve_for_polish(db: Session, track_ids: list[str]) -> tuple[list[Path], str]:
    """Giải bgm_ids → (paths theo thứ tự, credits text).

    ``credits`` = join ``\\n\\n`` các ``description`` của track cần attribution đã dùng.
    Raise HTTPException nếu track_id không hợp lệ / file mất.
    """
    from fastapi import HTTPException

    paths: list[Path] = []
    credits_parts: list[str] = []
    for tid in track_ids:
        t = get_track(db, tid)
        if t is None:
            raise HTTPException(status_code=404, detail=f"BGM track không tồn tại: {tid}")
        p = _resolve_path(t.file_path)
        if not p.exists() or not p.stat().st_size:
            raise HTTPException(status_code=404, detail=f"File BGM không tìm thấy: {t.name}")
        paths.append(p)
        if t.needs_attribution and t.description:
            credits_parts.append(t.description)
    credits = "\n\n".join(credits_parts) if credits_parts else ""
    return paths, credits
