"""Muse Canvas: nhiều project (lưu / chuyển dữ liệu cũ / thùng rác), không gọi Muse."""
from __future__ import annotations

import json

import pytest

from app.workflow import muse_canvas as mc
from app.workflow import muse_projects as mp


@pytest.fixture
def store(monkeypatch, tmp_path):
    data: dict = {}
    monkeypatch.setattr(mc, "read_config", lambda: data)
    monkeypatch.setattr(mc, "write_config", lambda d: data.update(d))
    monkeypatch.setattr(mc, "GRAPH_FILE", tmp_path / "muse_canvas.json")
    monkeypatch.setattr(mp, "PROJECTS_DIR", tmp_path / "muse_canvas_projects")
    return {"config": data, "tmp": tmp_path}


def _graph(*ids: str) -> mc.MuseCanvasGraph:
    return mc.MuseCanvasGraph(nodes=[{"id": i, "position": {"x": 0, "y": 0}, "data": {}} for i in ids],
                              edges=[{"id": "e", "source": ids[0], "target": ids[-1]}] if len(ids) > 1 else [])


def test_first_run_creates_one_empty_default_project(store):
    idx = mp.list_projects()
    assert len(idx.projects) == 1 and idx.active_id == idx.projects[0].id
    assert idx.projects[0].name == mp.DEFAULT_NAME
    assert mp.get_graph(idx.active_id).nodes == []
    # gọi lại không tạo thêm
    assert len(mp.list_projects().projects) == 1


def test_legacy_canvas_is_migrated_with_flow_settings(store):
    mc.GRAPH_FILE.write_text(json.dumps({"nodes": [{"id": "old1"}, {"id": "old2"}], "edges": [{"id": "e1"}],
                                         "viewport": {"x": 1, "y": 2, "zoom": 0.5}}), encoding="utf-8")
    store["config"]["muse_canvas"] = {"flow_project_id": "veo-1", "flow_aspect": "16:9", "flow_resolution": "360p",
                                      "file_prefix": "aoxanh"}
    idx = mp.list_projects()
    proj = idx.projects[0]
    assert (proj.name, proj.node_count, proj.edge_count) == (mp.DEFAULT_NAME, 2, 1)
    assert proj.settings.model_dump() == {"flow_project_id": "veo-1", "flow_aspect": "16:9", "flow_resolution": "360p",
                                          "flow_seconds": 0, "flow_variants": 1, "file_prefix": "aoxanh"}
    g = mp.get_graph(proj.id)
    assert [n["id"] for n in g.nodes] == ["old1", "old2"] and g.viewport == {"x": 1, "y": 2, "zoom": 0.5}
    # file cũ được giữ làm bản sao, không chuyển lại lần nữa
    assert not mc.GRAPH_FILE.exists() and mc.GRAPH_FILE.with_suffix(".json.migrated").exists()
    assert len(mp.list_projects().projects) == 1


def test_create_inherits_active_settings_and_activates(store):
    first = mp.list_projects().projects[0]
    mp.update_project(first.id, mp.MuseProjectPatch(settings=mp.MuseProjectSettings(flow_project_id="veo-9")))
    p2 = mp.create_project(mp.MuseProjectCreate(name="  Áo   sơ mi xanh "))
    assert p2.name == "Áo sơ mi xanh" and p2.settings.flow_project_id == "veo-9"
    assert mp.active_id() == p2.id
    p3 = mp.create_project(mp.MuseProjectCreate(name="Nháp", activate=False, graph=_graph("a", "b"),
                                                settings=mp.MuseProjectSettings(flow_resolution="360p")))
    assert mp.active_id() == p2.id
    assert (p3.node_count, p3.settings.flow_resolution, p3.settings.flow_project_id) == (2, "360p", "")
    assert [n["id"] for n in mp.get_graph(p3.id).nodes] == ["a", "b"]


def test_graphs_are_separate_and_counts_follow_saves(store):
    a = mp.list_projects().projects[0]
    b = mp.create_project(mp.MuseProjectCreate(name="B"))
    mp.save_graph(a.id, _graph("x"))
    mp.save_graph(b.id, _graph("y", "z"))
    assert [n["id"] for n in mp.get_graph(a.id).nodes] == ["x"]
    assert [n["id"] for n in mp.get_graph(b.id).nodes] == ["y", "z"]
    assert mp.get_project(b.id).node_count == 2 and mp.get_project(b.id).edge_count == 1
    # API cũ /muse/canvas = project đang mở
    mp.open_project(a.id)
    assert [n["id"] for n in mc.get_graph().nodes] == ["x"]
    mc.save_graph(_graph("x2"))
    assert [n["id"] for n in mp.get_graph(a.id).nodes] == ["x2"]
    assert [n["id"] for n in mp.get_graph(b.id).nodes] == ["y", "z"]


def test_delete_moves_to_trash_and_keeps_last_project(store):
    a = mp.list_projects().projects[0]
    b = mp.create_project(mp.MuseProjectCreate(name="B", graph=_graph("q")))
    idx = mp.delete_project(b.id)
    assert [p.id for p in idx.projects] == [a.id] and idx.active_id == a.id
    trash = list((mp.PROJECTS_DIR / mp.TRASH_NAME).glob(f"{b.id}_*.json"))
    assert len(trash) == 1 and json.loads(trash[0].read_text(encoding="utf-8"))["nodes"][0]["id"] == "q"
    with pytest.raises(ValueError):
        mp.delete_project(a.id)
    with pytest.raises(KeyError):
        mp.get_graph(b.id)


def test_bad_ids_and_names(store):
    mp.list_projects()
    for bad in ("../index", "INDEX", "", "a/b"):
        with pytest.raises(KeyError):
            mp.get_graph(bad)
    with pytest.raises(Exception):
        mp.MuseProjectCreate(name="   ")
    with pytest.raises(Exception):
        mp.MuseProjectSettings(flow_aspect="1:1")
    assert mp.MuseProjectSettings(file_prefix="a b/c").file_prefix == "a_b_c"


def test_graph_size_limit_per_project(store, monkeypatch):
    pid = mp.active_id()
    monkeypatch.setattr(mc, "MAX_GRAPH_BYTES", 10)
    with pytest.raises(ValueError):
        mp.save_graph(pid, _graph("big"))
    with pytest.raises(ValueError):
        mp.create_project(mp.MuseProjectCreate(name="X", graph=_graph("big")))


def test_corrupt_index_is_rebuilt(store):
    mp.list_projects()
    (mp.PROJECTS_DIR / mp.INDEX_NAME).write_text("{hỏng", encoding="utf-8")
    idx = mp.list_projects()
    assert len(idx.projects) == 1 and idx.active_id == idx.projects[0].id


def test_project_routes(store):
    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app)
    idx = c.get("/api/workflow/muse/projects").json()
    first = idx["active_id"]
    r = c.post("/api/workflow/muse/projects", json={"name": "Chiến dịch 2", "graph": {"nodes": [{"id": "n"}], "edges": []}})
    assert r.status_code == 200
    pid = r.json()["id"]
    assert c.get("/api/workflow/muse/projects").json()["active_id"] == pid
    assert c.get(f"/api/workflow/muse/projects/{pid}/canvas").json()["nodes"] == [{"id": "n"}]
    assert c.put(f"/api/workflow/muse/projects/{pid}/canvas", json={"nodes": [], "edges": []}).status_code == 200
    r = c.patch(f"/api/workflow/muse/projects/{pid}", json={"name": "Đổi tên", "settings": {"flow_project_id": "v1"}})
    assert r.json()["name"] == "Đổi tên" and r.json()["settings"]["flow_project_id"] == "v1"
    assert c.post(f"/api/workflow/muse/projects/{first}/open").json()["active_id"] == first
    assert c.delete(f"/api/workflow/muse/projects/{pid}").status_code == 200
    assert c.get(f"/api/workflow/muse/projects/{pid}/canvas").status_code == 404
    assert c.delete(f"/api/workflow/muse/projects/{first}").status_code == 400
    assert c.patch("/api/workflow/muse/projects/khong-co", json={"name": "x"}).status_code == 404
    assert c.post("/api/workflow/muse/projects", json={"name": " "}).status_code == 422


def test_flow_seconds_setting(store):
    """Thời lượng Flow theo project: 0 = Tự động, 3–15 giây; giá trị lạ -> Tự động; chuyển từ cấu hình cũ."""
    assert mp.MuseProjectSettings().flow_seconds == 0
    assert mp.MuseProjectSettings(flow_seconds=8).flow_seconds == 8
    assert mp.MuseProjectSettings(flow_seconds=15).flow_seconds == 15
    for bad in (2, 16, -1, "x", None):
        assert mp.MuseProjectSettings(flow_seconds=bad).flow_seconds == 0
    assert mc.MuseCanvasConfig(flow_seconds=12).flow_seconds == 12
    assert mc.MuseCanvasConfig(flow_seconds=40).flow_seconds == 0
    pid = mp.active_id()
    p = mp.update_project(pid, mp.MuseProjectPatch(settings=mp.MuseProjectSettings(flow_seconds=10)))
    assert p.settings.flow_seconds == 10 and mp.get_project(pid).settings.flow_seconds == 10


def test_flow_variants_setting(store):
    """Biến thể mỗi lần Tạo video theo project: 1–4, mặc định 1; giá trị lạ -> 1; chuyển từ cấu hình cũ."""
    assert mp.MuseProjectSettings().flow_variants == 1
    assert [mp.MuseProjectSettings(flow_variants=n).flow_variants for n in (1, 2, 3, 4)] == [1, 2, 3, 4]
    for bad in (0, 5, -2, "x", None):
        assert mp.MuseProjectSettings(flow_variants=bad).flow_variants == 1
    assert mc.MuseCanvasConfig(flow_variants=3).flow_variants == 3
    assert mc.MuseCanvasConfig(flow_variants=9).flow_variants == 1
    pid = mp.active_id()
    p = mp.update_project(pid, mp.MuseProjectPatch(settings=mp.MuseProjectSettings(flow_variants=4)))
    assert p.settings.flow_variants == 4 and mp.get_project(pid).settings.flow_variants == 4
