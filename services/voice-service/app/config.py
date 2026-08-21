"""Settings cho voice-service — đọc từ ``.env`` (pydantic-settings).

Lưu ý đường dẫn dữ liệu: voice-service có ``data/`` RIÊNG (ref audio + voices.json),
KHÔNG dùng ``Data/app.db`` (của main backend) hay ``Backend/Data/`` (nội bộ video/configs).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    voice_port: int = 8001
    device: str = "cpu"          # cpu -> đường ONNX
    backend: str = "onnx"       # ép ONNX/CPU torch-free; KHÔNG "auto" (auto thử import torch)
    precision: str = "int8"     # "int8" (nhanh, mặc định) | "fp32" (chất lượng tối đa)
    threads: int = 0            # ONNX intra-op threads; 0 = engine default
    backbone_repo: str = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
    onnx_dir: str | None = None  # thư mục weights local (Phase 5 offline); None -> tải HF
    voices_dir: str = "data/voices"      # ref audio bền vững (Phase 2)
    voices_file: str = "data/voices.json"  # engine persistence (Phase 2)


settings = Settings()
