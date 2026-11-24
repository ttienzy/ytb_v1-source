"""Editable Recap defaults and validated, independent snapshots for each run."""
import re

from pydantic import BaseModel, Field, field_validator

from app.core.config import PROMPTS_DIR
from app.core.storage import read_config, write_config

SCRIPT_VARIABLES = {
    "video_url", "chunk_index", "total_chunks", "chunk_start_sec", "chunk_end_sec",
    "is_first_chunk", "is_last_chunk", "previous_chunk_summary",
    "target_segments_min", "target_segments_max", "raw_text",
}


class RecapPrompts(BaseModel):
    script: str = Field(min_length=1, max_length=60000)
    caption: str = Field(min_length=1, max_length=60000)

    @field_validator("script", "caption")
    @classmethod
    def validate_template(cls, text, info):
        required = SCRIPT_VARIABLES if info.field_name == "script" else {"scene_titles_joined_by_newline"}
        variables = set(re.findall(r"\{\{\s*(\w+)\s*\}\}", text))
        missing = sorted(required - variables)
        unknown = sorted(variables - required)
        if missing:
            raise ValueError("Giữ nguyên các biến bắt buộc: " + ", ".join("{{" + v + "}}" for v in missing))
        if unknown:
            raise ValueError("Biến không được hỗ trợ: " + ", ".join(unknown))
        if info.field_name == "script":
            for key in ("scenes", "segments", "start_time_sec", "end_time_sec", "duration_sec", "vietnamese_vo", "chunk_summary_for_next"):
                if f'"{key}"' not in text:
                    raise ValueError(f'Giữ trường JSON bắt buộc: "{key}"')
        else:
            for key in ("title", "description", "hashtags"):
                if f'"{key}"' not in text:
                    raise ValueError(f'Giữ trường JSON bắt buộc: "{key}"')
        # Engine uses literal replacements; accept whitespace without leaving unresolved variables.
        return re.sub(r"\{\{\s*(\w+)\s*\}\}", r"{{\1}}", text)


def originals() -> RecapPrompts:
    folder = PROMPTS_DIR / "recap"
    return RecapPrompts(
        script=(folder / "food_review_chunk.prompt.txt").read_text(encoding="utf-8"),
        caption=(folder / "social_caption.prompt.txt").read_text(encoding="utf-8"),
    )


def current() -> RecapPrompts:
    stored = read_config().get("recap_prompts")
    return RecapPrompts.model_validate(stored) if stored is not None else originals()


def snapshot(value: dict | RecapPrompts | None = None) -> dict:
    selected = current() if value is None else RecapPrompts.model_validate(value)
    return selected.model_dump()


def save_defaults(value: RecapPrompts) -> None:
    config = read_config()
    config["recap_prompts"] = value.model_dump()
    write_config(config)
