"""Reference enrollment via the SDK public API; references survive model upgrades."""
from pathlib import Path
import re
import subprocess
import tempfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import resolve_ffmpeg_path
from app.engine import engine
from app.routers.tts import inference_error, require_engine
from app.schemas import PresetList, PresetVoice, VoiceRegistered, VoiceRemoved
from app.storage import delete_ref_audio, voices_dir

router = APIRouter()


def validate_id(voice_id):
    if not re.fullmatch(r"[a-f0-9]{12}", voice_id):
        raise HTTPException(400, "voice_id phải là ID clone 12 ký tự hex của ứng dụng.")


@router.get("/internal/voices/presets", response_model=PresetList)
def list_presets():
    return PresetList(presets=[PresetVoice(**p) for p in engine.presets()])


@router.post("/internal/voices/{voice_id}", response_model=VoiceRegistered)
def register_voice(voice_id: str, ref_audio: UploadFile = File(...), name: str | None = Form(default=None)):
    require_engine()
    validate_id(voice_id)
    data = ref_audio.file.read(20 * 1024 * 1024 + 1)
    if not data or len(data) > 20 * 1024 * 1024:
        raise HTTPException(400, "Audio mẫu cần có dữ liệu và không vượt quá 20 MB.")
    try:
        with engine.session():
            ref_path = voices_dir() / f"{voice_id}.wav"
            if voice_id in engine.custom_voices or ref_path.exists():
                raise HTTPException(409, "ID giọng đã tồn tại.")
            ffmpeg = resolve_ffmpeg_path()
            if not ffmpeg:
                raise ValueError("Không tìm thấy FFmpeg; hãy kiểm tra FFMPEG_PATH.")
            with tempfile.TemporaryDirectory(dir=voices_dir()) as tmp:
                source = Path(tmp) / "upload.audio"
                normalized = Path(tmp) / "reference.wav"
                source.write_bytes(data)
                result = subprocess.run(
                    [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                     "-t", "30", "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(normalized)],
                    capture_output=True, text=True, timeout=120, check=False,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if result.returncode or not normalized.is_file():
                    raise ValueError(f"Chuẩn hóa audio thất bại: {result.stderr[-1000:]}")
                normalized.replace(ref_path)
                try:
                    engine.register(voice_id, ref_path)
                except Exception:
                    ref_path.unlink(missing_ok=True)
                    raise
    except HTTPException:
        raise
    except Exception as exc:
        raise inference_error(exc) from exc
    return VoiceRegistered(ok=True, voice_id=voice_id, name=name or voice_id)


@router.delete("/internal/voices/{voice_id}", response_model=VoiceRemoved)
def remove_voice(voice_id: str):
    require_engine()
    validate_id(voice_id)
    try:
        with engine.session():
            engine.remove(voice_id)
            delete_ref_audio(voice_id)
    except Exception as exc:
        raise inference_error(exc) from exc
    return VoiceRemoved(ok=True, voice_id=voice_id)
