"""Service layer cho watermark remover — hybrid path/upload mode.

Hỗ trợ 2 mode:
1. Path-based (Electron): gwr đọc file từ đường dẫn gốc
2. Upload mode (Web): gwr đọc file từ Data/watermark/uploads/

The packaged desktop app provides its own pinned GWR/Sharp/Playwright runtime.
During development a repo-local runtime or a global ``gwr`` command is accepted.
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
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.watermark import state as wstate
from app.watermark.state import BatchJobState, VideoState

logger = logging.getLogger(__name__)

GWR_CMD = "gwr"


@dataclass(frozen=True)
class GwrRuntime:
    """Resolved command and environment needed to launch GWR."""

    command: tuple[str, ...]
    source: str
    env_overrides: dict[str, str]
    video_available: bool


def _generate_job_id() -> str:
    """Generate unique job ID."""
    return secrets.token_hex(6)


def _has_playwright_browser(browser_dir: Path) -> bool:
    """Return whether a hermetic Playwright browser was bundled."""
    try:
        return browser_dir.is_dir() and any(
            item.is_dir() and item.name.startswith(("chromium-", "chromium_headless_shell-"))
            for item in browser_dir.iterdir()
        )
    except OSError:
        return False


def _script_runtime(
    node_path: Path,
    script_path: Path,
    *,
    source: str,
    browser_dir: Path,
    node_is_electron: bool = False,
) -> GwrRuntime | None:
    if not node_path.is_file() or not script_path.is_file():
        return None

    env_overrides = {"PLAYWRIGHT_BROWSERS_PATH": str(browser_dir)}
    if node_is_electron:
        env_overrides["ELECTRON_RUN_AS_NODE"] = "1"
    return GwrRuntime(
        command=(str(node_path), str(script_path)),
        source=source,
        env_overrides=env_overrides,
        video_available=_has_playwright_browser(browser_dir),
    )


def _resolve_gwr_runtime() -> GwrRuntime | None:
    """Resolve the packaged runtime first, then repo-local and global fallbacks."""
    explicit_node = os.environ.get("WATERMARK_NODE_PATH", "").strip()
    explicit_script = os.environ.get("WATERMARK_GWR_SCRIPT", "").strip()
    explicit_browsers = os.environ.get("WATERMARK_PLAYWRIGHT_BROWSERS_PATH", "").strip()
    if explicit_node or explicit_script:
        if not (explicit_node and explicit_script and explicit_browsers):
            logger.error("[watermark] Packaged runtime environment is incomplete")
            return None
        return _script_runtime(
            Path(explicit_node),
            Path(explicit_script),
            source="bundled",
            browser_dir=Path(explicit_browsers),
            node_is_electron=os.environ.get("WATERMARK_NODE_IS_ELECTRON") == "1",
        )

    repo_root = Path(__file__).resolve().parents[3]
    local_root = repo_root / "Frontend" / "watermark-runtime" / "node_modules"
    local_script = local_root / "@pilio" / "gemini-watermark-remover" / "bin" / "gwr.mjs"
    local_browsers = local_root / "playwright-core" / ".local-browsers"
    node_path = shutil.which("node")
    if node_path:
        local_runtime = _script_runtime(
            Path(node_path),
            local_script,
            source="repo-local",
            browser_dir=local_browsers,
        )
        if local_runtime:
            return local_runtime

    which_path = shutil.which(GWR_CMD)
    appdata = os.environ.get("APPDATA", "")
    candidates = [
        Path(which_path) if which_path else None,
        Path(appdata) / "npm" / "gwr.cmd" if appdata else None,
        Path(appdata) / "npm" / "gwr" if appdata else None,
        Path(sys.executable).parent / "gwr.cmd",
        Path(sys.executable).parent / "gwr.exe",
        Path(sys.executable).parent / "bin" / "gwr.cmd",
    ]
    for candidate in candidates:
        if candidate is None or not candidate.is_file():
            continue
        command = (
            ("cmd", "/c", str(candidate))
            if candidate.suffix.lower() in {".cmd", ".bat"}
            else (str(candidate),)
        )
        return GwrRuntime(
            command=command,
            source="system",
            env_overrides={},
            video_available=True,
        )
    return None


def _resolve_gwr_path() -> str | None:
    """Compatibility helper returning the resolved GWR script/shim path."""
    runtime = _resolve_gwr_runtime()
    return runtime.command[-1] if runtime else None


def _gwr_available() -> bool:
    return _resolve_gwr_runtime() is not None


def get_gwr_runtime_status() -> dict[str, str | bool | None]:
    runtime = _resolve_gwr_runtime()
    if runtime is None:
        return {"gwr_available": False, "video_available": False, "runtime": None}
    return {
        "gwr_available": True,
        "video_available": runtime.video_available,
        "runtime": runtime.source,
    }


def _gwr_command(runtime: GwrRuntime | None = None) -> list[str]:
    """Build the GWR command prefix for bundled and system runtimes."""
    resolved = runtime or _resolve_gwr_runtime()
    if not resolved:
        return [GWR_CMD]
    return list(resolved.command)


def _gwr_environment(runtime: GwrRuntime) -> dict[str, str]:
    env = os.environ.copy()
    env.update(runtime.env_overrides)
    return env



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

    try:
        runtime = _resolve_gwr_runtime()
        if runtime is None:
            raise FileNotFoundError("Watermark runtime is unavailable")
        if inp.suffix.lower() in VIDEO_EXTENSIONS and not runtime.video_available:
            raise RuntimeError("Trình duyệt xử lý video không có trong watermark runtime.")

        cmd = [*_gwr_command(runtime), "remove", str(inp), "--output", str(out), "--overwrite"]
        logger.info("[watermark] Running (%s): %s", runtime.source, " ".join(cmd))
        stderr_tail: list[str] = []
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=_gwr_environment(runtime),
        )

        assert proc.stderr is not None
        for line in proc.stderr:
            line = line.strip()
            if line:
                logger.debug("[gwr] %s", line)
                stderr_tail.append(line)
                del stderr_tail[:-8]
            processed, total = _parse_frame_progress(line)
            if processed is not None:
                video.processed_frames = processed
                if total is not None:
                    video.frame_estimate = total

        proc.wait()
        if proc.returncode == 0 and out.is_file():
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
            detail = stderr_tail[-1] if stderr_tail else f"exit code {proc.returncode}"
            if proc.returncode == 0:
                detail = "lệnh hoàn tất nhưng không tạo file đầu ra"
            video.error = f"gwr: {detail}"
            logger.error("[watermark] Failed %s (exit code %s)", video.name, proc.returncode)


    except FileNotFoundError:
        video.status = "error"
        video.error = "Watermark runtime tích hợp không khả dụng. Hãy cài lại ứng dụng."
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
