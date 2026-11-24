import json
import os
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.veo import service
from app.veo.models import VeoImage, VeoProject


def test_history_page_caps_results_and_clamps_after_deletion(monkeypatch, tmp_path):
    monkeypatch.setattr(service, "_VEO_DATA_DIR", tmp_path)
    for index in range(1, 52):
        path = tmp_path / f"video-{index:03}.mp4"
        path.write_bytes(b"video")
        os.utime(path, (index, index))
    (tmp_path / "partial.mp4.part").write_bytes(b"partial")
    (tmp_path / "folder.mp4").mkdir()
    (tmp_path / "video-051.json").write_text(json.dumps({"prompt": "Latest"}), encoding="utf-8")

    client = TestClient(app)
    first = client.get("/api/veo/history/page").json()
    assert (first["page"], first["page_size"], first["total"], len(first["items"])) == (1, 50, 51, 50)
    assert first["items"][0]["video_id"] == "video-051"
    assert first["items"][0]["prompt"] == "Latest"
    assert first["items"][-1]["video_id"] == "video-002"

    second = client.get("/api/veo/history/page?page=2").json()
    assert second["page"] == 2
    assert [item["video_id"] for item in second["items"]] == ["video-001"]
    assert len(client.get("/api/veo/history").json()) == 51
    assert client.get("/api/veo/history/page?page=0").status_code == 422

    client.delete("/api/veo/history/video-001")
    clamped = client.get("/api/veo/history/page?page=2").json()
    assert (clamped["page"], clamped["total"], len(clamped["items"])) == (1, 50, 50)


def test_frame_path_supports_data_directory_outside_the_bundle(monkeypatch, tmp_path):
    bundle = tmp_path / "bundle"
    monkeypatch.setattr(service, "_BASE_DIR", bundle)
    old_path = bundle / "Data" / "media" / "frame.jpg"
    user_data_path = tmp_path / "userData" / "Data" / "media" / "frame.jpg"
    assert service._stored_image_path(old_path) == "Data/media/frame.jpg"
    assert service._stored_image_path(user_data_path) == user_data_path.as_posix()


def test_generated_images_use_project_scope_beyond_the_old_list_limit(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'images.db').as_posix()}")
    VeoProject.__table__.create(engine)
    VeoImage.__table__.create(engine)
    session = sessionmaker(bind=engine)
    monkeypatch.setattr(service, "init_db", lambda: None)
    monkeypatch.setattr(service, "SessionLocal", session)
    with session.begin() as db:
        db.add(VeoProject(id="project", name="Test", flow_project_id="flow-project"))
        for index in range(104):
            db.add(VeoImage(
                id=f"image-{index:03d}", media_id=str(index), image_url="", prompt=f"Prompt {index}",
                project_id="project" if index != 103 else "another-project",
                created_at=datetime(2026, 1, 1) + timedelta(seconds=index),
            ))
    client = TestClient(app)
    first = client.get("/api/veo/images/page?project_id=project").json()
    assert (first["total"], first["page"], len(first["items"])) == (103, 1, 50)
    third = client.get("/api/veo/images/page?page=3&project_id=flow-project").json()
    assert [item["id"] for item in third["items"]] == ["image-002", "image-001", "image-000"]
    engine.dispose()
