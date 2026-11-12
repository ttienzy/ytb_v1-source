"""Chặn test recap ghi vào dữ liệu thật (Backend/Data/Downloads/{job_id}/...).

Trước đây một số test không patch đường dẫn nên để lại hàng chục thư mục job rác (timings.json giả, thư mục
merge rỗng) trong dữ liệu của người dùng. Fixture autouse này chuyển MỌI đường dẫn ghi file của job sang
thư mục tạm; test nào cần đường dẫn riêng vẫn tự patch đè được (patch sau thắng).
"""
from __future__ import annotations

import pytest

from app.recap import service, timing


@pytest.fixture(autouse=True)
def _isolate_job_files(tmp_path, monkeypatch):
    root = tmp_path / "jobs"
    monkeypatch.setattr(timing, "timings_path", lambda job_id: root / job_id / "timings.json")
    monkeypatch.setattr(service, "job_dir_of", lambda job_id: root / job_id)
    monkeypatch.setattr(service, "job_meta_path", lambda job_id: root / job_id / "job.json")
    monkeypatch.setattr(service, "DOWNLOADS_DIR", root)
    monkeypatch.setattr(service, "merge_dir", lambda job_id: root / job_id / "merge")
    monkeypatch.setattr(service, "voice_dir", lambda job_id: root / job_id / "voice")
    monkeypatch.setattr(service, "voice_path", lambda job_id, i: root / job_id / "voice" / f"voice_{i}.wav")
    monkeypatch.setattr(service, "segment_path", lambda job_id, i: root / job_id / "merge" / f"seg_{i}.mp4")
    monkeypatch.setattr(service, "recap_path", lambda job_id: root / job_id / "recap.json")
    monkeypatch.setattr(service, "raw_path", lambda job_id: root / job_id / "raw.txt")
    monkeypatch.setattr(service, "source_dir", lambda job_id: root / job_id / "source")
    monkeypatch.setattr(service, "video_path", lambda job_id: root / job_id / "source" / "video.mp4")
    monkeypatch.setattr(service, "final_path", lambda job_id: root / job_id / "final_recap.mp4")
    monkeypatch.setattr(service, "final_studio_path", lambda job_id: root / job_id / "final_studio.mp4")
