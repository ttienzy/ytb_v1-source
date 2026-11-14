"""Nhà cung cấp clip: giao diện mỏng để `clip.py` không gắn chết vào Google Flow (docs/PLAN_campaign_v3 §5.5).

Hiện chỉ có FlowProvider (Omni 1.2 Ingredients qua app.veo). Mọi quy tắc "không gửi lại", idempotency, phân loại lỗi
vẫn nằm ở clip.py; provider chỉ gửi, hỏi trạng thái và trả file.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class JobState:
    status: str                   # queued | generating | done | error | ... (chuỗi)
    step: str = ""
    error_code: str = ""
    error_message: str = ""
    files: list[str] | None = None
    deduplicated: bool = False


class FlowProvider:
    """Omni 1.2 Ingredients trong Google Flow (extension). Thay `_veo` trong test."""
    name = "flow"

    def __init__(self, veo: Any):
        self.veo = veo

    @property
    def model_name(self) -> str:
        return self.veo.OMNI_12_NAME

    @staticmethod
    def model_id(duration: int, resolution: str) -> str:
        return f"macaron_cookie_r2v_{duration}s{'_360p' if resolution == '360p' else ''}"

    def active_project_id(self) -> str | None:
        project = self.veo.get_active_project()
        return None if project is None else project.id

    def submit(self, *, prompt: str, aspect: str, duration: int, resolution: str, project_id: str, image_paths: list[str],
               idempotency_key: str) -> tuple[str, bool]:
        """Gửi job. Lỗi ValueError = kiểm tra đầu vào thất bại TRƯỚC khi gửi (không mất credit)."""
        from app.veo.schemas import AspectRatio, InputMode, VeoJobRequest
        request = VeoJobRequest(
            prompt=prompt, model_display_name=self.model_name, aspect_ratio=AspectRatio(aspect), duration_seconds=duration,
            resolution=resolution, num_outputs=1, project_id=project_id, input_mode=InputMode.INGREDIENTS,
            ingredient_image_paths=list(image_paths), idempotency_key=idempotency_key)
        job = self.veo.submit_job(request)
        return job.job_id, bool(getattr(job, "deduplicated", False))

    def poll(self, job_id: str) -> JobState | None:
        from app.veo.schemas import JobStatus  # noqa: F401 - giữ import để lỗi sớm nếu schema đổi
        job = self.veo.get_job(job_id)
        if job is None:
            return None
        status = getattr(job.status, "value", str(job.status))
        return JobState(status=status, step=str(getattr(job, "current_step", "") or ""),
                        error_code=str(getattr(job, "error_code", "") or ""), error_message=str(getattr(job, "error_message", "") or ""),
                        files=list(getattr(job, "output_files", None) or []), deduplicated=bool(getattr(job, "deduplicated", False)))

    def video_path(self, file_name: str) -> Path | None:
        path = self.veo.get_video_path(file_name)
        return None if path is None else Path(path)

    @staticmethod
    def done_status() -> str:
        from app.veo.schemas import JobStatus
        return JobStatus.DONE.value

    @staticmethod
    def error_status() -> str:
        from app.veo.schemas import JobStatus
        return JobStatus.ERROR.value
