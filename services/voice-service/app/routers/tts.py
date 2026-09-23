"""Legacy WAV/ZIP endpoints plus a streaming PCM/WAV speech adapter."""
import hashlib
import io
import json
import struct
import zipfile

import anyio
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask

from app.audio import audio_to_wav_bytes, duration_of
from app.engine import EngineBusy, engine
from app.schemas import PreviewRequest, SpeechRequest, TTSBatchRequest, TTSRequest

router = APIRouter()


def require_engine():
    if not engine.ready:
        raise HTTPException(503, "voice engine not loaded")


def inference_error(exc: Exception):
    if isinstance(exc, EngineBusy):
        return HTTPException(429, str(exc), headers={"Retry-After": "3"})
    return HTTPException(400 if isinstance(exc, ValueError) else 500, f"infer failed: {exc}")


def _synth(text, voice_id, temperature, max_chars):
    try:
        with engine.session():
            audio = engine.vieneu.infer(text, voice=engine.resolve_voice(voice_id),
                                        temperature=temperature, max_chars=max_chars)
            sr = engine.vieneu.sample_rate
            return audio, sr
    except Exception as exc:
        raise inference_error(exc) from exc


async def wav_response(text, voice_id, temperature, max_chars):
    require_engine()
    audio, sr = await run_in_threadpool(_synth, text, voice_id, temperature, max_chars)
    return Response(audio_to_wav_bytes(audio, sr), media_type="audio/wav",
                    headers={"X-Audio-Duration": f"{duration_of(audio, sr):.3f}",
                             "X-Sample-Rate": str(sr)})


@router.post("/preview")
async def preview(req: PreviewRequest):
    return await wav_response(req.text, req.voice_id, req.temperature, 256)


@router.post("/tts")
async def tts(req: TTSRequest):
    return await wav_response(req.text, req.voice_id, req.temperature, req.max_chars)


def _batch(req: TTSBatchRequest):
    try:
        with engine.session():
            groups: dict[str | None, list[int]] = {}
            for i, item in enumerate(req.items):
                groups.setdefault(item.voice_id or req.voice_id, []).append(i)
            # Validate every voice before doing expensive synthesis.
            voices = {vid: engine.resolve_voice(vid) for vid in groups}
            audios = [None] * len(req.items)
            for vid, indices in groups.items():
                results = engine.vieneu.infer_batch(
                    [req.items[i].text for i in indices], voice=voices[vid],
                    temperature=req.temperature, max_chars=req.max_chars,
                )
                if len(results) != len(indices):
                    raise RuntimeError("SDK returned an incomplete audio batch")
                for i, audio in zip(indices, results):
                    audios[i] = audio
            sr = engine.vieneu.sample_rate
            manifest = []
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for i, audio in enumerate(audios):
                    fname = f"vo_{i}.wav"
                    zf.writestr(fname, audio_to_wav_bytes(audio, sr))
                    duration = round(duration_of(audio, sr), 3)
                    manifest.append({"index": i, "filename": fname, "duration": duration,
                                     "duration_sec": duration, "sample_rate": sr,
                                     "voice_id": req.items[i].voice_id or req.voice_id,
                                     "text_sha256": hashlib.sha256(req.items[i].text.encode()).hexdigest()})
                zf.writestr("manifest.json", json.dumps({
                    "schema_version": 2, "profile": engine.profile,
                    "sdk_version": engine.status()["sdk_version"], "items": manifest,
                }, ensure_ascii=False))
            return buf.getvalue()
    except Exception as exc:
        raise inference_error(exc) from exc


@router.post("/tts/batch")
async def tts_batch(req: TTSBatchRequest):
    require_engine()
    data = await run_in_threadpool(_batch, req)
    return Response(data, media_type="application/zip",
                    headers={"X-Audio-Count": str(len(req.items))})


def pcm_bytes(audio):
    return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


def _pcm_stream(req: SpeechRequest):
    with engine.session():
        voice = engine.resolve_voice(req.voice)
        chunks = engine.vieneu.infer_stream(req.input, voice=voice,
                                            temperature=req.temperature, max_chars=req.max_chars)
        try:
            for chunk in chunks:
                if len(chunk):
                    yield pcm_bytes(chunk)
        finally:
            chunks.close()


def wav_header(sr):
    # Streaming WAV: RIFF/data length unknown until the producer finishes.
    return struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 0xFFFFFFFF, b"WAVE", b"fmt ",
                       16, 1, 1, sr, sr * 2, 2, 16, b"data", 0xFFFFFFFF)


@router.post("/v1/audio/speech")
async def speech(req: SpeechRequest):
    require_engine()
    if not req.stream:
        audio, sr = await run_in_threadpool(_synth, req.input, req.voice, req.temperature, req.max_chars)
        data = pcm_bytes(audio) if req.response_format == "pcm" else audio_to_wav_bytes(audio, sr)
        return Response(data, media_type="application/octet-stream" if req.response_format == "pcm" else "audio/wav",
                        headers={"X-Sample-Rate": str(sr)})
    iterator = _pcm_stream(req)
    try:
        first = await run_in_threadpool(next, iterator, None)
        if first is None:
            raise ValueError("Không tạo được âm thanh từ văn bản.")
    except Exception as exc:
        iterator.close()
        raise inference_error(exc) from exc

    async def body():
        try:
            if req.response_format == "wav":
                yield wav_header(engine.vieneu.sample_rate)
            yield first
            while True:
                chunk = await run_in_threadpool(next, iterator, None)
                if chunk is None:
                    break
                yield chunk
        finally:
            # Release the model even when the browser disconnects mid-stream.
            with anyio.CancelScope(shield=True):
                await run_in_threadpool(iterator.close)

    return StreamingResponse(body(), media_type="audio/wav" if req.response_format == "wav" else "application/octet-stream",
                             headers={"X-Sample-Rate": str(engine.vieneu.sample_rate), "Cache-Control": "no-store"},
                             background=BackgroundTask(iterator.close))


@router.get("/v1/voices")
def speech_voices():
    require_engine()
    return {"voices": [*engine.presets(), *({"name": name, "custom": True} for name in engine.custom_voices)]}
