import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.campaign.router import router
from app.campaign.service import set_service

from .conftest import SCENES


@pytest.fixture
def client(svc):
    set_service(svc)
    app = FastAPI()
    app.include_router(router)
    yield TestClient(app)
    set_service(None)


def wait_idle(client, cid):
    for _ in range(100):
        if not client.get(f"/api/campaigns/{cid}/runs").json()["active_exec"]:
            return
        time.sleep(0.05)
    raise AssertionError("chạy chưa xong")


def upload(client, cid, name, data):
    r = client.post(f"/api/campaigns/{cid}/artifacts/upload", files={"file": (name, data, "image/png")})
    assert r.status_code == 200, r.text
    return r.json()


def setup(client):
    cid = client.post("/api/campaigns", json={"name": "Áo Haim"}).json()["id"]
    shirt, person = upload(client, cid, "shirt.png", b"s"), upload(client, cid, "p.jpg", b"p")
    assert client.post(f"/api/campaigns/{cid}/steps/garment_source/input", json={"files": [{"artifact_id": shirt["id"], "role": "front"}]}).status_code == 200
    assert client.post(f"/api/campaigns/{cid}/steps/cast/input", json={"files": [{"artifact_id": person["id"], "role": "identity"}]}).status_code == 200
    assert client.put(f"/api/campaigns/{cid}/steps/scene_set/params", json={"params": {"items": SCENES[:1]}}).status_code == 200
    assert client.put(f"/api/campaigns/{cid}/steps/style/params", json={"params": {"lighting": "soft"}}).json()["params"] == {"lighting": "soft"}
    assert client.put(f"/api/campaigns/{cid}/steps/format/params", json={"params": {"format_id": "fit_check"}}).status_code == 200
    return cid


def test_campaign_flow_over_http(client):
    cid = setup(client)
    assert client.get("/api/campaigns").json()["campaigns"][0]["id"] == cid
    state = client.get(f"/api/campaigns/{cid}").json()
    assert [b["title"] for b in state["blocks"]] == ["Sản phẩm", "Nhân vật & Cảnh", "Format & Kịch bản", "Khung chốt cảnh", "Clip", "Ghép & Xuất"]

    plan = client.post(f"/api/campaigns/{cid}/plan", json={"target": "cast_sheet"}).json()
    assert plan["items"][-1]["step_key"] == "cast_sheet" and plan["images"] == 1

    r = client.post(f"/api/campaigns/{cid}/run", json={"target": "cast_sheet"})
    assert r.status_code == 200 and r.json()["exec_id"]
    wait_idle(client, cid)
    sheet = next(s for b in client.get(f"/api/campaigns/{cid}").json()["blocks"] for s in b["steps"] if s["key"] == "cast_sheet")
    assert sheet["elements"][0]["gate"] == "need_approval"
    art = sheet["elements"][0]["selected_artifact_id"]
    assert client.get(f"/api/campaigns/artifacts/{art}/file").content.startswith(b"png:")
    assert client.post(f"/api/campaigns/{cid}/gates/cast_sheet/approve", json={}).json()["state"] == "approved"


def test_run_requires_credit_confirmation(client):
    cid = setup(client)
    client.post(f"/api/campaigns/{cid}/run", json={"target": "cast_sheet"})
    wait_idle(client, cid)
    client.post(f"/api/campaigns/{cid}/gates/cast_sheet/approve", json={})
    client.post(f"/api/campaigns/{cid}/run", json={"target": "scene_anchor"})
    wait_idle(client, cid)
    assert client.post(f"/api/campaigns/{cid}/gates/scene_anchor/approve", json={"element_key": "scene:1"}).status_code == 200
    client.post(f"/api/campaigns/{cid}/run", json={"target": "script"})
    wait_idle(client, cid)

    r = client.post(f"/api/campaigns/{cid}/run", json={"target": "clip"})
    assert r.status_code == 409 and r.json()["error"] == "confirm_required" and r.json()["plan"]["estimated_credit"] == 18
    r = client.post(f"/api/campaigns/{cid}/run", json={"target": "clip", "confirm_credit": True})
    assert r.status_code == 200
    wait_idle(client, cid)
    runs = client.get(f"/api/campaigns/{cid}/runs").json()["runs"]
    assert sum(1 for x in runs if x["step_key"] == "clip" and x["state"] == "done") == 4


def test_error_mapping(client):
    assert client.get("/api/campaigns/nope").status_code == 404
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    assert client.put(f"/api/campaigns/{cid}/steps/khong_co/params", json={"params": {}}).status_code == 400
    assert client.post(f"/api/campaigns/{cid}/plan", json={"target": "khong_co"}).status_code == 400
    assert client.post(f"/api/campaigns/{cid}/artifacts/upload", files={"file": ("a.exe", b"x", "application/octet-stream")}).status_code == 400
    assert client.post(f"/api/campaigns/{cid}/gates/fact_sheet/approve", json={}).status_code == 400
    assert client.post("/api/campaigns", json={"name": "  "}).status_code == 400


def test_prompt_endpoints(client):
    lst = client.get("/api/campaigns/prompts?kind=cast_sheet").json()["templates"]
    assert [t["template_id"] for t in lst[:2]] == ["system:cast_sheet", "system:cast_sheet_classic"] and lst[0]["read_only"] is True

    r = client.post("/api/campaigns/prompts/render", json={"template_id": "system:cast_sheet", "changes": "short hair",
                                                           "variables": {"presentation": "woman"}, "ref_paths": ["a.jpg", "b.png"]}).json()
    assert "[OPTIONAL CHANGES]: short hair" in r["prompt"] and [x["role"] for x in r["ref_order"]] == ["identity", "outfit"]

    mine = client.post("/api/campaigns/prompts", json={"name": "Mine", "base_id": "system:cast_sheet"}).json()
    assert mine["version"] == 1 and mine["kind"] == "cast_sheet"
    v2 = client.put(f"/api/campaigns/prompts/{mine['template_id']}", json={"body": "Mới {{changes}}"}).json()
    assert v2["version"] == 2
    assert client.put("/api/campaigns/prompts/system:cast_sheet", json={"body": "x"}).status_code == 400
    assert client.delete(f"/api/campaigns/prompts/{mine['template_id']}").json() == {"ok": True}


def test_formats_and_meta(client):
    fm = client.get("/api/campaigns/formats").json()["formats"]
    assert [f["id"] for f in fm][0] == "fit_check" and fm[0]["shot_list"][0]["role"] == "hook"
    body = client.get("/api/campaigns/meta").json()
    assert body["gated_steps"] == ["cast_sheet", "clip", "scene_anchor"] and "formats" in body["features"] and "v3" in body["features"]
    assert body["executors"] == sorted(body["executors"]) and "script" in body["executors"] and body["steps"][0] == "garment_source"
    assert [b["title"] for b in body["blocks"]][1] == "Nhân vật & Cảnh"


def test_cast_library_endpoints(client):
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    person = upload(client, cid, "p.png", b"person-px")
    added = client.post("/api/campaigns/cast-library", json={"campaign_id": cid, "artifact_id": person["id"], "name": "Linh"})
    assert added.status_code == 200
    lib_id = added.json()["id"]
    assert client.get("/api/campaigns/cast-library").json()["items"][0]["name"] == "Linh"
    other = client.post("/api/campaigns", json={"name": "y"}).json()["id"]
    used = client.post(f"/api/campaigns/{other}/cast/use-library", json={"library_id": lib_id})
    assert used.status_code == 200 and used.json()["kind"] == "bundle"
    assert client.delete(f"/api/campaigns/cast-library/{lib_id}").json() == {"ok": True}


def test_edit_artifact_endpoint_normalizes_fact_sheet(client):
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    shirt = upload(client, cid, "s.png", b"s1")
    client.post(f"/api/campaigns/{cid}/steps/garment_source/input", json={"files": [{"artifact_id": shirt["id"], "role": "front"}]})
    r = client.put(f"/api/campaigns/{cid}/steps/fact_sheet/artifact", json={"content": {"pattern": "lace", "color": "trắng"}})
    assert r.status_code == 200
    data = client.get(f"/api/campaigns/artifacts/{r.json()['id']}/file").json()
    assert data["risk"]["level"] == "high" and data["color"] == "trắng"
