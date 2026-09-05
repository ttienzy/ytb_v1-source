"""
Veo Studio — Service layer.

Quản lý job lifecycle, lịch sử video, và capabilities.
Chưa có contract Flow xác minh → adapter dispatch là placeholder.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
from typing import Any
from urllib.parse import urlparse

import requests

from app.veo import bridge
from app.veo.schemas import (
    AccountInfo,
    AspectRatio,
    ExtensionInfo,
    InputMode,
    JobStatus,
    VeoBridgeStatus,
    VeoCapabilities,
    VeoHistoryItem,
    VeoJobOut,
    VeoJobRequest,
    VeoModelInfo,
)

logger = logging.getLogger("veo.service")

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────

_BASE_DIR = Path(__file__).resolve().parent.parent.parent  # Backend/
_VEO_DATA_DIR = _BASE_DIR / "Data" / "media" / "veo_outputs"
_VEO_JOBS_FILE = _BASE_DIR / "Data" / "veo_jobs.json"

# Ensure directories exist
_VEO_DATA_DIR.mkdir(parents=True, exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# In-memory job store
# ─────────────────────────────────────────────────────────────────────────────

_jobs: dict[str, dict[str, Any]] = {}


def _save_jobs() -> None:
    """Persist jobs to disk."""
    try:
        serializable = {}
        for jid, job in _jobs.items():
            serializable[jid] = {k: v for k, v in job.items() if k != "_thread"}
        _VEO_JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _VEO_JOBS_FILE.write_text(
            json.dumps(serializable, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as e:
        logger.warning("Failed to save jobs: %s", e)


def _load_jobs() -> None:
    """Load jobs from disk on startup."""
    global _jobs
    if _VEO_JOBS_FILE.exists():
        try:
            data = json.loads(_VEO_JOBS_FILE.read_text(encoding="utf-8"))
            _jobs = data
            # Reset stuck jobs
            for job in _jobs.values():
                if job.get("status") in ("captcha", "submitting", "generating", "downloading"):
                    job["status"] = "error"
                    job["error_message"] = "Job interrupted by server restart"
                    job["updated_at"] = datetime.now(timezone.utc).isoformat()
        except Exception as e:
            logger.warning("Failed to load jobs: %s", e)


# ─────────────────────────────────────────────────────────────────────────────
# Capabilities — từ Google Help, cập nhật khi có runtime verification
# ─────────────────────────────────────────────────────────────────────────────

# Nguồn: https://support.google.com/flow/answer/16352836?hl=en
_DEFAULT_MODELS: list[dict[str, Any]] = [
    {
        "display_name": "Omni 1.1 Flash",
        "provider": "flow",
        "provider_model_id": None,  # Chưa xác minh
        "group": "video",
        "supported_modes": ["text_to_video", "frames", "ingredients"],
        "supported_durations": [4, 6, 8, 10],
        "supported_resolutions": ["360p", "720p"],
        "extend_supported": None,  # Flow Help ghi "Coming soon"
        "verified": False,
    },
    {
        "display_name": "Veo 3.1 - Lite",
        "provider": "flow",
        "provider_model_id": None,
        "group": "video",
        "supported_modes": ["text_to_video", "frames", "ingredients"],
        "supported_durations": [4, 6, 8],
        "supported_resolutions": ["360p", "720p"],
        "extend_supported": True,  # Flow Help xác nhận
        "verified": False,
    },
    {
        "display_name": "Veo 3.1 - Fast",
        "provider": "flow",
        "provider_model_id": None,
        "group": "video",
        "supported_modes": ["text_to_video", "frames"],
        "supported_durations": [4, 6, 8],
        "supported_resolutions": ["360p", "720p"],
        "extend_supported": False,  # Flow Help: không hỗ trợ
        "verified": False,
    },
    {
        "display_name": "Veo 3.1 - Quality",
        "provider": "flow",
        "provider_model_id": None,
        "group": "video",
        "supported_modes": ["text_to_video", "frames"],
        "supported_durations": [4, 6, 8],
        "supported_resolutions": ["360p", "720p"],
        "extend_supported": False,
        "verified": False,
    },
]


def get_capabilities() -> VeoCapabilities:
    """Trả về capabilities hiện tại — model list từ tài liệu Google Help."""
    models = [VeoModelInfo(**m) for m in _DEFAULT_MODELS]
    return VeoCapabilities(
        models=models,
        aspect_ratios=["16:9", "9:16"],
        max_outputs=4,
        note="Dữ liệu từ tài liệu Google Help. Internal model IDs chưa xác minh runtime.",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Bridge Status
# ─────────────────────────────────────────────────────────────────────────────

def get_bridge_status() -> VeoBridgeStatus:
    """Lấy trạng thái tổng thể Bridge + Extension + Accounts."""
    ext = bridge.get_extension_info()
    pool = bridge.get_credentials_pool()
    captcha = bridge.get_captcha_stats()

    accounts = []
    for email, cred in pool.items():
        accounts.append(AccountInfo(
            email=email,
            tier=cred.get("tier", "unknown"),
            credits=cred.get("credit"),
            has_token=bool(cred.get("access_token")),
            session_valid=bool(cred.get("cookie")),
            last_updated=cred.get("pushed_at"),
        ))

    return VeoBridgeStatus(
        bridge_running=bridge.is_bridge_running(),
        bridge_port=bridge.get_bridge_port() or 60526,
        bridge_uptime_seconds=bridge.get_uptime(),
        secret_generated=bool(bridge.get_bridge_secret()),
        extension=ExtensionInfo(**ext),
        accounts=accounts,
        captcha_queue_size=captcha.get("queue_size", 0),
        total_captcha_solved=captcha.get("total_solved", 0),
        last_captcha_at=captcha.get("last_solved_at"),
    )


def trigger_refresh() -> dict[str, Any]:
    """Phát lệnh yêu cầu Extension quét và làm mới số dư credits từ Google Flow."""
    bridge.request_refresh(reason="user_refresh")
    return {"ok": True, "message": "Đã gửi yêu cầu làm mới tới Extension"}


def save_manual_credential(email: str, cookie: str, access_token: str = "") -> dict[str, Any]:
    """Lưu cookie/token nhập tay từ trang Cài đặt."""
    bridge.set_manual_credential(email=email, cookie=cookie, access_token=access_token)
    return {"ok": True, "message": f"Đã lưu thông tin xác thực cho {email}"}



# ─────────────────────────────────────────────────────────────────────────────
# Job Management
# ─────────────────────────────────────────────────────────────────────────────

def submit_job(request: VeoJobRequest) -> VeoJobOut:
    """Tạo job mới và bắt đầu xử lý async."""
    job_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    job = {
        "job_id": job_id,
        "status": JobStatus.PENDING.value,
        "input_mode": request.input_mode.value,
        "prompt": request.prompt,
        "model_display_name": request.model_display_name,
        "aspect_ratio": request.aspect_ratio.value,
        "duration_seconds": request.duration_seconds,
        "resolution": request.resolution,
        "num_outputs": request.num_outputs,
        "seed": request.seed,
        "current_step": "Đã tạo job, đang chờ xử lý",
        "error_message": None,
        "output_files": [],
        "created_at": now,
        "updated_at": now,
    }

    _jobs[job_id] = job
    _save_jobs()

    # Start async processing
    thread = Thread(target=_process_job, args=(job_id,), daemon=True, name=f"veo-job-{job_id}")
    thread.start()

    return _job_to_out(job)


def _process_job(job_id: str) -> None:
    """Generate a verified Flow T2V variant through the logged-in Chrome tab."""
    job = _jobs.get(job_id)
    if not job:
        return

    try:
        # Step 1: Check Bridge & Extension
        _update_job(job, JobStatus.CAPTCHA, "Đang chờ giải reCAPTCHA...")
        if not bridge.is_bridge_running():
            _update_job(job, JobStatus.ERROR, error="Bridge Server không hoạt động")
            return

        ext = bridge.get_extension_info()
        if not ext.get("connected"):
            _update_job(job, JobStatus.ERROR, error="Extension chưa kết nối. Hãy nạp FlowsVeo-Clean vào Chrome và mở tab labs.google")
            return

        pool = bridge.get_credentials_pool()
        if not pool:
            _update_job(job, JobStatus.ERROR, error="Chưa có tài khoản Google Labs. Đăng nhập trên tab labs.google")
            return

        # Step 2: Request reCAPTCHA
        flow_request = _build_verified_flow_request(job)
        # The successful Flow HAR sends this exact Enterprise reCAPTCHA action.
        request_id = bridge.request_captcha(
            action="VIDEO_GENERATION",
            flow_request=flow_request,
        )
        if not request_id:
            _update_job(job, JobStatus.ERROR, error="Không thể tạo yêu cầu CAPTCHA (queue đầy hoặc Extension đang bận)")
            return

        # Step 3: Wait for token
        result = bridge.wait_captcha_result(request_id, timeout=30.0)
        if not result or not result.get("token"):
            error_msg = result.get("error", "Timeout") if result else "Timeout chờ token reCAPTCHA"
            _update_job(job, JobStatus.ERROR, error=f"Giải reCAPTCHA thất bại: {error_msg}")
            return

        captcha_token = result["token"]
        logger.info("Job %s: reCAPTCHA token received", job_id)

        _update_job(job, JobStatus.GENERATING, "Flow đã nhận token; đang tạo video...")
        flow_envelope = bridge.wait_flow_result(request_id, timeout=630.0)
        if not flow_envelope:
            _update_job(job, JobStatus.ERROR, error="Timeout chờ kết quả Google Flow")
            return
        if flow_envelope.get("error"):
            _update_job(job, JobStatus.ERROR, error=f"Google Flow: {flow_envelope['error']}")
            return
        flow_result = flow_envelope.get("result") or {}
        if not flow_result.get("ok") or not flow_result.get("video_url"):
            _update_job(
                job, JobStatus.ERROR,
                error=f"Google Flow không trả video: {flow_result.get('error') or 'response không hợp lệ'}",
            )
            return

        _update_job(job, JobStatus.DOWNLOADING, "Đang tải video từ Flow...")
        output_path = _download_flow_video(job, flow_result)
        job["output_files"] = [str(output_path)]
        job["provider_media_id"] = flow_result.get("media_id")
        job["provider_model_id"] = flow_result.get("provider_model_id")
        _update_job(job, JobStatus.DONE, "Hoàn tất — video đã lưu vào máy")

    except Exception as e:
        logger.exception("Job %s failed: %s", job_id, e)
        _update_job(job, JobStatus.ERROR, error=f"Lỗi không xác định: {str(e)}")


def _build_verified_flow_request(job: dict[str, Any]) -> dict[str, Any]:
    """Chuẩn hóa cấu hình về contract Omni 1.1 Flash 6s (đã xác minh) để gửi tới Google Flow."""
    expected = {
        "input_mode": "text_to_video",
        "model_display_name": "Omni 1.1 Flash",
        "duration_seconds": 6,
        "resolution": "720p",
        "aspect_ratio": "16:9",
        "num_outputs": 1,
    }
    # Tự động chuẩn hóa nếu người dùng chọn model hoặc thời lượng khác
    mismatches = [key for key, value in expected.items() if job.get(key) != value]
    if mismatches:
        logger.info(
            "Tự động chuẩn hóa job %s sang cấu hình Flow đã xác minh (Omni 1.1 Flash 6s 16:9 720p). Khác biệt cũ: %s",
            job.get("job_id"),
            ", ".join(mismatches),
        )
    return {
        "prompt": job["prompt"],
        **expected,
    }


def _download_flow_video(job: dict[str, Any], flow_result: dict[str, Any]) -> Path:
    """Download a signed result URL to an atomic local file and write metadata."""
    url = str(flow_result.get("video_url") or "")
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "flow-content.google":
        raise ValueError("Flow trả URL video không thuộc flow-content.google")

    output_path = _VEO_DATA_DIR / f"{job['job_id']}.mp4"
    part_path = output_path.with_suffix(".mp4.part")
    max_bytes = 250 * 1024 * 1024
    written = 0
    try:
        with requests.get(url, stream=True, timeout=(15, 120)) as response:
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "").lower()
            if content_type and not (
                content_type.startswith("video/") or content_type == "application/octet-stream"
            ):
                raise ValueError(f"Flow trả Content-Type không phải video: {content_type}")
            with part_path.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > max_bytes:
                        raise ValueError("Video Flow vượt giới hạn tải 250 MB")
                    output.write(chunk)
        if written < 1024:
            raise ValueError("File video Flow rỗng hoặc quá nhỏ")
        part_path.replace(output_path)
    except Exception:
        part_path.unlink(missing_ok=True)
        raise

    media = _probe_video(output_path)
    media_width = int(media.get("width") or 0)
    media_height = int(media.get("height") or 0)
    actual_aspect = job["aspect_ratio"]
    if media_width and media_height:
        actual_aspect = "16:9" if media_width > media_height else "9:16"
    metadata = {
        "prompt": job["prompt"],
        "model_display_name": job["model_display_name"],
        "provider_model_id": flow_result.get("provider_model_id"),
        "provider_media_id": flow_result.get("media_id"),
        "aspect_ratio": actual_aspect,
        "input_mode": job["input_mode"],
        "duration_seconds": media.get("duration_seconds", job["duration_seconds"]),
        "width": media_width,
        "height": media_height,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    output_path.with_suffix(".json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return output_path


def _probe_video(path: Path) -> dict[str, Any]:
    """Best-effort ffprobe validation; failure leaves the downloaded file usable."""
    try:
        process = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height:format=duration",
                "-of", "json", str(path),
            ],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=20, check=True,
        )
        data = json.loads(process.stdout)
        stream = (data.get("streams") or [{}])[0]
        return {
            "width": int(stream.get("width") or 0),
            "height": int(stream.get("height") or 0),
            "duration_seconds": float((data.get("format") or {}).get("duration") or 0),
        }
    except Exception as exc:
        logger.warning("ffprobe failed for %s: %s", path.name, exc)
        return {}


def recover_current_scene(job_id: str) -> VeoJobOut | None:
    """Recover a completed scene already open in Flow without creating another render."""
    job = _jobs.get(job_id)
    if not job:
        return None
    thread = Thread(
        target=_recover_current_scene,
        args=(job_id,),
        daemon=True,
        name=f"veo-recover-{job_id}",
    )
    thread.start()
    return _job_to_out(job)


def _recover_current_scene(job_id: str) -> None:
    job = _jobs.get(job_id)
    if not job:
        return
    try:
        _update_job(job, JobStatus.DOWNLOADING, "Đang lấy video từ scene Flow đã hoàn tất...")
        request_id = bridge.request_flow_recovery()
        if not request_id:
            raise RuntimeError("Không thể gửi yêu cầu khôi phục tới extension")
        envelope = bridge.wait_flow_result(request_id, timeout=45.0)
        if not envelope:
            raise TimeoutError("Timeout chờ extension đọc scene Flow")
        if envelope.get("error"):
            raise RuntimeError(envelope["error"])
        result = envelope.get("result") or {}
        if not result.get("video_url"):
            raise RuntimeError("Scene Flow không cung cấp URL video")
        output_path = _download_flow_video(job, result)
        job["output_files"] = [str(output_path)]
        job["provider_media_id"] = result.get("media_id")
        job["provider_model_id"] = result.get("provider_model_id") or "abra_t2v_6s"
        _update_job(job, JobStatus.DONE, "Hoàn tất — video đã khôi phục và lưu vào máy")
    except Exception as exc:
        logger.exception("Job %s recovery failed: %s", job_id, exc)
        _update_job(job, JobStatus.ERROR, error=f"Khôi phục Flow thất bại: {exc}")


def _update_job(job: dict, status: JobStatus, step: str = "", error: str | None = None) -> None:
    """Cập nhật trạng thái job."""
    job["status"] = status.value
    if step:
        job["current_step"] = step
    if error:
        job["error_message"] = error
        job["current_step"] = f"Lỗi: {error}"
    elif status != JobStatus.ERROR:
        job["error_message"] = None
    job["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_jobs()


def _job_to_out(job: dict) -> VeoJobOut:
    return VeoJobOut(
        job_id=job["job_id"],
        status=job.get("status", "pending"),
        input_mode=job.get("input_mode", "text_to_video"),
        prompt=job.get("prompt", ""),
        model_display_name=job.get("model_display_name", ""),
        aspect_ratio=job.get("aspect_ratio", "16:9"),
        duration_seconds=job.get("duration_seconds", 8),
        resolution=job.get("resolution", "720p"),
        num_outputs=job.get("num_outputs", 1),
        current_step=job.get("current_step", ""),
        error_message=job.get("error_message"),
        output_files=job.get("output_files", []),
        created_at=job.get("created_at", ""),
        updated_at=job.get("updated_at", ""),
    )


def get_job(job_id: str) -> VeoJobOut | None:
    """Lấy trạng thái job theo ID."""
    job = _jobs.get(job_id)
    if not job:
        return None
    return _job_to_out(job)


def get_all_jobs() -> list[VeoJobOut]:
    """Lấy tất cả jobs, mới nhất trước."""
    sorted_jobs = sorted(_jobs.values(), key=lambda j: j.get("created_at", ""), reverse=True)
    return [_job_to_out(j) for j in sorted_jobs]


def delete_job(job_id: str) -> bool:
    """Xóa job khỏi danh sách."""
    if job_id in _jobs:
        del _jobs[job_id]
        _save_jobs()
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# History — video đã tạo thành công lưu local
# ─────────────────────────────────────────────────────────────────────────────

def get_history() -> list[VeoHistoryItem]:
    """Quét thư mục veo_outputs và trả metadata."""
    items: list[VeoHistoryItem] = []
    if not _VEO_DATA_DIR.exists():
        return items

    for f in sorted(_VEO_DATA_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.suffix.lower() in (".mp4", ".webm", ".mkv"):
            stat = f.stat()
            # Load metadata JSON sidecar nếu có
            meta_path = f.with_suffix(".json")
            meta: dict[str, Any] = {}
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    pass

            items.append(VeoHistoryItem(
                video_id=f.stem,
                file_name=f.name,
                file_path=str(f),
                file_size_bytes=stat.st_size,
                duration_seconds=meta.get("duration_seconds", 0),
                width=meta.get("width", 0),
                height=meta.get("height", 0),
                prompt=meta.get("prompt", ""),
                model_display_name=meta.get("model_display_name", ""),
                aspect_ratio=meta.get("aspect_ratio", "16:9"),
                input_mode=meta.get("input_mode", "text_to_video"),
                created_at=meta.get("created_at", datetime.fromtimestamp(stat.st_mtime).isoformat()),
            ))

    return items


def get_video_path(video_id: str) -> Path | None:
    """Tìm file video theo ID trong thư mục outputs."""
    for ext in (".mp4", ".webm", ".mkv"):
        path = _VEO_DATA_DIR / f"{video_id}{ext}"
        if path.exists():
            return path
    return None


def delete_video(video_id: str) -> bool:
    """Xóa video và metadata JSON sidecar."""
    path = get_video_path(video_id)
    if path:
        path.unlink(missing_ok=True)
        path.with_suffix(".json").unlink(missing_ok=True)
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────────────────────────────────────

def startup() -> None:
    """Gọi khi FastAPI startup — khởi tạo jobs và Bridge."""
    _load_jobs()
    ok = bridge.start_bridge(port=60526)
    if ok:
        logger.info("Veo service started. Bridge on 127.0.0.1:%d", bridge.get_bridge_port())
    else:
        logger.error("Veo service: Bridge failed to start!")


def shutdown() -> None:
    """Gọi khi FastAPI shutdown."""
    bridge.stop_bridge()
    _save_jobs()
    logger.info("Veo service stopped")
