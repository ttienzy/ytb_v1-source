from pathlib import Path
from urllib.parse import quote
import asyncio
import re
import shutil
import subprocess
import time
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Literal, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.db import get_db
from app.stories.models import CrawledStory, CrawledChapter, StorySummary
from app.media import audio_workflow, backgrounds, overlays, story_art, story_text, story_video
from app.media.audio_options import AudioOptions
from app.media import service as bgm_service

router = APIRouter(prefix="/api/audio", tags=["Audio workflow"])

class RunBody(BaseModel):
    story_slug: str
    chapter_number: Optional[int] = None
    chapter_numbers: list[int] | None = None
    batch_items: list[dict] | None = None
    voice_id: str
    aspect: str = "16:9"
    unit: Literal["story", "chapter"] = "story"  # story: mỗi truyện 1 video FULL (tự chia tập); chapter: mỗi chương 1 video
    part_max_minutes: int = Field(120, ge=20, le=600)  # truyện dài hơn ngưỡng này chia thành nhiều tập (cắt ở ranh giới chương)
    bg_fit: str = "fill"  # cách khớp video nền vào khung: fill (lấp đầy, cắt giữa) | blur (giữ nguyên + nền mờ)
    bgm_random: bool = True
    bgm_enabled: bool = True
    options: AudioOptions = Field(default_factory=AudioOptions)  # âm thanh & hiệu ứng (tốc độ đọc, nhạc nền, lớp phủ, kiểu nền…)
    auto_upload_drive: bool = False
    delete_local_after_upload: bool = False

class TestRunBody(BaseModel):
    text: str
    voice_id: str = "Adam"
    aspect: str = "9:16"
    bg_fit: str = "fill"
    options: AudioOptions = Field(default_factory=AudioOptions)

class AudioDriveRequest(BaseModel):
    file_names: list[str] = Field(min_length=1, max_length=100)
    auto_delete_local: bool = True

class AudioLocalDeleteRequest(BaseModel):
    file_names: list[str] = Field(min_length=1, max_length=100)

AUDIO_DRIVE_JOBS: dict[str, dict] = {}

def _require_backgrounds(aspect: str, fit: str, options: AudioOptions | None = None) -> None:
    """Báo lỗi ngay (400) nếu thiếu thứ bắt buộc, thay vì để job đọc xong cả chương bằng TTS rồi mới thất bại ở bước ghép.

    Chế độ nền ảnh bìa không cần thư viện video nền; logo đã chọn phải còn file."""
    options = options or AudioOptions()
    try:
        backgrounds.check(aspect, fit)
        if options.bg_mode == "library":
            backgrounds.ensure_sources()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if options.logo_id and audio_workflow.logo_path(options.logo_id) is None:
        raise HTTPException(400, "Không tìm thấy file logo đã chọn. Hãy chọn lại logo.")

def _pick_bgm_pool(db: Session, options: AudioOptions) -> list[Path]:
    """Danh sách nhạc nền hợp lệ; nếu chọn một bài cụ thể thì chỉ bài đó."""
    tracks = [t for t in bgm_service.list_tracks(db) if Path(t.file_path).exists() and Path(t.file_path).stat().st_size]
    if options.bgm_track_id:
        tracks = [t for t in tracks if t.track_id == options.bgm_track_id]
        if not tracks: raise HTTPException(400, "Không tìm thấy bài nhạc nền đã chọn trong Thư viện nhạc.")
    elif not tracks:
        raise HTTPException(400, "Bạn đã bật nhạc nền nhưng thư viện nhạc chưa có bài nào hợp lệ.")
    return [Path(t.file_path) for t in tracks]

def _audio_metadata() -> dict[str, dict]:
    try:
        import json
        return {item["file_name"]: item for item in json.loads(audio_workflow.AUDIO_MANIFEST.read_text(encoding="utf-8"))}
    except (OSError, ValueError, KeyError, TypeError):
        return {}

def _safe_audio_files(file_names: list[str]) -> list[tuple[str, Path, dict]]:
    metadata = _audio_metadata()
    result = []
    for filename in dict.fromkeys(file_names):
        path = audio_workflow.AUDIO_DIR / Path(filename).name
        if Path(filename).name != filename or path.parent != audio_workflow.AUDIO_DIR:
            raise HTTPException(400, "Tên file video không hợp lệ.")
        if not path.exists():
            raise HTTPException(404, f"Không tìm thấy video local: {filename}")
        result.append((filename, path, metadata.get(filename, {})))
    return result

def _remove_audio_local(filename: str, path: Path) -> None:
    path.unlink(missing_ok=True)
    metadata = _audio_metadata()
    thumb = metadata.get(filename, {}).get("thumbnail_name")
    if thumb:
        (audio_workflow.AUDIO_THUMBNAIL_DIR / Path(thumb).name).unlink(missing_ok=True)

def _drive_video_name(meta: dict) -> str:
    story_name = audio_workflow._safe_name(meta.get("story_name") or "Video_Audio")
    chapter_number = meta.get("chapter_number") or 1
    return f"{story_name}_Phần_{chapter_number}.mp4"

def _unique_drive_video_name(client, filename: str, folder_id: str) -> str:
    stem = Path(filename).stem
    suffix = Path(filename).suffix or ".mp4"
    candidate = f"{stem}{suffix}"
    index = 1
    while client.find_file_in_folder(candidate, folder_id):
        candidate = f"{stem} ({index}){suffix}"
        index += 1
    return candidate

def _upload_outputs_worker(job_id: str, body: AudioDriveRequest) -> None:
    from app.externals.gdrive import service as gdrive_service
    cfg = gdrive_service.get_gdrive_config()
    root_id = gdrive_service.get_workflow_folder_id("audio") or cfg.get("folder_id")
    client = gdrive_service.get_client()
    job = AUDIO_DRIVE_JOBS[job_id]
    for filename, path, meta in _safe_audio_files(body.file_names):
        item = next(entry for entry in job["items"] if entry["file_name"] == filename)
        try:
            history_item = audio_workflow.find_history_item(meta.get("story_slug"), meta.get("story_name"), meta.get("chapter_number"))
            if meta.get("drive_uploaded") or (history_item and history_item.get("drive_uploaded")):
                item.update(status="already_uploaded", percent=100, drive_url=meta.get("drive_url"))
                continue
            item.update(status="uploading", percent=0)
            def progress(done: int, total: int, current=item) -> None:
                current["percent"] = min(99, round(done * 100 / total)) if total else 0
            story_folder = client.get_or_create_child_folder(meta.get("story_name") or "Video Audio khác", root_id)
            chapter_name = f"Chương {meta['chapter_number']}" if meta.get("chapter_number") else "Video khác"
            drive_name = _unique_drive_video_name(client, _drive_video_name(meta), story_folder["id"])
            result = client.upload_file_resumable(path, folder_id=story_folder["id"], custom_name=drive_name, progress_callback=progress)
            item.update(status="done", percent=100, drive_url=result.get("web_view_link"))
            audio_workflow.record_drive_upload(meta, result)
            if body.auto_delete_local:
                _remove_audio_local(filename, path)
                item["deleted"] = True
        except Exception as exc:  # keep other selected videos running
            item.update(status="error", percent=0, error=str(exc))
    job["status"] = "completed"

@router.post("/outputs/upload-drive", status_code=202)
def upload_outputs_to_drive(body: AudioDriveRequest, background_tasks: BackgroundTasks):
    """Bắt đầu upload các video Audio theo cấu trúc Truyện/Chương."""
    from app.externals.gdrive import service as gdrive_service
    if not gdrive_service.get_client():
        raise HTTPException(400, "Google Drive chưa được kết nối. Vui lòng vào Cài đặt để kết nối.")
    cfg = gdrive_service.get_gdrive_config()
    if not (gdrive_service.get_workflow_folder_id("audio") or cfg.get("folder_id")):
        raise HTTPException(400, "Chưa cấu hình thư mục Google Drive cho Audio.")
    files = _safe_audio_files(body.file_names)
    import uuid
    job_id = uuid.uuid4().hex[:12]
    AUDIO_DRIVE_JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "items": [{"file_name": filename, "status": "queued", "percent": 0} for filename, _, _ in files],
    }
    background_tasks.add_task(_upload_outputs_worker, job_id, body)
    return {"job_id": job_id, **AUDIO_DRIVE_JOBS[job_id]}

@router.get("/outputs/upload-drive/{job_id}")
def upload_outputs_status(job_id: str):
    job = AUDIO_DRIVE_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Không tìm thấy tiến trình upload.")
    return job

@router.post("/outputs/delete-local")
def delete_audio_outputs_local(body: AudioLocalDeleteRequest):
    deleted = []
    for filename, path, _ in _safe_audio_files(body.file_names):
        _remove_audio_local(filename, path)
        deleted.append(filename)
    return {"ok": True, "deleted": deleted}

@router.get("/config")
def config():
    """Thông tin cấu hình để giao diện hiển thị đúng (vd thư mục lưu video) thay vì hard-code."""
    return {"output_dir": str(audio_workflow.AUDIO_DIR)}

def _completion_lookup():
    """Tra "chương này đã làm chưa" từ lịch sử: khớp theo (slug, số chương) HOẶC (tên truyện, số chương)."""
    history = [item for item in audio_workflow.history() if item.get("status") in {"completed", "uploaded"}]
    by_key = {(item.get("story_slug"), item.get("chapter_number")): item for item in history}
    by_name = {(item.get("story_name"), item.get("chapter_number")): item for item in history}

    def record(slug: str, name: str, number: int):
        return by_key.get((slug, number)) or by_name.get((name, number))

    return history, record

@router.get("/stories")
def stories(db: Session = Depends(get_db)):
    """Danh sách NHẸ để duyệt/tìm truyện: chỉ tên, thumbnail và số chương (tổng / đã làm). Chương chi tiết lấy theo từng truyện
    ở /stories/{slug}/chapters khi người dùng chọn truyện.

    Trước đây trả luôn toàn bộ chương của mọi truyện (14K+ dòng, ~1,6 MB) và nạp cả các cột nặng của CrawledStory
    (description, raw_metadata…) dù chỉ cần tên."""
    rows = db.query(CrawledStory.story_slug, CrawledStory.name, CrawledStory.image).order_by(CrawledStory.name, CrawledStory.story_slug).all()
    totals = dict(db.query(CrawledChapter.story_slug, func.count()).group_by(CrawledChapter.story_slug).all())
    thumbnails = audio_workflow.thumbnail_index()
    summarized = {slug for (slug,) in db.query(StorySummary.story_slug)}  # truyện đã có bản tóm tắt Gemini

    # Số chương đã làm: chỉ truyện có trong lịch sử mới cần tra số chương thật (thường là một phần rất nhỏ).
    history, record = _completion_lookup()
    name_by_slug = {slug: name for slug, name, _ in rows}
    slugs_by_name: dict[str, list[str]] = {}
    for slug, name, _ in rows:
        slugs_by_name.setdefault(name, []).append(slug)
    candidates: set[str] = set()
    for item in history:
        if item.get("story_slug") in name_by_slug:
            candidates.add(item["story_slug"])
        candidates.update(slugs_by_name.get(item.get("story_name"), ()))
    done: dict[str, int] = {}
    candidate_list = sorted(candidates)
    for start in range(0, len(candidate_list), 500):  # IN (...) theo lô: tránh vượt giới hạn tham số của SQLite
        chunk = candidate_list[start:start + 500]
        for slug, number in db.query(CrawledChapter.story_slug, CrawledChapter.chapter_number).filter(CrawledChapter.story_slug.in_(chunk)):
            if record(slug, name_by_slug[slug], number):
                done[slug] = done.get(slug, 0) + 1

    return [
        {"story_slug": slug, "name": name.strip(), "thumbnail_name": thumbnails.get(audio_workflow._safe_name(slug)),
         "has_cover": bool(image), "total_chapters": totals.get(slug, 0), "done_chapters": done.get(slug, 0), "has_summary": slug in summarized}
        for slug, name, image in rows
    ]

_LENGTHS_CACHE: dict = {"key": None, "value": {}}

@router.get("/stories/lengths")
def story_lengths(db: Session = Depends(get_db)):
    """Tổng số ký tự mỗi truyện → giao diện ước thời lượng video. Tính một lần (~3 giây với 14K chương) rồi giữ trong RAM
    tới khi số chương thay đổi (crawl thêm), nên tách khỏi /stories để danh sách hiện ngay."""
    key = db.query(func.count(CrawledChapter.chapter_key), func.max(CrawledChapter.crawled_at)).one()
    if _LENGTHS_CACHE["key"] != tuple(key):
        rows = db.query(CrawledChapter.story_slug, func.sum(func.length(CrawledChapter.paragraph))).group_by(CrawledChapter.story_slug).all()
        _LENGTHS_CACHE.update(key=tuple(key), value={slug: int(total or 0) for slug, total in rows})
    return {"chars_per_second": story_text.CHARS_PER_SECOND, "chars": _LENGTHS_CACHE["value"]}

@router.get("/stories/{story_slug}/cover")
def story_cover(story_slug: str, db: Session = Depends(get_db)):
    """Ảnh dùng cho video/thumbnail của truyện: ảnh tải lên tay (nếu có) → ảnh bìa nguồn (tải về cache lần đầu)."""
    uploaded = audio_workflow.thumbnail_path(story_slug)
    if uploaded:
        return FileResponse(uploaded)
    story = db.query(CrawledStory.image).filter(CrawledStory.story_slug == story_slug).first()
    if not story: raise HTTPException(404, "Không tìm thấy truyện đã crawl.")
    path = story_art.fetch_cover(story_video.cover_dir(), story_slug, story.image)
    if path is None: raise HTTPException(404, "Truyện không có ảnh bìa hoặc không tải được ảnh bìa nguồn.")
    return FileResponse(path, headers={"Cache-Control": "max-age=86400"})

@router.get("/stories/{story_slug}/chapters")
def story_chapters(story_slug: str, db: Session = Depends(get_db)):
    """Chương của MỘT truyện (không nạp nội dung `paragraph`), kèm trạng thái đã làm / đã upload Drive."""
    story = db.query(CrawledStory.story_slug, CrawledStory.name).filter(CrawledStory.story_slug == story_slug).first()
    if not story: raise HTTPException(404, "Không tìm thấy truyện đã crawl.")
    _, record = _completion_lookup()
    rows = db.query(CrawledChapter.chapter_number, CrawledChapter.title).filter(CrawledChapter.story_slug == story_slug).order_by(CrawledChapter.chapter_number).all()
    return {"story_slug": story.story_slug, "chapters": [
        {"chapter_number": number, "title": title, "completed": bool(record(story.story_slug, story.name, number)),
         "drive_uploaded": bool((record(story.story_slug, story.name, number) or {}).get("drive_uploaded"))}
        for number, title in rows
    ]}

@router.get("/stories/{story_slug}/chapters/{chapter_number}")
def story_chapter_content(story_slug: str, chapter_number: int, db: Session = Depends(get_db)):
    """Nội dung MỘT chương để người dùng đọc trước khi chọn làm Audio (chỉ nạp khi xem, không nằm trong danh sách)."""
    row = db.query(CrawledChapter.chapter_number, CrawledChapter.title, CrawledChapter.paragraph).filter(
        CrawledChapter.story_slug == story_slug, CrawledChapter.chapter_number == chapter_number).first()
    if not row: raise HTTPException(404, "Không tìm thấy chương.")
    text = (row.paragraph or "").strip()
    return {"story_slug": story_slug, "chapter_number": row.chapter_number, "title": row.title, "paragraph": text, "chars": len(text)}

@router.post("/stories/{story_slug}/thumbnail")
async def upload_thumbnail(story_slug: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not db.get(CrawledStory, story_slug): raise HTTPException(404, "Không tìm thấy truyện đã crawl.")
    if not file.content_type or not file.content_type.startswith("image/"): raise HTTPException(400, "File thumbnail phải là ảnh.")
    suffix = Path(file.filename or ".jpg").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}: raise HTTPException(400, "Chỉ hỗ trợ PNG, JPG, JPEG hoặc WEBP.")
    data = await file.read()
    if not data: raise HTTPException(400, "Ảnh thumbnail đang rỗng.")
    audio_workflow.AUDIO_THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
    for old in audio_workflow.AUDIO_THUMBNAIL_DIR.glob(f"{audio_workflow._safe_name(story_slug)}.*"): old.unlink(missing_ok=True)
    path = audio_workflow.AUDIO_THUMBNAIL_DIR / f"{audio_workflow._safe_name(story_slug)}{suffix}"
    path.write_bytes(data)
    return {"thumbnail_name": path.name}

@router.get("/thumbnails/{filename}")
def thumbnail(filename: str):
    path = audio_workflow.AUDIO_THUMBNAIL_DIR / Path(filename).name
    if path.parent != audio_workflow.AUDIO_THUMBNAIL_DIR or not path.exists(): raise HTTPException(404, "Không tìm thấy thumbnail.")
    return FileResponse(path)

def _story_input(story: CrawledStory, chapters: list[CrawledChapter]) -> story_video.StoryInput:
    categories = [c.get("categoryName", "") if isinstance(c, dict) else str(c) for c in (story.categories or [])]
    return story_video.StoryInput(
        slug=story.story_slug, name=story.name,
        chapters=[story_video.ChapterInput(c.chapter_number, c.title or f"Chương {c.chapter_number}", c.paragraph or "") for c in chapters],
        image=audio_workflow.thumbnail_path(story.story_slug), image_url=story.image,
        description=story.description or "", categories=[c for c in categories if c],
    )


def _queue_items(body: RunBody) -> list[tuple[str, list[int] | None]]:
    """(slug, số chương | None = mọi chương) theo cả hai dạng payload: một truyện hoặc batch_items."""
    if body.batch_items is not None:
        if not body.batch_items or len(body.batch_items) > 10:
            raise HTTPException(400, "Hàng đợi phải có từ 1 đến 10 truyện.")
        items = []
        for item in body.batch_items:
            slug = item.get("story_slug") if isinstance(item, dict) else None
            numbers = item.get("chapter_numbers") if isinstance(item, dict) else None
            if not slug or not isinstance(numbers, list) or not numbers:
                raise HTTPException(400, "Mỗi truyện trong hàng đợi phải có ít nhất 1 chương.")
            items.append((slug, [int(n) for n in numbers]))
        return items
    if body.chapter_numbers is not None:
        return [(body.story_slug, body.chapter_numbers)]
    if body.chapter_number is not None:
        return [(body.story_slug, [body.chapter_number])]
    return [(body.story_slug, None)]


def _check_render_inputs(body_aspect: str, bg_fit: str, options: AudioOptions) -> None:
    if body_aspect not in {"9:16", "16:9"}: raise HTTPException(400, "Khổ video không hợp lệ.")
    if options.layout == "classic":
        _require_backgrounds(body_aspect, bg_fit, options)
    elif options.logo_id and audio_workflow.logo_path(options.logo_id) is None:
        raise HTTPException(400, "Không tìm thấy file logo đã chọn. Hãy chọn lại logo.")


@router.post("/run", status_code=202)
async def run(body: RunBody, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Tạo video: `unit="story"` → mỗi truyện một video FULL (tự chia tập), `unit="chapter"` → mỗi chương một video."""
    _check_render_inputs(body.aspect, body.bg_fit, body.options)
    stories: list[story_video.StoryInput] = []
    for slug, numbers in _queue_items(body):
        story = db.get(CrawledStory, slug)
        if not story:
            raise HTTPException(404, f"Không tìm thấy truyện đã crawl: {slug}.")
        query = db.query(CrawledChapter).filter(CrawledChapter.story_slug == slug)
        if numbers is not None:
            query = query.filter(CrawledChapter.chapter_number.in_(numbers))
        chapters = query.order_by(CrawledChapter.chapter_number).all()
        if not chapters:
            raise HTTPException(404, f"Không tìm thấy chương đã chọn trong truyện {story.name.strip()}.")
        empty = next((c for c in chapters if not (c.paragraph or "").strip()), None)
        if empty:
            raise HTTPException(400, f"Nội dung chương {empty.chapter_number} của truyện {story.name.strip()} đang rỗng.")
        stories.append(_story_input(story, chapters))
    bgm_pool = _pick_bgm_pool(db, body.options) if body.bgm_enabled else []
    spec = story_video.VideoSpec(unit=body.unit, voice_id=body.voice_id, aspect=body.aspect, bg_fit=body.bg_fit, options=body.options,
                                 bgm_pool=bgm_pool, part_max_minutes=body.part_max_minutes, auto_upload_drive=body.auto_upload_drive,
                                 delete_local_after_upload=body.delete_local_after_upload)
    units = story_video.plan_units(stories, spec)
    job_id = audio_workflow.create(stories[0].name.strip() if len(stories) == 1 else "Hàng đợi Audio", "", len(units))
    audio_workflow.AUDIO_JOBS[job_id].update(steps=story_video.steps_for(spec), total_videos=len(units), completed_videos=0)
    background_tasks.add_task(story_video.run_videos, job_id, stories, spec)
    return {"job_id": job_id, "total_videos": len(units)}

@router.post("/test-run", status_code=202)
async def test_run(body: TestRunBody, background_tasks: BackgroundTasks):
    """Chạy thử pipeline bằng text dán trực tiếp, không cần truyện/chương (ảnh bìa thay thế, không nhạc nền)."""
    if not body.text.strip(): raise HTTPException(400, "Text test đang rỗng.")
    _check_render_inputs(body.aspect, body.bg_fit, body.options)
    story = story_video.StoryInput(slug=None, name="Test Workflow Audio", chapters=[story_video.ChapterInput(1, "Nội dung test", body.text.strip())])
    spec = story_video.VideoSpec(unit="chapter", voice_id=body.voice_id, aspect=body.aspect, bg_fit=body.bg_fit, options=body.options)
    job_id = audio_workflow.create("Test Workflow Audio", "Nội dung test")
    audio_workflow.AUDIO_JOBS[job_id].update(steps=story_video.steps_for(spec), total_videos=1, completed_videos=0)
    background_tasks.add_task(story_video.run_videos, job_id, [story], spec)
    return {"job_id": job_id}

@router.get("/jobs/{job_id}")
def job(job_id: str):
    item = audio_workflow.AUDIO_JOBS.get(job_id)
    if not item: raise HTTPException(404, "Không tìm thấy tiến trình Audio.")
    return item

@router.get("/outputs")
def outputs(): return audio_workflow.list_outputs()

@router.get("/outputs/{filename}")
def output(filename: str):
    path = audio_workflow.AUDIO_DIR / Path(filename).name
    if path.parent != audio_workflow.AUDIO_DIR or not path.exists(): raise HTTPException(404, "Không tìm thấy video Audio.")
    # inline để trình duyệt mở trình phát khi người dùng bấm xem;
    # FileResponse mặc định dùng attachment nên bị tải xuống ngay.
    # Header HTTP phải là Latin-1; dùng filename* để truyền tên tiếng Việt theo UTF-8.
    encoded_name = quote(path.name, safe="")
    headers = {"Content-Disposition": f'inline; filename="audio-video.mp4"; filename*=UTF-8\'\'{encoded_name}'}
    return FileResponse(path, media_type="video/mp4", headers=headers)

# ── Logo ─────────────────────────────────────────────────────────────────────
MAX_LOGO_BYTES = 5 * 1024 * 1024

@router.post("/logo", status_code=201)
async def upload_logo(file: UploadFile = File(...)):
    """Tải logo (PNG/JPG/WEBP ≤ 5 MB) để phủ lên video. Trả logo_id dùng trong options.logo_id."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in audio_workflow.LOGO_SUFFIXES: raise HTTPException(400, "Logo phải là PNG, JPG, JPEG hoặc WEBP.")
    data = await file.read()
    if not data: raise HTTPException(400, "File logo đang rỗng.")
    if len(data) > MAX_LOGO_BYTES: raise HTTPException(400, "Logo quá lớn (tối đa 5 MB).")
    logo_id = uuid.uuid4().hex[:12]
    audio_workflow.logo_dir().mkdir(parents=True, exist_ok=True)
    (audio_workflow.logo_dir() / f"{logo_id}{suffix}").write_bytes(data)
    return {"logo_id": logo_id}

@router.get("/logo/{logo_id}")
def get_logo(logo_id: str):
    path = audio_workflow.logo_path(logo_id)
    if path is None: raise HTTPException(404, "Không tìm thấy logo.")
    return FileResponse(path)

# ── Xem thử (vài giây, không cần TTS) ────────────────────────────────────────
class PreviewBody(BaseModel):
    story_slug: str | None = None
    aspect: str = "9:16"
    bg_fit: str = "fill"
    seconds: int = Field(6, ge=3, le=12)
    options: AudioOptions = Field(default_factory=AudioOptions)

PREVIEW_KEEP = 6

def _previews_dir() -> Path:
    return audio_workflow.AUDIO_DIR / "previews"

def _keep_preview(produced: Path) -> str:
    """Chuyển file xem thử vào thư mục previews (chỉ giữ PREVIEW_KEEP file mới nhất)."""
    out_dir = _previews_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"preview_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}.mp4"
    shutil.move(str(produced), out_dir / file_name)
    for old in sorted(out_dir.glob("preview_*.mp4"), key=lambda path: path.stat().st_mtime, reverse=True)[PREVIEW_KEEP:]:
        old.unlink(missing_ok=True)
    return file_name

PREVIEW_LINES = [
    "Đây là phụ đề mẫu, hiện đúng lúc giọng đọc câu này.",
    "Câu dài hơn sẽ tự xuống dòng, tối đa hai dòng mỗi lần để người xem kịp đọc.",
]


def _preview_cover_center(story: CrawledStory | None, name: str, body: PreviewBody, work: Path) -> Path:
    """Xem thử bố cục ảnh bìa: ảnh bìa thật của truyện (hoặc ảnh thay thế) + phụ đề mẫu + nhãn chương + lời nhắc (hiện ngay)."""
    image = None
    if story:
        image, _ = story_video.resolve_image(_story_input(story, []))
    image = image or story_art.placeholder_cover(story_video.cover_dir() / "_placeholder.png")
    seconds = float(body.seconds)
    half = seconds / 2
    cues = [story_text.Cue(0.3, half - 0.2, PREVIEW_LINES[0]), story_text.Cue(half, seconds - 0.2, PREVIEW_LINES[1])]
    options = body.options.model_copy(update={"cta": False})  # lời nhắc thật hiện từ giây 20 → thêm tay để thấy ngay
    ass = story_video.build_ass(cues, [(0.0, "Chương 1"), (seconds, "Chương 2")], seconds, body.aspect, options)
    if body.options.cta:
        x, y = story_art.frame_layout(body.aspect)["cta_pos"]
        ass += story_text.ass_event(0.5, seconds - 0.3, "Cta", body.options.cta_text.upper(), prefix=f"{{\\an5\\pos({x},{y})}}", layer=1)
    font_ok = story_video.stage_font(work)
    if font_ok:
        (work / "subs.ass").write_text(ass, encoding="utf-8")
    frame = story_art.compose_frame(image, body.aspect, story_text.clean_name(name), work / "frame_src.png")
    return story_video.render_cover_center(frame, audio_workflow.logo_path(body.options.logo_id), work, aspect=body.aspect,
                                           duration=seconds, options=body.options, has_ass=font_ok)


@router.post("/preview")
def preview(body: PreviewBody, db: Session = Depends(get_db)):
    """Dựng video xem thử với đúng bố cục + chữ/lớp phủ đang chọn (không có tiếng; bố cục Nền video dùng tiếng ồn hồng cho waveform)."""
    _check_render_inputs(body.aspect, body.bg_fit, body.options)
    story = db.get(CrawledStory, body.story_slug) if body.story_slug else None
    if body.story_slug and not story: raise HTTPException(404, "Không tìm thấy truyện đã crawl.")
    name = story.name if story else "Tên truyện mẫu"
    thumbnail = audio_workflow.thumbnail_path(story.story_slug) if story else None
    options = body.options
    if options.layout == "cover_center":
        work = _previews_dir() / f".w_{uuid.uuid4().hex[:8]}"
        work.mkdir(parents=True, exist_ok=True)
        try:
            try:
                produced = _preview_cover_center(story, name, body, work)
            except (ValueError, RuntimeError, subprocess.SubprocessError, OSError) as exc:
                raise HTTPException(400, f"Không dựng được video xem thử: {exc}") from exc
            return {"file_name": _keep_preview(produced)}
        finally:
            shutil.rmtree(work, ignore_errors=True)
    if options.bg_mode == "cover" and thumbnail is None:
        raise HTTPException(400, "Nền ảnh bìa cần một truyện đã có thumbnail: hãy chọn truyện và thêm ảnh bìa trước khi xem thử.")

    work = _previews_dir() / f".w_{uuid.uuid4().hex[:8]}"
    work.mkdir(parents=True, exist_ok=True)
    background: Path | None = None
    try:
        try:
            if options.bg_mode == "cover":
                background = backgrounds.build_cover_background(thumbnail, body.seconds, body.aspect)
            else:
                background = backgrounds.build_background(body.seconds, body.aspect, body.bg_fit)
            if options.needs_overlay():
                noise = work / "noise.wav"
                subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", f"anoisesrc=d={body.seconds}:c=pink:a=0.3", str(noise)],
                               check=True, capture_output=True, timeout=60)
                lines = overlays.title_lines(name, 1, "Tiêu đề chương mẫu", body.aspect)
                produced = overlays.render_overlays(background, noise, audio_workflow.logo_path(options.logo_id), work, aspect=body.aspect,
                                                    duration=float(body.seconds), options=options, lines=lines)
            else:
                produced = work / "plain.mp4"
                done = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(background), "-t", str(body.seconds), "-c", "copy", "-an", str(produced)],
                                      capture_output=True, text=True, timeout=120)
                if done.returncode: raise RuntimeError(done.stderr[-400:])
        except (ValueError, RuntimeError, subprocess.SubprocessError) as exc:
            raise HTTPException(400, f"Không dựng được video xem thử: {exc}") from exc
        return {"file_name": _keep_preview(produced)}
    finally:
        if background: background.unlink(missing_ok=True)
        shutil.rmtree(work, ignore_errors=True)

@router.get("/preview/{file_name}")
def get_preview(file_name: str):
    path = _previews_dir() / Path(file_name).name
    if path.parent != _previews_dir() or not re.fullmatch(r"preview_[\w]+\.mp4", path.name) or not path.exists():
        raise HTTPException(404, "Không tìm thấy video xem thử.")
    return FileResponse(path, media_type="video/mp4")
