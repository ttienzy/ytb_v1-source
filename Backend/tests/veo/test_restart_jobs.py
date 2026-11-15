"""Khởi động lại backend khi job Flow đang dở: không job nào được kẹt vô hạn, và phân biệt đúng "đã gửi" / "chưa gửi"."""
import json

from app.veo import service


def _load(tmp_path, monkeypatch, jobs: dict) -> dict:
    path = tmp_path / "veo_jobs.json"
    path.write_text(json.dumps(jobs), encoding="utf-8")
    monkeypatch.setattr(service, "_VEO_JOBS_FILE", path)
    monkeypatch.setattr(service, "_jobs", {})
    service._load_jobs()
    return service._jobs


def test_pending_job_becomes_not_submitted_error_after_restart(tmp_path, monkeypatch):
    jobs = _load(tmp_path, monkeypatch, {"p1": {"job_id": "p1", "status": "pending", "current_step": "Đang xếp hàng chờ Flow (1 việc phía trước)..."}})
    j = jobs["p1"]
    assert j["status"] == "error"
    assert j["error_code"] == "NOT_SUBMITTED"  # nằm trong SAFE_ERROR_CODES: chưa mất credit, tạo lại được
    assert j["error_stage"] == "pre_submit" and j["error_retryable"] is True
    assert "chưa được gửi lên Flow" in j["error_hint"] and "chưa mất credit" in j["error_hint"]
    assert j["updated_at"]


def test_submitted_jobs_stay_interrupted_not_safe(tmp_path, monkeypatch):
    jobs = _load(tmp_path, monkeypatch, {
        "g1": {"job_id": "g1", "status": "generating"},
        "c1": {"job_id": "c1", "status": "captcha"},
        "d1": {"job_id": "d1", "status": "done", "output_files": ["a.mp4"]},
        "e1": {"job_id": "e1", "status": "error", "error_code": "FLOW_REJECTED"},
    })
    assert jobs["g1"]["error_code"] == "JOB_INTERRUPTED"  # Flow có thể đã nhận lệnh -> phải "tìm lại" trước khi tạo lại
    assert jobs["c1"]["status"] == "error"
    assert jobs["d1"]["status"] == "done" and jobs["d1"]["output_files"] == ["a.mp4"]  # job xong không bị đụng
    assert jobs["e1"]["error_code"] == "FLOW_REJECTED"


def test_nothing_left_in_a_waiting_state_after_load(tmp_path, monkeypatch):
    jobs = _load(tmp_path, monkeypatch, {s: {"job_id": s, "status": s} for s in ("pending", "captcha", "submitting", "generating", "downloading")})
    assert {j["status"] for j in jobs.values()} == {"error"}
