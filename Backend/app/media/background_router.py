"""API trạng thái video nền của Workflow Audio.

Việc thêm / xóa video nguồn do khối Video (trang Video nhúng trong Audio) đảm nhiệm qua /api/video/*;
ở đây chỉ có: liệt kê nguồn kèm trạng thái chuẩn hóa từng khổ, và xếp hàng chuẩn hóa trước.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.media import backgrounds

router = APIRouter(prefix="/api/audio/backgrounds", tags=["Audio backgrounds"])


class PrepareBody(BaseModel):
    fit: str = backgrounds.DEFAULT_FIT
    aspects: list[str] | None = None
    retry_errors: bool = False


def _fit(value: str) -> str:
    try:
        backgrounds.check("9:16", value)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return value


@router.get("")
def list_backgrounds(fit: str = backgrounds.DEFAULT_FIT):
    return backgrounds.list_backgrounds(_fit(fit))


@router.post("/prepare")
def prepare(body: PrepareBody):
    """Xếp hàng chuẩn hóa mọi nguồn còn thiếu (sau khi thêm video, đổi cách khớp khung, hoặc thử lại clip lỗi)."""
    _fit(body.fit)
    for aspect in body.aspects or []:
        try:
            backgrounds.check(aspect, body.fit)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    return {"queued": backgrounds.prepare_all(body.fit, body.aspects, body.retry_errors)}
