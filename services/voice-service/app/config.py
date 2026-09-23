import os
import shutil
import sys
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Hỗ trợ tùy chỉnh APP_DATA_DIR khi chạy môi trường đóng gói (Production) hoặc mặc định thư mục gốc (Dev)
if os.environ.get("APP_DATA_DIR"):
    VOICE_ROOT = Path(os.environ["APP_DATA_DIR"]).resolve() / "voice_data"
elif getattr(sys, "frozen", False):
    app_data = Path(os.environ.get("APPDATA", Path.home())).resolve() / "GoogleSearchApp" / "voice_data"
    VOICE_ROOT = app_data
else:
    VOICE_ROOT = Path(__file__).resolve().parents[2] / "data"

try:
    (VOICE_ROOT / "voices").mkdir(parents=True, exist_ok=True)
except OSError:
    pass


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    voice_port: int = 8001
    device: str = "cpu"          # cpu -> đường ONNX
    backend: str = "onnx"       # ép ONNX/CPU torch-free; KHÔNG "auto" (auto thử import torch)
    precision: Literal["fp32", "int8"] = "fp32"
    voice_profile: Literal["turbo-fp32", "turbo-int8", "turbo-gpu", "nano"] | None = None
    threads: int = Field(default=0, ge=0, le=128)
    max_batch_size: int = Field(default=8, ge=1, le=32)
    inference_wait_seconds: float = Field(default=30, gt=0, le=300)
    nano_repo: str = "pnnbao-ump/VieNeu-TTS-v3-Nano"
    backbone_repo: str = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
    onnx_dir: str | None = None  # thư mục weights local (Phase 5 offline); None -> tải HF
    model_cache_dir: str = os.environ.get("HF_HOME", str(VOICE_ROOT / "models"))
    ffmpeg_path: str | None = None
    voices_dir: str = str(VOICE_ROOT / "voices")      # ref audio bền vững (Phase 2)
    voices_file: str = str(VOICE_ROOT / "voices.json")  # engine persistence (Phase 2)


settings = Settings()

# Hugging Face reads HF_HOME when its modules are imported. Vieneu is imported lazily
# after this module, so setting it here keeps downloaded weights in persistent app data.
MODEL_CACHE_DIR = Path(settings.model_cache_dir).expanduser().resolve()
try:
    MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass
os.environ.setdefault("HF_HOME", str(MODEL_CACHE_DIR))


def resolve_ffmpeg_path() -> str | None:
    """Return the configured bundled FFmpeg, falling back to the system PATH in dev."""
    configured = (settings.ffmpeg_path or "").strip()
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_file():
            return str(candidate.resolve())
        return None
    return shutil.which("ffmpeg")

