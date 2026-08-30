"""FastAPI Router for Discover Module."""
from __future__ import annotations

from fastapi import APIRouter

from app.discover.schemas import (
    ChannelVideoRequest,
    RecommendRequest,
    SaveChannelRequest,
)
from app.discover.history import get_processed_video_map, remove_from_history
from app.discover import service

router = APIRouter(prefix="/api/discover", tags=["discover"])


@router.get("/preset-channels")
def get_preset_channels():
    """Lấy danh sách kênh ẩm thực tiếng Anh đề xuất."""
    return service.get_preset_channels()


@router.get("/saved-channels")
def get_saved_channels():
    """Lấy danh sách kênh yêu thích người dùng đã lưu."""
    return service.get_saved_channels()


@router.post("/saved-channels")
def save_channel(req: SaveChannelRequest):
    """Lưu kênh mới vào danh sách theo dõi (Tự động quét metadata thật từ YouTube)."""
    return service.save_channel(
        handle=req.handle,
        name=req.name,
        channel_url=req.channel_url,
        avatar_url=req.avatar_url,
        subscribers=req.subscribers,
        category=req.category,
        category_label=req.category_label,
        description=req.description,
        tags=req.tags,
    )


@router.delete("/saved-channels/{handle_or_id}")
def delete_saved_channel(handle_or_id: str):
    """Xóa kênh khỏi danh sách theo dõi."""
    return service.delete_saved_channel(handle_or_id)


@router.post("/recommend-channels")
def recommend_channels(req: RecommendRequest):
    """Dùng Gemini AI để gợi ý danh sách kênh ẩm thực theo prompt tiếng Anh chuẩn."""
    results = service.recommend_channels(query=req.query, category=req.category)
    return {"query": req.query, "results": results}


@router.post("/channel-videos")
def get_channel_videos(req: ChannelVideoRequest):
    """Trích xuất 20-30 video mới nhất của kênh YouTube bằng yt-dlp flat playlist."""
    return service.get_channel_videos(channel_url=req.channel_url, limit=req.limit)


@router.get("/processed-history")
def get_processed_history():
    """Lấy danh sách toàn bộ video YouTube đã từng được tạo recap."""
    return {"processed_map": get_processed_video_map()}


@router.delete("/processed-history/{video_id}")
def delete_processed_history_item(video_id: str):
    """Xóa video khỏi DB lịch sử nếu người dùng muốn làm lại từ đầu."""
    ok = remove_from_history(video_id)
    return {"ok": ok, "video_id": video_id}
