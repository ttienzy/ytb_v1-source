from fastapi.testclient import TestClient

from app.main import app
from app.workflow import service


def test_video_library_filters_and_counts_use_the_whole_library(monkeypatch):
    items = [
        {
            "filename": f"video-{index:03d}.mp4", "title": f"Clip {index}",
            "prompt": "choreography in older clip" if index == 0 else "",
            "source_type": "veo_scene", "input_mode": "video_edit" if index == 1 else "ingredients",
            "duration_sec": 5,
        }
        for index in reversed(range(103))
    ]
    monkeypatch.setattr(service, "list_exported_videos", lambda **_: items)
    client = TestClient(app)
    first = client.get("/api/workflow/exports?page=1").json()
    assert (first["total"], first["page"], len(first["items"])) == (103, 1, 50)
    third = client.get("/api/workflow/exports?page=3").json()
    assert [item["filename"] for item in third["items"]] == ["video-002.mp4", "video-001.mp4", "video-000.mp4"]
    search = client.get("/api/workflow/exports?page=3&source=motion_control&q=older%20clip").json()
    assert (search["total"], search["page"]) == (1, 1)
    assert search["items"][0]["filename"] == "video-000.mp4"
    assert search["counts"] == {"all": 103, "export": 0, "veo_scene": 101, "motion_control": 2, "muse_clip": 0}
