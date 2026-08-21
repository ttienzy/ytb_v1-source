"""REST /api/recap — Phase R1 (generate) + R2 (cut). State in-memory, KHÔNG DB / file recap.json.

- POST /api/recap/generate  (multipart: youtube_url + raw_file transcript) -> JobOut (recap_done)
- POST /api/recap/cut       (json: {job_id}) -> JobOut (cut_done, clips)
- GET  /api/recap/jobs/{id} -> JobOut (doc state de flow tiep o R3/R4)
- GET  /api/recap/jobs      -> list JobOut (debug)
"""
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.recap import service, state
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
    )


class CutRequest(BaseModel):
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


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str) -> JobOut:
    job = state.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy job — state in-memory, có thể server đã restart.",
        )
    return _to_out(job)


@router.get("/jobs", response_model=list[JobOut])
def list_jobs() -> list[JobOut]:
    return [_to_out(j) for j in state.list_jobs()]
