"""Bản tải phụ của video đã ghép (khối 8): bản xóa watermark, bản không nhạc nền, hoặc cả hai.

Mỗi bản dựng lại ĐÚNG video đang chọn (cùng clip, giọng, phụ đề, kiểu dựng) với một thay đổi:
- xóa watermark: gwr chạy trên từng clip gốc rồi dựng lại (gwr không nhận ra logo trên video đã ghép vì đã crop/phóng);
- không nhạc nền: bỏ bước trộn nhạc, giữ tiếng đọc và phụ đề.
Chỉ tạo khi video đang chọn còn "mới" so với đầu vào hiện tại, để bản phụ không lệch nội dung so với video gốc.
Kết quả lưu ở campaigns/<id>/exports/<artifact_id>/<variant>.mp4: tạo một lần, lần sau tải ngay. 0 credit.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable

from . import graph
from .executors import assemble
from .runner import ExecContext

logger = logging.getLogger(__name__)

VARIANTS: dict[str, dict[str, Any]] = {
    "clean": {"clean": True, "no_bgm": False, "label": "Bản xóa watermark"},
    "no_bgm": {"clean": False, "no_bgm": True, "label": "Bản tách nhạc nền (không nhạc nền)"},
    "clean_no_bgm": {"clean": True, "no_bgm": True, "label": "Xóa watermark + không nhạc nền"},
}

_lock = threading.Lock()
_jobs: dict[tuple[str, str, str], dict[str, Any]] = {}       # (campaign, artifact, variant) -> {state, message, error}


class ExportError(ValueError):
    """Không tạo được bản phụ (chưa có video, video đã cũ, biến thể lạ...)."""


def _dir(svc: Any, cid: str, artifact_id: str) -> Path:
    return svc.store.campaign_dir(cid) / "exports" / artifact_id


def _current(svc: Any, cid: str) -> tuple[str, bool, dict[str, Any]]:
    """(id video đang chọn, còn mới không, meta). Không có video -> ExportError."""
    sd = graph.get_step("assemble")
    with svc.session() as s:
        svc._campaign(s, cid)
        art = svc.store.selected(s, cid, "assemble", "")
        if art is None or art.kind != "video":
            raise ExportError("Chưa có video đã ghép. Bấm “Ghép video” trước.")
        st = svc.engine.state_of(s, cid, sd, "", "final")
        from .store import ArtifactStore
        return art.id, st.state in ("fresh", "pinned"), ArtifactStore.meta(art)


def status(svc: Any, cid: str) -> dict[str, Any]:
    try:
        art_id, fresh, meta = _current(svc, cid)
    except ExportError as exc:
        return {"artifact_id": None, "fresh": False, "has_bgm": False, "variants": {}, "reason": str(exc)}
    out: dict[str, Any] = {}
    for key, v in VARIANTS.items():
        path = _dir(svc, cid, art_id) / f"{key}.mp4"
        job = _jobs.get((cid, art_id, key))
        if path.is_file():
            out[key] = {"state": "ready", "label": v["label"], "bytes": path.stat().st_size}
        elif job:
            out[key] = {"state": job["state"], "label": v["label"], "message": job.get("message", ""), "error": job.get("error", "")}
        else:
            out[key] = {"state": "none", "label": v["label"]}
    return {"artifact_id": art_id, "fresh": fresh, "has_bgm": bool(meta.get("bgm")),
            "watermark_removed": bool(meta.get("watermark_removed")), "variants": out,
            "reason": "" if fresh else "Video đang chọn đã cũ so với clip/lời thoại hiện tại: ghép lại trước khi tạo bản phụ."}


def start(svc: Any, cid: str, variant: str, executor: Callable[[ExecContext], Any] | None = None, wait: bool = False) -> dict[str, Any]:
    if variant not in VARIANTS:
        raise ExportError(f"Không có kiểu tải “{variant}”.")
    art_id, fresh, meta = _current(svc, cid)
    if not fresh:
        raise ExportError("Video đang chọn đã cũ so với clip/lời thoại hiện tại: ghép lại trước khi tạo bản phụ.")
    if VARIANTS[variant]["no_bgm"] and not meta.get("bgm"):
        raise ExportError("Video này không có nhạc nền nên không cần bản tách nhạc nền.")
    target = _dir(svc, cid, art_id) / f"{variant}.mp4"
    key = (cid, art_id, variant)
    with _lock:
        if target.is_file() or _jobs.get(key, {}).get("state") == "running":
            return status(svc, cid)
        _jobs[key] = {"state": "running", "message": "Đang chuẩn bị…", "started": time.time()}
    t = threading.Thread(target=_work, args=(svc, cid, art_id, variant, target, executor or assemble.run_assemble), daemon=True,
                         name=f"export-{cid}-{variant}")
    t.start()
    if wait:
        t.join()
    return status(svc, cid)


def _work(svc: Any, cid: str, art_id: str, variant: str, target: Path, executor: Callable[[ExecContext], Any]) -> None:
    key = (cid, art_id, variant)
    job = _jobs[key]
    try:
        sd = graph.get_step("assemble")
        with svc.session() as s:
            params = dict(svc.engine.get_params(s, cid, "assemble"))
            _, blockers, refs = svc.engine.current_parts(s, cid, sd, "", "final")
        if blockers:
            raise ExportError("Chưa đủ đầu vào: " + "; ".join(f"{b['dep']}: {b['reason']}" for b in blockers))
        v = VARIANTS[variant]
        params[assemble.EXPORT_CLEAN] = v["clean"]
        params[assemble.EXPORT_NO_BGM] = v["no_bgm"]
        ctx = ExecContext(campaign_id=cid, step_key="assemble", element_key="", tier="final", params=params, inputs=refs,
                          fingerprint=f"export:{variant}", note="", store=svc.store, set_external_ref=lambda r: None,
                          cancelled=lambda: False, report=lambda m: job.__setitem__("message", m))
        result = executor(ctx)
        data = result.artifacts[0].data
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(f".{target.stem}.part")
        tmp.write_bytes(data)
        os.replace(tmp, target)
        job.update(state="ready", message="Xong")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Tạo bản %s cho %s lỗi", variant, cid)
        job.update(state="error", error=str(exc)[:500])


def file_path(svc: Any, cid: str, variant: str) -> tuple[Path, str]:
    if variant not in VARIANTS:
        raise ExportError(f"Không có kiểu tải “{variant}”.")
    art_id, _, _ = _current(svc, cid)
    path = _dir(svc, cid, art_id) / f"{variant}.mp4"
    if not path.is_file():
        raise ExportError("Bản này chưa được tạo.")
    with svc.session() as s:
        name = svc._campaign(s, cid).name
    suffix = {"clean": "khong-watermark", "no_bgm": "khong-nhac-nen", "clean_no_bgm": "khong-watermark-khong-nhac"}[variant]
    return path, f"{name} - {suffix}.mp4"
