from app.ai.gemini.router import reset_cookie, save_settings
from app.ai.gemini.schemas import GeminiSettingsPayload
from app.core import storage


def _use_temp_config(monkeypatch, tmp_path):
    config_file = tmp_path / "config.json"
    monkeypatch.setattr(storage.settings, "config_file", config_file)
    storage.write_config({
        **storage.default_config(),
        "gemini": {
            **storage.default_config()["gemini"],
            "cookies": "SID=old; SAPISID=old",
            "cookie_count": 2,
            "inner_template": [["captured"]],
            "user_agent": "test-agent",
            "saved_at": "2026-01-01T00:00:00+00:00",
        },
    })
    return config_file


def test_blank_cookie_on_save_preserves_existing_cookie(monkeypatch, tmp_path):
    _use_temp_config(monkeypatch, tmp_path)

    result = save_settings(GeminiSettingsPayload(
        cookies="",
        client_context_token="token",
        app_url="https://gemini.google.com/app",
    ))

    gemini = storage.read_config()["gemini"]
    assert result["has_cookie"] is True
    assert result["cookie_count"] == 2
    assert gemini["cookies"] == "SID=old; SAPISID=old"
    assert gemini["client_context_token"] == "token"


def test_reset_cookie_preserves_profile_independent_template_data(monkeypatch, tmp_path):
    _use_temp_config(monkeypatch, tmp_path)

    result = reset_cookie()

    gemini = storage.read_config()["gemini"]
    assert result == {"ok": True, "has_cookie": False, "cookie_count": 0}
    assert gemini["cookies"] == ""
    assert gemini["cookie_count"] == 0
    assert gemini["saved_at"] is None
    assert gemini["inner_template"] == [["captured"]]
    assert gemini["user_agent"] == "test-agent"
    assert gemini["cookie_cleared_at"]
