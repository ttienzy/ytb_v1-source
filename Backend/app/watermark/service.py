"""Service layer cho watermark remover — hybrid path/upload mode.

Hỗ trợ 2 mode:
1. Path-based (Electron): gwr đọc file từ đường dẫn gốc
2. Upload mode (Web): gwr đọc file từ Data/watermark/uploads/

Setup (chạy 1 lần):
    npm install -g @pilio/gemini-watermark-remover
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.watermark import state as wstate
from app.watermark.state import BatchJobState, VideoState

logger = logging.getLogger(__name__)

GWR_CMD = "gwr"


def _generate_job_id() -> str:
    """Generate unique job ID."""
    return secrets.token_hex(6)


def _resolve_gwr_path() -> str | None:
    """Tìm đường dẫn thực thi của gwr (cả global PATH, npm appdata, và local bundle)."""
    # 1. Thử system PATH
    which_path = shutil.which(GWR_CMD)
    if which_path:
        return which_path

    # 2. Thử các đường dẫn phổ biến trên Windows
    appdata = os.environ.get("APPDATA", "")
    candidates = [
        Path(appdata) / "npm" / "gwr.cmd",
        Path(appdata) / "npm" / "gwr",
        Path(sys.executable).parent / "gwr.cmd",
        Path(sys.executable).parent / "gwr.exe",
        Path(sys.executable).parent / "bin" / "gwr.cmd",
        Path(__file__).resolve().parents[3] / "Frontend" / "node_modules" / ".bin" / "gwr.cmd",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return None


def _gwr_available() -> bool:
    return _resolve_gwr_path() is not None


def _gwr_command() -> list[str]:
    """Dựng prefix lệnh gwr — handle npm global shim .cmd/.bat trên Windows."""
    exe = _resolve_gwr_path()
    if not exe:
        return [GWR_CMD]
    if exe.lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", exe]
    return [exe]



def _parse_frame_progress(line: str) -> tuple[int | None, int | None]:
    """Parse: '[video] 63% 140/240 frames (AI 81, reused 59)'"""
    m = re.search(r"(\d+)/(\d+)\s+frames", line, re.IGNORECASE)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def get_output_path(input_path: Path) -> Path:
    """Output nằm cạnh file gốc, trong thư mục _clean/.

    Ví dụ:
        input:  C:/Videos/fl1/Cooking_beef.mp4
        output: C:/Videos/fl1_clean/Cooking_beef.mp4
    """
    clean_dir = input_path.parent.parent / (input_path.parent.name + "_clean")
    clean_dir.mkdir(parents=True, exist_ok=True)
    return clean_dir / input_path.name


# ── Core single-file processing ────────────────────────────────────────────────

def _process_single_sync(video: VideoState, job_id: str) -> None:
    """Xử lý 1 file đồng bộ trong thread pool."""
    inp = Path(video.input_path)   # đường dẫn gốc trên disk
    out = get_output_path(inp)

    video.status = "running"
    video.output_path = str(out)
    video.output_name = out.name
    try:
        wstate.update_job(job_id)
    except KeyError:
        pass

    cmd = [*_gwr_command(), "remove", str(inp), "--output", str(out), "--overwrite"]
    logger.info("[watermark] Running: %s", " ".join(cmd))

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        assert proc.stderr is not None
        for line in proc.stderr:
            line = line.strip()
            if line:
                logger.debug("[gwr] %s", line)
            processed, total = _parse_frame_progress(line)
            if processed is not None:
                video.processed_frames = processed
                if total is not None:
                    video.frame_estimate = total

        proc.wait()
        if proc.returncode == 0:
            video.status = "done"
            logger.info("[watermark] Done: %s", video.name)

            # Tự động upload lên Google Drive nếu người dùng bật trong Cài đặt
            try:
                from app.externals.gdrive import service as gdrive_service

                cfg = gdrive_service.get_gdrive_config()
                if cfg.get("enabled") and cfg.get("auto_upload", True):
                    video.drive_status = "uploading"
                    try:
                        wstate.update_job(job_id)
                    except KeyError:
                        pass

                    client = gdrive_service.get_client()
                    if client:
                        target_folder = gdrive_service.get_workflow_folder_id("watermark") or cfg.get("folder_id")
                        upload_res = client.upload_file_resumable(
                            file_path=out,
                            folder_id=target_folder,
                            custom_name=out.name,
                        )
                        video.drive_status = "done"
                        video.drive_file_id = upload_res.get("file_id")
                        video.drive_url = upload_res.get("web_view_link")
            except Exception as drive_exc:
                logger.warning("[watermark] Tự động upload Drive thất bại: %s", drive_exc)
                video.drive_status = "error"
                video.drive_error = str(drive_exc)
        else:
            video.status = "error"
            video.error = f"gwr exited with code {proc.returncode}"
            logger.error("[watermark] Failed %s (exit code %s)", video.name, proc.returncode)


    except FileNotFoundError:
        video.status = "error"
        video.error = "`gwr` không tìm thấy. Cài: npm install -g @pilio/gemini-watermark-remover"
    except Exception as exc:  # noqa: BLE001
        video.status = "error"
        video.error = str(exc)
        logger.exception("[watermark] Unexpected error for %s", video.name)

    try:
        wstate.update_job(job_id)
    except KeyError:
        pass


# ── Async batch orchestration ──────────────────────────────────────────────────

async def run_batch(job: BatchJobState) -> None:
    """Chạy batch job trong background — xử lý tuần tự."""
    job.status = "running"
    logger.info("[watermark] Batch %s started — %d files", job.job_id, job.total)

    for video in job.videos:
        if video.status != "pending":
            continue
        await asyncio.to_thread(_process_single_sync, video, job.job_id)

    job.status = "error" if job.failed == job.total else "done"
    job.updated_at = datetime.now(timezone.utc)
    logger.info("[watermark] Batch %s finished — done=%d failed=%d",
                job.job_id, job.done, job.failed)


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS


def create_batch_job_from_paths(file_paths: list[str]) -> BatchJobState:
    """Tạo batch job từ danh sách đường dẫn file trên disk (hỗ trợ cả video và ảnh)."""
    videos = []
    for p in file_paths:
        path = Path(p)
        if not path.exists():
            logger.warning("[watermark] File không tồn tại: %s", p)
            continue
        ext = path.suffix.lower()
        mtype = "image" if ext in IMAGE_EXTENSIONS else "video"
        v = VideoState(name=path.name, size_bytes=path.stat().st_size, media_type=mtype)
        v.input_path = str(path)   # lưu path gốc vào state
        videos.append(v)
    return wstate.create_job(videos)
