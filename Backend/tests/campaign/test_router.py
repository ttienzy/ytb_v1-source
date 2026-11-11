import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.campaign.router import router
from app.campaign.service import set_service


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


def test_campaign_flow_over_http(client):
    cid = client.post("/api/campaigns", json={"name": "Áo Haim"}).json()["id"]
    assert client.get("/api/campaigns").json()["campaigns"][0]["id"] == cid

    shirt, person = upload(client, cid, "shirt.png", b"s"), upload(client, cid, "p.jpg", b"p")
    assert client.post(f"/api/campaigns/{cid}/steps/garment_source/input",
                       json={"files": [{"artifact_id": shirt["id"], "role": "front"}]}).status_code == 200
    assert client.post(f"/api/campaigns/{cid}/steps/cast/input",
                       json={"files": [{"artifact_id": person["id"], "role": "identity"}]}).status_code == 200
    assert client.put(f"/api/campaigns/{cid}/steps/style/params", json={"params": {"lighting": "soft"}}).json()["params"] == {"lighting": "soft"}

    state = client.get(f"/api/campaigns/{cid}").json()
    assert [b["title"] for b in state["blocks"]][0] == "Sản phẩm" and len(state["blocks"]) == 8

    plan = client.post(f"/api/campaigns/{cid}/plan", json={"target": "look"}).json()
    assert plan["items"][-1]["step_key"] == "look" and plan["images"] == 1

    r = client.post(f"/api/campaigns/{cid}/run", json={"target": "look"})
    assert r.status_code == 200 and r.json()["exec_id"]
    wait_idle(client, cid)
    look = next(s for b in client.get(f"/api/campaigns/{cid}").json()["blocks"] for s in b["steps"] if s["key"] == "look")
    assert look["elements"][0]["gate"] == "need_approval"

    art = look["elements"][0]["selected_artifact_id"]
    assert client.get(f"/api/campaigns/artifacts/{art}/file").content.startswith(b"png:")
    assert client.post(f"/api/campaigns/{cid}/gates/look/approve", json={}).json()["state"] == "approved"


def test_run_requires_credit_confirmation(client):
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    shirt, person = upload(client, cid, "s.png", b"s"), upload(client, cid, "p.png", b"p")
    client.post(f"/api/campaigns/{cid}/steps/garment_source/input", json={"files": [{"artifact_id": shirt["id"]}]})
    client.post(f"/api/campaigns/{cid}/steps/cast/input", json={"files": [{"artifact_id": person["id"]}]})
    for tgt in ("look",):
        client.post(f"/api/campaigns/{cid}/run", json={"target": tgt})
        wait_idle(client, cid)
    client.post(f"/api/campaigns/{cid}/gates/look/approve", json={})
    client.post(f"/api/campaigns/{cid}/run", json={"target": "anchor_frame"})
    wait_idle(client, cid)
    client.post(f"/api/campaigns/{cid}/gates/anchor_frame/approve", json={})
    client.post(f"/api/campaigns/{cid}/run", json={"target": "storyboard"})
    wait_idle(client, cid)
    for k in ("shot:1", "shot:2", "shot:3"):                           # cổng duyệt keyframe trước khi tốn credit
        assert client.post(f"/api/campaigns/{cid}/gates/storyboard/approve", json={"element_key": k}).status_code == 200

    r = client.post(f"/api/campaigns/{cid}/run", json={"target": "clip"})
    assert r.status_code == 409 and r.json()["error"] == "confirm_required" and r.json()["plan"]["total_credit"] == 60
    r = client.post(f"/api/campaigns/{cid}/run", json={"target": "clip", "confirm_credit": True})
    assert r.status_code == 200
    wait_idle(client, cid)
    runs = client.get(f"/api/campaigns/{cid}/runs").json()["runs"]
    assert sum(1 for x in runs if x["step_key"] == "clip" and x["state"] == "done") == 3


def test_error_mapping(client):
    assert client.get("/api/campaigns/nope").status_code == 404
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    assert client.put(f"/api/campaigns/{cid}/steps/khong_co/params", json={"params": {}}).status_code == 400
    assert client.post(f"/api/campaigns/{cid}/plan", json={"target": "khong_co"}).status_code == 400
    assert client.post(f"/api/campaigns/{cid}/artifacts/upload", files={"file": ("a.exe", b"x", "application/octet-stream")}).status_code == 400
    assert client.post(f"/api/campaigns/{cid}/gates/fact_sheet/approve", json={}).status_code == 400   # không có cổng
    assert client.post("/api/campaigns", json={"name": "  "}).status_code == 400


def test_prompt_endpoints(client):
    lst = client.get("/api/campaigns/prompts?kind=look_sheet").json()["templates"]
    assert lst[0]["template_id"] == "system:look_sheet" and lst[0]["read_only"] is True

    r = client.post("/api/campaigns/prompts/render", json={"template_id": "system:look_sheet", "changes": "short hair",
                                                           "ref_paths": ["a.jpg", "b.png"]}).json()
    assert "[OPTIONAL CHANGES]: short hair" in r["prompt"] and [x["role"] for x in r["ref_order"]] == ["identity", "outfit"]

    mine = client.post("/api/campaigns/prompts", json={"name": "Mine", "base_id": "system:look_sheet"}).json()
    assert mine["version"] == 1 and mine["kind"] == "look_sheet"
    v2 = client.put(f"/api/campaigns/prompts/{mine['template_id']}", json={"body": "Mới {{changes}}"}).json()
    assert v2["version"] == 2
    assert len(client.get(f"/api/campaigns/prompts/{mine['template_id']}/versions").json()["versions"]) == 2
    assert client.put("/api/campaigns/prompts/system:look_sheet", json={"body": "x"}).status_code == 400
    assert client.delete(f"/api/campaigns/prompts/{mine['template_id']}").json() == {"ok": True}
    assert client.get(f"/api/campaigns/prompts/{mine['template_id']}").status_code == 404


def test_cast_library_endpoints(client):
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    person = upload(client, cid, "p.png", b"person-px")
    added = client.post("/api/campaigns/cast-library", json={"campaign_id": cid, "artifact_id": person["id"], "name": "Linh"})
    assert added.status_code == 200
    lib_id = added.json()["id"]
    assert client.get("/api/campaigns/cast-library").json()["items"][0]["name"] == "Linh"
    assert client.get(f"/api/campaigns/cast-library/{lib_id}/file").content == b"person-px"

    other = client.post("/api/campaigns", json={"name": "y"}).json()["id"]
    used = client.post(f"/api/campaigns/{other}/cast/use-library", json={"library_id": lib_id})
    assert used.status_code == 200 and used.json()["kind"] == "bundle"
    assert client.post(f"/api/campaigns/{other}/cast/use-library", json={"library_id": "nope"}).status_code == 404
    assert client.post("/api/campaigns/cast-library", json={"campaign_id": cid, "artifact_id": person["id"], "name": " "}).status_code == 400
    assert client.delete(f"/api/campaigns/cast-library/{lib_id}").json() == {"ok": True}
    assert client.get("/api/campaigns/cast-library").json()["items"] == []


def test_edit_artifact_endpoint_normalizes_fact_sheet(client):
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    shirt = upload(client, cid, "s.png", b"s1")
    client.post(f"/api/campaigns/{cid}/steps/garment_source/input", json={"files": [{"artifact_id": shirt["id"], "role": "front"}]})
    r = client.put(f"/api/campaigns/{cid}/steps/fact_sheet/artifact", json={"content": {"pattern": "lace", "color": "trắng"}})
    assert r.status_code == 200
    data = client.get(f"/api/campaigns/artifacts/{r.json()['id']}/file").json()
    assert data["risk"]["level"] == "high" and data["color"] == "trắng"


def test_meta_reports_what_this_backend_can_run(client):
    r = client.get("/api/campaigns/meta")
    assert r.status_code == 200
    body = r.json()
    assert "storyboard" in body["gated_steps"] and "look" in body["gated_steps"] and "clip" in body["gated_steps"]
    assert body["executors"] == sorted(body["executors"]) and "fact_sheet" in body["executors"]
    assert body["steps"][0] == "garment_source"
