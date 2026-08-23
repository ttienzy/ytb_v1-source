"""REST /api/recap — Phase redesign: parallel cut+voice, 1-button /run endpoint.

Endpoints:
- POST /api/recap/run       (multipart: youtube_url + voice_id [+ raw_file?]) → 202 {job_id}  [NEW, auto-fetch transcript]
- POST /api/recap/generate  (multipart: youtube_url + raw_file) → JobOut   [giữ]
- POST /api/recap/cut       (json: {job_id}) → JobOut                       [giữ, manual]
- POST /api/recap/voice     (json: {job_id, voice_id}) → JobOut             [giữ, manual]
- POST /api/recap/merge     (json: {job_id}) → JobOut                       [giữ, manual]
- GET  /api/recap/jobs/{id}            → JobOut (poll)
- GET  /api/recap/jobs/{id}/voice/{i} → audio/wav
- GET  /api/recap/jobs/{id}/final     → video/mp4
- GET  /api/recap/jobs                → list JobOut
"""
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app.recap import service, state
from app.recap.paths import final_path, voice_path
from app.recap.schemas import JobOut

router = APIRouter(prefix="/api/recap", tags=["Recap"])


def _overall(job: state.JobState) -> str:
    """Tính overall status theo precedence."""
    phases = [job.recap_status, job.cut_status, job.voice_status, job.merge_status]
    if any(p == "error" for p in phases):
        return "error"
    if job.merge_status == "done":
        return "merged"
    if any(p == "running" for p in phases):
        return "running"
    if job.recap_status == "done":
        return "recap_done"
    return "idle"


def _to_out(job: state.JobState) -> JobOut:
    return JobOut(
        job_id=job.job_id,
        youtube_url=job.youtube_url,
        recap_status=job.recap_status,
        cut_status=job.cut_status,
        voice_status=job.voice_status,
        merge_status=job.merge_status,
        overall=_overall(job),
        progress={
            "cut": job.progress_cut,
            "voice": job.progress_voice,
            "merge": job.progress_merge,
        },
        created_at=job.created_at,
        updated_at=job.updated_at,
        voice_id=job.voice_id,
        error=job.error,
        recap=job.recap,
        clips=job.clips,
        overspeed=job.overspeed,
        final=job.final,
    )


# ── Request bodies ──────────────────────────────────────────────────────────

class CutRequest(BaseModel):
    job_id: str


class VoiceRequest(BaseModel):
    job_id: str
    voice_id: str


class MergeRequest(BaseModel):
    job_id: str


# ── 1-button run endpoint (Phase C) ─────────────────────────────────────────

@router.post("/run", status_code=202)
async def run_pipeline(
    background_tasks: BackgroundTasks,
    youtube_url: str = Form(...),
    voice_id: str = Form(...),
    raw_file: UploadFile | None = File(None),
):
    """1-click: [fetch transcript] → generate → gather(cut, voice) song song → merge.

    ``raw_file`` tùy chọn — để trống → backend tự fetch transcript từ YouTube
    (Playwright get_panel). Trả 202 {job_id} ngay; frontend poll GET /jobs/{id}.
    """
    voice_id = voice_id.strip()
    if not voice_id:
        raise HTTPException(status_code=400, detail="voice_id rỗng.")

    raw_bytes: bytes | None = None
    raw_name: str | None = None
    if raw_file is not None:
        raw_bytes = await raw_file.read()
        if not raw_bytes:
            raw_bytes = None  # upload rỗng → coi như auto-fetch
        else:
            raw_name = raw_file.filename or "raw.txt"

    job_id = await service.run(youtube_url, raw_bytes, raw_name, voice_id)
    return JSONResponse({"job_id": job_id}, status_code=202)


# ── Manual step endpoints (giữ để debug / re-run từng phase) ────────────────

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


# ── Poll + serve ─────────────────────────────────────────────────────────────

@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str) -> JobOut:
    job = state.get_job(job_id)
    if job is None:
        job = service.rehydrate(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy job — state in-memory, có thể server đã restart.",
        )
    return _to_out(job)


@router.get("/jobs/{job_id}/voice/{idx}")
def get_voice(job_id: str, idx: int):
    """Serve voice_{idx}.wav cho UI nghe thử từng đoạn."""
    if state.get_job(job_id) is None:
        service.rehydrate(job_id)
    if state.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    p = voice_path(job_id, idx)
    if not p.exists() or not p.stat().st_size:
        raise HTTPException(status_code=404, detail=f"voice_{idx}.wav chưa có — chạy TTS trước.")
    return FileResponse(p, media_type="audio/wav", filename=p.name)


@router.get("/jobs/{job_id}/final")
def get_final(job_id: str):
    """Serve final_recap.mp4 — FileResponse hỗ trợ range request (seek)."""
    if state.get_job(job_id) is None:
        service.rehydrate(job_id)
    if state.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    p = final_path(job_id)
    if not p.exists() or not p.stat().st_size:
        raise HTTPException(status_code=404, detail="final_recap.mp4 chưa có — chạy merge trước.")
    return FileResponse(p, media_type="video/mp4", filename=p.name)


@router.get("/jobs", response_model=list[JobOut])
def list_jobs() -> list[JobOut]:
    """List tất cả job (memory + disk rehydrate). Sort theo created_at desc."""
    for jid in service.list_disk_jobs():
        service.rehydrate(jid)
    jobs = state.list_jobs()
    jobs.sort(key=lambda j: j.created_at, reverse=True)
    return [_to_out(j) for j in jobs]
