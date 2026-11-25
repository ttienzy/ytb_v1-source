from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.externals.pippit import captions, service, sources
from app.externals.pippit.schemas import (
    CaptionGenerateRequest,
    PippitAccountOut,
    PippitBulkScheduleRequest,
    PippitBulkScheduleResponse,
    PippitLoginSyncRequest,
    PippitPublishRequest,
    PippitPublishResponse,
    PippitScheduleTaskOut,
    PippitTasksOverview,
)

router = APIRouter(prefix="/api/pippit", tags=["Pippit AI"])


@router.get("/accounts", response_model=list[PippitAccountOut])
def get_accounts():
    """Lấy danh sách các tài khoản Pippit đã lưu trong config.json."""
    return service.get_saved_pippit_accounts()


@router.get("/active-pages")
def get_active_pages():
    """Lấy danh sách tất cả các Facebook Page đang active (đã liên kết) trên toàn bộ tài khoản Pippit."""
    return service.get_all_active_facebook_pages()


@router.get("/active-tiktok-channels")
def get_active_tiktok_channels():
    """Lấy danh sách tất cả các TikTok Channel đang active trên toàn bộ tài khoản Pippit."""
    return service.get_all_active_tiktok_channels()


@router.get("/active-channels")
def get_active_channels():
    """Lấy danh sách tất cả kênh (Facebook + TikTok) đã kết nối trên Pippit."""
    return service.get_all_active_channels()


@router.post("/accounts/login-sync", response_model=PippitAccountOut)
def login_and_sync(payload: PippitLoginSyncRequest):
    """Đăng nhập Pure HTTP bằng email + mật khẩu và tự động kéo toàn bộ Real Facebook Pages về."""
    return service.login_and_sync_account(payload)


@router.post("/accounts/{account_id}/refresh-pages", response_model=PippitAccountOut)
def refresh_pages(account_id: str):
    """Quét lại danh sách Real Facebook Pages từ Pippit cho tài khoản đã lưu."""
    return service.refresh_account_pages(account_id)


@router.get("/accounts/{account_id}/tasks", response_model=list[PippitScheduleTaskOut])
def get_tasks(account_id: str):
    """Tra cứu danh sách các bài đăng đã lên lịch trên Pippit."""
    return service.list_account_tasks(account_id)


@router.get("/all-tasks")
def get_all_tasks():
    """Lấy danh sách tất cả các bài đăng đã lên lịch trên toàn bộ tài khoản Pippit (luôn đồng bộ live)."""
    return service.list_all_saved_accounts_tasks()


@router.get("/tasks", response_model=PippitTasksOverview)
def get_tasks_overview(sync: bool = False):
    """Lịch sử bài đăng: sync=false đọc cache; sync=true đồng bộ live và báo trạng thái từng tài khoản."""
    return service.get_tasks_overview(sync=sync)


@router.post("/publish", response_model=PippitPublishResponse)
def publish_video(payload: PippitPublishRequest):
    """Upload video 5 bước lên Pippit Cloud và lên lịch đăng bài cho Facebook Page."""
    return service.publish_video_to_page(payload)


@router.post("/bulk-schedule", response_model=PippitBulkScheduleResponse)
def bulk_schedule(payload: PippitBulkScheduleRequest):
    """Lên lịch đăng bài hàng loạt video ngắn qua Pippit."""
    return service.bulk_schedule_videos(payload)


@router.get("/sources")
def list_sources(source: str = "campaign", q: str = "", group: str = "",
                 limit: int = Query(default=60, ge=1, le=200), offset: int = Query(default=0, ge=0)):
    """Kho video có thể đăng: chiến dịch AI | ai_library | recap | local (kèm caption sẵn có + kênh đã đăng)."""
    try:
        return sources.list_publishable_videos(source, q, group, limit, offset)
    except sources.SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sources/preview")
def preview_source(path: str):
    """Phát video cục bộ để xem trước (chỉ file video trong thư mục dữ liệu của app)."""
    try:
        file = sources.assert_allowed_video_path(path)
    except sources.SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(file, media_type="video/mp4", filename=file.name, content_disposition_type="inline")


@router.post("/sources/upload-local")
async def upload_local_videos(files: list[UploadFile] = File(...)):
    """Nhận video từ máy tính vào kho tạm của app để đăng."""
    saved: list[dict] = []
    errors: list[str] = []
    for f in files:
        data = await f.read()
        try:
            saved.append(await run_in_threadpool(sources.save_local_upload, f.filename or "video.mp4", data))
        except sources.SourceError as exc:
            errors.append(str(exc))
    if not saved and errors:
        raise HTTPException(status_code=400, detail=" ".join(errors))
    return {"items": saved, "errors": errors}


@router.post("/generate-captions")
async def generate_captions(payload: CaptionGenerateRequest):
    """Gemini viết caption hàng loạt cho các video đã chọn (0 credit Flow/Muse, một lượt, không tự gửi lại)."""
    try:
        return await run_in_threadpool(
            captions.generate_batch_captions,
            [i.model_dump() for i in payload.items],
            tone=payload.tone, extra_brief=payload.extra_brief,
            include_ai_disclosure=payload.include_ai_disclosure, language=payload.language,
        )
    except captions.CaptionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str):
    """Xóa tài khoản Pippit khỏi config.json."""
    return service.delete_pippit_account(account_id)
