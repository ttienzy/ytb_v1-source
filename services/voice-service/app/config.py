import os
import sys
from pathlib import Path

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
    precision: str = "int8"     # "int8" (nhanh, mặc định) | "fp32" (chất lượng tối đa)
    threads: int = 0            # ONNX intra-op threads; 0 = engine default
    backbone_repo: str = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
    onnx_dir: str | None = None  # thư mục weights local (Phase 5 offline); None -> tải HF
    voices_dir: str = str(VOICE_ROOT / "voices")      # ref audio bền vững (Phase 2)
    voices_file: str = str(VOICE_ROOT / "voices.json")  # engine persistence (Phase 2)


settings = Settings()

