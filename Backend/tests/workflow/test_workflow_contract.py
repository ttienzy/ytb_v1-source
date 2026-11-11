import asyncio
import io
import json
from unittest.mock import MagicMock, Mock
import zipfile

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from app.workflow import config, service
from app.workflow.config import WorkflowSettings
from app.workflow.router import router
from app.workflow.schemas import ScriptGenerationConfig


def test_public_config_defaults(monkeypatch):
    policy = WorkflowSettings(_env_file=None)
    monkeypatch.setattr(service, "workflow_settings", policy)
    monkeypatch.setattr(config, "workflow_settings", policy)
    monkeypatch.setattr(service, "read_config", lambda: {})
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).get("/api/workflow/config")
    assert response.status_code == 200
    assert response.json() == {
        "defaultClipDurationSeconds": 10,
        "defaultScriptModel": "ChatGPT web",
        "defaultVoiceId": "bf4bed06c671",
        "defaultVeoModel": "Omni 1.2 Flash",
        "defaultAspectRatio": "9:16",
        "defaultResolution": "720p",
        "defaultVariations": 1,
        "voiceoverWordsPerSecond": {"min": 2, "max": 2.4},
        "polling": {"intervalMs": 3000, "timeoutMs": 900000,
                    "requestTimeoutMs": 30000, "maxConsecutiveErrors": 5},
    }


def test_environment_policy_is_shared_with_word_limits(monkeypatch):
    for key, value in {
        "VOICEOVER_WORDS_PER_SECOND_MIN": "1.5", "VOICEOVER_WORDS_PER_SECOND_MAX": "1.8",
        "POLLING_INTERVAL_MS": "1500", "POLLING_TIMEOUT_MS": "120000",
        "POLLING_REQUEST_TIMEOUT_MS": "10000", "POLLING_MAX_CONSECUTIVE_ERRORS": "3",
        "CLIP_DURATION_SECONDS": "8", "DEFAULT_VOICE_ID": "configured-voice",
    }.items():
        monkeypatch.setenv(f"WORKFLOW_{key}", value)
    policy = WorkflowSettings(_env_file=None)
    monkeypatch.setattr(service, "workflow_settings", policy)
    monkeypatch.setattr(config, "workflow_settings", policy)
    monkeypatch.setattr(service, "read_config", lambda: {})
    public = service.get_workflow_config()
    assert public.defaultClipDurationSeconds == 8
    assert public.defaultVoiceId == "configured-voice"
    assert public.polling.model_dump() == {
        "intervalMs": 1500, "timeoutMs": 120000, "requestTimeoutMs": 10000, "maxConsecutiveErrors": 3,
    }
    assert service.calculate_voiceover_word_range(10) == (15, 18)


@pytest.mark.parametrize("values", [
    {"voiceover_words_per_second_min": 3, "voiceover_words_per_second_max": 2},
    {"voiceover_words_per_second_max": float("nan")},
    {"polling_interval_ms": 0}, {"polling_max_consecutive_errors": 0},
    {"polling_timeout_ms": 100, "polling_request_timeout_ms": 200},
])
def test_invalid_policy_is_rejected(values):
    with pytest.raises(ValidationError):
        WorkflowSettings(_env_file=None, **values)


def test_voice_resolution_and_script_goes_through_chatgpt_web(monkeypatch):
    assert config.resolve_default_voice_id({"workflow": {"default_voice_id": " saved-voice "}}) == "saved-voice"
    call = Mock(return_value=("ok", "chatgpt-web (acc@x)"))
    monkeypatch.setattr(service, "chatgpt_text", call)
    text, provider = service.execute_gpt_script_generation("product", prompt_template="Create a script")
    assert (text, provider) == ("ok", "chatgpt-web (acc@x)")
    assert "Create a script" in call.call_args.args[0] and call.call_args.kwargs["system"]


@pytest.fixture
def gemini_client(monkeypatch):
    client = MagicMock()
    client.__enter__.return_value = client
    monkeypatch.setattr(service.httpx, "Client", Mock(return_value=client))
    monkeypatch.setattr(service, "_gemini_config", lambda: {
        "cookies": "test", "user_agent": "test", "inner_template": [[]],
    })
    monkeypatch.setattr(service, "_fresh_tokens", Mock(return_value=("at", "bl", "sid")))
    monkeypatch.setattr(service, "_auto_refresh_cookies", Mock())
    return client


@pytest.mark.parametrize("failure", [RuntimeError("upload unavailable"), "", None])
def test_gemini_rejects_partial_attachment_upload(monkeypatch, gemini_client, failure):
    upload = Mock(side_effect=["uploaded/first", failure])
    fallback = Mock()
    monkeypatch.setattr(service, "_upload_file", upload)
    monkeypatch.setattr(service, "execute_chatgpt_vision_analysis", fallback)
    with pytest.raises(service.GeminiAttachmentError, match="attachment 2 upload failed"):
        service.execute_gemini_analysis("analyze", ["data:image/png;base64,YQ=="] * 2, fallback_to_chatgpt=True)
    gemini_client.post.assert_not_called()
    fallback.assert_not_called()


@pytest.mark.parametrize("image", ["", "data:image/png;base64,%%%", "missing-image.png"])
def test_invalid_gemini_image_never_generates(monkeypatch, gemini_client, image):
    upload = Mock()
    monkeypatch.setattr(service, "_upload_file", upload)
    with pytest.raises(service.GeminiAttachmentError):
        service.execute_gemini_analysis("analyze", [image])
    upload.assert_not_called()
    gemini_client.post.assert_not_called()


def test_refreshed_gemini_session_does_not_swallow_attachment_failure(monkeypatch, gemini_client):
    monkeypatch.setattr(service, "_fresh_tokens", Mock(side_effect=[RuntimeError("expired"), ("at", "bl", "sid")]))
    monkeypatch.setattr(service, "_upload_file", Mock(side_effect=RuntimeError("upload failed")))
    fallback = Mock()
    monkeypatch.setattr(service, "execute_chatgpt_vision_analysis", fallback)
    with pytest.raises(service.GeminiAttachmentError):
        service.execute_gemini_analysis("analyze", ["data:image/png;base64,YQ=="], fallback_to_chatgpt=True)
    fallback.assert_not_called()
    gemini_client.post.assert_not_called()


def script_payload(ctas):
    return json.dumps({"scripts": [
        {"angle": f"angle {i}", "title": "title", "hook": "hook", "visual_direction": "Close up",
         "voiceover": " ".join(["word"] * 20), "on_screen_text": "text", "cta": cta}
        for i, cta in enumerate(ctas)
    ]})


@pytest.mark.parametrize("mode,ctas,valid", [
    ("independent", ["buy", "buy"], True), ("independent", ["", "buy"], False),
    ("sequential", ["", "buy"], True), ("sequential", ["buy", "buy"], False),
])
def test_story_mode_cta_contract(mode, ctas, valid):
    scripts = service.parse_gpt_scripts(script_payload(ctas), expected_count=2)
    if valid:
        service.validate_gpt_scripts(scripts, 2, 20, 24, mode)
    else:
        with pytest.raises(ValueError, match="CTA"):
            service.validate_gpt_scripts(scripts, 2, 20, 24, mode)


@pytest.mark.parametrize("mode,valid_ctas", [("independent", ["buy", "buy"]), ("sequential", ["", "buy"])])
def test_repair_prompt_and_validation_share_story_mode(monkeypatch, mode, valid_ctas):
    calls = Mock(side_effect=[(script_payload(["", ""]), "model"), (script_payload(valid_ctas), "model")])
    monkeypatch.setattr(service, "execute_gpt_script_generation", calls)
    result = service.generate_validated_gpt_scripts("product", script_config={"count": 2, "story_mode": mode})
    assert result[3] is True
    assert calls.call_count == 2
    assert service._cta_instruction(mode) in calls.call_args.kwargs["prompt_template"]


def test_invalid_repair_is_not_returned_as_success(monkeypatch):
    call = Mock(return_value=(script_payload(["", "buy"]), "model"))
    monkeypatch.setattr(service, "execute_gpt_script_generation", call)
    with pytest.raises(ValueError, match="CTA"):
        service.generate_validated_gpt_scripts("product", script_config={"count": 2, "story_mode": "independent"})
    assert call.call_count == 2


def test_invalid_story_mode_rejected_before_generation(monkeypatch):
    with pytest.raises(ValidationError):
        ScriptGenerationConfig(story_mode="typo")
    call = Mock()
    monkeypatch.setattr(service, "execute_gpt_script_generation", call)
    with pytest.raises(ValueError, match="story_mode"):
        service.generate_validated_gpt_scripts("product", script_config={"story_mode": "typo"})
    call.assert_not_called()


def test_script_count_supports_more_than_ten_and_has_a_safety_ceiling():
    config = ScriptGenerationConfig(count=50, batch_size=8)
    assert config.count == 50
    assert config.batch_size == 8
    with pytest.raises(ValidationError):
        ScriptGenerationConfig(count=201)


def test_large_generation_is_batched_and_keeps_continuity(monkeypatch):
    calls = []

    def fake_execute(**kwargs):
        cfg = kwargs["script_config"]
        calls.append(cfg.copy())
        items = []
        for index in range(cfg["count"]):
            is_global_last = cfg["batch_end"] == cfg["total_count"] and index == cfg["count"] - 1
            items.append({
                "title": f"scene {cfg['batch_start'] + index}",
                "visual_direction": "Cinematic product close-up",
                "voiceover": " ".join(["word"] * 20),
                "on_screen_text": "short text",
                "cta": "buy" if is_global_last else "",
            })
        return json.dumps({"scripts": items}), "model"

    monkeypatch.setattr(service, "execute_gpt_script_generation", fake_execute)
    result = service.generate_validated_gpt_scripts(
        "product",
        script_config={"count": 12, "batch_size": 5, "story_mode": "sequential"},
    )

    assert len(result[2]) == 12
    assert [call["count"] for call in calls] == [5, 5, 2]
    assert [call["batch_start"] for call in calls] == [1, 6, 11]
    assert calls[0]["continuity_context"] == ""
    assert "scene 5" in calls[1]["continuity_context"]
    assert result[2][-1].cta == "buy"


@pytest.mark.parametrize("mode", ["sequential", "independent"])
def test_generation_prompt_matches_mode_and_clean_audio(monkeypatch, mode):
    call = Mock(return_value=("ok", "chatgpt-web"))
    monkeypatch.setattr(service, "chatgpt_text", call)
    service.execute_gpt_script_generation("product", script_config={"story_mode": mode}, prompt_template="Create scripts")
    assert service._cta_instruction(mode) in call.call_args.args[0]
    assert "The narrator speaks" not in call.call_args.kwargs["system"]


@pytest.mark.parametrize("files", [{"vo_0.wav": b"audio"}, {"vo_0.wav": b"audio", "vo_1.wav": b""}])
def test_partial_tts_batch_fails(monkeypatch, tmp_path, files):
    from app.voices import voice_client
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)

    async def fake_batch(*args):
        return archive.getvalue()

    monkeypatch.setattr(voice_client, "tts_batch", fake_batch)
    monkeypatch.setattr(service, "VOICEOVER_DIR", tmp_path)
    monkeypatch.setattr(service, "ffprobe_duration", lambda _: 1)
    with pytest.raises(RuntimeError, match="voiceover"):
        asyncio.run(service.generate_voiceover_batch("voice", ["one", "two"]))
