import pytest
from pathlib import Path
from app.veo.service import extract_last_frame, _VEO_DATA_DIR, _VEO_IMAGES_DIR


def test_extract_last_frame_not_found():
    with pytest.raises(FileNotFoundError):
        extract_last_frame("non_existent_video_12345")


def test_extract_last_frame_with_real_or_dummy_video(tmp_path):
    # Tìm xem có video thực tế nào trong veo_outputs không
    real_videos = list(_VEO_DATA_DIR.glob("*.mp4"))
    if real_videos:
        target_vid = real_videos[0].stem
        res = extract_last_frame(target_vid)
        assert res["ok"] is True
        assert res["image_id"].startswith("frame_")
        assert Path(res["file_path"]).exists()
        assert Path(res["file_path"]).stat().st_size > 0
        assert f"/api/veo/images/{res['image_id']}/file" in res["preview_url"]
