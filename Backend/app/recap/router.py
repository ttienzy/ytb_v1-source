"""REST /api/recap — Phase R1 (generate) + R2 (cut) + R3 (voice) + R4 (merge). State in-memory.

- POST /api/recap/generate  (multipart: youtube_url + raw_file transcript) -> JobOut (recap_done)
- POST /api/recap/cut       (json: {job_id}) -> JobOut (cut_done, clips)
- POST /api/recap/voice     (json: {job_id, voice_id}) -> JobOut (voice_done, overspeed)
- POST /api/recap/merge     (json: {job_id}) -> JobOut (merged, final)
- GET  /api/recap/jobs/{id}            -> JobOut (doc state de flow tiep)
- GET  /api/recap/jobs/{id}/voice/{i} -> audio/wav (serve vo_i đã sync, cho UI nghe thử)
- GET  /api/recap/jobs/{id}/final     -> video/mp4 (serve final_recap.mp4, range request)
- GET  /api/recap/jobs                -> list JobOut (debug)
"""
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.recap import service, state
from app.recap.paths import final_path, voice_path
from app.recap.schemas import JobOut

router = APIRouter(prefix="/api/recap", tags=["Recap"])


def _to_out(job: state.JobState) -> JobOut:
    return JobOut(
        job_id=job.job_id,
        youtube_url=job.youtube_url,
        status=job.status,
        error=job.error,
        recap=job.recap,
        clips=job.clips,
        overspeed=job.overspeed,
        final=job.final,
    )


class CutRequest(BaseModel):
    job_id: str


class VoiceRequest(BaseModel):
    job_id: str
    voice_id: str


class MergeRequest(BaseModel):
    job_id: str


@router.post("/generate", response_model=JobOut)
async def generate(
    youtube_url: str = Form(...),
    raw_file: UploadFile = File(...),
) -> JobOut:
    raw_bytes = await raw_file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="File transcript rỗng.")
    job = await service.generate(youtube_url, raw_bytes, raw_file.filename or "raw.txt")
    return _to_out(job)


@router.post("/cut", response_model=JobOut)
async def cut(req: CutRequest) -> JobOut:
    job = await service.cut(req.job_id)
    return _to_out(job)


@router.post("/voice", response_model=JobOut)
async def voice(req: VoiceRequest) -> JobOut:
    job = await service.voice(req.job_id, req.voice_id)
    return _to_out(job)


@router.post("/merge", response_model=JobOut)
async def merge(req: MergeRequest) -> JobOut:
    job = await service.merge(req.job_id)
    return _to_out(job)


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str) -> JobOut:
    job = state.get_job(job_id)
    if job is None:
        job = service.rehydrate(job_id)  # thử dựng lại từ disk sau restart
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy job — state in-memory, có thể server đã restart.",
        )
    return _to_out(job)


@router.get("/jobs/{job_id}/voice/{idx}")
def get_voice(job_id: str, idx: int):
    """Serve ``voice_{idx}.wav`` (VO đã atempo sync) cho UI nghe thử từng đoạn."""
    if state.get_job(job_id) is None:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy job — state in-memory, có thể server đã restart.",
        )
    p = voice_path(job_id, idx)
    if not p.exists() or not p.stat().st_size:
        raise HTTPException(status_code=404, detail=f"voice_{idx}.wav chưa có — chạy TTS trước.")
    return FileResponse(p, media_type="audio/wav", filename=p.name)


@router.get("/jobs/{job_id}/final")
def get_final(job_id: str):
    """Serve ``final_recap.mp4`` (video cuối) — FileResponse hỗ trợ range request (seek)."""
    if state.get_job(job_id) is None:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy job — state in-memory, có thể server đã restart.",
        )
    p = final_path(job_id)
    if not p.exists() or not p.stat().st_size:
        raise HTTPException(status_code=404, detail="final_recap.mp4 chưa có — chạy merge trước.")
    return FileResponse(p, media_type="video/mp4", filename=p.name)


@router.get("/jobs", response_model=list[JobOut])
def list_jobs() -> list[JobOut]:
    # Gộp job trong memory + job trên disk (rehydrate nhẹ — chỉ đọc recap.json).
    for jid in service.list_disk_jobs():
        service.rehydrate(jid)
    return [_to_out(j) for j in state.list_jobs()]
