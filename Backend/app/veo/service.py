"""
Veo Studio — Service layer.

Quản lý job lifecycle, lịch sử video, và capabilities.
Chưa có contract Flow xác minh → adapter dispatch là placeholder.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import mimetypes
import os
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
import threading
from threading import Thread
from typing import Any
from urllib.parse import urlparse

import requests

from app.db import Base, SessionLocal, engine
from app.veo import bridge
from app.veo.models import VeoProject, VeoImage
from app.veo.schemas import (
    AccountInfo,
    AspectRatio,
    ExtensionInfo,
    InputMode,
    JobStatus,
    VeoBridgeStatus,
    VeoCapabilities,
    VeoHistoryItem,
    VeoImageGenerateRequest,
    VeoImageGenerateResponse,
    VeoImageItem,
    VeoJobOut,
    VeoJobRequest,
    VeoModelInfo,
    VeoProjectOut,
)

logger = logging.getLogger("veo.service")

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────

_BASE_DIR = Path(__file__).resolve().parent.parent.parent  # Backend/
_VEO_DATA_DIR = _BASE_DIR / "Data" / "media" / "veo_outputs"
_VEO_IMAGES_DIR = _BASE_DIR / "Data" / "media" / "veo_images"
_VEO_UPLOADS_DIR = _BASE_DIR / "Data" / "media" / "veo_uploads"
_VEO_JOBS_FILE = _BASE_DIR / "Data" / "veo_jobs.json"

# Ensure directories exist
_VEO_DATA_DIR.mkdir(parents=True, exist_ok=True)
_VEO_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
_VEO_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# In-memory job store
# ─────────────────────────────────────────────────────────────────────────────

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _save_jobs() -> None:
    """Persist jobs to disk."""
    try:
        with _jobs_lock:
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
                    job.update(_classify_job_error(job["error_message"], job.get("status")))
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


# ─── Dispatch Profile Matrix ───────────────────────────────────────────────
# Nguồn: https://support.google.com/flow/answer/16526234?hl=en (Credit Table)
# Nguồn: https://support.google.com/flow/answer/16352836?hl=en (Models page)
#
# Cấu trúc key: "{model_slug}_{aspect}_{duration}s_{resolution}"
# Credit cost theo tài liệu Google; runtime_verified = True chỉ khi có trace E2E.

def _build_profiles() -> list[dict[str, Any]]:  # noqa: C901
    """Tạo danh sách VeoCapabilityProfile từ ma trận tài liệu Google Help."""
    from app.veo.schemas import InputMode, AspectRatio  # local import tránh circular

    rows: list[dict[str, Any]] = []

    # ── Omni 1.1 Flash ────────────────────────────────────────────────────────
    # Credit: 360p → 4/5/6/7 credits; 720p → 7/10/12/15 credits
    omni_credit_720 = {4: 7, 6: 10, 8: 12, 10: 15}
    omni_credit_360 = {4: 4, 6: 5, 8: 6, 10: 7}
    for aspect in ("16:9", "9:16"):
        aspect_slug = "landscape" if aspect == "16:9" else "portrait"
        for dur in (4, 6, 8, 10):
            for res, credit_map in (("720p", omni_credit_720), ("360p", omni_credit_360)):
                rows.append({
                    "id": f"omni_flash_{aspect_slug}_{dur}s_{res}",
                    "model_display_name": "Omni 1.1 Flash",
                    "provider_model_id": "",  # chưa xác minh
                    "input_mode": InputMode.TEXT_TO_VIDEO.value,
                    "aspect_ratio": aspect,
                    "duration_seconds": dur,
                    "resolution": res,
                    "num_outputs": 1,
                    "credit_cost": credit_map[dur],
                    "documented": True,
                    "runtime_verified": False,
                    "note": "Theo Google Flow Help — chưa xác minh E2E",
                })

    # ── Veo 3.1 - Lite ────────────────────────────────────────────────────────
    # Credit: flat 10 credits bất kể duration/resolution
    for aspect in ("16:9", "9:16"):
        aspect_slug = "landscape" if aspect == "16:9" else "portrait"
        for dur in (4, 6, 8):
            for res in ("720p", "360p"):
                rows.append({
                    "id": f"veo31_lite_{aspect_slug}_{dur}s_{res}",
                    "model_display_name": "Veo 3.1 - Lite",
                    "provider_model_id": "",
                    "input_mode": InputMode.TEXT_TO_VIDEO.value,
                    "aspect_ratio": aspect,
                    "duration_seconds": dur,
                    "resolution": res,
                    "num_outputs": 1,
                    "credit_cost": 10,
                    "documented": True,
                    "runtime_verified": False,
                    "note": "Theo Google Flow Help — chưa xác minh E2E",
                })

    # ── Veo 3.1 - Fast ────────────────────────────────────────────────────────
    # Credit: flat 20 credits
    for aspect in ("16:9", "9:16"):
        aspect_slug = "landscape" if aspect == "16:9" else "portrait"
        for dur in (4, 6, 8):
            for res in ("720p", "360p"):
                rows.append({
                    "id": f"veo31_fast_{aspect_slug}_{dur}s_{res}",
                    "model_display_name": "Veo 3.1 - Fast",
                    "provider_model_id": "",
                    "input_mode": InputMode.TEXT_TO_VIDEO.value,
                    "aspect_ratio": aspect,
                    "duration_seconds": dur,
                    "resolution": res,
                    "num_outputs": 1,
                    "credit_cost": 20,
                    "documented": True,
                    "runtime_verified": False,
                    "note": "Theo Google Flow Help — chưa xác minh E2E",
                })

    # ── Veo 3.1 - Quality ─────────────────────────────────────────────────────
    # Credit: 100 credits (Ultra & Non-Ultra đều 100)
    for aspect in ("16:9", "9:16"):
        aspect_slug = "landscape" if aspect == "16:9" else "portrait"
        for dur in (4, 6, 8):
            for res in ("720p", "360p"):
                rows.append({
                    "id": f"veo31_quality_{aspect_slug}_{dur}s_{res}",
                    "model_display_name": "Veo 3.1 - Quality",
                    "provider_model_id": "",
                    "input_mode": InputMode.TEXT_TO_VIDEO.value,
                    "aspect_ratio": aspect,
                    "duration_seconds": dur,
                    "resolution": res,
                    "num_outputs": 1,
                    "credit_cost": 100,
                    "documented": True,
                    "runtime_verified": False,
                    "note": "Theo Google Flow Help — chưa xác minh E2E",
                })

    # ─────────────────────────────────────────────────────────────────────────
    # IMAGE-TO-VIDEO: frames (first frame / first+last) & ingredients
    # Nguồn: https://support.google.com/flow/answer/16352836
    # Credit: cùng mức với T2V của từng model.
    # Omni Flash hỗ trợ frames + ingredients; Veo Lite/Fast/Quality: frames only
    # ─────────────────────────────────────────────────────────────────────────

    # Omni 1.1 Flash — frames (first frame) 720p/360p
    for mode in (InputMode.FRAMES, InputMode.INGREDIENTS):
        mode_slug = "frames" if mode == InputMode.FRAMES else "ingr"
        for aspect in ("16:9", "9:16"):
            aspect_slug = "landscape" if aspect == "16:9" else "portrait"
            for dur in (4, 6, 8, 10):
                for res, credit_map in (("720p", omni_credit_720), ("360p", omni_credit_360)):
                    rows.append({
                        "id": f"omni_flash_{mode_slug}_{aspect_slug}_{dur}s_{res}",
                        "model_display_name": "Omni 1.1 Flash",
                        "provider_model_id": "",
                        "input_mode": mode.value,
                        "aspect_ratio": aspect,
                        "duration_seconds": dur,
                        "resolution": res,
                        "num_outputs": 1,
                        "credit_cost": credit_map[dur],
                        "documented": True,
                        "runtime_verified": False,
                        "note": f"I2V {mode.value} — Theo Google Flow Help",
                    })

    # Omni 1.1 Flash — edit uploaded/generated video with optional ingredients.
    # Google documents video edits separately from ordinary Omni generations:
    # 40 credits per generation for every supported length and resolution.
    # The selected source segment controls the edit length (up to 10 seconds).
    for aspect in ("16:9", "9:16"):
        aspect_slug = "landscape" if aspect == "16:9" else "portrait"
        for res in ("720p", "360p"):
            rows.append({
                "id": f"omni_flash_video_edit_{aspect_slug}_10s_{res}",
                "model_display_name": "Omni 1.1 Flash",
                "provider_model_id": "abra_edit_360p" if res == "360p" else "abra_edit",
                "input_mode": InputMode.VIDEO_EDIT.value,
                "aspect_ratio": aspect,
                "duration_seconds": 10,
                "resolution": res,
                "num_outputs": 1,
                "credit_cost": 40,
                "documented": True,
                "runtime_verified": aspect == "9:16" and res == "360p",
                "note": "Video edit costs 40 credits per generation; source segment up to 10 seconds; 1080p is a separate upscale step",
            })

    # Veo 3.1 Lite — frames (10 credits) + ingredients (10 credits)
    for mode in (InputMode.FRAMES, InputMode.INGREDIENTS):
        mode_slug = "frames" if mode == InputMode.FRAMES else "ingr"
        for aspect in ("16:9", "9:16"):
            aspect_slug = "landscape" if aspect == "16:9" else "portrait"
            for dur in (4, 6, 8):
                for res in ("720p", "360p"):
                    rows.append({
                        "id": f"veo31_lite_{mode_slug}_{aspect_slug}_{dur}s_{res}",
                        "model_display_name": "Veo 3.1 - Lite",
                        "provider_model_id": "",
                        "input_mode": mode.value,
                        "aspect_ratio": aspect,
                        "duration_seconds": dur,
                        "resolution": res,
                        "num_outputs": 1,
                        "credit_cost": 10,
                        "documented": True,
                        "runtime_verified": False,
                        "note": f"I2V {mode.value} — Theo Google Flow Help",
                    })

    # Veo 3.1 Fast — frames only (20 credits)
    for aspect in ("16:9", "9:16"):
        aspect_slug = "landscape" if aspect == "16:9" else "portrait"
        for dur in (4, 6, 8):
            for res in ("720p", "360p"):
                rows.append({
                    "id": f"veo31_fast_frames_{aspect_slug}_{dur}s_{res}",
                    "model_display_name": "Veo 3.1 - Fast",
                    "provider_model_id": "",
                    "input_mode": InputMode.FRAMES.value,
                    "aspect_ratio": aspect,
                    "duration_seconds": dur,
                    "resolution": res,
                    "num_outputs": 1,
                    "credit_cost": 20,
                    "documented": True,
                    "runtime_verified": False,
                    "note": "I2V frames — Theo Google Flow Help",
                })

    # Veo 3.1 Quality — frames only (100 credits)
    for aspect in ("16:9", "9:16"):
        aspect_slug = "landscape" if aspect == "16:9" else "portrait"
        for dur in (4, 6, 8):
            for res in ("720p", "360p"):
                rows.append({
                    "id": f"veo31_quality_frames_{aspect_slug}_{dur}s_{res}",
                    "model_display_name": "Veo 3.1 - Quality",
                    "provider_model_id": "",
                    "input_mode": InputMode.FRAMES.value,
                    "aspect_ratio": aspect,
                    "duration_seconds": dur,
                    "resolution": res,
                    "num_outputs": 1,
                    "credit_cost": 100,
                    "documented": True,
                    "runtime_verified": False,
                    "note": "I2V frames — Theo Google Flow Help",
                })

    # ─────────────────────────────────────────────────────────────────────────
    # EXTEND VIDEO — chỉ Veo 3.1 Lite hỗ trợ (flat 10 credits)
    # Nguồn: https://support.google.com/flow/answer/16352836 ("Extend supported: Yes")
    # ─────────────────────────────────────────────────────────────────────────
    for aspect in ("16:9", "9:16"):
        aspect_slug = "landscape" if aspect == "16:9" else "portrait"
        for dur in (4, 6, 8):
            for res in ("720p", "360p"):
                rows.append({
                    "id": f"veo31_lite_extend_{aspect_slug}_{dur}s_{res}",
                    "model_display_name": "Veo 3.1 - Lite",
                    "provider_model_id": "",
                    "input_mode": InputMode.EXTEND.value,
                    "aspect_ratio": aspect,
                    "duration_seconds": dur,
                    "resolution": res,
                    "num_outputs": 1,
                    "credit_cost": 10,
                    "documented": True,
                    "runtime_verified": False,
                    "note": "Extend — chỉ Veo 3.1 Lite, Theo Google Flow Help",
                })

    return rows



_DISPATCH_PROFILES: list[dict[str, Any]] = _build_profiles()


def get_capabilities() -> VeoCapabilities:
    """Trả về capabilities đầy đủ — models + profiles từ tài liệu Google Help."""
    from app.veo.schemas import VeoCapabilityProfile  # local import tránh circular

    models = [VeoModelInfo(**m) for m in _DEFAULT_MODELS]
    profiles = [VeoCapabilityProfile(**p) for p in _DISPATCH_PROFILES]
    return VeoCapabilities(
        models=models,
        profiles=profiles,
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


def save_manual_credential(email: str, cookie: str, access_token: str = "", credits: int | None = None) -> dict[str, Any]:
    """Lưu cookie/token nhập tay từ trang Cài đặt."""
    bridge.set_manual_credential(email=email, cookie=cookie, access_token=access_token, credits=credits)
    msg = f"Đã lưu thông tin xác thực cho {email}"
    if credits is not None:
        msg += f" (Credits: {credits})"
    return {"ok": True, "message": msg}


def set_account_credits(email: str, credits: int) -> dict[str, Any]:
    """Cập nhật trực tiếp số dư credits cho tài khoản."""
    bridge.set_account_credits(email=email, credits=credits)
    return {"ok": True, "message": f"Đã cập nhật số dư {credits} credits cho {email}"}



# ─────────────────────────────────────────────────────────────────────────────
# Projects Management (SQLite DB app.db)
# ─────────────────────────────────────────────────────────────────────────────

def init_db() -> None:
    """Tạo bảng veo_projects và veo_images trong SQLite nếu chưa có."""
    try:
        Base.metadata.create_all(bind=engine, tables=[VeoProject.__table__, VeoImage.__table__])
    except Exception as e:
        logger.warning("Failed to init veo tables: %s", e)


def _model_to_project_out(p: VeoProject) -> VeoProjectOut:
    return VeoProjectOut(
        id=p.id,
        name=p.name,
        flow_project_id=p.flow_project_id,
        account_email=p.account_email or "",
        is_active=bool(p.is_active),
        video_count=p.video_count or 0,
        created_at=p.created_at.isoformat() if p.created_at else "",
        updated_at=p.updated_at.isoformat() if p.updated_at else "",
    )


def list_projects() -> list[VeoProjectOut]:
    """Danh sách tất cả project đã lưu trong SQLite DB."""
    init_db()
    with SessionLocal() as db:
        projects = db.query(VeoProject).order_by(VeoProject.created_at.desc()).all()
        return [_model_to_project_out(p) for p in projects]


def get_active_project() -> VeoProjectOut | None:
    """Lấy project đang kích hoạt (active). Nếu chưa có, kích hoạt project gần nhất nếu có."""
    init_db()
    with SessionLocal() as db:
        p = db.query(VeoProject).filter(VeoProject.is_active == True).first()
        if not p:
            p = db.query(VeoProject).order_by(VeoProject.created_at.desc()).first()
            if p:
                p.is_active = True
                db.commit()
                db.refresh(p)
        return _model_to_project_out(p) if p else None


def get_project(project_id: str) -> VeoProjectOut | None:
    """Lấy thông tin project theo ID hoặc flow_project_id."""
    init_db()
    with SessionLocal() as db:
        p = db.query(VeoProject).filter(
            (VeoProject.id == project_id) | (VeoProject.flow_project_id == project_id)
        ).first()
        return _model_to_project_out(p) if p else None


def create_project(name: str, flow_project_id: str | None = None) -> VeoProjectOut:
    """Tạo Project mới: gửi lệnh tới Extension tự động tạo trên tab Flow, nhận flow_project_id và lưu DB."""
    init_db()

    account_email = ""
    pool = bridge.get_credentials_pool()
    if pool:
        account_email = list(pool.keys())[0]

    flow_pid = (flow_project_id or "").strip()
    if not flow_pid:
        if not bridge.is_bridge_running():
            raise RuntimeError("Bridge Server không hoạt động")
        ext = bridge.get_extension_info()
        if not ext.get("connected"):
            raise RuntimeError("Extension chưa kết nối. Hãy mở Chrome có tiện ích FlowsVeo và tab Google Flow")

        # Yêu cầu Extension tạo project trên tab Flow
        req_id = bridge.request_create_project(name=name.strip())
        if not req_id:
            raise RuntimeError("Không thể gửi yêu cầu tạo Project tới Extension")

        res = bridge.wait_project_result(req_id, timeout=35.0)
        if not res:
            raise TimeoutError("Hết thời gian chờ Extension tạo Project trên tab Google Flow")
        if not res.get("ok"):
            raise RuntimeError(res.get("error") or "Không thể tạo project trên Google Flow")

        flow_pid = res.get("flow_project_id", "").strip()
        if not flow_pid:
            raise RuntimeError("Không nhận được mã project ID từ Google Flow")

        if res.get("account_email"):
            account_email = res["account_email"]

    with SessionLocal() as db:
        # Hủy active các project cũ
        db.query(VeoProject).update({VeoProject.is_active: False})
        new_project = VeoProject(
            id=str(uuid.uuid4())[:12],
            name=name.strip() or f"Project {datetime.now().strftime('%d/%m %H:%M')}",
            flow_project_id=flow_pid,
            account_email=account_email,
            is_active=True,
            video_count=0,
        )
        db.add(new_project)
        db.commit()
        db.refresh(new_project)
        return _model_to_project_out(new_project)


def select_project(project_id: str) -> VeoProjectOut:
    """Chọn project làm việc (kích hoạt is_active) và đồng bộ tab Chrome tương ứng."""
    init_db()
    with SessionLocal() as db:
        p = db.query(VeoProject).filter(
            (VeoProject.id == project_id) | (VeoProject.flow_project_id == project_id)
        ).first()
        if not p:
            raise ValueError(f"Project '{project_id}' không tồn tại")
        db.query(VeoProject).update({VeoProject.is_active: False})
        p.is_active = True
        db.commit()
        db.refresh(p)

        # Tự động gửi lệnh sang Chrome Extension để chuyển/mở tab dự án này
        if p.flow_project_id:
            try:
                bridge.request_switch_project(p.flow_project_id, p.account_email or "")
                logger.info("Queued switch_project for flow_project_id: %s", p.flow_project_id)
            except Exception as ex:
                logger.warning("Failed to queue switch_project: %s", ex)

        return _model_to_project_out(p)


def delete_project(project_id: str) -> bool:
    """Xóa project khỏi SQLite DB."""
    init_db()
    with SessionLocal() as db:
        p = db.query(VeoProject).filter(
            (VeoProject.id == project_id) | (VeoProject.flow_project_id == project_id)
        ).first()
        if not p:
            return False
        was_active = p.is_active
        db.delete(p)
        db.commit()
        if was_active:
            next_p = db.query(VeoProject).order_by(VeoProject.created_at.desc()).first()
            if next_p:
                next_p.is_active = True
                db.commit()
        return True


def _increment_project_video_count(project_id: str) -> None:
    try:
        init_db()
        with SessionLocal() as db:
            p = db.query(VeoProject).filter(
                (VeoProject.id == project_id) | (VeoProject.flow_project_id == project_id)
            ).first()
            if p:
                p.video_count = (p.video_count or 0) + 1
                db.commit()
    except Exception as e:
        logger.warning("Failed to increment video count for project %s: %s", project_id, e)


# ─────────────────────────────────────────────────────────────────────────────
# Job Management
# ─────────────────────────────────────────────────────────────────────────────

_ACTIVE_JOB_STATUSES = {
    JobStatus.PENDING.value,
    JobStatus.CAPTCHA.value,
    JobStatus.SUBMITTING.value,
    JobStatus.GENERATING.value,
    JobStatus.DOWNLOADING.value,
}


def _job_request_fingerprint(request: VeoJobRequest, project_id: str) -> str:
    """Tạo fingerprint ổn định để chặn cùng payload bị submit đồng thời."""
    payload = request.model_dump(mode="json", exclude={"idempotency_key"})
    payload["resolved_project_id"] = project_id
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _find_duplicate_job(
    *,
    idempotency_key: str | None,
    request_fingerprint: str,
) -> dict[str, Any] | None:
    """Tìm job cùng request còn sống hoặc cùng idempotency key đã từng tạo."""
    for job in _jobs.values():
        if idempotency_key and job.get("idempotency_key") == idempotency_key:
            return job
        if (
            job.get("request_fingerprint") == request_fingerprint
            and job.get("status") in _ACTIVE_JOB_STATUSES
        ):
            return job
    return None

def submit_job(request: VeoJobRequest) -> VeoJobOut:
    """Tạo job mới và bắt đầu xử lý async. Bắt buộc phải có project được chọn."""
    active_proj = None
    if getattr(request, "project_id", None):
        active_proj = get_project(request.project_id)
    if not active_proj:
        active_proj = get_active_project()

    if not active_proj:
        raise ValueError("Vui lòng tạo hoặc chọn một Project trước khi sử dụng Veo")

    request_fingerprint = _job_request_fingerprint(request, active_proj.id)
    idempotency_key = (request.idempotency_key or "").strip() or None

    # Validate chế độ Khung hình (Frames) theo chuẩn Google Flow
    if getattr(request.input_mode, "value", str(request.input_mode)) == "frames":
        if request.end_image_path and not request.image_path:
            raise ValueError("Chế độ Khung hình (Frames): Khung hình kết thúc (End Frame) yêu cầu phải có Khung hình bắt đầu (Start Frame).")
        if not request.image_path and not request.end_image_path:
            raise ValueError("Chế độ Khung hình (Frames): Vui lòng chọn ít nhất Khung hình bắt đầu (Start Frame).")

    # Validate & đồng bộ hóa chế độ Thành phần (Ingredients) theo chuẩn Google Flow UI
    if getattr(request.input_mode, "value", str(request.input_mode)) == "ingredients":
        if not request.ingredient_image_paths and request.image_path:
            request.ingredient_image_paths = [request.image_path]
            if request.end_image_path:
                request.ingredient_image_paths.append(request.end_image_path)
        if request.ingredient_media_ids or not 1 <= len(request.ingredient_image_paths or []) <= 3:
            raise ValueError("Ingredients yêu cầu 1–3 file ảnh; hãy chọn ảnh từ máy hoặc thư viện app.")
        request.image_path = None
        request.end_image_path = None

    if getattr(request.input_mode, "value", str(request.input_mode)) == "video_edit":
        if not request.ingredient_image_paths and request.image_path:
            request.ingredient_image_paths = [request.image_path]
        request.image_path = None
        request.end_image_path = None
        if not (request.reference_video_id or "").strip():
            raise ValueError("Video edit mode requires an uploaded reference_video_id")
        end_seconds = request.reference_video_end_seconds or request.reference_video_start_seconds + 10
        if end_seconds <= request.reference_video_start_seconds:
            raise ValueError("Reference video end time must be after its start time")
        if end_seconds - request.reference_video_start_seconds > 10:
            raise ValueError("Flow video references support clips up to 10 seconds")

    job_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    job = {
        "job_id": job_id,
        "project_id": active_proj.id,
        "flow_project_id": active_proj.flow_project_id,
        "idempotency_key": idempotency_key,
        "request_fingerprint": request_fingerprint,
        "status": JobStatus.PENDING.value,
        "input_mode": request.input_mode.value,
        "prompt": request.prompt,
        "model_display_name": request.model_display_name,
        "aspect_ratio": request.aspect_ratio.value,
        "duration_seconds": request.duration_seconds,
        "resolution": request.resolution,
        "num_outputs": request.num_outputs,
        "seed": request.seed,
        "image_path": request.image_path,
        "end_image_path": request.end_image_path,
        "ingredient_image_paths": request.ingredient_image_paths or [],
        "ingredient_media_ids": request.ingredient_media_ids or [],
        "reference_video_id": request.reference_video_id,
        "reference_video_start_seconds": request.reference_video_start_seconds,
        "reference_video_end_seconds": request.reference_video_end_seconds,
        "force_fresh_assets": request.force_fresh_assets,
        "created_at": now,
        "updated_at": now,
    }

    # Fail before persisting, starting a worker, or sending any paid Flow request.
    # The worker validates again so removed files cannot cause a text-only render.
    _build_verified_flow_request(job)
    # Check-and-insert phải nằm cùng một lock; nếu không hai POST song song
    # đều có thể vượt qua check rồi cùng tạo hai render trả phí.
    with _jobs_lock:
        duplicate = _find_duplicate_job(
            idempotency_key=idempotency_key,
            request_fingerprint=request_fingerprint,
        )
        if duplicate:
            logger.warning(
                "Duplicate Veo submit suppressed: existing_job=%s key=%s fingerprint=%s",
                duplicate.get("job_id"),
                bool(idempotency_key),
                request_fingerprint[:12],
            )
            return _job_to_out(duplicate, deduplicated=True)
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

    import random
    # Jitter delay để tránh nhiều job kích hoạt Flow API cùng lúc, giảm nguy cơ PUBLIC_ERROR_UNUSUAL_ACTIVITY
    startup_jitter = random.uniform(2.0, 6.0)
    logger.info("Job %s: startup jitter delay %.1fs", job_id, startup_jitter)
    time.sleep(startup_jitter)

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

        is_native_ui_mode = job.get("input_mode") in ("frames", "ingredients", "video_edit")
        if not is_native_ui_mode:
            result = bridge.wait_captcha_result(request_id, timeout=30.0)
            if not result or not result.get("token"):
                error_msg = result.get("error", "Timeout") if result else "Timeout chờ token reCAPTCHA"
                _update_job(job, JobStatus.ERROR, error=f"Giải reCAPTCHA thất bại: {error_msg}")
                return
            _update_job(job, JobStatus.GENERATING, "Flow đã nhận token; đang tạo video...")
        else:
            step_msg = (
                "Đang đưa video & ảnh tham chiếu lên Flow..."
                if job.get("input_mode") == "video_edit"
                else "Đang đưa ảnh lên Flow và tạo video..."
            )
            _update_job(job, JobStatus.GENERATING, step_msg)
        flow_timeout = 1080.0 if job.get("input_mode") in ("ingredients", "video_edit") else (780.0 if job.get("input_mode") == "frames" else 630.0)
        flow_envelope = bridge.wait_flow_result(request_id, timeout=flow_timeout)
        if not flow_envelope:
            _update_job(job, JobStatus.ERROR, error="Timeout chờ kết quả Google Flow")
            return
        if flow_envelope.get("error"):
            flow_error = str(flow_envelope["error"])
            if "no result" in flow_error.lower() and "scene recovery:" not in flow_error.lower():
                if _try_recover_completed_scene(job):
                    return
            _update_job(job, JobStatus.ERROR, error=f"Google Flow: {flow_error}")
            return
        flow_result = flow_envelope.get("result") or {}
        if not flow_result.get("ok") or not flow_result.get("video_url"):
            flow_error = str(flow_result.get("error") or "response không hợp lệ")
            if "no result" in flow_error.lower() and "scene recovery:" not in flow_error.lower():
                if _try_recover_completed_scene(job):
                    return
            _update_job(
                job, JobStatus.ERROR,
                error=f"Google Flow không trả video: {flow_error}",
            )
            return

        _update_job(job, JobStatus.DOWNLOADING, "Đang tải video từ Flow...")
        output_path = _download_flow_video(job, flow_result)
        job["output_files"] = [output_path.name]
        job["provider_media_id"] = flow_result.get("media_id")
        job["provider_model_id"] = flow_result.get("provider_model_id")
        _update_job(job, JobStatus.DONE, "Hoàn tất — video đã lưu vào máy")
        if job.get("project_id"):
            _increment_project_video_count(job["project_id"])

    except Exception as e:
        logger.exception("Job %s failed: %s", job_id, e)
        _update_job(job, JobStatus.ERROR, error=f"Lỗi không xác định: {str(e)}")


def _encode_image_file(path_str: str | None) -> dict[str, Any] | None:
    """Đọc file ảnh từ đĩa và mã hóa base64 kèm MIME type."""
    if not path_str:
        return None
    p = Path(path_str)
    if not p.is_absolute() and (_BASE_DIR / p).is_file():
        p = _BASE_DIR / p
    if not p.is_file() and p.parent == Path("."):
        for candidate_dir in (_VEO_UPLOADS_DIR, _VEO_IMAGES_DIR, _VEO_DATA_DIR):
            candidate = candidate_dir / p.name
            if candidate.exists() and candidate.is_file():
                p = candidate
                break
    if not p.exists() or not p.is_file():
        raise ValueError(f"Image file not found: {path_str}")
    try:
        data = p.read_bytes()
        if not data:
            raise ValueError(f"Image file is empty: {path_str}")
        mime, _ = mimetypes.guess_type(str(p))
        if not mime:
            mime = "image/jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else "image/png"
        width, height = None, None
        try:
            import io
            from PIL import Image
            with Image.open(io.BytesIO(data)) as img:
                width, height = img.size
        except Exception:
            pass
        return {
            "base64": base64.b64encode(data).decode("utf-8"),
            "mime": mime,
            "filename": p.name,
            "local_path": str(p.resolve()),
            "size": len(data),
            "width": width,
            "height": height,
        }
    except Exception as e:
        raise ValueError(f"Cannot read image file {path_str}: {e}") from e


def _resolve_provider_model_id(job: dict[str, Any]) -> str:
    """Xác định mã model ID gửi tới Google Flow theo model, thời lượng, tỉ lệ và input mode."""
    model_name = (job.get("model_display_name") or "Omni 1.1 Flash").lower()
    dur = int(job.get("duration_seconds") or 6)
    aspect = job.get("aspect_ratio") or "16:9"
    is_portrait = (aspect == "9:16")
    input_mode = (job.get("input_mode") or "text_to_video").lower()
    is_frames = (input_mode == "frames")
    is_ingredients = (input_mode == "ingredients")

    if input_mode == "video_edit":
        return "abra_edit_360p" if (job.get("resolution") or "720p").lower() == "360p" else "abra_edit"

    if is_frames:
        has_start = bool(job.get("image_path"))
        has_end = bool(job.get("end_image_path"))
        if has_start and has_end:
            # Google Flow chỉ hỗ trợ 8s hoặc 10s cho 2 frames interpolation (HAR flow.google_1.har / flow.google_2.har.com)
            frame_dur = 10 if dur >= 10 else (8 if dur >= 8 else 6)
            return f"omni_flash_i2v_{frame_dur}s_first_last"
        r2v_dur = dur if dur in (4, 6, 8, 10) else (8 if dur >= 8 else 6)
        return f"abra_i2v_{r2v_dur}s"

    if "omni" in model_name or "flash" in model_name:
        dur_mapped = dur if dur in (4, 6, 8, 10) else 6
        if is_ingredients:
            r2v_dur = dur if dur in (4, 6, 8, 10) else (8 if dur >= 8 else 6)
            return f"abra_r2v_{r2v_dur}s"
        return f"abra_t2v_{dur_mapped}s"

    if "quality" in model_name:
        if is_frames:
            return "veo_3_1_i2v_quality_portrait" if is_portrait else "veo_3_1_i2v_quality"
        return "veo_3_1_t2v_quality_portrait" if is_portrait else "veo_3_1_t2v_quality"

    if "fast" in model_name:
        if is_frames:
            return "veo_3_1_i2v_fast_portrait" if is_portrait else "veo_3_1_i2v_fast"
        return "veo_3_1_t2v_fast_portrait" if is_portrait else "veo_3_1_t2v_fast"

    # Default: Veo 3.1 - Lite / Fallback
    return "veo_3_1_i2v_lite" if is_frames else "veo_3_1_t2v_lite"


def _build_verified_flow_request(job: dict[str, Any]) -> dict[str, Any]:
    """Chuẩn hóa cấu hình gửi tới Google Flow với thời lượng, tỉ lệ, base64 frames và model ID động."""
    dur = int(job.get("duration_seconds") or 6)
    aspect = job.get("aspect_ratio") or "16:9"
    model_name = job.get("model_display_name") or "Omni 1.1 Flash"
    res = job.get("resolution") or "720p"
    mode = job.get("input_mode") or "text_to_video"
    if mode not in ("text_to_video", "frames", "ingredients", "video_edit"):
        raise ValueError(f"Unsupported input_mode: {mode}")
    if mode in ("frames", "ingredients"):
        if model_name != "Omni 1.1 Flash" or res != "720p" or int(job.get("num_outputs") or 1) != 1:
            raise ValueError(f"Chế độ {mode} hiện hỗ trợ Omni 1.1 Flash, 720p, một video mỗi lượt.")
        if mode == "frames" and job.get("end_image_path") and dur not in (6, 8, 10):
            raise ValueError("Hai khung hình đầu–cuối yêu cầu thời lượng 6, 8 hoặc 10 giây.")
    provider_model_id = _resolve_provider_model_id(job)
    force_fresh_assets = bool(job.get("force_fresh_assets"))

    from app.veo import media_registry

    target_project_id = str(job.get("flow_project_id") or job.get("project_id") or "").strip()

    ingredient_media_ids = [
        str(media_id).strip()
        for media_id in (job.get("ingredient_media_ids") or [])
        if str(media_id).strip()
    ]

    if mode == "ingredients":
        paths = job.get("ingredient_image_paths") or []
        if not paths and job.get("image_path"):
            paths = [job["image_path"]]
            if job.get("end_image_path"):
                paths.append(job["end_image_path"])
            job["ingredient_image_paths"] = paths
        if ingredient_media_ids or not 1 <= len(paths) <= 3:
            raise ValueError("Ingredients yêu cầu 1–3 file ảnh, không dùng Start/End Frame hoặc mã ảnh rời.")
    elif mode == "video_edit":
        if not job.get("ingredient_image_paths") and job.get("image_path"):
            job["ingredient_image_paths"] = [job["image_path"]]

    # Deduplication cho ingredient_image_paths:
    # Nếu ảnh đã từng upload lên project này, lấy thẳng media_id, bỏ qua encode base64
    ingredient_data_list = []
    ingredient_inputs = [{"media_id": mid} for mid in ingredient_media_ids]
    for ipath in (job.get("ingredient_image_paths") or []):
        cached_mid = None
        try:
            p = Path(ipath)
            if mode != "ingredients" and p.is_file() and target_project_id and not force_fresh_assets:
                ihash = media_registry.compute_file_sha256(p)
                cached_mid = media_registry.get_cached_media_id(target_project_id, ihash)
        except Exception as e:
            logger.debug("Không thể tra cứu media_registry cho %s: %s", ipath, e)

        if cached_mid:
            if cached_mid not in ingredient_media_ids:
                ingredient_media_ids.append(cached_mid)
            ingredient_inputs.append({"media_id": cached_mid})
            logger.info(
                "[Deduplication] Tái sử dụng media_id=%s cho ảnh nguyên liệu %s (bỏ qua upload base64)",
                cached_mid,
                Path(ipath).name,
            )
            continue

        enc = _encode_image_file(ipath)
        if not enc:
            raise ValueError("Ingredient image path is required")
        ingredient_data_list.append(enc)
        ingredient_inputs.append({"local_path": enc["local_path"], "filename": enc["filename"]})

    start_frame_data = _encode_image_file(job.get("image_path")) if mode not in ("ingredients", "video_edit") else None
    end_frame_data = _encode_image_file(job.get("end_image_path")) if mode not in ("ingredients", "video_edit") else None

    # Deduplication cho reference_video_id:
    reference_video_id = str(job.get("reference_video_id") or "").strip()
    if not reference_video_id and job.get("reference_video_path") and target_project_id and not force_fresh_assets:
        try:
            vp = Path(job["reference_video_path"])
            if vp.is_file():
                vhash = media_registry.compute_file_sha256(vp)
                cached_vid = media_registry.get_cached_media_id(target_project_id, vhash)
                if cached_vid:
                    reference_video_id = cached_vid
                    logger.info(
                        "[Deduplication] Tự động tái sử dụng reference_video_id=%s cho video tham chiếu %s",
                        cached_vid,
                        vp.name,
                    )
        except Exception as e:
            logger.debug("Không thể tra cứu reference_video registry: %s", e)

    reference_video_start_seconds = float(job.get("reference_video_start_seconds") or 0)
    raw_reference_end = job.get("reference_video_end_seconds")
    reference_video_end_seconds = (
        float(raw_reference_end)
        if raw_reference_end is not None
        else reference_video_start_seconds + 10
    )

    if mode in ("ingredients", "video_edit") and not ingredient_inputs and not ingredient_data_list and start_frame_data:
        ingredient_data_list.append(start_frame_data)
        ingredient_inputs.append({"local_path": start_frame_data["local_path"], "filename": start_frame_data["filename"]})

    if mode == "ingredients" and not ingredient_data_list and not ingredient_media_ids:
        raise ValueError("Ingredients mode requires at least one readable image or uploaded media ID")
    elif mode == "video_edit":
        if not reference_video_id:
            raise ValueError("Video edit mode requires an uploaded reference_video_id")
        if res not in ("360p", "720p"):
            raise ValueError("Video edit mode supports only 360p or 720p generation")
        if int(job.get("num_outputs") or 1) != 1:
            raise ValueError("Video edit adapter currently supports exactly one output")
        if reference_video_start_seconds < 0 or reference_video_end_seconds <= reference_video_start_seconds:
            raise ValueError("Reference video trim range is invalid")
        if reference_video_end_seconds - reference_video_start_seconds > 10:
            raise ValueError("Flow video references support clips up to 10 seconds")
        media_info = media_registry.get_media_info_by_id(reference_video_id)
        if media_info and media_info.get("duration", 0) > 0:
            actual_dur = float(media_info["duration"])
            if reference_video_end_seconds > actual_dur:
                logger.info(
                    "[FlowJob] reference_video_end_seconds (%.2f) vượt quá thời lượng video thực tế (%.2f). Tự động hạ xuống %.2f",
                    reference_video_end_seconds, actual_dur, actual_dur,
                )
                reference_video_end_seconds = actual_dur
        reference_video_filename = (media_info.get("filename") if media_info else None) or (Path(job.get("reference_video_path", "")).name if job.get("reference_video_path") else None)
    elif mode == "frames":
        reference_video_filename = None
        if not start_frame_data:
            raise ValueError("Frames mode requires a readable Start Frame before an End Frame")
    else:
        reference_video_filename = None

    logger.info(
        "Chuẩn bị Flow request cho job %s: mode=%s, model=%s, provider_model_id=%s, duration=%ds, aspect=%s, has_start_frame=%s, has_end_frame=%s, num_ingredients=%d",
        job.get("job_id"),
        mode,
        model_name,
        provider_model_id,
        dur,
        aspect,
        bool(start_frame_data),
        bool(end_frame_data),
        len(ingredient_data_list) + len(ingredient_media_ids),
    )

    return {
        "prompt": job["prompt"],
        "project_id": job.get("flow_project_id") or job.get("project_id"),
        "input_mode": mode,
        "model_display_name": model_name,
        "provider_model_id": provider_model_id,
        "duration_seconds": (
            (10 if dur >= 10 else (8 if dur >= 8 else 6))
            if provider_model_id.startswith("omni_flash_i2v_")
            else (dur)
        ),
        "resolution": res,
        "aspect_ratio": aspect,
        "num_outputs": job.get("num_outputs") or 1,
        "image_path": job.get("image_path"),
        "end_image_path": job.get("end_image_path"),
        "ingredient_image_paths": job.get("ingredient_image_paths") or [],
        "ingredient_media_ids": ingredient_media_ids,
        "ingredient_inputs": ingredient_inputs,
        "reference_video_id": reference_video_id or None,
        "reference_video_filename": reference_video_filename,
        "reference_video_start_seconds": reference_video_start_seconds,
        "reference_video_end_seconds": reference_video_end_seconds,
        "force_fresh_assets": force_fresh_assets,
        # Base64 encoded payload cho Extension tải lên Google Flow kèm kích thước pixel
        "image_base64": start_frame_data["base64"] if start_frame_data else None,
        "image_mime": start_frame_data["mime"] if start_frame_data else None,
        "image_name": start_frame_data["filename"] if start_frame_data else None,
        "image_width": start_frame_data.get("width") if start_frame_data else None,
        "image_height": start_frame_data.get("height") if start_frame_data else None,
        "end_image_base64": end_frame_data["base64"] if end_frame_data else None,
        "end_image_mime": end_frame_data["mime"] if end_frame_data else None,
        "end_image_name": end_frame_data["filename"] if end_frame_data else None,
        "image_local_path": start_frame_data["local_path"] if start_frame_data else None,
        "end_image_local_path": end_frame_data["local_path"] if end_frame_data else None,
        "end_image_width": end_frame_data.get("width") if end_frame_data else None,
        "end_image_height": end_frame_data.get("height") if end_frame_data else None,
        "ingredient_images": ([{k: v for k, v in image.items() if k != "base64"} for image in ingredient_data_list]
                              if mode == "ingredients" else ingredient_data_list),
    }


def _download_flow_video(job: dict[str, Any], flow_result: dict[str, Any]) -> Path:
    """Download a signed result URL to an atomic local file and write metadata."""
    url = str(flow_result.get("video_url") or "")
    logger.info("Downloading video for job %s, media=%s", job.get("job_id"), flow_result.get("media_id"))
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
        "ingredient_image_paths": job.get("ingredient_image_paths") or [],
        "generation_diagnostics": {k: v for k, v in (flow_result.get("diagnostics") or {}).items()
                                   if k in ("adapter", "rpc", "ingredient_media_ids", "start_media_id", "end_media_id", "scene_id", "prompt_verified")},
        "reference_video_id": job.get("reference_video_id"),
        "reference_video_start_seconds": job.get("reference_video_start_seconds", 0),
        "reference_video_end_seconds": job.get("reference_video_end_seconds"),
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


def _try_recover_completed_scene(job: dict[str, Any]) -> bool:
    """Recover a Flow media card when the generation adapter lost its result."""
    request_id = bridge.request_flow_recovery(
        provider_model_id=str(job.get("provider_model_id") or ""),
        project_id=str(job.get("flow_project_id") or ""),
    )
    if not request_id:
        logger.warning("Job %s: unable to enqueue Flow scene recovery", job.get("job_id"))
        return False

    envelope = bridge.wait_flow_result(request_id, timeout=45.0)
    if not envelope or envelope.get("error"):
        logger.info(
            "Job %s: Flow scene recovery returned no usable envelope: %s",
            job.get("job_id"),
            (envelope or {}).get("error") if envelope else "timeout",
        )
        return False

    result = envelope.get("result") or {}
    if not result.get("video_url"):
        return False

    try:
        _update_job(job, JobStatus.DOWNLOADING, "Đang tải video đã hoàn tất từ Flow...")
        output_path = _download_flow_video(job, result)
        job["output_files"] = [output_path.name]
        job["provider_media_id"] = result.get("media_id")
        job["provider_model_id"] = result.get("provider_model_id") or job.get("provider_model_id")
        _update_job(job, JobStatus.DONE, "Hoàn tất — đã khôi phục video từ Flow")
        if job.get("project_id"):
            _increment_project_video_count(job["project_id"])
        logger.info("Job %s recovered completed Flow scene", job.get("job_id"))
        return True
    except Exception:
        logger.exception("Job %s: recovered Flow URL could not be downloaded", job.get("job_id"))
        return False


def _recover_current_scene(job_id: str) -> None:
    job = _jobs.get(job_id)
    if not job:
        return
    try:
        _update_job(job, JobStatus.DOWNLOADING, "Đang lấy video từ scene Flow đã hoàn tất...")
        request_id = bridge.request_flow_recovery(
            provider_model_id=str(job.get("provider_model_id") or ""),
            project_id=str(job.get("flow_project_id") or ""),
        )
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
        job["output_files"] = [output_path.name]
        job["provider_media_id"] = result.get("media_id")
        job["provider_model_id"] = result.get("provider_model_id") or "abra_t2v_6s"
        _update_job(job, JobStatus.DONE, "Hoàn tất — video đã khôi phục và lưu vào máy")
    except Exception as exc:
        logger.exception("Job %s recovery failed: %s", job_id, exc)
        _update_job(job, JobStatus.ERROR, error=f"Khôi phục Flow thất bại: {exc}")


def _classify_job_error(error: str, previous_status: str | None = None) -> dict[str, Any]:
    """Return stable, UI-friendly metadata without hiding the provider's raw error."""
    message = (error or "").lower()

    if "bridge server" in message:
        return {
            "error_code": "BRIDGE_OFFLINE",
            "error_stage": "connection",
            "error_hint": "Khởi động lại Backend/Bridge rồi kiểm tra trạng thái kết nối trước khi thử lại.",
            "error_retryable": True,
        }
    if "extension" in message and ("chưa kết nối" in message or "không thể gửi" in message):
        return {
            "error_code": "EXTENSION_DISCONNECTED",
            "error_stage": "connection",
            "error_hint": "Mở Google Flow trong Chrome, bật FlowsVeo-Clean và chờ extension báo đã kết nối.",
            "error_retryable": True,
        }
    if "tài khoản google labs" in message or "đăng nhập" in message:
        return {
            "error_code": "FLOW_AUTH_REQUIRED",
            "error_stage": "authentication",
            "error_hint": "Đăng nhập đúng tài khoản Google Flow trong tab Chrome đang được extension sử dụng.",
            "error_retryable": True,
        }
    if "captcha" in message and ("queue" in message or "đang bận" in message):
        return {
            "error_code": "CAPTCHA_QUEUE_BUSY",
            "error_stage": "captcha",
            "error_hint": "Extension đang xử lý yêu cầu khác. Chờ một lúc rồi thử lại.",
            "error_retryable": True,
        }
    if "captcha" in message:
        return {
            "error_code": "CAPTCHA_FAILED",
            "error_stage": "captcha",
            "error_hint": "Giữ tab Google Flow mở, kiểm tra phiên đăng nhập và thử lại.",
            "error_retryable": True,
        }
    if "flow_ui:" in message and any(control in message for control in (
        "flow control not found:", "flow control was not found:",
        "flow control is covered:", "flow control is disabled:",
    )):
        return {
            "error_code": "FLOW_UI_CONTROL_MISSING",
            "error_stage": "generation",
            "error_hint": "Tải lại tab Google Flow, kiểm tra extension đã cập nhật rồi thử lại.",
            "error_retryable": True,
        }
    if "not found" in message or "không tìm thấy" in message or "empty" in message or "rỗng" in message:
        return {
            "error_code": "REFERENCE_INVALID",
            "error_stage": "reference_upload",
            "error_hint": "Chọn lại file tham chiếu còn tồn tại và upload lại trước khi chạy.",
            "error_retryable": True,
        }
    if "timeout" in message and ("google flow" in message or "kết quả" in message):
        return {
            "error_code": "FLOW_TIMEOUT",
            "error_stage": "generation",
            "error_hint": "Flow phản hồi quá lâu. Kiểm tra tab Flow; nếu chưa tạo video, hãy thử lại.",
            "error_retryable": True,
        }
    if "no result" in message or "không trả video" in message or "response không hợp lệ" in message:
        return {
            "error_code": "FLOW_EMPTY_RESULT",
            "error_stage": "generation",
            "error_hint": "Mở Flow kiểm tra scene hiện tại. Thử lại với prompt hoặc file tham chiếu khác nếu scene bị từ chối.",
            "error_retryable": True,
        }
    if "audio_filtered" in message:
        return {
            "error_code": "FLOW_AUDIO_FILTERED",
            "error_stage": "generation",
            "error_hint": (
                "Google Flow từ chối video tham chiếu do phát hiện âm thanh/nhạc nền bản quyền (AUDIO_FILTERED). "
                "Backend đã tự động kích hoạt chế độ tách bỏ âm thanh (mute) khi upload video để khắc phục triệt để lỗi này."
            ),
            "error_retryable": True,
        }
    if "render ended with status" in message:
        return {
            "error_code": "FLOW_RENDER_FAILED",
            "error_stage": "generation",
            "error_hint": (
                "Flow đã từ chối scene ở tầng render (Status 4). "
                "Nguyên nhân cốt lõi: Ảnh nhân vật cận mặt hoặc có biểu cảm không tự nhiên (thè lưỡi, nháy mắt, góc chụp quá hẹp) "
                "khiến AI không thể suy diễn dáng nhảy toàn thân hoặc vi phạm bộ lọc biến dạng khuôn mặt của Google. "
                "Giải pháp: Dùng ảnh chân dung chụp từ eo trở lên (tỉ lệ 9:16), hai mắt mở tự nhiên, nhìn thẳng để Flow render thành công 100%."
            ),
            "error_retryable": True,
        }
    if "google flow:" in message:
        return {
            "error_code": "FLOW_REJECTED",
            "error_stage": "generation",
            "error_hint": "Kiểm tra nội dung prompt, file tham chiếu, credits và cảnh báo trực tiếp trên Google Flow.",
            "error_retryable": True,
        }
    if previous_status == JobStatus.DOWNLOADING.value or "tải video" in message:
        return {
            "error_code": "DOWNLOAD_FAILED",
            "error_stage": "download",
            "error_hint": "Video có thể đã tạo xong trên Flow. Kiểm tra thư viện Flow hoặc dùng chức năng khôi phục scene.",
            "error_retryable": True,
        }
    if "server restart" in message:
        return {
            "error_code": "JOB_INTERRUPTED",
            "error_stage": "backend",
            "error_hint": "Backend đã khởi động lại khi job đang chạy. Kiểm tra Flow trước khi tạo lại để tránh tốn credits hai lần.",
            "error_retryable": True,
        }
    return {
        "error_code": "UNKNOWN_ERROR",
        "error_stage": previous_status or "unknown",
        "error_hint": "Xem chi tiết lỗi, kiểm tra Backend và tab Google Flow rồi thử lại.",
        "error_retryable": True,
    }


def _update_job(job: dict, status: JobStatus, step: str = "", error: str | None = None) -> None:
    """Cập nhật trạng thái job."""
    previous_status = job.get("status")
    job["status"] = status.value
    if step:
        job["current_step"] = step
    if error:
        job["error_message"] = error
        job["current_step"] = f"Lỗi: {error}"
        job.update(_classify_job_error(error, previous_status))
    elif status != JobStatus.ERROR:
        job["error_message"] = None
        job["error_code"] = None
        job["error_stage"] = None
        job["error_hint"] = None
        job["error_retryable"] = None
    job["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_jobs()


def _job_to_out(job: dict, deduplicated: bool = False) -> VeoJobOut:
    # Old jobs saved missing browser controls as invalid reference files.
    # Correct their API metadata without changing the historical job record.
    if job.get("status") == "error" and job.get("error_code") in (None, "REFERENCE_INVALID"):
        metadata = _classify_job_error(str(job.get("error_message") or ""))
        if metadata["error_code"] == "FLOW_UI_CONTROL_MISSING":
            job = {**job, **metadata}
    return VeoJobOut(
        job_id=job["job_id"],
        project_id=job.get("project_id"),
        flow_project_id=job.get("flow_project_id"),
        status=job.get("status", "pending"),
        input_mode=job.get("input_mode", "text_to_video"),
        prompt=job.get("prompt", ""),
        model_display_name=job.get("model_display_name", ""),
        aspect_ratio=job.get("aspect_ratio", "16:9"),
        duration_seconds=job.get("duration_seconds", 8),
        resolution=job.get("resolution", "720p"),
        num_outputs=job.get("num_outputs", 1),
        deduplicated=deduplicated,
        current_step=job.get("current_step", ""),
        error_message=job.get("error_message"),
        error_code=job.get("error_code"),
        error_stage=job.get("error_stage"),
        error_hint=job.get("error_hint"),
        error_retryable=job.get("error_retryable"),
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
    """Tìm file video theo ID hoặc tên file trong thư mục outputs."""
    clean_id = Path(video_id).stem
    for ext in (".mp4", ".webm", ".mkv"):
        path = _VEO_DATA_DIR / f"{clean_id}{ext}"
        if path.exists():
            return path
    try:
        direct = Path(video_id)
        if direct.exists() and direct.is_file():
            return direct
    except Exception:
        pass
    return None


def delete_video(video_id: str) -> bool:
    """Xóa video và metadata JSON sidecar."""
    path = get_video_path(video_id)
    if path:
        path.unlink(missing_ok=True)
        path.with_suffix(".json").unlink(missing_ok=True)
        return True
    return False


def extract_last_frame(video_id: str) -> dict:
    """Trích xuất frame cuối của video Veo để làm frame đầu cho phân cảnh tiếp theo."""
    path = get_video_path(video_id)
    if not path or not path.exists():
        raise FileNotFoundError(f"Không tìm thấy file video với ID '{video_id}'")

    clean_id = Path(video_id).stem
    _VEO_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    img_id = f"frame_final_{clean_id}"
    out_file = _VEO_IMAGES_DIR / f"{img_id}.jpg"

    # Đọc metadata sidecar nếu có
    meta_path = path.with_suffix(".json")
    meta: dict[str, Any] = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Decode the tail and overwrite one temporary image for every decoded frame.
    # -frames:v 1 after an approximate seek returns an earlier frame, not the last.
    if not (out_file.exists() and out_file.stat().st_size > 0
            and out_file.stat().st_mtime_ns >= path.stat().st_mtime_ns):
        temp_file = out_file.with_name(f"{out_file.stem}.{uuid.uuid4().hex}.tmp.jpg")
        try:
            for seek_args in (["-sseof", "-1"], []):
                cmd = ["ffmpeg", "-y", *seek_args, "-i", str(path),
                       "-map", "0:v:0", "-an", "-vsync", "0", "-q:v", "2",
                       "-update", "1", str(temp_file)]
                proc = subprocess.run(cmd, capture_output=True, text=True,
                                      encoding="utf-8", errors="replace", timeout=60)
                if proc.returncode == 0 and temp_file.exists() and temp_file.stat().st_size > 0:
                    temp_file.replace(out_file)
                    break
                temp_file.unlink(missing_ok=True)
            else:
                raise RuntimeError(f"FFmpeg không thể trích xuất frame cuối từ video '{video_id}': {(proc.stderr or '')[-300:]}")
        finally:
            temp_file.unlink(missing_ok=True)

    prompt = meta.get("prompt") or ""
    aspect_ratio = meta.get("aspect_ratio") or "9:16"
    model_display_name = meta.get("model_display_name") or "Google Veo"
    local_rel_path = str(out_file.relative_to(_BASE_DIR)).replace("\\", "/")

    target_project_id = meta.get("project_id") or ""
    if not target_project_id:
        job = _jobs.get(clean_id) or _jobs.get(video_id)
        if job and job.get("project_id"):
            target_project_id = job.get("project_id")
    if not target_project_id:
        try:
            with SessionLocal() as db:
                active_p = db.query(VeoProject).filter(VeoProject.is_active == True).first()
                if active_p:
                    target_project_id = active_p.id
        except Exception:
            pass

    # Lưu vào database VeoImage để hiển thị trong Thư viện ảnh Veo Studio
    try:
        with SessionLocal() as db:
            existing = db.query(VeoImage).filter(VeoImage.id == img_id).first()
            if existing:
                if target_project_id and existing.project_id != target_project_id:
                    existing.project_id = target_project_id
                    db.commit()
            else:
                new_img = VeoImage(
                    id=img_id,
                    prompt=f"[Frame cuối] {prompt}" if prompt else "Frame cuối phân cảnh",
                    model_display_name=model_display_name,
                    model_key="veo_last_frame",
                    aspect_ratio=aspect_ratio,
                    seed=None,
                    media_id=img_id,
                    image_url=f"/api/veo/images/{img_id}/file",
                    local_path=local_rel_path,
                    project_id=target_project_id,
                )
                db.add(new_img)
                db.commit()
    except Exception as e:
        logger.warning("Không thể lưu VeoImage vào database: %s", e)

    return {
        "ok": True,
        "image_id": img_id,
        "file_path": str(out_file.resolve()),
        "preview_url": f"/api/veo/images/{img_id}/file",
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "model_display_name": model_display_name,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Image Generation (Nano Banana - Pinhole)
# ─────────────────────────────────────────────────────────────────────────────

_image_download_locks_guard = threading.Lock()
_image_download_locks: dict[str, threading.Lock] = {}


def _get_image_download_lock(image_id: str) -> threading.Lock:
    """Return a stable per-image lock shared by background and on-demand downloads."""
    with _image_download_locks_guard:
        return _image_download_locks.setdefault(image_id, threading.Lock())


def _download_image_to_local(
    image_id: str,
    image_url: str,
    *,
    timeout: float = 25.0,
) -> Path | None:
    """Download a generated image once and publish it atomically."""
    parsed_url = urlparse(image_url or "")
    if parsed_url.scheme not in {"http", "https"}:
        return None

    local_file = _VEO_IMAGES_DIR / f"{image_id}.jpg"
    lock = _get_image_download_lock(image_id)
    with lock:
        if local_file.is_file() and local_file.stat().st_size > 0:
            return local_file

        temp_file = local_file.with_name(f".{local_file.name}.{uuid.uuid4().hex}.tmp")
        try:
            with requests.get(image_url, timeout=timeout, stream=True) as response:
                response.raise_for_status()
                with temp_file.open("wb") as output:
                    for chunk in response.iter_content(chunk_size=1024 * 256):
                        if chunk:
                            output.write(chunk)

            if not temp_file.is_file() or temp_file.stat().st_size <= 0:
                raise RuntimeError("Google Flow trả về file ảnh rỗng")
            os.replace(temp_file, local_file)
            return local_file
        except Exception as exc:
            logger.warning("Không thể tải ảnh %s về máy: %s", image_id, exc)
            return None
        finally:
            temp_file.unlink(missing_ok=True)


def ensure_image_file_path(image_id: str) -> Path | None:
    """Return a local image path, downloading the CDN asset when still pending."""
    existing = get_image_file_path(image_id)
    if existing:
        return existing

    image = get_image_by_id(image_id)
    if not image or not image.image_url:
        return None
    return _download_image_to_local(image_id, image.image_url)

def _model_to_image_item(img: VeoImage) -> VeoImageItem:
    return VeoImageItem(
        id=img.id,
        media_id=img.media_id,
        prompt=img.prompt,
        model_display_name=img.model_display_name,
        model_key=img.model_key,
        aspect_ratio=img.aspect_ratio,
        seed=img.seed,
        image_url=img.image_url,
        local_path=img.local_path,
        project_id=img.project_id,
        created_at=img.created_at.isoformat() if img.created_at else "",
    )


def generate_images(req: VeoImageGenerateRequest) -> VeoImageGenerateResponse:
    """Sinh ảnh từ prompt thông qua Google Flow Nano Banana (RPC ogiZ0b).

    Tách N biến thể thành N request qua bridge, mỗi request dùng CAPTCHA mới.
    HAR cũng hỗ trợ nhiều ảnh trong một RPC; gửi tuần tự giữ tiến độ hiện tại.
    Hỗ trợ partial success (2/3 ảnh ok vẫn trả về).
    """
    init_db()

    if not bridge.is_bridge_running():
        return VeoImageGenerateResponse(ok=False, error="Bridge Server không hoạt động")
    if not bridge.get_extension_info().get("connected"):
        return VeoImageGenerateResponse(ok=False, error="Extension chưa kết nối. Hãy mở Chrome và nạp FlowsVeo-Clean")

    target_flow_pid = ""
    project_db_id = ""
    with SessionLocal() as db:
        if req.project_id:
            p = db.query(VeoProject).filter(
                (VeoProject.id == req.project_id) | (VeoProject.flow_project_id == req.project_id)
            ).first()
        else:
            p = db.query(VeoProject).filter(VeoProject.is_active == True).first()
            if not p:
                p = db.query(VeoProject).order_by(VeoProject.created_at.desc()).first()
        if p:
            target_flow_pid = p.flow_project_id
            project_db_id = p.id

    if not target_flow_pid:
        return VeoImageGenerateResponse(ok=False, error="Không tìm thấy project Flow. Hãy chọn hoặc tạo project trước khi tạo ảnh")

    target_count = min(max(req.count, 1), 4)
    # Scene UUID dùng chung cho tất cả biến thể (giống Flow gốc)
    shared_scene_uuid = str(uuid.uuid4()).upper()

    raw_images: list[dict] = []
    errors: list[str] = []

    # 1. Native parallel generation attempt on Flow (e.g. x2, x4 in a single submit)
    flow_request = {
        "prompt": req.prompt.strip(),
        "aspect_ratio": req.aspect_ratio or "16:9",
        "model_key": req.model_key or "GEM_PIX_2",
        "model_display_name": req.model_display_name or "Nano Banana Pro",
        "count": target_count,
        "seed": req.seed,
        "project_id": target_flow_pid,
        "reference_image_ids": req.reference_image_ids or [],
        "scene_uuid": shared_scene_uuid,
    }

    req_id = bridge.request_generate_image(flow_request)
    if not req_id:
        return VeoImageGenerateResponse(ok=False, error="Bridge chưa sẵn sàng hoặc hàng đợi đầy")

    bridge_res = bridge.wait_image_result(req_id, timeout=180.0)
    if not bridge_res:
        return VeoImageGenerateResponse(ok=False, error="Timeout chờ Extension sinh ảnh (180s)")

    if not bridge_res.get("result") or not bridge_res["result"].get("ok"):
        err = (
            bridge_res.get("error")
            or (bridge_res.get("result") and bridge_res["result"].get("error"))
            or "Lỗi không xác định"
        )
        return VeoImageGenerateResponse(ok=False, error=str(err))

    first_batch_images = bridge_res["result"].get("images", [])
    raw_images.extend(first_batch_images)

    # 2. Resilient fallback: If Flow generated fewer than requested, generate remaining sequentially
    remaining = target_count - len(raw_images)
    for i in range(remaining):
        import random, time as _t
        cadence_delay = random.uniform(1.2, 2.0)
        logger.info("Generating remaining image %d/%d (delay: %.2fs)", len(raw_images) + 1, target_count, cadence_delay)
        _t.sleep(cadence_delay)

        sub_req = dict(flow_request)
        sub_req["count"] = 1
        sub_req["seed"] = (req.seed + len(raw_images)) if req.seed is not None else None

        sub_id = bridge.request_generate_image(sub_req)
        if not sub_id:
            break
        sub_res = bridge.wait_image_result(sub_id, timeout=180.0)
        if sub_res and sub_res.get("result") and sub_res["result"].get("ok"):
            raw_images.extend(sub_res["result"].get("images", []))
        else:
            if sub_res:
                err = sub_res.get("error") or (sub_res.get("result") and sub_res["result"].get("error"))
                if err:
                    errors.append(str(err))
            break

    if not raw_images:
        combined_err = "; ".join(errors) if errors else "Google Flow không trả về ảnh nào"
        return VeoImageGenerateResponse(ok=False, error=combined_err)

    # Lưu ảnh thành công vào DB & tải về local bất đồng bộ
    created_items: list[VeoImageItem] = []
    with SessionLocal() as db:
        for item in raw_images:
            img_id = str(uuid.uuid4())[:12]
            cdn_url = item.get("image_url", "")
            local_file = _VEO_IMAGES_DIR / f"{img_id}.jpg"
            local_rel_path = str(local_file.relative_to(_BASE_DIR)).replace("\\", "/")

            # Tải ảnh về ổ cứng ngầm (không chặn response trả về UI).
            # Helper dùng lock + atomic replace để an toàn khi endpoint download
            # đồng thời yêu cầu file ngay sau lúc ảnh vừa được tạo.
            if cdn_url:
                def _download_task(target_url=cdn_url, target_id=img_id):
                    _download_image_to_local(target_id, target_url)

                Thread(target=_download_task, daemon=True).start()

            new_img = VeoImage(
                id=img_id,
                prompt=req.prompt,
                model_display_name=req.model_display_name or "Nano Banana Pro",
                model_key=item.get("model_key", req.model_key),
                aspect_ratio=item.get("aspect_ratio", req.aspect_ratio),
                seed=item.get("seed", req.seed),
                media_id=item.get("media_id") or img_id,
                image_url=cdn_url,
                local_path=local_rel_path,
                project_id=project_db_id or target_flow_pid,
            )
            db.add(new_img)
            db.commit()
            db.refresh(new_img)
            created_items.append(_model_to_image_item(new_img))

    # Log partial success nếu có
    if errors:
        logger.warning(
            "Image generation partial success: %d/%d ok. Errors: %s",
            len(created_items), target_count, "; ".join(errors),
        )

    return VeoImageGenerateResponse(ok=True, images=created_items, error="; ".join(errors) if errors else None)


def list_images(project_id: str | None = None) -> list[VeoImageItem]:
    """Lấy danh sách ảnh đã tạo từ SQLite DB."""
    init_db()
    with SessionLocal() as db:
        q = db.query(VeoImage)
        if project_id:
            # Tìm project tương ứng để match cả DB ID lẫn Flow Project ID
            p = db.query(VeoProject).filter(
                (VeoProject.id == project_id) | (VeoProject.flow_project_id == project_id)
            ).first()
            match_ids = {project_id}
            if p:
                if p.id: match_ids.add(p.id)
                if p.flow_project_id: match_ids.add(p.flow_project_id)
            q = q.filter(
                (VeoImage.project_id.in_(list(match_ids)))
                | (VeoImage.project_id == "")
                | (VeoImage.project_id.is_(None))
            )
        images = q.order_by(VeoImage.created_at.desc()).limit(100).all()
        return [_model_to_image_item(img) for img in images]


def get_image_by_id(image_id: str) -> VeoImage | None:
    """Lấy thông tin bản ghi ảnh từ SQLite DB."""
    init_db()
    with SessionLocal() as db:
        return db.query(VeoImage).filter(VeoImage.id == image_id).first()


def delete_image(image_id: str) -> bool:
    """Xóa ảnh khỏi SQLite DB và xóa file local."""
    init_db()
    with SessionLocal() as db:
        img = db.query(VeoImage).filter(VeoImage.id == image_id).first()
        if not img:
            return False
        if img.local_path:
            local_file = _BASE_DIR / img.local_path
            local_file.unlink(missing_ok=True)
        db.delete(img)
        db.commit()
        return True


def get_image_file_path(image_id: str) -> Path | None:
    """Lấy đường dẫn file ảnh cục bộ nếu file đã có trên đĩa."""
    local_file = _VEO_IMAGES_DIR / f"{image_id}.jpg"
    if local_file.exists() and local_file.stat().st_size > 0:
        return local_file
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        candidate = _VEO_IMAGES_DIR / f"{image_id}{ext}"
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────────────────────────────────────

def startup() -> None:
    """Gọi khi FastAPI startup — khởi tạo jobs và Bridge."""
    init_db()
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
