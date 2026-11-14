"""Gợi ý điền form (Brief, Các cảnh & phong cách) bằng Gemini giả: không lưu, chỉ trả về; giá chỉ khi đọc được trên ảnh."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.campaign.executors import llm
from app.campaign.router import router
from app.campaign.service import set_service

from .conftest import prime

BRIEF_REPLY = json.dumps({"audience": "nữ 18-25 thích phong cách Hàn", "occasion": "đi học, cafe", "price": "", "promo": "", "note": "Không thấy giá trên ảnh."})
SCENE_REPLY = json.dumps({"items": [{"name": "Phố", "place": "a sunny sidewalk", "time": "afternoon", "light": "warm sun from the left", "mood": "easy", "action": "walking"},
                                    {"name": "Thừa", "place": "x"}],
                          "lighting": "soft daylight", "palette": "neutrals", "dont": "no extra text", "note": "Một cảnh đường phố."})


@pytest.fixture
def sent(monkeypatch):
    calls = []

    def fake(prompt, image_paths=None):
        calls.append((prompt, list(image_paths or [])))
        return (SCENE_REPLY if "art director" in prompt else BRIEF_REPLY), "gemini"
    monkeypatch.setattr(llm, "call_llm", fake)
    return calls


def test_brief_suggestion_uses_photos_and_never_saves(svc, sent):
    cid = prime(svc)
    out = svc.suggest_params(cid, "brief")
    assert out["suggestion"]["audience"].startswith("nữ 18-25") and out["suggestion"]["price"] == ""
    assert out["images"] == 3 and out["used_fact_sheet"] is False
    assert svc.engine.get_params(svc.session().__enter__(), cid, "brief") == {"audience": "nữ 18-25"}   # không lưu


def test_scene_suggestion_follows_the_format_scene_count(svc, sent):
    cid = prime(svc)                                                              # fit_check: 1 cảnh
    out = svc.suggest_params(cid, "scene_set")
    prompt = sent[-1][0]
    assert "needs exactly 1 scene(s)" in prompt and "Fit check" in prompt
    assert [sc["key"] for sc in out["suggestion"]["items"]] == ["scene:1"]          # cắt theo số cảnh của format
    assert out["suggestion"]["items"][0]["place"] == "a sunny sidewalk" and out["suggestion"]["lighting"] == "soft daylight"


def test_suggestion_errors(svc, sent, monkeypatch):
    cid = svc.create_campaign("trống")["id"]
    with pytest.raises(Exception, match="Chưa có ảnh sản phẩm"):
        svc.suggest_params(cid, "brief")
    with pytest.raises(Exception, match="chưa có gợi ý"):
        svc.suggest_params(cid, "clip")
    cid = prime(svc)
    monkeypatch.setattr(llm, "call_llm", lambda p, i=None: ("không phải json", "gemini"))
    with pytest.raises(llm.LlmJsonError):
        svc.suggest_params(cid, "brief")


def test_suggest_endpoint(svc, sent):
    set_service(svc)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    try:
        cid = prime(svc)
        r = client.post(f"/api/campaigns/{cid}/steps/scene_set/suggest")
        assert r.status_code == 200 and r.json()["suggestion"]["items"][0]["name"] == "Phố"
        assert client.post(f"/api/campaigns/{cid}/steps/clip/suggest").status_code == 400
    finally:
        set_service(None)
