"""VieNeu adapter: serialized model access and public-API voice storage."""
import json
import logging
import re
import shutil
import threading
from contextlib import contextmanager
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import numpy as np

from app.config import MODEL_CACHE_DIR, resolve_ffmpeg_path, settings

logger = logging.getLogger("voice.engine")


def supports_vnni() -> bool:
    try:
        from cpuinfo import get_cpu_info
        flags = set(get_cpu_info().get("flags", []))
        return bool(flags & {"avx512_vnni", "avx512vnni", "avx_vnni", "avxvnni"})
    except Exception:
        return False


class EngineBusy(RuntimeError):
    pass


class VoiceEngine:
    def __init__(self) -> None:
        self.vieneu: Any = None
        self.backend: str | None = None
        self.error: str | None = None
        self.warning: str | None = None
        self.profile = "turbo-fp32"
        self.custom_voices: dict[str, dict] = {}
        self.lock = threading.Lock()

    @contextmanager
    def session(self):
        if not self.ready:
            raise RuntimeError("voice engine not loaded")
        if not self.lock.acquire(timeout=settings.inference_wait_seconds):
            raise EngineBusy("Voice Service đang bận. Vui lòng thử lại sau.")
        try:
            yield
        finally:
            self.lock.release()

    def start(self) -> None:
        self.error = self.warning = None
        try:
            from vieneu import Vieneu
            self.profile = settings.voice_profile or (
                "turbo-gpu" if settings.backend == "pytorch" or settings.device == "cuda"
                else f"turbo-{settings.precision}"
            )
            if self.profile == "turbo-int8" and not supports_vnni():
                if settings.onnx_dir:
                    raise ValueError("CPU chưa xác nhận hỗ trợ VNNI; chọn turbo-fp32 và ONNX_DIR tương ứng.")
                self.profile = "turbo-fp32"
                self.warning = "CPU chưa xác nhận hỗ trợ VNNI; đã dùng fp32 để tránh méo tiếng."
            nano = self.profile == "nano"
            gpu = self.profile == "turbo-gpu"
            if gpu:
                import torch
                if not torch.cuda.is_available():
                    raise RuntimeError("turbo-gpu cần NVIDIA CUDA và bản PyTorch có CUDA. Xem README voice-service.")
            kwargs: dict[str, Any] = {
                "backbone_repo": settings.nano_repo if nano else settings.backbone_repo,
                "threads": settings.threads,
            }
            if not nano:
                kwargs.update(backend="pytorch" if gpu else "onnx", device="cuda" if gpu else "cpu",
                              precision="int8" if self.profile == "turbo-int8" else "fp32",
                              max_batch_size=settings.max_batch_size)
            if settings.onnx_dir:
                kwargs["onnx_dir"] = settings.onnx_dir
            self.vieneu = Vieneu(mode="v3nano" if nano else "v3turbo", **kwargs)
            self.backend = self.vieneu.backend
            self._load_custom_voices()
        except Exception as exc:
            if self.vieneu is not None:
                self.vieneu.close()
            self.vieneu = None
            self.error = f"{type(exc).__name__}: {exc}"
            logger.exception("Vieneu init failed")

    @property
    def voices_path(self) -> Path:
        p = Path(settings.voices_file)
        return p.with_name(f"{p.stem}.nano{p.suffix}") if self.profile == "nano" else p

    def _load_custom_voices(self) -> None:
        self.custom_voices = {}
        if not self.voices_path.exists():
            return
        data = json.loads(self.voices_path.read_text(encoding="utf-8"))
        entries = data.get("presets", {})
        if data.get("schema_version") != 2:
            # Legacy SDK snapshots included factory presets; migrate only app voices.
            entries = {name: v for name, v in entries.items()
                       if re.fullmatch(r"[a-f0-9]{12}", name)
                       or (Path(settings.voices_dir) / f"{name}.wav").is_file()}
        for name, entry in entries.items():
            v = dict(entry)
            v["speaker_emb"] = np.asarray(v["speaker_emb"], dtype=np.float32)
            if self.profile == "nano":
                v["style"] = np.asarray(v["style"], dtype=np.float32)
            elif v.get("codes") is not None:
                v["codes"] = np.asarray(v["codes"], dtype=np.int64)
            self.custom_voices[name] = v

    def _save_custom_voices(self) -> None:
        path = self.voices_path
        path.parent.mkdir(parents=True, exist_ok=True)
        backup = path.with_suffix(path.suffix + ".bak")
        if path.exists() and not backup.exists():
            shutil.copy2(path, backup)
        data = {"schema_version": 2, "model": "v3nano" if self.profile == "nano" else "v3turbo",
                "presets": self.custom_voices}
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False,
                                  default=lambda value: value.tolist()), encoding="utf-8")
        temp.replace(path)

    def register(self, voice_id: str, ref_path: Path) -> None:
        # Caller owns session; all SDK infer APIs accept voice dictionaries.
        emb, codes = self.vieneu.encode_reference(ref_path.as_posix(), denoise=True)
        old = self.custom_voices.get(voice_id)
        self.custom_voices[voice_id] = {
            "speaker_emb": emb, "style" if self.profile == "nano" else "codes": codes,
        }
        try:
            self._save_custom_voices()
        except Exception:
            if old is None:
                self.custom_voices.pop(voice_id, None)
            else:
                self.custom_voices[voice_id] = old
            raise

    def remove(self, voice_id: str) -> None:
        # Remove both registries so model switching cannot revive a deleted voice.
        p = Path(settings.voices_file)
        for path in {p, p.with_name(f"{p.stem}.nano{p.suffix}")}:
            if path.exists():
                data = json.loads(path.read_text(encoding="utf-8"))
                data.get("presets", {}).pop(voice_id, None)
                temp = path.with_suffix(path.suffix + ".tmp")
                temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                temp.replace(path)
        self.custom_voices.pop(voice_id, None)

    def resolve_voice(self, voice_id: str | None):
        if voice_id in self.custom_voices:
            return self.custom_voices[voice_id]
        # References are shared, embeddings are not: re-enroll on first model switch.
        if voice_id and re.fullmatch(r"[a-f0-9]{12}", voice_id):
            ref = Path(settings.voices_dir) / f"{voice_id}.wav"
            if ref.is_file():
                self.register(voice_id, ref)
                return self.custom_voices[voice_id]
        if voice_id is not None:
            self.vieneu.get_preset_voice(voice_id)
        return voice_id

    @property
    def ready(self) -> bool:
        return self.vieneu is not None

    def presets(self) -> list[dict]:
        if not self.ready:
            return []
        return [{"name": name, "description": v.get("description", ""), "gender": v.get("gender", "")}
                for _, name in self.vieneu.list_preset_voices()
                for v in [self.vieneu.get_preset_voice(name)]]

    def status(self) -> dict:
        try:
            sdk_version = version("vieneu")
        except PackageNotFoundError:
            sdk_version = None
        return {
            "model_loaded": self.ready, "model_cache_dir": str(MODEL_CACHE_DIR),
            "backend": self.backend, "device": "cuda" if self.profile == "turbo-gpu" else "cpu",
            "profile": self.profile, "sdk_version": sdk_version,
            "precision": "int8" if self.profile == "turbo-int8" else "fp32",
            "sample_rate": self.vieneu.sample_rate if self.ready else None,
            "streaming": "chunks" if self.profile == "nano" else "frames",
            "gpu_batching": self.profile == "turbo-gpu", "max_batch_size": settings.max_batch_size,
            "voices_count": len(self.presets()), "custom_voices_count": len(self.custom_voices),
            "ffmpeg_available": resolve_ffmpeg_path() is not None,
            "error": self.error, "warning": self.warning,
        }


engine = VoiceEngine()
