"""Đồng bộ lịch sử bài đăng Pippit: parse task FB/TikTok, merge với cache, sync nhiều tài khoản.

Không gọi mạng: PippitClient.post / client.login được thay bằng hàm giả.
"""
from __future__ import annotations

import json

import pytest

from app.externals.pippit import client as pclient
from app.externals.pippit import service
from app.externals.pippit.client import PippitAuthError, PippitClient, parse_schedule_task

FB_PAGE = "111"
TT_CHANNEL = "4056099954436"

ACCOUNTS = [
    {
        "id": "pip_expired",
        "email": "expired@example.com",
        "password": "pw",
        "cookies": "old=1",
        "workspace_id": "w1",
        "facebook_pages": [{"page_id": FB_PAGE, "page_name": "Bếp Nhà"}],
        "tiktok_channels": [],
    },
    {
        "id": "pip_tt",
        "email": "tt@example.com",
        "password": "",
        "cookies": "ok=1",
        "workspace_id": "w2",
        "facebook_pages": [],
        "tiktok_channels": [{"channel_id": TT_CHANNEL, "nickname": "sora", "handle": "sorasocute6"}],
    },
]


def _raw_tiktok(task_id: str, status: int = 3) -> dict:
    return {
        "id": task_id,
        "status": status,
        "schedule_time": 1788324840000,
        "platform_type": 1,
        "platform_unique_name": "sorasocute6",
        "failed_reason": "",
        "cover_url": None,
        "tiktok_publish_param": {"title": "Baking chocolate lava cake\n\n#shorts #reels"},
        "facebook_page_publish_param": None,
        "platform_item_link": "https://www.tiktok.com/@/video/7680796710876007700",
        "platform_user_id": TT_CHANNEL,
        "platform_user": {"nick_name": "sora", "unique_name": "sorasocute6"},
    }


def _raw_facebook(task_id: str, status: int = 3, failed: str = "") -> dict:
    return {
        "id": task_id,
        "status": status,
        "schedule_time": 1788000000000,
        "platform_type": 301,
        "failed_reason": failed,
        "facebook_page_publish_param": {"title": "", "description": "Món ngon\n\n#food"},
        "platform_item_link": "https://www.facebook.com/reel/987654321",
        "platform_user_id": FB_PAGE,
        "platform_user": {"nick_name": "Bếp Nhà"},
    }


# ── parse ──────────────────────────────────────────────────────────────────
def test_parse_tiktok_task_sets_platform_and_fixes_link():
    t = parse_schedule_task(_raw_tiktok("42"))
    assert t["platform"] == "tiktok"
    assert t["published"] is True
    assert t["post_url"] == "https://www.tiktok.com/@sorasocute6/video/7680796710876007700"
    assert t["post_id"] == "7680796710876007700"
    assert t["title"] == "Baking chocolate lava cake"
    assert t["page_name"] == "sora"
    assert t["handle"] == "sorasocute6"


def test_parse_facebook_failed_task():
    t = parse_schedule_task(_raw_facebook("7", status=4, failed="cc_ecom_publisher_publish_error_tech_issue"))
    assert t["platform"] == "facebook"
    assert t["published"] is False
    assert t["failed_reason"].startswith("cc_ecom")
    assert t["description"].startswith("Món ngon")


def test_list_schedule_tasks_queries_both_platform_keys(monkeypatch):
    sent = {}

    def fake_post(self, path, body, profile="asset"):
        sent.update(body)
        return {"ret": "0", "data": [_raw_tiktok("1"), _raw_facebook("2")]}

    monkeypatch.setattr(PippitClient, "post", fake_post)
    out = PippitClient("c=1", "w").list_schedule_tasks(page_ids=[FB_PAGE], tiktok_ids=[TT_CHANNEL])
    assert sent["platform_user_ids"] == {"301": [FB_PAGE], "1": [TT_CHANNEL]}
    assert [t["platform"] for t in out] == ["tiktok", "facebook"]


def test_list_schedule_tasks_raises_auth_error_on_1017(monkeypatch):
    monkeypatch.setattr(
        PippitClient, "post", lambda self, path, body, profile="asset": {"ret": "1017", "errmsg": "check business login error"}
    )
    with pytest.raises(PippitAuthError):
        PippitClient("c=1", "w").list_schedule_tasks(page_ids=[FB_PAGE])


# ── merge ──────────────────────────────────────────────────────────────────
def test_merge_updates_status_keeps_local_title_and_infers_platform():
    local = [
        {"task_id": "42", "page_id": TT_CHANNEL, "status": 1, "published": False,
         "title": "Tiêu đề gốc", "description": "Tiêu đề gốc\n\n#x", "job_id": "job1"},
        {"task_id": "9", "page_id": FB_PAGE, "status": 3, "published": True, "title": "Cũ"},
    ]
    live = {"42": parse_schedule_task(_raw_tiktok("42"))}
    merged = service.merge_task_lists(local, live, ACCOUNTS, synced_at="2026-11-15T00:00:00+00:00")

    by_id = {t["task_id"]: t for t in merged}
    tt = by_id["42"]
    assert tt["status"] == 3 and tt["published"] is True
    assert tt["title"] == "Tiêu đề gốc"  # không ghi đè dữ liệu local
    assert tt["job_id"] == "job1"
    assert tt["platform"] == "tiktok"
    assert tt["post_url"].startswith("https://www.tiktok.com/@sorasocute6/")
    assert tt["synced_at"] == "2026-11-15T00:00:00+00:00"

    fb = by_id["9"]
    assert fb["platform"] == "facebook"  # suy ra từ page_id trong config
    assert "synced_at" not in fb  # không có trong live → không đánh dấu đã đồng bộ
    assert fb["account_id"] == "pip_expired"


def test_merge_adds_live_only_tasks_and_dedupes_local():
    local = [{"task_id": "1", "page_id": FB_PAGE}, {"task_id": "1", "page_id": FB_PAGE}]
    live = {"5": parse_schedule_task(_raw_facebook("5"))}
    merged = service.merge_task_lists(local, live, ACCOUNTS)
    assert sorted(t["task_id"] for t in merged) == ["1", "5"]


def test_merge_clears_failed_reason_when_live_says_ok():
    local = [{"task_id": "3", "page_id": FB_PAGE, "status": 4, "failed_reason": "old error"}]
    live = {"3": parse_schedule_task(_raw_facebook("3", status=3))}
    merged = service.merge_task_lists(local, live, ACCOUNTS)
    assert merged[0]["failed_reason"] == ""
    assert merged[0]["published"] is True


# ── sync ───────────────────────────────────────────────────────────────────
@pytest.fixture
def isolated(monkeypatch, tmp_path):
    tasks_file = tmp_path / "pippit_tasks.json"
    monkeypatch.setattr(service, "PIPPIT_TASKS_FILE", tasks_file)
    # file_path chỉ được nhận khi nằm trong thư mục dữ liệu của app (sources.assert_allowed_video_path).
    from app.externals.pippit import sources
    monkeypatch.setattr(sources, "DATA_DIR", tmp_path)
    accounts = json.loads(json.dumps(ACCOUNTS))
    saved: list[list[dict]] = []
    monkeypatch.setattr(service, "get_saved_pippit_accounts", lambda: json.loads(json.dumps(accounts)))
    monkeypatch.setattr(service, "_save_pippit_accounts", lambda accs: saved.append(accs))
    return tasks_file, saved


def test_sync_relogins_expired_account_and_persists(monkeypatch, isolated):
    tasks_file, saved = isolated
    tasks_file.write_text(json.dumps([
        {"task_id": "42", "page_id": TT_CHANNEL, "status": 1, "published": False, "title": "A"},
    ]), encoding="utf-8")

    def fake_post(self, path, body, profile="asset"):
        if self.cookies == "old=1":
            return {"ret": "1017", "errmsg": "check business login error"}
        ids = body["platform_user_ids"]
        data = []
        if "1" in ids:
            data.append(_raw_tiktok("42"))
        if "301" in ids:
            data.append(_raw_facebook("77"))
        return {"ret": "0", "data": data}

    monkeypatch.setattr(PippitClient, "post", fake_post)
    monkeypatch.setattr(pclient, "login", lambda email, pw, proxy="": {"cookies": "new=1", "workspace_id": "w1", "user_id": "u"})

    out = service.sync_all_tasks()

    status = {a["account_id"]: a for a in out["accounts"]}
    assert status["pip_expired"]["ok"] and status["pip_expired"]["relogged"]
    assert status["pip_tt"]["ok"] and status["pip_tt"]["task_count"] == 1
    # cookie mới được ghi lại cho đúng tài khoản
    assert saved and next(a for a in saved[-1] if a["id"] == "pip_expired")["cookies"] == "new=1"

    on_disk = {t["task_id"]: t for t in json.loads(tasks_file.read_text(encoding="utf-8"))}
    assert on_disk["42"]["status"] == 3 and on_disk["42"]["platform"] == "tiktok"
    assert on_disk["77"]["platform"] == "facebook"


def test_sync_reports_error_without_password_and_keeps_cache(monkeypatch, isolated):
    tasks_file, _ = isolated
    tasks_file.write_text(json.dumps([{"task_id": "42", "page_id": TT_CHANNEL, "status": 1}]), encoding="utf-8")
    monkeypatch.setattr(
        PippitClient, "post", lambda self, path, body, profile="asset": {"ret": "1017", "errmsg": "expired"}
    )
    out = service.sync_all_tasks()
    status = {a["account_id"]: a for a in out["accounts"]}
    assert not status["pip_tt"]["ok"]
    assert "hết hạn" in status["pip_tt"]["error"]
    assert out["tasks"][0]["status"] == 1  # giữ nguyên cache, chỉ lấp platform
    assert out["tasks"][0]["platform"] == "tiktok"


def test_overview_without_sync_reads_cache_only(monkeypatch, isolated):
    tasks_file, _ = isolated
    tasks_file.write_text(json.dumps([
        {"task_id": "1", "page_id": FB_PAGE, "synced_at": "2026-11-01T00:00:00+00:00"},
    ]), encoding="utf-8")

    def boom(*a, **k):
        raise AssertionError("không được gọi mạng khi sync=False")

    monkeypatch.setattr(PippitClient, "post", boom)
    out = service.get_tasks_overview(sync=False)
    assert out["synced_at"] == "2026-11-01T00:00:00+00:00"
    assert out["tasks"][0]["platform"] == "facebook"


def test_sync_also_queries_unlinked_pages_from_history(monkeypatch, isolated):
    """Page đã gỡ khỏi tài khoản vẫn được hỏi theo page_id trong lịch sử."""
    tasks_file, _ = isolated
    tasks_file.write_text(json.dumps([
        {"task_id": "500", "page_id": "999", "account_id": "pip_tt", "status": 1, "title": "FB cũ"},
    ]), encoding="utf-8")
    sent: list[dict] = []

    def fake_post(self, path, body, profile="asset"):
        sent.append(body["platform_user_ids"])
        if self.cookies == "old=1":
            return {"ret": "0", "data": []}
        raw = _raw_facebook("500")
        raw["platform_user_id"] = "999"
        raw["platform_user"] = None  # Pippit không còn thông tin page đã gỡ
        return {"ret": "0", "data": [raw]}

    monkeypatch.setattr(PippitClient, "post", fake_post)
    out = service.sync_all_tasks()
    assert {"301": ["999"], "1": [TT_CHANNEL]} in sent
    t = out["tasks"][0]
    assert t["status"] == 3 and t["platform"] == "facebook" and t["title"] == "FB cũ"


def test_merge_marks_missing_on_pippit_and_infers_platform_from_same_page():
    now = 1789000000000
    local = [
        {"task_id": "", "page_id": "555", "account_id": "pip_tt", "status": 1, "schedule_time_ms": now - 1000},
        {"task_id": "8", "page_id": "555", "account_id": "pip_tt", "status": 1, "schedule_time_ms": now},
        {"task_id": "9", "page_id": "555", "account_id": "other", "status": 1, "schedule_time_ms": now},
    ]
    live = {"8": {**parse_schedule_task(_raw_facebook("8")), "page_id": "555"}}
    merged = service.merge_task_lists(local, live, ACCOUNTS, synced_account_ids={"pip_tt"}, now_ms=now)
    by_id = {t["task_id"]: t for t in merged}
    assert by_id[""]["missing_on_pippit"] is True
    assert by_id[""]["platform"] == "facebook"  # suy ra từ task "8" cùng page
    assert "missing_on_pippit" not in by_id["8"]
    assert "missing_on_pippit" not in by_id["9"]  # tài khoản "other" chưa đồng bộ được


# ── bulk schedule ──────────────────────────────────────────────────────────
def test_bulk_schedule_uses_full_client_and_records_drive_file(monkeypatch, isolated, tmp_path):
    tasks_file, _ = isolated
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x" * 10)
    made: list[PippitClient] = []

    real_init = PippitClient.__init__

    def spy_init(self, *a, **k):
        real_init(self, *a, **k)
        made.append(self)

    monkeypatch.setattr(PippitClient, "__init__", spy_init)
    monkeypatch.setattr(PippitClient, "upload", lambda self, path: {"asset_id": "A1"})
    monkeypatch.setattr(PippitClient, "schedule_tiktok", lambda self, **k: "T1")

    from app.externals.pippit.schemas import PippitBulkScheduleItem, PippitBulkScheduleRequest

    res = service.bulk_schedule_videos(PippitBulkScheduleRequest(account_id="", items=[
        PippitBulkScheduleItem(file_id="drv1", file_path=str(video), file_name="v.mp4",
                               title="T", caption="c", schedule_time_ms=1, page_id=TT_CHANNEL),
    ]))
    assert res.success_count == 1 and res.results[0].platform == "tiktok"
    assert made[0].workspace_id == "w2"
    rec = json.loads(tasks_file.read_text(encoding="utf-8"))[0]
    assert rec["account_id"] == "pip_tt"
    assert rec["drive_file_id"] == "drv1" and rec["file_name"] == "v.mp4"


def test_bulk_schedule_without_task_id_is_an_error(monkeypatch, isolated, tmp_path):
    tasks_file, _ = isolated
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x" * 10)
    monkeypatch.setattr(PippitClient, "upload", lambda self, path: {"asset_id": "A1"})
    monkeypatch.setattr(PippitClient, "schedule_facebook", lambda self, **k: "")

    from app.externals.pippit.schemas import PippitBulkScheduleItem, PippitBulkScheduleRequest

    res = service.bulk_schedule_videos(PippitBulkScheduleRequest(account_id="", items=[
        PippitBulkScheduleItem(file_path=str(video), file_name="v.mp4", schedule_time_ms=1, page_id=FB_PAGE),
    ]))
    assert res.failed_count == 1 and "task id" in res.results[0].error
    assert not tasks_file.exists()
