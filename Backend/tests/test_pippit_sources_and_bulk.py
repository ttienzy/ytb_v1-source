"""Lên lịch Pippit 2.0: kho video đa nguồn, caption AI, đăng hàng loạt từ file cục bộ.

Không gọi mạng / Gemini / Pippit thật: PippitClient, LLM và danh sách task đều được thay bằng hàm giả; dữ liệu nằm trong tmp_path.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.externals.pippit import captions, service, sources
from app.externals.pippit.client import PippitAuthError, smart_truncate
from app.externals.pippit.router import router
from app.externals.pippit.schemas import PippitBulkScheduleItem, PippitBulkScheduleRequest


@pytest.fixture
def data_dir(tmp_path, monkeypatch) -> Path:
    d = tmp_path / "Data"
    d.mkdir()
    monkeypatch.setattr(sources, "DATA_DIR", d)
    monkeypatch.setattr(sources, "_veo_history", lambda: [])
    monkeypatch.setattr(sources, "_pippit_tasks", lambda: [])
    monkeypatch.setattr(sources, "_probe", lambda p: {})
    return d


def _mp4(path: Path, size: int = 64) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x00" * size)
    return path


# ── an toàn đường dẫn ────────────────────────────────────────────────────────
def test_allowed_path_inside_data_dir_only(data_dir, tmp_path):
    ok = _mp4(data_dir / "exports" / "a.mp4")
    assert sources.assert_allowed_video_path(ok) == ok.resolve()
    with pytest.raises(sources.SourceError):
        sources.assert_allowed_video_path(_mp4(tmp_path / "outside" / "x.mp4"))
    with pytest.raises(sources.SourceError):
        sources.assert_allowed_video_path(str(data_dir / "exports" / ".." / ".." / "outside" / "x.mp4"))
    cfg = data_dir / "config.json"
    cfg.write_text("{}")
    with pytest.raises(sources.SourceError):  # trong Data nhưng không phải video
        sources.assert_allowed_video_path(cfg)
    with pytest.raises(sources.SourceError):
        sources.assert_allowed_video_path(data_dir / "missing.mp4")


# ── các nguồn ────────────────────────────────────────────────────────────────
def test_recap_items_carry_caption_from_recap_json(data_dir):
    job = data_dir / "Downloads" / "job1"
    _mp4(job / "final_studio.mp4")
    (job / "recap.json").write_text(json.dumps({"caption": {"title": "Pizza Tokyo", "description": "Mô tả hay", "hashtags": ["#pizza", "food"]}}),
                                    encoding="utf-8")
    _mp4(data_dir / "Downloads" / "job2" / "raw.mp4")  # không có final → bỏ qua
    items = sources.recap_items()
    assert [i["source_id"] for i in items] == ["recap:job1"]
    it = items[0]
    assert (it["default_title"], it["default_caption"]) == ("Pizza Tokyo", "Mô tả hay")
    assert it["default_hashtags"] == ["#pizza", "#food"]


def test_ai_library_collects_flow_muse_motion_and_exports(data_dir, monkeypatch):
    flow = _mp4(data_dir / "media" / "veo_outputs" / "v1.mp4")
    monkeypatch.setattr(sources, "_veo_history", lambda: [type("V", (), dict(
        video_id="v1", file_path=str(flow), width=640, height=360, prompt="Cô gái xoay váy\nchi tiết", model_display_name="Omni",
        created_at="2026-11-01T00:00:00+00:00", duration_seconds=15.0))()])
    _mp4(data_dir / "workflow_exports" / "muse_final_1.mp4")
    (data_dir / "workflow_exports" / "exports_history.json").write_text(json.dumps({"muse_final_1.mp4": {"title": "Muse 1", "duration_sec": 28}}))
    _mp4(data_dir / "motion_long" / "abc123" / "final.mp4")
    _mp4(data_dir / "motion_long" / "abc123" / "seg_0.mp4")  # đoạn trung gian không được liệt kê
    _mp4(data_dir / "exports" / "e.mp4")
    items = sources.ai_library_items()
    groups = {i["group"]: i for i in items}
    assert set(groups) == {"veo", "muse_canvas", "motion_long", "processed"}
    assert len(items) == 4
    assert groups["veo"]["context_text"].startswith("Cô gái xoay váy") and groups["veo"]["duration_seconds"] == 15.0
    assert groups["muse_canvas"]["title"] == "Muse 1"
    assert all(i["preview_url"].startswith("/api/pippit/sources/preview?path=") for i in items)


def test_campaign_items_include_variants_and_script_defaults(data_dir, monkeypatch):
    exports = data_dir / "campaigns" / "c1" / "exports" / "art1"
    base = _mp4(data_dir / "campaigns" / "c1" / "artifacts" / "ab" / "x.mp4")
    _mp4(exports / "clean.mp4")
    _mp4(exports / "hook_h1.mp4")
    (exports / "hooks_manifest.json").write_text(json.dumps([{"id": "h1", "angle": "Nỗi đau dáng", "opening_text": "Mặc là thon", "cta_text": "Bấm giỏ cam"}]))
    monkeypatch.setattr(sources, "_campaign_rows", lambda: [{
        "campaign_id": "c1", "name": "Set Thun NY", "platform": "tiktok", "video": base, "artifact_id": "art1", "seconds": 18.0,
        "size": "720x1280", "created_at": "2026-11-20T00:00:00+00:00", "exports_dir": exports,
        "script": {"caption": "Form rộng mát", "hashtags": ["#thun", "#tiktokshop"], "cta": "Chốt đơn", "hook": "Hook gốc"}}])
    items = {i["source_id"]: i for i in sources.campaign_items()}
    assert set(items) == {"c1:art1", "c1:art1:clean", "c1:art1:hook_h1"}
    main = items["c1:art1"]
    assert (main["default_caption"], main["default_hashtags"], main["default_cta"]) == ("Form rộng mát", ["#thun", "#tiktokshop"], "Chốt đơn")
    assert (main["width"], main["height"]) == (720, 1280)
    hook = items["c1:art1:hook_h1"]
    assert hook["default_title"] == "Mặc là thon" and hook["default_cta"] == "Bấm giỏ cam"


def test_local_upload_validates_and_lists(data_dir):
    with pytest.raises(sources.SourceError):
        sources.save_local_upload("note.txt", b"x")
    with pytest.raises(sources.SourceError):
        sources.save_local_upload("empty.mp4", b"")
    saved = sources.save_local_upload("../../Áo thun?.mp4", b"video-bytes")
    assert Path(saved["file_path"]).parent == sources.local_upload_dir()
    assert saved["source_type"] == "local" and saved["title"].startswith("Áo thun")
    again = sources.save_local_upload("Áo thun?.mp4", b"video-bytes")
    assert again["file_path"] == saved["file_path"]  # cùng nội dung → không nhân bản
    assert [i["uid"] for i in sources.local_items()] == [saved["uid"]]


def test_list_marks_published_by_source_id_and_ignores_failed(data_dir, monkeypatch):
    p = _mp4(data_dir / "exports" / "a.mp4")
    monkeypatch.setattr(sources, "_pippit_tasks", lambda: [
        {"task_id": "1", "source_id": "export:a.mp4", "status": 1, "platform": "tiktok", "page_id": "T1", "page_name": "sora"},
        {"task_id": "2", "local_path": str(p), "status": 3, "platform": "facebook", "page_id": "F1", "page_name": "Bếp"},
        {"task_id": "3", "source_id": "export:a.mp4", "status": 4, "platform": "tiktok", "page_id": "T2", "page_name": "lỗi"},
    ])
    res = sources.list_publishable_videos("ai_library")
    assert res["total"] == 1 and res["counts"]["ai_library"] == 1
    chans = res["items"][0]["published_channels"]
    assert sorted((c["platform"], c["status"]) for c in chans) == [("facebook", "published"), ("tiktok", "scheduled")]
    with pytest.raises(sources.SourceError):
        sources.list_publishable_videos("drive")


def test_list_filters_and_paginates(data_dir):
    for n in ("alpha", "beta", "gamma"):
        _mp4(data_dir / "exports" / f"{n}.mp4")
    assert sources.list_publishable_videos("ai_library", query="bet")["total"] == 1
    page = sources.list_publishable_videos("ai_library", limit=2, offset=2)
    assert page["total"] == 3 and len(page["items"]) == 1
    assert sources.list_publishable_videos("ai_library", group="veo")["total"] == 0


# ── caption ──────────────────────────────────────────────────────────────────
def test_compose_final_caption_respects_user_caption():
    assert service.compose_final_caption("Tên file thô", "Caption đẹp #a", False) == "Caption đẹp #a"
    assert service.compose_final_caption("Tiêu đề", "", False) == "Tiêu đề"
    assert service.compose_final_caption("Tiêu đề", "Nội dung", True) == "Tiêu đề\n\nNội dung"
    assert service.compose_final_caption("Tiêu đề", "Tiêu đề và hơn nữa", True) == "Tiêu đề và hơn nữa"


def test_smart_truncate_cuts_on_word_boundary():
    out = smart_truncate("một hai ba bốn năm sáu bảy tám chín mười", 20)
    assert len(out) <= 20 and out.endswith("…") and "  " not in out
    assert not out.rstrip("…").endswith("sá")  # không cắt giữa chữ
    assert smart_truncate("ngắn", 20) == "ngắn"


def _items(n=2):
    return [{"uid": f"u{i}", "title": f"video {i}", "context_text": "áo thun", "existing_caption": "", "platform": "tiktok"} for i in range(n)]


def test_generate_captions_normalizes_and_adds_disclosure(monkeypatch):
    seen = {}

    def fake(prompt):
        seen["prompt"] = prompt
        return {"items": [{"uid": "u0", "title": "T0 " * 40, "caption": "Cap 0", "hashtags": ["a", "#b", "#B", "c d"]},
                          {"uid": "u1", "title": "T1", "caption": "Cap 1", "hashtags": []}]}

    monkeypatch.setattr(captions, "_call_llm", fake)
    res = captions.generate_batch_captions(_items(), extra_brief="Áo thun NY", include_ai_disclosure=True)
    assert "Áo thun NY" in seen["prompt"] and "DIFFERENT angle" in seen["prompt"]
    first = res["items"][0]
    assert len(first["title"]) <= captions.MAX_TITLE
    assert first["hashtags"] == ["#a", "#b", "#cd"]
    assert first["full_text"].startswith("Cap 0\n\n#a #b #cd") and first["full_text"].endswith(captions.DISCLOSURE["vi"])
    assert res["missing"] == []


def test_generate_captions_reports_missing_and_errors(monkeypatch):
    monkeypatch.setattr(captions, "_call_llm", lambda p: {"items": [{"uid": "u0", "caption": "Chỉ một"}]})
    res = captions.generate_batch_captions(_items())
    assert [i["uid"] for i in res["items"]] == ["u0"] and res["missing"] == ["u1"]
    monkeypatch.setattr(captions, "_call_llm", lambda p: {"items": []})
    with pytest.raises(captions.CaptionError):
        captions.generate_batch_captions(_items())
    monkeypatch.setattr(captions, "_call_llm", lambda p: (_ for _ in ()).throw(RuntimeError("hết phiên")))
    with pytest.raises(captions.CaptionError, match="hết phiên"):
        captions.generate_batch_captions(_items())
    with pytest.raises(captions.CaptionError):
        captions.generate_batch_captions(_items(captions.MAX_BATCH + 1))
    with pytest.raises(captions.CaptionError):
        captions.generate_batch_captions([])


# ── đăng hàng loạt ───────────────────────────────────────────────────────────
class FakeClient:
    instances: list["FakeClient"] = []

    def __init__(self, fail_auth_times: int = 0):
        self.fail_auth_times = fail_auth_times
        self.calls: list[tuple] = []
        FakeClient.instances.append(self)

    def upload(self, path):
        if self.fail_auth_times:
            self.fail_auth_times -= 1
            raise PippitAuthError("1017")
        self.calls.append(("upload", path))
        return {"asset_id": "A1"}

    def schedule_tiktok(self, **kw):
        self.calls.append(("tiktok", kw))
        return "T-100"

    def schedule_facebook(self, **kw):
        self.calls.append(("facebook", kw))
        return "F-100"


@pytest.fixture
def bulk_env(data_dir, monkeypatch):
    FakeClient.instances = []
    acc = {"id": "pip_a", "email": "a@x.com", "password": "pw", "cookies": "c=1", "workspace_id": "w", "user_id": "u",
           "facebook_pages": [{"page_id": "F1", "page_name": "Bếp"}], "tiktok_channels": [{"channel_id": "T1", "nickname": "sora"}]}
    saved: list[dict] = []
    monkeypatch.setattr(service, "get_saved_pippit_accounts", lambda: [acc])
    monkeypatch.setattr(service, "_save_task_record", saved.append)
    state = {"client": FakeClient(), "relogged": 0, "persisted": 0}
    monkeypatch.setattr(service, "_account_client", lambda a: state["client"])
    monkeypatch.setattr(service, "_relogin_account", lambda a: state.__setitem__("relogged", state["relogged"] + 1))
    monkeypatch.setattr(service, "_persist_relogged_cookies", lambda accs: state.__setitem__("persisted", state["persisted"] + 1))
    return type("Env", (), {"saved": saved, "state": state, "data": data_dir})


def _item(path, **kw):
    base = dict(file_path=str(path), file_name=Path(path).name, schedule_time_ms=1_900_000_000_000, page_id="T1", platform="tiktok")
    base.update(kw)
    return PippitBulkScheduleItem(**base)


def test_bulk_local_file_keeps_user_caption_and_records_source(bulk_env):
    video = _mp4(bulk_env.data / "exports" / "d327067e-de3.mp4")
    item = _item(video, title="d327067e-de3", caption="Form rộng mát #thun", source_type="ai_library", source_id="export:d327067e-de3.mp4",
                 privacy_level=2, allow_comment=False, allow_duet=False, allow_stitch=True)
    res = service.bulk_schedule_videos(PippitBulkScheduleRequest(account_id="pip_a", items=[item]))
    assert res.success_count == 1 and res.results[0].task_id == "T-100"
    kind, kw = bulk_env.state["client"].calls[1]
    assert kind == "tiktok"
    assert kw["description"] == "Form rộng mát #thun"  # KHÔNG bị nhồi tên file lên đầu
    assert (kw["privacy_level"], kw["allow_comment"], kw["allow_duet"], kw["allow_stitch"]) == (2, False, False, True)
    rec = bulk_env.saved[0]
    assert rec["source_id"] == "export:d327067e-de3.mp4" and rec["local_path"] == str(video.resolve()) and rec["source_type"] == "ai_library"
    assert rec["drive_file_id"] == ""


def test_bulk_facebook_route_and_legacy_title_when_caption_empty(bulk_env):
    video = _mp4(bulk_env.data / "exports" / "f.mp4")
    res = service.bulk_schedule_videos(PippitBulkScheduleRequest(account_id="pip_a", items=[
        _item(video, page_id="F1", platform="facebook", title="Chỉ tiêu đề", caption="")]))
    assert res.success_count == 1
    kind, kw = bulk_env.state["client"].calls[1]
    assert kind == "facebook" and kw["description"] == "Chỉ tiêu đề"


def test_bulk_rejects_path_outside_data_dir(bulk_env, tmp_path):
    outside = _mp4(tmp_path / "outside" / "evil.mp4")
    res = service.bulk_schedule_videos(PippitBulkScheduleRequest(account_id="pip_a", items=[_item(outside)]))
    assert res.failed_count == 1 and "ngoài thư mục dữ liệu" in res.results[0].error
    assert bulk_env.state["client"].calls == [] and bulk_env.saved == []


def test_bulk_relogs_in_once_on_expired_cookie_then_succeeds(bulk_env):
    video = _mp4(bulk_env.data / "exports" / "r.mp4")
    bulk_env.state["client"] = FakeClient(fail_auth_times=1)
    res = service.bulk_schedule_videos(PippitBulkScheduleRequest(account_id="pip_a", items=[_item(video)]))
    assert res.success_count == 1
    assert (bulk_env.state["relogged"], bulk_env.state["persisted"]) == (1, 1)


def test_bulk_gives_up_when_relogin_does_not_help(bulk_env):
    video = _mp4(bulk_env.data / "exports" / "r.mp4")
    bulk_env.state["client"] = FakeClient(fail_auth_times=5)
    res = service.bulk_schedule_videos(PippitBulkScheduleRequest(account_id="pip_a", items=[_item(video)]))
    assert res.failed_count == 1 and bulk_env.state["relogged"] == 1  # chỉ đăng nhập lại đúng 1 lần
    assert bulk_env.saved == []


# ── HTTP ─────────────────────────────────────────────────────────────────────
@pytest.fixture
def client(data_dir):
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_http_preview_and_sources(client, data_dir, tmp_path):
    video = _mp4(data_dir / "exports" / "p.mp4", 128)
    r = client.get("/api/pippit/sources/preview", params={"path": str(video)})
    assert r.status_code == 200 and len(r.content) == 128
    assert client.get("/api/pippit/sources/preview", params={"path": str(_mp4(tmp_path / "o" / "x.mp4"))}).status_code == 400
    ok = client.get("/api/pippit/sources", params={"source": "ai_library"}).json()
    assert ok["total"] == 1
    assert client.get("/api/pippit/sources", params={"source": "nope"}).status_code == 400


def test_http_upload_local_and_generate_captions(client, monkeypatch):
    r = client.post("/api/pippit/sources/upload-local", files=[("files", ("a.mp4", b"vid", "video/mp4")), ("files", ("b.txt", b"x", "text/plain"))])
    body = r.json()
    assert r.status_code == 200 and len(body["items"]) == 1 and len(body["errors"]) == 1
    only_bad = client.post("/api/pippit/sources/upload-local", files=[("files", ("b.txt", b"x", "text/plain"))])
    assert only_bad.status_code == 400

    monkeypatch.setattr(captions, "_call_llm", lambda p: (_ for _ in ()).throw(RuntimeError("no gemini")))
    r = client.post("/api/pippit/generate-captions", json={"items": [{"uid": "u0"}]})
    assert r.status_code == 502 and "no gemini" in r.json()["detail"]
    monkeypatch.setattr(captions, "_call_llm", lambda p: {"items": [{"uid": "u0", "caption": "ok", "hashtags": ["#x"]}]})
    r = client.post("/api/pippit/generate-captions", json={"items": [{"uid": "u0", "title": "t"}]})
    assert r.status_code == 200 and r.json()["items"][0]["full_text"] == "ok\n\n#x"
