from app.campaign import formats, graph
from app.campaign.fingerprint import canonical, diff_parts, make_fingerprint


def test_fingerprint_ignores_key_order_but_not_values():
    a = make_fingerprint({"step": "x", "params": {"b": 1, "a": 2}})
    b = make_fingerprint({"params": {"a": 2, "b": 1}, "step": "x"})
    c = make_fingerprint({"params": {"a": 2, "b": 2}, "step": "x"})
    assert a == b != c
    assert canonical({"b": [1, 2], "a": "x"}) == '{"a":"x","b":[1,2]}'


def test_diff_parts_names_what_changed():
    old = {"params": {"count": 1, "aspect": "16:9"}, "inputs": {"cast": "h1"}, "prompt": {"hash": "p1"}, "tier": "draft"}
    new = {"params": {"count": 2, "aspect": "16:9"}, "inputs": {"cast": "h2"}, "prompt": {"hash": "p1"}, "tier": "final"}
    assert diff_parts(old, new) == ["inputs.cast", "params.count", "tier"]
    assert diff_parts(None, new) == ["inputs.cast", "params.aspect", "params.count", "prompt", "tier"]


def test_graph_is_topological_and_maps_are_declared():
    seen = set()
    for s in graph.STEPS:
        assert all(d in seen for d in s.deps), s.key
        seen.add(s.key)
    assert graph.get_step("clip").map_from == "script" and graph.get_step("scene_anchor").map_from == "scene_set"
    assert graph.get_step("scene_set").kind == "input_params"                 # nguồn phần tử là danh sách trong tham số
    assert graph.BLOCKS[1] == "Sản phẩm" and len(graph.BLOCKS) == 6
    assert [s.key for s in graph.STEPS if s.gate] == ["cast_sheet", "scene_anchor", "clip"]
    assert graph.get_step("clip").paid and graph.get_step("clip").lane == "flow"
    assert all(graph.get_step(k).isolated for k in ("voice", "assemble", "export_pack"))


def test_ancestors_and_descendants():
    assert "garment_source" in graph.ancestors("clip") and "scene_plate" in graph.ancestors("clip")
    assert "clip" in graph.descendants("cast_sheet") and "assemble" in graph.descendants("script")
    assert "storyboard" not in graph.STEP_BY_KEY and "look" not in graph.STEP_BY_KEY


def test_clip_cost_only_for_verified_prices():
    assert graph.clip_cost({"duration": 13}, "final") == 48 and graph.clip_cost({"duration": 6}, "final") == 18
    assert graph.clip_cost({"duration": 5}, "final") is None and graph.clip_cost_estimate({"duration": 5}, "final") == 15
    assert graph.clip_cost({"duration": 99}, "draft") is None and graph.clip_cost_estimate({"duration": 99}, "draft") is None


def test_formats_are_valid_and_listed_easy_first():
    lst = formats.list_formats()
    assert [f["id"] for f in lst][:2] == ["fit_check", "detail_first"] and len(lst) == 5
    for f in lst:
        assert f["shot_list"][0]["role"] == "hook" and f["shot_list"][-1]["role"] == "cta" and 1 <= f["scenes"] <= 3
        assert 12 <= f["total_seconds"] <= 30
    assert formats.resolve({"format_id": "nope"})["id"] == "fit_check"
