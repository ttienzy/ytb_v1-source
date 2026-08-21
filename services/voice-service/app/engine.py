"""Singleton wrapper quanh Vieneu (v3 Turbo, ONNX/CPU, int8).

Init **dung sai**: nếu load model fail (weights chưa tải, mất mạng, deps thiếu),
service vẫn khởi động và ``/health`` báo trạng thái degraded — tiện skeleton (Phase 1)
và debug. Metadata voice do main backend quản lý trong ``app.db``; voice-service chỉ giữ
``voices.json`` (engine state) + ref audio.
"""
import logging
from pathlib import Path
from typing import Any

from app.config import settings

logger = logging.getLogger("voice.engine")


class VoiceEngine:
    """Bọc Vieneu instance, quản lý lifecycle + expose status."""

    def __init__(self) -> None:
        self.vieneu: Any = None
        self.backend: str | None = None
        self.error: str | None = None

    def start(self) -> None:
        try:
            from vieneu import Vieneu  # import lười: service vẫn start trước khi deps sẵn sàng
        except ImportError as e:
            self.error = f"vieneu not installed: {e}"
            logger.error(self.error)
            return

        try:
            kwargs: dict[str, Any] = {
                "backend": settings.backend,
                "precision": settings.precision,
                "threads": settings.threads,
            }
            if settings.onnx_dir:
                kwargs["onnx_dir"] = settings.onnx_dir
            logger.info("Loading VieNeu-TTS v3 Turbo (ONNX/CPU, %s) ...", settings.precision)
            self.vieneu = Vieneu(mode="v3turbo", **kwargs)
            self.backend = getattr(self.vieneu, "backend", settings.backend)
            self._load_custom_voices()
            logger.info("Voice engine ready (backend=%s)", self.backend)
        except Exception as e:  # noqa: BLE001 — phải bắt tất cả để service không crash
            self.error = f"{type(e).__name__}: {e}"
            logger.exception("Vieneu init failed")

    def _load_custom_voices(self) -> None:
        """Phase 2: nạp voice clone đã persist từ data/voices.json vào engine."""
        p = Path(settings.voices_file)
        if self.vieneu is None or not p.exists():
            return
        try:
            self.vieneu._load_voices_from_file(p)
            logger.info("Loaded custom voices from %s", p)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to load custom voices from %s", p)

    @property
    def ready(self) -> bool:
        return self.vieneu is not None

    def status(self) -> dict:
        voices_count = 0
        if self.ready:
            try:
                voices_count = len(self.vieneu.list_preset_voices())
            except Exception:  # noqa: BLE001
                voices_count = 0
        return {
            "model_loaded": self.ready,
            "backend": self.backend,
            "device": settings.device,
            "precision": settings.precision,
            "voices_count": voices_count,
            "error": self.error,
        }


engine = VoiceEngine()
