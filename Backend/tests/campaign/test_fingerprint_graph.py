from app.campaign import graph
from app.campaign.fingerprint import canonical, diff_parts, make_fingerprint


def test_fingerprint_ignores_key_order_but_not_values():
    a = {"step": "x", "params": {"a": 1, "b": 2}, "inputs": {"u": "h1"}}
    b = {"inputs": {"u": "h1"}, "params": {"b": 2, "a": 1}, "step": "x"}
    assert canonical(a) == canonical(b)
    assert make_fingerprint(a) == make_fingerprint(b)
    c = {**a, "params": {"a": 1, "b": 3}}
    assert make_fingerprint(a) != make_fingerprint(c)


def test_diff_parts_names_what_changed():
    old = {"step": "clip", "params": {"duration": 10, "aspect": "9:16"}, "tier": "draft", "inputs": {"storyboard": "h1"}}
    new = {"step": "clip", "params": {"duration": 8, "aspect": "9:16"}, "tier": "final", "inputs": {"storyboard": "h2"}}
    assert diff_parts(old, new) == ["inputs.storyboard", "params.duration", "tier"]
    assert diff_parts(new, new) == []


def test_graph_is_topological_and_maps_are_declared():
    keys = [s.key for s in graph.STEPS]
    assert len(keys) == len(set(keys))
    for s in graph.STEPS:
        assert all(keys.index(d) < keys.index(s.key) for d in s.deps)
        if s.map_from:
            assert s.map_from in s.deps


def test_ancestors_and_descendants():
    anc = graph.ancestors("clip")
    assert {"storyboard", "look", "shot_plan", "garment_source", "cast", "style", "fact_sheet"} <= anc
    assert "script" not in anc and "assemble" not in anc
    assert {"storyboard", "clip", "assemble", "export_pack"} <= graph.descendants("look")
    assert "shot_plan" in graph.descendants("look")          # kế hoạch shot nhìn ảnh mẫu đã duyệt
    assert "fact_sheet" not in graph.descendants("look")


def test_clip_cost_only_for_verified_prices():
    assert graph.clip_cost({"duration": 13}, "final") == 48
    assert graph.clip_cost({"duration": 15}, "draft") == 20
    assert graph.clip_cost({"duration": 6}, "draft") is None       # chưa đo: không đoán
    assert graph.clip_cost({"duration": 8}, "final") is None
    assert graph.clip_cost({"duration": "abc"}, "draft") is None
    assert graph.clip_cost({"duration": 16}, "draft") is None
