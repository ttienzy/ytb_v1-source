import asyncio
import copy
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.ai.gemini import recap as engine
from app.recap import prompts, service, state
from app.recap.router import router, get_db
from app.recap.service import _run_batch_worker as _REAL_BATCH_WORKER


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: None
    async def noop(*args, **kwargs):
        pass
    monkeypatch.setattr(service, "_run_pipeline", noop)
    monkeypatch.setattr(service, "_run_batch_worker", noop)
    monkeypatch.setattr(service, "record_job_start", lambda *a, **kw: None)
    monkeypatch.setattr(service, "record_batch_queue", lambda *a, **kw: None)
    old_jobs, old_batches = dict(state._JOBS), dict(state._BATCHES)
    with TestClient(app) as http:
        yield http
    state._JOBS.clear(); state._JOBS.update(old_jobs)
    state._BATCHES.clear(); state._BATCHES.update(old_batches)


def custom():
    data = prompts.originals().model_dump()
    data["script"] += "\nPhong cách tùy chỉnh: kể chuyện về công nghệ."
    data["caption"] += "\nKhông thêm hashtag ẩm thực."
    return data


@pytest.mark.parametrize("field,source,replacement", [
    ("script", "{{raw_text}}", ""),
    ("script", '"vietnamese_vo"', '"voice"'),
    ("caption", "{{scene_titles_joined_by_newline}}", "{{unsupported}}"),
    ("caption", '"hashtags"', '"tags"'),
])
def test_rejects_broken_template(field, source, replacement):
    data = custom()
    data[field] = data[field].replace(source, replacement)
    with pytest.raises(ValidationError):
        prompts.RecapPrompts(**data)


def test_defaults_save_preserves_originals_and_other_settings(client):
    from app.core.storage import read_config, write_config
    write_config({"unrelated": {"keep": True}})
    original = client.get("/api/recap/prompts").json()["originals"]
    assert client.put("/api/recap/prompts", json=custom()).status_code == 200
    result = client.get("/api/recap/prompts").json()
    assert result == {"originals": original, "current": custom()}
    assert read_config()["unrelated"] == {"keep": True}
    bad = {**custom(), "script": "invalid"}
    assert client.put("/api/recap/prompts", json=bad).status_code == 422
    assert client.get("/api/recap/prompts").json() == result


def test_single_run_snapshot_survives_default_change_and_restart(client):
    sent = custom()
    response = client.post("/api/recap/run", data={
        "youtube_url": "https://youtu.be/abcdefghijk", "voice_id": "v1",
        "script_prompt": sent["script"], "caption_prompt": sent["caption"],
    })
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    assert state.get_job(job_id).prompts == sent
    assert json.loads(service.job_meta_path(job_id).read_text(encoding="utf-8"))["prompts"] == sent
    client.put("/api/recap/prompts", json=prompts.originals().model_dump())
    state._JOBS.pop(job_id)
    assert service.rehydrate(job_id).prompts == sent


def test_broken_single_prompt_does_not_create_job(client):
    before = set(state._JOBS)
    response = client.post("/api/recap/run", data={
        "youtube_url": "https://youtu.be/abcdefghijk", "voice_id": "v1", "script_prompt": "broken",
    })
    assert response.status_code == 422
    assert set(state._JOBS) == before


def test_batch_snapshot_used_for_every_job_after_defaults_change(client, monkeypatch):
    sent = custom()
    response = client.post("/api/recap/batch", json={
        "urls": ["https://youtu.be/abcdefghijk", "https://youtu.be/12345678901"],
        "voice_id": "v1", "prompts": sent,
    })
    assert response.status_code == 202
    batch = state.get_batch(response.json()["batch_id"])
    assert batch.prompts == sent
    prompts.save_defaults(prompts.originals())
    for item in batch.items:
        job_id, _ = asyncio.run(service._run_one_batch_job(item.url, "v1", None, prompts=batch.prompts))
        assert state.get_job(job_id).prompts == sent
    # Each job holds a copy, rather than sharing a mutable batch dict.
    sent["script"] = "changed"
    assert batch.prompts["script"] != "changed"


def test_saved_defaults_apply_to_requests_without_overrides(client):
    client.put("/api/recap/prompts", json=custom())
    response = client.post("/api/recap/run", data={"youtube_url": "https://youtu.be/abcdefghijk", "voice_id": "v1"})
    assert state.get_job(response.json()["job_id"]).prompts == custom()


def test_restored_job_passes_its_snapshot_to_engine(client, monkeypatch):
    response = client.post("/api/recap/run", data={
        "youtube_url": "https://youtu.be/abcdefghijk", "voice_id": "v1",
        "script_prompt": custom()["script"], "caption_prompt": custom()["caption"],
    })
    job_id = response.json()["job_id"]
    state._JOBS.pop(job_id)
    restored = service.rehydrate(job_id)
    restored.raw_bytes = b"[0:00] source"
    prompts.save_defaults(prompts.originals())
    calls = []
    def generate(*args, **kwargs):
        calls.append(kwargs)
        return {"scenes": [], "caption": {"title": "Demo"}}
    monkeypatch.setattr(service, "generate_recap", generate)
    monkeypatch.setattr(service, "record_job_metadata", lambda *a, **kw: None)
    asyncio.run(service._generate_for_job(job_id))
    assert calls[0]["script_prompt"] == custom()["script"]
    assert calls[0]["caption_prompt"] == custom()["caption"]


def test_batch_worker_passes_same_snapshot_through_retry(client, monkeypatch):
    response = client.post("/api/recap/batch", json={
        "urls": ["https://youtu.be/abcdefghijk", "https://youtu.be/12345678901"],
        "voice_id": "v1", "prompts": custom(),
    })
    batch_id = response.json()["batch_id"]
    prompts.save_defaults(prompts.originals())
    calls = []
    async def run_one(**kwargs):
        calls.append(copy.deepcopy(kwargs))
        return "fake-job", "error" if len(calls) == 1 else "merged"
    async def no_sleep(*_):
        pass
    monkeypatch.setattr(service, "_run_one_batch_job", run_one)
    monkeypatch.setattr(service.asyncio, "sleep", no_sleep)
    asyncio.run(_REAL_BATCH_WORKER(batch_id))
    assert len(calls) == 3
    assert all(call["prompts"] == custom() for call in calls)
    assert state.get_batch(batch_id).status == "done"


def test_engine_uses_both_custom_prompts_without_food_intro_or_outro(monkeypatch, tmp_path):
    captured = []
    scene = {"scene_title": "Công nghệ", "segments": [{
        "start_time_sec": 0, "end_time_sec": 8, "duration_sec": 8,
        "original_text": "source", "vietnamese_vo": "Một thiết bị mới xuất hiện.",
    }]}
    def stream(**kwargs):
        captured.append(kwargs)
        if kwargs["filename"] == "caption_prompt.txt":
            return json.dumps({"title": "Công nghệ mới", "description": "Khám phá thiết bị", "hashtags": ["#tech"]})
        return json.dumps({"scenes": [copy.deepcopy(scene)], "chunk_summary_for_next": "Thiết bị"})
    monkeypatch.setattr(engine, "_call_gemini_stream", stream)
    monkeypatch.setattr(engine, "_parse_gemini_response", json.loads)
    monkeypatch.setattr(engine, "TOOLS_DIR", tmp_path)
    monkeypatch.setattr(engine.time, "sleep", lambda _: None)
    selected = custom()
    result = engine.generate_recap("https://youtu.be/abcdefghijk", b"[0:00] source\n[0:20] end", script_prompt=selected["script"], caption_prompt=selected["caption"])
    assert "kể chuyện về công nghệ" in captured[0]["prompt_text"]
    assert "{{raw_text}}" not in captured[0]["prompt_text"]
    assert "Không thêm hashtag ẩm thực" in captured[-1]["prompt_text"]
    assert result["scenes"][0]["segments"][0]["vietnamese_vo"] == scene["segments"][0]["vietnamese_vo"]
    assert result["caption"]["hashtags"] == ["#tech"]
