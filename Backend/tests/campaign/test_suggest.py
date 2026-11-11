"""Gợi ý điền form Brief/Phong cách bằng Gemini giả."""
import json
from pathlib import Path

import pytest

from app.campaign.executors import llm
from app.campaign.service import CampaignError

from .conftest import prime


@pytest.fixture
def sent(monkeypatch):
    seen = []

    def fake(prompt, image_paths=None):
        seen.append((prompt, list(image_paths or [])))
        if "sales brief" in prompt:
            return json.dumps({"audience": "Nữ 18–25,  thích phong cách Hàn", "occasion": "Đi học, cafe", "price": "",
                               "promo": "", "note": "Không thấy giá trên ảnh nên để trống.", "extra": "bỏ qua"}), "gemini"
        return "```json\n" + json.dumps({"lighting": "soft window light", "background": "minimal studio",
                                         "palette": "warm neutrals", "dont": "no extra text", "note": "Tối giản"}) + "\n```", "gemini"
    monkeypatch.setattr(llm, "call_llm", fake)
    return seen


def test_brief_suggestion_uses_photos_and_never_saves(svc, sent):
    cid = prime(svc)
    svc.set_params(cid, "brief", {"audience": "đã gõ tay"})
    out = svc.suggest_params(cid, "brief")
    prompt, paths = sent[0]
    assert [Path(p).read_bytes() for p in paths] == [b"shirt-bytes-1", b"shirt-bytes-2"]     # Gemini xem cả 2 ảnh
    assert "never contradict them" in prompt and "đã gõ tay" in prompt                          # biết ô người dùng đã gõ
    assert out["suggestion"] == {"audience": "Nữ 18–25, thích phong cách Hàn", "occasion": "Đi học, cafe", "price": "", "promo": ""}
    assert "extra" not in out["suggestion"] and out["note"] and out["images"] == 2 and out["used_fact_sheet"] is False
    with svc.session() as s:
        assert svc.engine.get_params(s, cid, "brief") == {"audience": "đã gõ tay"}              # không lưu gì


def test_price_rule_is_in_prompt(svc, sent):
    cid = prime(svc)
    svc.suggest_params(cid, "brief")
    assert "NEVER invent a price" in sent[0][0]


def test_style_suggestion_includes_garment_profile_and_brief(svc, sent):
    cid = prime(svc)
    svc.set_params(cid, "brief", {"occasion": "đi biển"})
    svc.edit_artifact(cid, "fact_sheet", {"category": "áo thun", "pattern": "solid", "summary": "tee"})
    out = svc.suggest_params(cid, "style")
    assert out["used_fact_sheet"] is True and out["suggestion"]["lighting"] == "soft window light"
    assert set(out["suggestion"]) == {"lighting", "background", "palette", "dont"}
    prompt = sent[0][0]
    assert "áo thun" in prompt and "đi biển" in prompt


def test_suggestion_errors(svc, sent, monkeypatch):
    empty = svc.create_campaign("trống")["id"]
    with pytest.raises(CampaignError, match="Chưa có ảnh sản phẩm"):
        svc.suggest_params(empty, "brief")
    cid = prime(svc)
    with pytest.raises(CampaignError, match="chưa có gợi ý"):
        svc.suggest_params(cid, "look")
    monkeypatch.setattr(llm, "call_llm", lambda p, i=None: ("không phải json", "gemini"))
    with pytest.raises(ValueError, match="không trả về JSON"):
        svc.suggest_params(cid, "brief")


def test_suggest_endpoint(svc, sent):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.campaign.router import router
    from app.campaign.service import set_service
    set_service(svc)
    try:
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        cid = prime(svc)
        r = client.post(f"/api/campaigns/{cid}/steps/brief/suggest")
        assert r.status_code == 200 and r.json()["suggestion"]["occasion"] == "Đi học, cafe"
        assert client.post(f"/api/campaigns/{cid}/steps/look/suggest").status_code == 400
        assert client.post("/api/campaigns/nope/steps/brief/suggest").status_code == 404
    finally:
        set_service(None)
