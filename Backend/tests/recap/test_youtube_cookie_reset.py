from app.recap import ytdlp


def test_reset_youtube_cookies_removes_cookie_file(monkeypatch, tmp_path):
    cookie_file = tmp_path / "yt_cookies.txt"
    cookie_file.write_text(
        "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\ttest\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(ytdlp.settings, "yt_cookies_file", cookie_file)

    result = ytdlp.reset_youtube_cookies()

    assert result == {
        "ok": True,
        "logged_in": False,
        "cookie_count": 0,
        "saved_at": None,
    }
    assert not cookie_file.exists()


def test_reset_youtube_cookies_is_idempotent(monkeypatch, tmp_path):
    cookie_file = tmp_path / "missing.txt"
    monkeypatch.setattr(ytdlp.settings, "yt_cookies_file", cookie_file)

    result = ytdlp.reset_youtube_cookies()

    assert result["ok"] is True
    assert result["logged_in"] is False
