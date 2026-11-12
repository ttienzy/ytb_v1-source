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
from app.recap.schemas import (
    BatchOut,
    BatchRunRequest,
    JobOut,
    JobPublishFacebookRequest,
    JobPublishYouTubeRequest,
)
from app.recap.ytdlp import login_youtube, reset_youtube_cookies, yt_login_status

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


def _find_job_pippit_tasks(job_id: str, title: str | None = None) -> list[dict]:
    """Tìm các bài đăng Facebook / TikTok qua Pippit đã liên kết với job này."""
    try:
        from app.externals.pippit.service import _get_saved_tasks
        all_tasks = _get_saved_tasks()
        matched = []
        clean_title = (title or "").strip().lower()
        for t in all_tasks:
            t_jid = t.get("job_id")
            t_title = (t.get("title") or "").strip().lower()
            if t_jid and t_jid == job_id:
                matched.append(t)
            elif clean_title and t_title and len(clean_title) >= 10 and (clean_title in t_title or t_title in clean_title):
                matched.append(t)
        return matched
    except Exception:
        return []


def _find_job_youtube_tasks(job_id: str, title: str | None = None) -> list[dict]:
    """Tìm các bài đăng YouTube đã liên kết với job này."""
    try:
        from app.externals.youtube.service import get_saved_tasks
        all_tasks = get_saved_tasks()
        matched = []
        clean_title = (title or "").strip().lower()
        for t in all_tasks:
            t_file = t.get("file_name") or ""
            t_title = (t.get("title") or "").strip().lower()
            if job_id in t_file:
                matched.append(t)
            elif clean_title and t_title and len(clean_title) >= 10 and (clean_title in t_title or t_title in clean_title):
                matched.append(t)
        return matched
    except Exception:
        return []


def _to_out(job: state.JobState) -> JobOut:
    caption_obj = job.caption or (job.recap.get("caption") if job.recap else None)
    job_title = None
    if caption_obj and isinstance(caption_obj, dict):
        job_title = caption_obj.get("title")
    pippit_tasks = _find_job_pippit_tasks(job.job_id, job_title)
    youtube_tasks = _find_job_youtube_tasks(job.job_id, job_title)

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
            "recap": job.progress_recap,
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
        caption=caption_obj,
        clips=job.clips,
        overspeed=job.overspeed,
        final=job.final,
        final_studio=job.final_studio,
        credits=job.credits,
        timings=job.timings or None,
        pippit_tasks=pippit_tasks,
        youtube_tasks=youtube_tasks,
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


class ResumeRequest(BaseModel):
    voice_id: str | None = None  # chỉ cần khi job không còn nhớ giọng (vd. restart server)


@router.post("/jobs/{job_id}/resume", response_model=JobOut)
async def resume_job(job_id: str, req: ResumeRequest | None = None) -> JobOut:
    """Tiếp tục/Thử lại pipeline từ bước bị lỗi (Recap, Cut, Voice, Merge hoặc Polish).

    Chỉ chạy lại phase chưa xong. 404 không có job, 409 job đang chạy, 400 thiếu voice_id.
    """
    job = await service.resume_pipeline(job_id, req.voice_id if req else None)
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


@router.delete("/jobs/{job_id}")
def delete_job_endpoint(job_id: str) -> dict:
    """Xóa 1 job: xóa toàn bộ thư mục Data/Downloads/{job_id}/ và xóa state."""
    deleted = service.delete_job_data(job_id)
    return {"status": "ok", "job_id": job_id, "deleted": deleted}


@router.post("/jobs/{job_id}/publish-facebook")
def publish_facebook_endpoint(job_id: str, payload: JobPublishFacebookRequest):
    """Upload video của job lên Pippit và lên lịch đăng bài cho Facebook Page hoặc TikTok."""
    return service.publish_job_to_facebook(job_id, payload)


@router.post("/jobs/{job_id}/publish-youtube")
def publish_youtube_endpoint(job_id: str, payload: JobPublishYouTubeRequest):
    """Upload video của job lên kênh YouTube kết nối."""
    return service.publish_job_to_youtube(job_id, payload)




# ── YouTube login (fallback cookies khi bị IP bot-wall) ───────────────────────

@router.get("/yt/login")
def yt_login_status_endpoint() -> dict:
    """Trạng thái login YouTube — có cookies file (cho yt-dlp fallback) không."""
    return yt_login_status()


@router.post("/yt/login")
def yt_login_endpoint() -> dict:
    """Mở Chrome tới youtube.com để user login Google → xuất cookies cho yt-dlp."""
    return login_youtube()


@router.delete("/yt/login")
def yt_reset_login_endpoint() -> dict:
    """Xóa cookie YouTube đang dùng làm fallback cho yt-dlp."""
    return reset_youtube_cookies()


# ── Batch Queue ───────────────────────────────────────────────────────────────

def _batch_to_out(batch: state.BatchState) -> BatchOut:
    """Chuyển BatchState → BatchOut để serialize ra JSON."""
    items_out = [
        {
            "url": item.url,
            "job_id": item.job_id,
            "status": item.status,
            "error": item.error,
            "retry_count": item.retry_count,
        }
        for item in batch.items
    ]
    done_count = sum(1 for it in batch.items if it.status == "done")
    error_count = sum(1 for it in batch.items if it.status == "error")
    pending_count = sum(1 for it in batch.items if it.status in ("pending", "skipped"))
    return BatchOut(
        batch_id=batch.batch_id,
        status=batch.status,
        current_index=batch.current_index,
        items=items_out,
        voice_id=batch.voice_id,
        total=len(batch.items),
        done_count=done_count,
        error_count=error_count,
        pending_count=pending_count,
        created_at=batch.created_at,
        updated_at=batch.updated_at,
    )


@router.post("/batch", status_code=202)
async def create_batch(
    body: BatchRunRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Tạo batch queue: xếp hàng 1-10 YouTube URLs, chạy tuần tự.

    - Mỗi job dùng chung voice_id + bgm settings
    - Nếu 1 job lỗi → retry 1 lần → còn lỗi → dừng queue
    - Poll tiến trình qua GET /api/recap/batch/{batch_id}
    """
    # Resolve BGM ids → paths + credits qua database
    polish_opts: dict | None = None
    if body.bgm_ids and len(body.bgm_ids) > 0:
        bgm_paths, credits = resolve_for_polish(db, body.bgm_ids)
        polish_opts = {
            "bgm_paths": [str(p) for p in bgm_paths],
            "credits": credits,
            "volume": body.bgm_volume if body.bgm_volume is not None else 0.10,
        }

    batch_id = await service.run_batch(
        urls=body.urls,
        voice_id=body.voice_id,
        polish_opts=polish_opts,
    )
    return {"batch_id": batch_id, "total": len(body.urls)}


@router.get("/batch", response_model=list[BatchOut])
def list_batches() -> list[BatchOut]:
    """Trả danh sách tất cả batch (theo thứ tự tạo mới nhất)."""
    batches = state.list_batches()
    batches_sorted = sorted(batches, key=lambda b: b.created_at, reverse=True)
    return [_batch_to_out(b) for b in batches_sorted]


@router.get("/batch/{batch_id}", response_model=BatchOut)
def get_batch(batch_id: str) -> BatchOut:
    """Poll trạng thái của 1 batch. FE poll mỗi 3s cho đến khi status='done'|'stopped'."""
    batch = state.get_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch không tồn tại.")
    return _batch_to_out(batch)


@router.delete("/batch/{batch_id}")
def stop_batch(batch_id: str) -> dict:
    """Soft cancel batch: đánh dấu stop_requested=True.

    Worker sẽ dừng sau khi job hiện tại hoàn tất (không kill cứng).
    """
    batch = state.get_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch không tồn tại.")
    if batch.status in ("done", "stopped"):
        return {"ok": True, "message": f"Batch đã ở trạng thái '{batch.status}', không cần dừng."}
    state.update_batch(batch_id, stop_requested=True)
    return {"ok": True, "message": "Đã gửi lệnh dừng. Batch sẽ dừng sau khi job hiện tại xong."}
