import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.workflow.schemas import MotionWorkflowConfig
from app.workflow.service import (
    get_motion_workflow_config,
    save_motion_workflow_config,
    get_motion_presets,
)

client = TestClient(app)


def test_get_motion_workflow_config_defaults():
    config = get_motion_workflow_config()
    assert isinstance(config, MotionWorkflowConfig)
    assert config.aspect_ratio in ("9:16", "16:9")
    assert config.resolution in ("360p", "720p")
    assert config.duration_seconds in (4, 6, 8, 10)


def test_save_and_retrieve_motion_workflow_config():
    new_config = MotionWorkflowConfig(
        aspect_ratio="16:9",
        resolution="720p",
        duration_seconds=8,
        project_mode="selected",
        project_name_prefix="Custom Motion Prefix",
        fresh_assets=False,
        show_reference_comparison=True,
        active_preset_id="fashion_walk",
        num_outputs=3,
        creative={"camera_movement": "Smooth tracking shot"},
    )
    saved = save_motion_workflow_config(new_config)
    assert saved.aspect_ratio == "16:9"
    assert saved.resolution == "720p"
    assert saved.duration_seconds == 8
    assert saved.project_mode == "selected"
    assert saved.active_preset_id == "fashion_walk"
    assert saved.num_outputs == 3

    retrieved = get_motion_workflow_config()
    assert retrieved.aspect_ratio == "16:9"
    assert retrieved.resolution == "720p"
    assert retrieved.duration_seconds == 8
    assert retrieved.project_name_prefix == "Custom Motion Prefix"
    assert retrieved.active_preset_id == "fashion_walk"
    assert retrieved.num_outputs == 3


def test_get_motion_presets():
    presets = get_motion_presets()
    assert isinstance(presets, list)
    assert len(presets) >= 4
    preset_ids = [p.get("id") for p in presets]
    assert "choreography" in preset_ids
    assert "fashion_walk" in preset_ids
    assert "martial_arts" in preset_ids
    assert "cinematic_camera" in preset_ids


def test_motion_config_endpoints():
    # 1. GET /api/workflow/motion/config
    resp = client.get("/api/workflow/motion/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "aspect_ratio" in data
    assert "resolution" in data
    assert "duration_seconds" in data

    # 2. PUT /api/workflow/motion/config
    update_payload = {
        "aspect_ratio": "9:16",
        "resolution": "720p",
        "duration_seconds": 10,
        "project_mode": "selected",
        "project_name_prefix": "API Test",
        "fresh_assets": False,
        "show_reference_comparison": True,
        "active_preset_id": "choreography",
        "creative": None,
    }
    put_resp = client.put("/api/workflow/motion/config", json=update_payload)
    assert put_resp.status_code == 200
    put_data = put_resp.json()
    assert put_data["aspect_ratio"] == "9:16"
    assert put_data["resolution"] == "720p"
    assert put_data["project_mode"] == "selected"

    # 3. GET /api/workflow/motion/presets
    presets_resp = client.get("/api/workflow/motion/presets")
    assert presets_resp.status_code == 200
    presets_data = presets_resp.json()
    assert "presets" in presets_data
    assert len(presets_data["presets"]) >= 4
