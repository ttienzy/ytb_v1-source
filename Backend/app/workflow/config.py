"""Workflow policy shared by generation and GET /api/workflow/config.

Environment variables use the WORKFLOW_ prefix followed by the field name.
For example: WORKFLOW_VOICEOVER_WORDS_PER_SECOND_MIN=2.0 and
WORKFLOW_POLLING_TIMEOUT_MS=900000. Settings are loaded at process startup.
"""
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.storage import default_config


class WorkflowSettings(BaseSettings):
    default_voice_id: str = Field(default="bf4bed06c671", min_length=1)
    default_veo_model: str = Field(default="Omni 1.1 Flash", min_length=1)
    default_aspect_ratio: str = Field(default="9:16", min_length=3)
    default_resolution: str = Field(default="720p", min_length=2)
    default_variations: int = Field(default=1, ge=1, le=4)
    clip_duration_seconds: int = Field(default=10, ge=1, le=60)
    voiceover_words_per_second_min: float = Field(default=2.0, gt=0, allow_inf_nan=False)
    voiceover_words_per_second_max: float = Field(default=2.4, gt=0, allow_inf_nan=False)
    polling_interval_ms: int = Field(default=3000, gt=0)
    polling_timeout_ms: int = Field(default=900000, gt=0)
    polling_request_timeout_ms: int = Field(default=30000, gt=0)
    polling_max_consecutive_errors: int = Field(default=5, ge=1)

    model_config = SettingsConfigDict(env_prefix="WORKFLOW_", env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.voiceover_words_per_second_min > self.voiceover_words_per_second_max:
            raise ValueError("voiceover_words_per_second_min must not exceed max")
        if self.default_aspect_ratio not in {"9:16", "16:9"}:
            raise ValueError("default_aspect_ratio must be 9:16 or 16:9")
        if max(self.polling_interval_ms, self.polling_request_timeout_ms) > self.polling_timeout_ms:
            raise ValueError("polling interval and request timeout must not exceed total timeout")
        return self


workflow_settings = WorkflowSettings()


def resolve_default_script_model(router_config: dict) -> str:
    return (router_config.get("default_model") or "").strip() or default_config()["chatgpt_9router"]["default_model"]


def resolve_default_voice_id(config: dict) -> str:
    return (config.get("workflow", {}).get("default_voice_id") or "").strip() or workflow_settings.default_voice_id
