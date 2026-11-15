"""Muse Canvas: cấu hình + lưu đồ thị (không gọi Muse)."""
from __future__ import annotations

import json

import pytest

from app.workflow import muse_canvas as mc


@pytest.fixture
def cfg_store(monkeypatch, tmp_path):
    data: dict = {}
    monkeypatch.setattr(mc, "read_config", lambda: data)
    monkeypatch.setattr(mc, "write_config", lambda d: data.update(d))
    monkeypatch.setattr(mc, "GRAPH_FILE", tmp_path / "muse_canvas.json")
    return data


def test_defaults(cfg_store):
    c = mc.get_config()
    assert c.account_mode == "auto" and c.chat_mode == "new_per_run" and c.output_kind == "video"
    assert c.aspect_ratio == "9:16" and c.duration_seconds == 5 and c.timeout_seconds == 600 and c.max_parallel == 1


def test_values_are_clamped_and_cleaned(cfg_store):
    c = mc.MuseCanvasConfig(duration_seconds=7, timeout_seconds=60, max_parallel=99, file_prefix="a b/c:", prompt_prefix="  x  ")
    assert c.duration_seconds == 5 and c.timeout_seconds == 600 and c.max_parallel == 4
    assert c.file_prefix == "a_b_c_" and c.prompt_prefix == "x"
    with pytest.raises(Exception):
        mc.MuseCanvasConfig(aspect_ratio="4:3")


def test_save_then_load_roundtrip(cfg_store):
    mc.save_config(mc.MuseCanvasConfig(account_mode="fixed", account_id="abc", chat_mode="continue", duration_seconds=10,
                                       output_kind="image", aspect_ratio="16:9", language="en", style_preset="cinematic"))
    c = mc.get_config()
    assert (c.account_mode, c.account_id, c.chat_mode, c.duration_seconds, c.output_kind, c.aspect_ratio, c.language,
            c.style_preset) == ("fixed", "abc", "continue", 10, "image", "16:9", "en", "cinematic")


def test_corrupt_saved_values_keep_the_valid_ones(cfg_store):
    cfg_store["muse_canvas"] = {"aspect_ratio": "4:3", "chat_mode": "continue", "unknown": 1}
    c = mc.get_config()
    assert c.aspect_ratio == "9:16" and c.chat_mode == "continue"


def test_graph_roundtrip_and_size_limit(cfg_store, monkeypatch):
    assert mc.get_graph().nodes == []
    g = mc.save_graph(mc.MuseCanvasGraph(nodes=[{"id": "n1", "type": "musePrompt", "position": {"x": 1, "y": 2}, "data": {}}],
                                         edges=[], viewport={"x": 0, "y": 0, "zoom": 1}))
    assert g.updated_at > 0
    saved = json.loads(mc.GRAPH_FILE.read_text(encoding="utf-8"))
    assert saved["nodes"][0]["id"] == "n1" and mc.get_graph().viewport == {"x": 0, "y": 0, "zoom": 1}
    monkeypatch.setattr(mc, "MAX_GRAPH_BYTES", 10)
    with pytest.raises(ValueError):
        mc.save_graph(mc.MuseCanvasGraph(nodes=[{"id": "big"}]))


def test_api_routes(cfg_store):
    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app)
    r = c.put("/api/workflow/muse/config", json={"duration_seconds": 10, "max_parallel": 2, "chat_mode": "main"})
    assert r.status_code == 200 and r.json()["duration_seconds"] == 10
    assert c.get("/api/workflow/muse/config").json()["chat_mode"] == "main"
    assert c.put("/api/workflow/muse/config", json={"output_kind": "gif"}).status_code == 422
    r = c.put("/api/workflow/muse/canvas", json={"nodes": [{"id": "a"}], "edges": []})
    assert r.status_code == 200 and c.get("/api/workflow/muse/canvas").json()["nodes"] == [{"id": "a"}]


# ---------------------------------------------------------------- prompt mặc định (tách áo quần)


def test_outfit_prompt_default_and_override(cfg_store, monkeypatch, tmp_path):
    monkeypatch.setattr(mc, "PROMPT_OVERRIDE_DIR", tmp_path / "muse_prompts")
    p = mc.get_prompt("outfit_extract")
    assert p["is_custom"] is False
    assert p["prompt"].startswith("Extract ONLY the outfit worn by the person")
    assert "Pure white background (#FFFFFF)" in p["prompt"]
    saved = mc.save_prompt("outfit_extract", "  my prompt  ")
    assert saved == {"name": "outfit_extract", "prompt": "my prompt", "is_custom": True}
    assert mc.get_prompt("outfit_extract")["prompt"] == "my prompt"
    assert mc.reset_prompt("outfit_extract")["is_custom"] is False
    with pytest.raises(ValueError):
        mc.save_prompt("outfit_extract", "   ")
    with pytest.raises(KeyError):
        mc.get_prompt("khong-co")


def test_outfit_prompt_routes(cfg_store, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from app.main import app

    monkeypatch.setattr(mc, "PROMPT_OVERRIDE_DIR", tmp_path / "muse_prompts")
    c = TestClient(app)
    assert c.get("/api/workflow/muse/prompts/outfit_extract").json()["is_custom"] is False
    assert c.put("/api/workflow/muse/prompts/outfit_extract", json={"prompt": "x"}).json()["prompt"] == "x"
    assert c.delete("/api/workflow/muse/prompts/outfit_extract").json()["is_custom"] is False
    assert c.get("/api/workflow/muse/prompts/khong-co").status_code == 404
    assert c.put("/api/workflow/muse/prompts/outfit_extract", json={"prompt": " "}).status_code == 400


def test_character_sheet_prompt_file(cfg_store, monkeypatch, tmp_path):
    monkeypatch.setattr(mc, "PROMPT_OVERRIDE_DIR", tmp_path / "muse_prompts")
    p = mc.get_prompt("character_sheet")
    assert p["is_custom"] is False
    assert p["prompt"].startswith("16:9 horizontal character setting display board:")
    assert "Gender: Female" in p["prompt"] and "FRONT VIEW" in p["prompt"]
    assert p["prompt"].endswith("simple, and refined.")
    # lưu làm mặc định của node nhân vật không đụng prompt tách áo quần
    mc.save_prompt("character_sheet", "x")
    assert mc.get_prompt("outfit_extract")["is_custom"] is False


def test_character_outfit_addon_prompt_file(cfg_store, monkeypatch, tmp_path):
    monkeypatch.setattr(mc, "PROMPT_OVERRIDE_DIR", tmp_path / "muse_prompts")
    p = mc.get_prompt("character_outfit")
    assert p["is_custom"] is False and p["prompt"].startswith("OUTFIT:") and "second image" in p["prompt"]


def test_video_script_prompt_file(cfg_store, monkeypatch, tmp_path):
    monkeypatch.setattr(mc, "PROMPT_OVERRIDE_DIR", tmp_path / "muse_prompts")
    p = mc.get_prompt("video_script")
    assert p["is_custom"] is False
    assert p["prompt"].startswith("You are an expert short-form fashion video director")
    assert "Character Sheet to Reality" in p["prompt"] and "BOARD COVER" in p["prompt"]
    assert p["prompt"].endswith("export 9:16.")
    assert len(p["prompt"]) <= mc.MAX_PROMPT_CHARS
