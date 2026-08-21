"""TTS endpoints: /preview, /tts, /tts/batch.

Gọi engine.vieneu.infer / infer_batch (CPU-ONNX, 48 kHz). Vì infer là đồng bộ
và nặng (ONNX forward), bọc trong threadpool để không block event loop FastAPI.
Trả audio/wav (PCM_16) + header ``X-Audio-Duration`` (s) để main backend đo lệch
→ atempo sync (plan §3.3).
"""
import io
import json
import zipfile

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from app.audio import audio_to_wav_bytes, duration_of
from app.engine import engine
from app.schemas import (
    DEFAULT_PREVIEW_TEXT,
    PreviewRequest,
    TTSBatchRequest,
    TTSRequest,
)

router = APIRouter()


def _synth(text: str, voice_id: str | None, temperature: float, max_chars: int):
    """Chạy infer trong threadpool, trả (wav_bytes, duration_s). Bắt lỗi voice."""
    if not engine.ready:
        raise HTTPException(status_code=503, detail="voice engine not loaded")
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text rỗng")
    try:
        audio = engine.vieneu.infer(
            text,
            voice=voice_id,
            temperature=temperature,
            max_chars=max_chars,
        )
    except ValueError as e:  # voice_id không tồn tại
        raise HTTPException(status_code=400, detail=f"infer failed: {e}") from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"infer failed: {e}") from e
    sr = getattr(engine.vieneu, "sample_rate", 48000)
    return audio_to_wav_bytes(audio, sr), duration_of(audio, sr)


@router.post("/preview")
async def preview(req: PreviewRequest) -> Response:
    """Nghe thử: sinh 1 câu (default nếu thiếu text) → audio/wav."""
    wav, dur = await run_in_threadpool(
        _synth, req.text, req.voice_id, req.temperature, 256
    )
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={"X-Audio-Duration": f"{dur:.3f}"},
    )


@router.post("/tts")
async def tts(req: TTSRequest) -> Response:
    """Sinh lời 48 kHz cho 1 đoạn text → audio/wav + X-Audio-Duration."""
    wav, dur = await run_in_threadpool(
        _synth, req.text, req.voice_id, req.temperature, req.max_chars
    )
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={"X-Audio-Duration": f"{dur:.3f}"},
    )


@router.post("/tts/batch")
async def tts_batch(req: TTSBatchRequest) -> Response:
    """Sinh nhiều đoạn → zip {vo_<i>.wav, manifest.json}.

    CPU/ONNX chạy tuần tự (infer_batch không gain batch như GPU). Trả zip để main
    backend giải nén thẳng vào ``Data/jobs/{job_id}/voice/vo_i.wav`` (plan §5).
    """
    if not engine.ready:
        raise HTTPException(status_code=503, detail="voice engine not loaded")
    if not req.items:
        raise HTTPException(status_code=400, detail="items rỗng")

    sr = getattr(engine.vieneu, "sample_rate", 48000)
    manifest: list[dict] = []

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, item in enumerate(req.items):
            text = (item.text or "").strip()
            vid = item.voice_id or req.voice_id
            if not text:
                raise HTTPException(status_code=400, detail=f"item {i} text rỗng")
            try:
                audio = await run_in_threadpool(
                    engine.vieneu.infer,
                    text,
                    voice=vid,
                    temperature=req.temperature,
                    max_chars=req.max_chars,
                )
            except Exception as e:  # noqa: BLE001
                raise HTTPException(status_code=400, detail=f"item {i} infer failed: {e}") from e
            wav = audio_to_wav_bytes(audio, sr)
            fname = f"vo_{i}.wav"
            zf.writestr(fname, wav)
            manifest.append(
                {"index": i, "filename": fname, "duration": round(duration_of(audio, sr), 3)}
            )
        zf.writestr("manifest.json", json.dumps({"items": manifest}, ensure_ascii=False))

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"X-Audio-Count": str(len(manifest))},
    )
