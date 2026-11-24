"""Durable, ordered Omni Ingredients batches for Veo Studio."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, RLock, Thread
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter

from app.core.config import DATA_DIR
from app.veo import service
from app.veo.schemas import AspectRatio, InputMode, VeoJobOut, VeoJobRequest

logger = logging.getLogger(__name__)
STORE = DATA_DIR / "veo_studio_batches.json"
ImageId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,128}$")]


class ImageAsset(BaseModel):
    source: Literal["upload", "library"]
    id: ImageId
    name: str = Field(default="", max_length=255)


class VideoSettings(BaseModel):
    aspect_ratio: AspectRatio = AspectRatio.LANDSCAPE
    resolution: Literal["720p", "360p"] = "720p"
    duration_seconds: int = Field(default=10, ge=3, le=15, strict=True)


class VideoUnit(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    image: ImageAsset
    prompt: str = Field(min_length=1, max_length=8000)
    references: list[ImageAsset] = Field(default_factory=list, max_length=2)
    settings: VideoSettings


class BatchRequest(BaseModel):
    batch_id: UUID
    project_id: str = Field(min_length=1)
    items: list[VideoUnit] = Field(min_length=1)


class BatchItem(BaseModel):
    unit: VideoUnit
    status: Literal["queued", "running", "done", "error"] = "queued"
    job_id: str | None = None
    error: str | None = None


class Batch(BaseModel):
    batch_id: UUID
    project_id: str
    created_at: datetime
    status: Literal["queued", "running", "paused", "done"] = "queued"
    items: list[BatchItem]


class BatchItemView(BatchItem):
    job: VeoJobOut | None = None


class BatchView(Batch):
    items: list[BatchItemView]


_store_type = TypeAdapter(list[Batch])
_batches: dict[UUID, Batch] = {}
_lock = RLock()
_stop = Event()
_worker: Thread | None = None
_load_error: str | None = None


def uploaded_image(asset_id: str) -> Path:
    if not asset_id or any(c not in "0123456789abcdef-" for c in asset_id) or len(asset_id) != 12:
        raise ValueError("Mã ảnh tải lên không hợp lệ.")
    directory = service._VEO_UPLOADS_DIR.resolve()
    for path in directory.glob(f"{asset_id}.*"):
        local = path.resolve()
        if (local.is_relative_to(directory) and local.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
                and local.is_file() and local.stat().st_size):
            return local
    raise ValueError("Không tìm thấy ảnh đã tải lên.")


def _asset_path(asset: ImageAsset) -> str:
    if asset.source == "upload":
        return str(uploaded_image(asset.id))
    image = service.ensure_image_file_path(asset.id)
    if not image:
        raise ValueError("Không đọc được ảnh trong Thư Viện Ảnh Veo.")
    return str(image)


def _save() -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STORE.with_suffix(".tmp")
    temporary.write_bytes(_store_type.dump_json(list(_batches.values()), indent=2))
    temporary.replace(STORE)


def _view(batch: Batch) -> BatchView:
    return BatchView(
        **batch.model_dump(exclude={"items"}),
        items=[BatchItemView(**item.model_dump(), job=service.get_job(item.job_id) if item.job_id else None) for item in batch.items],
    )


def _key(batch_id: UUID, index: int) -> str:
    return f"veo-studio:{batch_id}:{index + 1}"


def _settle(item: BatchItem, job: VeoJobOut | None) -> None:
    if job and job.status == "done":
        item.status = "done"
    else:
        item.status = "error"
        item.error = (job.error_message if job else None) or "Lượt tạo bị gián đoạn. Kiểm tra Google Flow trước khi gửi lại mục này."


def startup() -> None:
    global _load_error
    with _lock:
        _stop.clear()
        _batches.clear()
        _load_error = None
        try:
            if STORE.exists():
                _batches.update((batch.batch_id, batch) for batch in _store_type.validate_json(STORE.read_bytes()))
            changed = False
            for batch in _batches.values():
                if batch.status in ("queued", "running"):
                    batch.status = "paused"
                    changed = True
                for index, item in enumerate(batch.items):
                    if item.status == "running":
                        job = service.get_job(item.job_id) if item.job_id else service.get_job_by_idempotency_key(_key(batch.batch_id, index))
                        if job:
                            item.job_id = job.job_id
                        _settle(item, job)
                        changed = True
                if batch.status == "paused" and all(item.status != "queued" for item in batch.items):
                    batch.status = "done"
                    changed = True
            if changed:
                _save()
        except (OSError, ValueError):
            _load_error = "Không đọc được hàng đợi Veo Studio trên máy."
            logger.exception("Could not load Veo Studio batches")


def shutdown() -> None:
    _stop.set()
    worker = _worker
    if worker:
        worker.join(timeout=2)


def _check_store() -> None:
    if _load_error:
        raise OSError(_load_error)


def list_batches(project_id: str) -> list[BatchView]:
    with _lock:
        _check_store()
        return [_view(batch) for batch in reversed(list(_batches.values())) if batch.project_id == project_id]


def _existing(request: BatchRequest) -> Batch | None:
    batch = _batches.get(request.batch_id)
    if batch and (batch.project_id != request.project_id or [item.unit for item in batch.items] != request.items):
        raise FileExistsError("Mã lô đã được dùng cho một danh sách khác.")
    return batch


def submit(request: BatchRequest) -> BatchView:
    with _lock:
        _check_store()
        existing = _existing(request)
        if existing:
            return _view(existing)
    if not service.get_project(request.project_id):
        raise ValueError("Project Flow đã chọn không còn trong app.")
    checked = set()
    for index, unit in enumerate(request.items, start=1):
        for asset in (unit.image, *unit.references):
            key = (asset.source, asset.id)
            if key not in checked:
                try:
                    _asset_path(asset)
                except ValueError as exc:
                    raise ValueError(f"Mục {index}: {exc}") from exc
                checked.add(key)
    with _lock:
        existing = _existing(request)
        if existing:
            return _view(existing)
        batch = Batch(batch_id=request.batch_id, project_id=request.project_id, created_at=datetime.now(timezone.utc),
                      items=[BatchItem(unit=unit) for unit in request.items])
        _batches[batch.batch_id] = batch
        try:
            _save()
        except OSError:
            del _batches[batch.batch_id]
            raise
        _start_worker()
        return _view(batch)


def set_paused(batch_id: UUID, paused: bool) -> BatchView:
    with _lock:
        _check_store()
        batch = _batches[batch_id]
        if any(item.status == "queued" for item in batch.items):
            previous = batch.status
            if paused:
                batch.status = "paused"
            elif previous == "paused":
                batch.status = "queued"
            if batch.status != previous:
                try:
                    _save()
                except OSError:
                    batch.status = previous
                    raise
            if not paused:
                _start_worker()
        return _view(batch)


def _start_worker() -> None:
    global _worker
    if _worker is None or not _worker.is_alive():
        _worker = Thread(target=_run, daemon=True, name="veo-studio-batches")
        _worker.start()


def _run() -> None:
    global _worker, _load_error
    try:
        while not _stop.is_set():
            with _lock:
                batch = next((batch for batch in _batches.values() if batch.status in ("queued", "running")), None)
                if batch is None:
                    _worker = None
                    return
                index, item = next((index, item) for index, item in enumerate(batch.items) if item.status == "queued")
                batch.status, item.status = "running", "running"
                _save()  # Record the claim before submitting an operation that may consume credits.
            _run_item(batch, index, item)
    except OSError:
        with _lock:
            _load_error = "Không lưu được hàng đợi Veo Studio trên máy."
            _worker = None
        logger.exception("Could not persist Veo Studio batch")


def _run_item(batch: Batch, index: int, item: BatchItem) -> None:
    unit = item.unit
    job = None
    failure = None
    try:
        paths = [_asset_path(asset) for asset in (unit.image, *unit.references)]
        if _stop.is_set():
            return
        job = service.submit_job(VeoJobRequest(
            project_id=batch.project_id, idempotency_key=_key(batch.batch_id, index), prompt=unit.prompt,
            model_display_name=service.OMNI_12_NAME, input_mode=InputMode.INGREDIENTS,
            ingredient_image_paths=paths, seed=(batch.batch_id.int + index) % 2147483647, **unit.settings.model_dump(),
        ), fallback_to_active=False)
    except Exception as exc:
        failure = str(exc) or "Không thể tạo video."
        logger.warning("Veo Studio batch %s item %d: %s", batch.batch_id, index + 1, failure)
    if job:
        with _lock:
            item.job_id = job.job_id
            _save()
        while job and job.status not in ("done", "error"):
            if _stop.wait(1):
                return
            job = service.get_job(job.job_id)
    with _lock:
        _settle(item, job)
        if failure:
            item.error = failure
        if not any(other.status == "queued" for other in batch.items):
            batch.status = "done"
        elif item.status == "error":
            batch.status = "paused"
        _save()
