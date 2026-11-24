from threading import Event
from time import monotonic, sleep
from uuid import uuid4

import pytest

from app.veo import studio_batch
from app.veo.schemas import VeoJobOut


@pytest.fixture
def batch_store(monkeypatch, tmp_path):
    monkeypatch.setattr(studio_batch, "STORE", tmp_path / "batches.json")
    monkeypatch.setattr(studio_batch.service, "get_project", lambda project_id: project_id if project_id == "project" else None)
    monkeypatch.setattr(studio_batch, "_asset_path", lambda asset: f"{asset.id}.png")
    studio_batch.startup()
    yield
    studio_batch.shutdown()
    studio_batch.startup()


def request():
    return studio_batch.BatchRequest.model_validate({
        "batch_id": uuid4(), "project_id": "project", "items": [
            {"image": {"source": "upload", "id": "main-a"}, "prompt": "First",
             "references": [{"source": "library", "id": "ref-a"}],
             "settings": {"aspect_ratio": "9:16", "resolution": "360p", "duration_seconds": 3}},
            {"image": {"source": "upload", "id": "main-b"}, "prompt": "Second",
             "settings": {"aspect_ratio": "16:9", "resolution": "720p", "duration_seconds": 15}},
        ],
    })


def wait_for(check):
    deadline = monotonic() + 4
    while monotonic() < deadline:
        value = check()
        if value:
            return value
        sleep(.02)
    pytest.fail("Batch did not reach the expected state")


def test_batch_submits_resolved_units_in_order_and_is_idempotent(batch_store, monkeypatch):
    first_done = Event()
    sent = []

    def get_job(job_id):
        status = "pending" if job_id == "job1" and not first_done.is_set() else "done"
        return VeoJobOut(job_id=job_id, status=status)

    def submit_job(unit, *, fallback_to_active):
        assert fallback_to_active is False
        sent.append(unit)
        return get_job(f"job{len(sent)}")

    monkeypatch.setattr(studio_batch.service, "get_job", get_job)
    monkeypatch.setattr(studio_batch.service, "submit_job", submit_job)
    batch_request = request()
    studio_batch.submit(batch_request)
    wait_for(lambda: sent)
    studio_batch.submit(batch_request)
    assert [job.prompt for job in sent] == ["First"]
    assert sent[0].ingredient_image_paths == ["main-a.png", "ref-a.png"]
    assert (sent[0].duration_seconds, sent[0].resolution, sent[0].aspect_ratio) == (3, "360p", "9:16")
    assert (sent[0].model_display_name, sent[0].input_mode, sent[0].num_outputs) == ("Omni 1.2 Flash", "ingredients", 1)
    first_done.set()
    wait_for(lambda: studio_batch.list_batches("project")[0].status == "done")
    assert [job.prompt for job in sent] == ["First", "Second"]
    assert sent[1].duration_seconds == 15
    assert sent[1].idempotency_key != sent[0].idempotency_key
    studio_batch.startup()
    [batch] = studio_batch.list_batches("project")
    assert [item.status for item in batch.items] == ["done", "done"]


def test_batch_keeps_waiting_items_when_job_fails_and_resumes_after_restart(batch_store, monkeypatch):
    sent = []

    def submit_job(unit, **kwargs):
        sent.append(unit.prompt)
        return VeoJobOut(job_id=f"job{len(sent)}", status="error" if len(sent) == 1 else "done", error_message="Flow unavailable")

    monkeypatch.setattr(studio_batch.service, "submit_job", submit_job)
    batch_request = request()
    studio_batch.submit(batch_request)
    wait_for(lambda: studio_batch.list_batches("project")[0].status == "paused")
    studio_batch.startup()
    [batch] = studio_batch.list_batches("project")
    assert [item.status for item in batch.items] == ["error", "queued"]
    assert batch.items[0].error == "Flow unavailable"
    studio_batch.set_paused(batch_request.batch_id, paused=False)
    wait_for(lambda: studio_batch.list_batches("project")[0].status == "done")
    assert sent == ["First", "Second"]


def test_batch_checks_every_input_before_enqueuing(batch_store, monkeypatch):
    def asset_path(asset):
        if asset.id == "main-b":
            raise ValueError("Missing image")
        return asset.id

    monkeypatch.setattr(studio_batch, "_asset_path", asset_path)
    with pytest.raises(ValueError, match="Mục 2: Missing image"):
        studio_batch.submit(request())
    assert studio_batch.list_batches("project") == []

    monkeypatch.setattr(studio_batch.service, "_VEO_UPLOADS_DIR", studio_batch.STORE.parent)
    (studio_batch.STORE.parent / "12345678-abc.webp").write_bytes(b"test")
    assert studio_batch.uploaded_image("12345678-abc").suffix == ".webp"
    with pytest.raises(ValueError):
        studio_batch.uploaded_image("../12345678-abc")
