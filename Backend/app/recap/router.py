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
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.media.service import resolve_for_polish
from app.recap import service, state
from app.recap.paths import final_path, final_studio_path, voice_path
from app.recap.schemas import JobOut
from app.recap.ytdlp import login_youtube, yt_login_status

router = APIRouter(prefix="/api/recap", tags=["Recap"])


def _overall(job: state.JobState) -> str:
    """Tính overall status theo precedence.

    Thứ tự quan trọng: running phải kiểm tra TRƯỚC merged/polished.
    Nếu polish đang running mà merge đã done → phải trả "running"
    để FE tiếp tục poll (không dừng sớm khi thấy merged).
    """
    phases = [job.recap_status, job.cut_status, job.voice_status, job.merge_status, job.polish_status]
    if any(p == "error" for p in phases):
        return "error"
    if any(p == "running" for p in phases):
        return "running"
    if job.polish_status == "done":
        return "polished"
    if job.merge_status == "done":
        return "merged"
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
        polish_status=job.polish_status,
        overall=_overall(job),
        progress={
            "cut": job.progress_cut,
            "voice": job.progress_voice,
            "merge": job.progress_merge,
            "polish": job.progress_polish,
        },
        created_at=job.created_at,
        updated_at=job.updated_at,
        voice_id=job.voice_id,
        error=job.error,
        recap=job.recap,
        caption=job.caption or (job.recap.get("caption") if job.recap else None),
        clips=job.clips,
        overspeed=job.overspeed,
        final=job.final,
        final_studio=job.final_studio,
        credits=job.credits,
    )


# ── Request bodies ──────────────────────────────────────────────────────────

class CutRequest(BaseModel):
    job_id: str


class VoiceRequest(BaseModel):
    job_id: str
    voice_id: str


class MergeRequest(BaseModel):
    job_id: str


class PolishRequest(BaseModel):
    bgm_ids: list[str] = []
    volume: float = 0.10


# ── 1-button run endpoint (Phase C) ─────────────────────────────────────────

@router.post("/run", status_code=202)
async def run_pipeline(
    background_tasks: BackgroundTasks,
    youtube_url: str = Form(...),
    voice_id: str = Form(...),
    bgm_ids: str = Form(""),
    bgm_volume: float = Form(0.10),
    raw_file: UploadFile | None = File(None),
    raw_text: str = Form(""),
    db: Session = Depends(get_db),
):
    """1-click: [fetch transcript] → generate → gather(cut, voice) → merge → [polish BGM].

    ``raw_file`` (file) hoặc ``raw_text`` (text dán) tùy chọn — để trống cả hai → backend tự
    fetch transcript từ YouTube. Có ``raw_text`` ưu tiên cho UI dán transcript thủ công (dành
    video bị attestation-wall không auto-fetch được). Backend tự chuẩn hoá JSON→text sạch.
    ``bgm_ids`` = JSON string mảng track_id. Để trống → bỏ qua polish (output = final_recap.mp4).
    Trả 202 {job_id}.
    """
    voice_id = voice_id.strip()
    if not voice_id:
        raise HTTPException(status_code=400, detail="voice_id rỗng.")

    # Resolve BGM ids → paths + credits (router có db; service thuần ffmpeg).
    polish_opts: dict | None = None
    if bgm_ids.strip():
        import json as _json
        try:
            ids = _json.loads(bgm_ids)
        except ValueError:
            raise HTTPException(status_code=400, detail="bgm_ids không phải JSON array hợp lệ.")
        if not isinstance(ids, list) or not ids:
            raise HTTPException(status_code=400, detail="bgm_ids rỗng hoặc không phải list.")
        bgm_paths, credits = resolve_for_polish(db, ids)
        polish_opts = {
            "bgm_paths": [str(p) for p in bgm_paths],
            "credits": credits,
            "volume": bgm_volume,
        }

    raw_bytes: bytes | None = None
    raw_name: str | None = None
    if raw_file is not None:
        raw_bytes = await raw_file.read()
        if not raw_bytes:
            raw_bytes = None  # upload rỗng → coi như auto-fetch
        else:
            raw_name = raw_file.filename or "raw.txt"
    elif raw_text.strip():
        # UI dán transcript thủ công (text '[MM:SS] ...' hoặc JSON) — service sẽ chuẩn hoá.
        raw_bytes = raw_text.strip().encode("utf-8")
        raw_name = "raw.txt"

    job_id = await service.run(youtube_url, raw_bytes, raw_name, voice_id, polish_opts)
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


@router.post("/jobs/{job_id}/polish", response_model=JobOut)
async def polish_job(req: PolishRequest, job_id: str, db: Session = Depends(get_db)) -> JobOut:
    """Manual polish — mix BGM dưới VO. Gate: merge_status=done. resolve trong router."""
    job = state.get_job(job_id)
    if job is None:
        job = service.rehydrate(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    if not req.bgm_ids:
        raise HTTPException(status_code=400, detail="Cần ít nhất 1 bgm_id.")
    opts: dict = {"volume": req.volume}
    bgm_paths, credits = resolve_for_polish(db, req.bgm_ids)
    opts["bgm_paths"] = [str(p) for p in bgm_paths]
    opts["credits"] = credits
    job = await service.polish(job_id, opts)
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


@router.get("/jobs/{job_id}/studio")
def get_studio(job_id: str):
    """Serve final_studio.mp4 (đã polish BGM) — FileResponse hỗ trợ range (seek)."""
    if state.get_job(job_id) is None:
        service.rehydrate(job_id)
    if state.get_job(job_id) is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy job.")
    p = final_studio_path(job_id)
    if not p.exists() or not p.stat().st_size:
        raise HTTPException(status_code=404, detail="final_studio.mp4 chưa có — chạy polish trước.")
    return FileResponse(p, media_type="video/mp4", filename=p.name)


@router.get("/jobs", response_model=list[JobOut])
def list_jobs() -> list[JobOut]:
    """List tất cả job (memory + disk rehydrate). Sort theo created_at desc."""
    for jid in service.list_disk_jobs():
        service.rehydrate(jid)
    jobs = state.list_jobs()
    jobs.sort(key=lambda j: j.created_at, reverse=True)
    return [_to_out(j) for j in jobs]


# ── YouTube login (fallback cookies khi bị IP bot-wall) ───────────────────────

@router.get("/yt/login")
def yt_login_status_endpoint() -> dict:
    """Trạng thái login YouTube — có cookies file (cho yt-dlp fallback) không."""
    return yt_login_status()


@router.post("/yt/login")
def yt_login_endpoint() -> dict:
    """Mở Chrome tới youtube.com để user login Google → xuất cookies cho yt-dlp."""
    return login_youtube()
