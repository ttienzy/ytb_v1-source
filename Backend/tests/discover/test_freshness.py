import json
from datetime import datetime, timezone

import pytest

from app.discover import freshness, service

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <entry><yt:videoId>AAAAAAAAAAA</yt:videoId><published>2026-11-07T13:18:00+00:00</published></entry>
 <entry><yt:videoId>BBBBBBBBBBB</yt:videoId><published>2026-11-06T12:31:43+00:00</published></entry>
 <entry><yt:videoId>BROKEN</yt:videoId><published>not-a-date</published></entry>
</feed>"""


@pytest.fixture(autouse=True)
def seen_file(tmp_path, monkeypatch):
    monkeypatch.setattr(freshness, "SEEN_FILE", tmp_path / "seen.json")
    return tmp_path / "seen.json"


def test_parse_rss_published_skips_bad_entries():
    got = freshness.parse_rss_published(RSS)
    assert got == {
        "AAAAAAAAAAA": "2026-11-07T13:18:00+00:00",
        "BBBBBBBBBBB": "2026-11-06T12:31:43+00:00",
    }
    assert freshness.parse_rss_published("<not xml") == {}


def test_resolve_published_prefers_rss_then_approx():
    rss = {"A": "2026-11-07T13:18:00+00:00"}
    assert freshness.resolve_published("A", rss, 1) == ("2026-11-07T13:18:00+00:00", True)
    iso, exact = freshness.resolve_published("Z", rss, 1773273600)  # 2026-03-12
    assert exact is False and iso.startswith("2026-03-12")
    assert freshness.resolve_published("Z", rss, None) == ("", False)


def test_published_label_approx_has_tilde():
    now = datetime(2026, 11, 12, tzinfo=timezone.utc)
    assert freshness.published_label("2026-11-09T00:00:00+00:00", False, now) == "~3 ngày trước"
    assert freshness.published_label("2026-03-12T00:00:00+00:00", False, now) == "~8 tháng trước"
    assert freshness.published_label("", False, now) == ""
    assert freshness.to_upload_date("2026-03-12T00:00:00+00:00") == "20260312"


def test_first_scan_sets_baseline_nothing_is_new():
    res = freshness.register_scan("chan", ["a", "b"], record=True, now=1_000)
    assert res["first_scan"] is True
    assert res["new_ids"] == set()
    assert res["new_in_scan"] == 0
    assert res["previous_scan_at"] is None


def test_second_scan_flags_only_unseen_videos_and_they_persist():
    freshness.register_scan("chan", ["a", "b"], record=True, now=1_000)

    res = freshness.register_scan("chan", ["c", "a", "b"], record=True, now=2_000)
    assert res["new_ids"] == {"c"}
    assert res["new_in_scan"] == 1
    assert res["first_scan"] is False
    assert res["previous_scan_at"] == 1_000

    # Lần quét sau không có gì mới: "c" vẫn còn nhãn mới nhưng new_in_scan = 0.
    res = freshness.register_scan("chan", ["c", "a", "b"], record=True, now=3_000)
    assert res["new_ids"] == {"c"}
    assert res["new_in_scan"] == 0


def test_new_flag_expires_after_window():
    freshness.register_scan("chan", ["a"], record=True, now=1_000)
    freshness.register_scan("chan", ["b", "a"], record=True, now=2_000)
    later = 2_000 + freshness.NEW_WINDOW_SECONDS + 1
    res = freshness.register_scan("chan", ["b", "a"], record=True, now=later)
    assert res["new_ids"] == set()


def test_load_more_does_not_record_or_flag_old_videos(seen_file):
    freshness.register_scan("chan", ["a"], record=True, now=1_000)
    before = seen_file.read_text(encoding="utf-8")
    res = freshness.register_scan("chan", ["old1", "old2"], record=False, now=5_000)
    assert res["new_ids"] == set()
    assert seen_file.read_text(encoding="utf-8") == before


def test_load_more_without_prior_scan_writes_nothing(seen_file):
    res = freshness.register_scan("chan", ["x"], record=False, now=1_000)
    assert res["first_scan"] is False and res["new_ids"] == set()
    assert not seen_file.exists()


def test_prune_keeps_newest(monkeypatch):
    monkeypatch.setattr(freshness, "MAX_SEEN_PER_CHANNEL", 3)
    freshness.register_scan("chan", ["a"], record=True, now=1_000)
    freshness.register_scan("chan", ["b", "c", "d", "e"], record=True, now=2_000)
    store = json.loads(freshness.SEEN_FILE.read_text(encoding="utf-8"))
    assert len(store["chan"]["videos"]) == 3
    assert "a" not in store["chan"]["videos"]


class _Proc:
    returncode = 0

    def __init__(self, entries):
        self.stdout = json.dumps({"channel": "Chan", "channel_id": "UCX", "entries": entries})
        self.stderr = ""


def _entry(vid, ts=None):
    return {"id": vid, "title": vid, "duration": 600, "view_count": 10, "timestamp": ts}


def test_get_channel_videos_offset_args_and_flags(monkeypatch):
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        return _Proc([_entry("aaaaaaaaaaa"), _entry("bbbbbbbbbbb")])

    monkeypatch.setattr(service.subprocess, "run", fake_run)
    monkeypatch.setattr(service, "get_processed_video_map", lambda: {})
    monkeypatch.setattr(service, "fetch_rss_published", lambda cid: {"aaaaaaaaaaa": "2026-11-07T13:18:00+00:00"})

    first = service.get_channel_videos("@chan", limit=5)
    cmd = calls[0]
    assert cmd[cmd.index("--playlist-start") + 1] == "1"
    assert cmd[cmd.index("--playlist-end") + 1] == "5"
    assert "youtubetab:approximate_date" in cmd
    assert first["first_scan"] is True
    assert first["has_more"] is False  # 2 < 5
    assert first["next_offset"] == 2
    assert first["videos"][0]["published_exact"] is True
    assert first["videos"][0]["upload_date"] == "20261107"

    # Quét lại có video mới → is_new.
    monkeypatch.setattr(
        service.subprocess, "run",
        lambda cmd, **kw: _Proc([_entry("ccccccccccc"), _entry("aaaaaaaaaaa"), _entry("bbbbbbbbbbb")]),
    )
    second = service.get_channel_videos("@chan", limit=5)
    assert second["new_in_scan"] == 1
    assert [v["is_new"] for v in second["videos"]] == [True, False, False]

    # Tải thêm: offset 30 → playlist-start 31, không đụng sổ.
    seen_before = freshness.SEEN_FILE.read_text(encoding="utf-8")
    monkeypatch.setattr(service.subprocess, "run", lambda cmd, **kw: (calls.append(cmd), _Proc([_entry("ddddddddddd")]))[1])
    more = service.get_channel_videos("@chan", limit=5, offset=30)
    assert calls[-1][calls[-1].index("--playlist-start") + 1] == "31"
    assert calls[-1][calls[-1].index("--playlist-end") + 1] == "35"
    assert more["videos"][0]["is_new"] is False
    assert freshness.SEEN_FILE.read_text(encoding="utf-8") == seen_before
