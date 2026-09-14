"""POST/DELETE /internal/voices/{voice_id} — register/remove voice trong engine Vieneu.

Nhận ref audio (multipart), gọi ``engine.add_voice`` (extract speaker embedding + codes)
rồi ``save_voices`` ra ``data/voices.json``. Khởi động sau, engine nạp lại từ file đó.
"""
from pathlib import Path
import subprocess

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import resolve_ffmpeg_path
from app.engine import engine
from app.schemas import PresetList, PresetVoice, VoiceRegistered, VoiceRemoved
from app.storage import delete_ref_audio, save_ref_audio, voices_dir, voices_file_path

router = APIRouter()


@router.get("/internal/voices/presets", response_model=PresetList)
def list_presets() -> PresetList:
    """Danh sách preset voices (sẵn dùng, không cần clone) — cho UI hiển thị."""
    return PresetList(presets=[PresetVoice(**p) for p in engine.presets()])


@router.post("/internal/voices/{voice_id}", response_model=VoiceRegistered)
async def register_voice(
    voice_id: str,
    ref_audio: UploadFile = File(...),
    name: str | None = Form(default=None),
) -> VoiceRegistered:
    if not engine.ready:
        raise HTTPException(status_code=503, detail="voice engine not loaded")
    data = await ref_audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="ref_audio rỗng")
    # VieNeu v3 đọc reference qua soundfile, không đảm bảo đọc được MP3/M4A
    # trực tiếp. Lưu tạm upload rồi luôn chuẩn hóa về WAV PCM mono 24 kHz.
    source_suffix = Path(ref_audio.filename or "ref.audio").suffix or ".audio"
    source_path = save_ref_audio(voice_id, data, f".upload{source_suffix}")
    ref_path = voices_dir() / f"{voice_id}.wav"
    try:
        ffmpeg = resolve_ffmpeg_path()
        if not ffmpeg:
            raise RuntimeError(
                "Không tìm thấy FFmpeg. Bản desktop cần đóng gói resources/bin/ffmpeg.exe "
                "và truyền FFMPEG_PATH cho Voice Service."
            )
        converted = subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "24000",
                "-c:a",
                "pcm_s16le",
                str(ref_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if converted.returncode != 0 or not ref_path.is_file() or ref_path.stat().st_size == 0:
            detail = (converted.stderr or "FFmpeg không tạo được file WAV.").strip()
            raise RuntimeError(f"Chuẩn hóa audio thất bại: {detail[-1000:]}")
        # add_voice: name=voice_id (khóa trong _preset_voices); save=False rồi save_voices
        # truyền ĐÚNG path (mặc định save_voices ghi vào package assets — không bền vững).
        # VieNeu xử lý chuỗi path theo kiểu POSIX ngay cả trên Windows. Dùng
        # forward slash để tránh engine escape dấu ``\`` thành ``\\`` và báo
        # file không tồn tại khi clone voice từ upload.
        engine.vieneu.add_voice(voice_id, ref_path.as_posix(), denoise=True, save=False)
        engine.vieneu.save_voices(voices_file_path().as_posix())
    except Exception as error:  # noqa: BLE001
        delete_ref_audio(voice_id)  # dọn ref nếu add fail
        raise HTTPException(status_code=400, detail=f"add_voice failed: {error}") from error
    return VoiceRegistered(ok=True, voice_id=voice_id, name=name or voice_id)


@router.delete("/internal/voices/{voice_id}", response_model=VoiceRemoved)
async def remove_voice(voice_id: str) -> VoiceRemoved:
    if not engine.ready:
        raise HTTPException(status_code=503, detail="voice engine not loaded")
    try:
        engine.vieneu.remove_voice(voice_id, save=False)
    except Exception:  # noqa: BLE001 — voice chưa từng register cũng coi như xoá OK
        pass
    engine.vieneu.save_voices(str(voices_file_path()))
    delete_ref_audio(voice_id)
    return VoiceRemoved(ok=True, voice_id=voice_id)
