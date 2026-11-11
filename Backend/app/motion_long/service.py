"""Motion Control cho video mẫu dài: chia đoạn → tạo lần lượt trên Flow → ghép → (tuỳ chọn) xóa watermark.

Quy tắc an toàn credit (mỗi đoạn là một lượt tạo tính phí):
- Hàng đợi chạy TUẦN TỰ, đoạn nào lỗi thì DỪNG hàng đợi. Không bao giờ tự gửi lại; chạy lại là hành động của người dùng.
- Mỗi lượt gửi có khóa chống trùng riêng (job + đoạn + lần thử), nên một cú bấm đúp không tạo hai render.
- Trạng thái nằm trong Data/motion_long/<id>/job.json: tắt app giữa chừng vẫn nối lại được. Đoạn đã gửi sang Flow thì khi
  mở lại chỉ THEO DÕI job cũ, không gửi lại. Đoạn đang cắt/tải dở (chưa gửi) thì về "chờ" để người dùng chạy lại.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import merge as merge_mod
from . import plan as plan_mod

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[2] / "Data" / "motion_long"
MODEL = "Omni 1.2 Flash"
POLL_SECONDS = 3.0
JOB_TIMEOUT_SECONDS = 25 * 60
AUDIO_MODES = ("original", "bgm", "none")

BUSY_STATES = ("cutting", "uploading", "submitting", "generating")
WATCHING_STATES = ("submitting", "generating")        # đã có (hoặc sắp có) job bên Veo

_lock = threading.RLock()
_jobs: dict[str, dict[str, Any]] = {}
_workers: dict[str, threading.Thread] = {}
_stop_flags: set[str] = set()
_loaded = False


class LongMotionError(ValueError):
    """Lỗi đầu vào hoặc trạng thái không cho phép (hiện cho người dùng)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def job_dir(jid: str) -> Path:
    return DATA_DIR / jid


def _save(job: dict[str, Any]) -> None:
    job["updated_at"] = _now()
    path = job_dir(job["id"]) / "job.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(job, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def _load_all() -> None:
    global _loaded
    with _lock:
        if _loaded:
            return
        _loaded = True
        if not DATA_DIR.is_dir():
            return
        for path in DATA_DIR.glob("*/job.json"):
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
                _jobs[job["id"]] = job
            except Exception as exc:  # noqa: BLE001 - file hỏng không được làm sập cả danh sách
                logger.warning("[motion_long] Bỏ qua %s: %s", path, exc)
        for job in list(_jobs.values()):
            _recover(job)


def _recover(job: dict[str, Any]) -> None:
    """Sau khi backend khởi động lại: theo dõi tiếp job Veo đã gửi, đưa các bước dở dang (chưa gửi) về 'chờ'."""
    resume: list[int] = []
    for seg in job["segments"]:
        if seg["state"] in WATCHING_STATES and seg.get("veo_job_id"):
            resume.append(seg["index"])
        elif seg["state"] in BUSY_STATES or seg["state"] == "queued":
            seg["state"] = "idle"
            seg["note"] = "Bị gián đoạn khi backend khởi động lại trước khi gửi sang Flow; chưa tốn credit. Bấm tạo lại."
    if job.get("merge", {}).get("state") == "running":
        job["merge"] = {"state": "idle", "message": "Việc ghép bị gián đoạn; hãy ghép lại."}
    exp = job.get("exports", {}).get("clean")
    if exp and exp.get("state") == "running":
        job["exports"]["clean"] = {"state": "idle", "message": "Việc xóa watermark bị gián đoạn; hãy chạy lại."}
    _save(job)
    if resume:
        _start_worker(job["id"], resume, attach_only=True)


# ───────────────────────────── tạo và đọc ─────────────────────────────

def _clean_options(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw or {}
    audio = str(raw.get("audio") or "original")
    if audio not in AUDIO_MODES:
        raise LongMotionError("Âm thanh phải là 'original', 'bgm' hoặc 'none'.")
    return {
        "overlap": bool(raw.get("overlap", True)),
        "overlap_seconds": max(0.0, min(float(raw.get("overlap_seconds") or 1.0), plan_mod.MAX_OVERLAP)),
        "audio": audio,
        "bgm_track_id": (raw.get("bgm_track_id") or None),
        "bgm_volume": max(0.05, min(float(raw.get("bgm_volume") or 0.35), 0.8)),
        "crossfade": max(0.0, min(float(raw.get("crossfade") or merge_mod.DEFAULT_CROSSFADE), 1.0)),
        "project_mode": "active" if raw.get("project_mode") == "active" else "new",
    }


def preview_plan(duration: float, overlap: bool = True, overlap_seconds: float = 1.0) -> dict[str, Any]:
    try:
        segs = plan_mod.plan_segments(duration, overlap_seconds if overlap else 0.0)
    except plan_mod.PlanError as exc:
        raise LongMotionError(str(exc)) from exc
    return {"segments": segs, "overlaps": plan_mod.overlaps(segs), "credits": plan_mod.estimate_credits(segs)}


def create_job(source: Path, filename: str, *, prompt: str, image_paths: list[str], aspect_ratio: str | None = None,
               options: dict[str, Any] | None = None) -> dict[str, Any]:
    _load_all()
    prompt = (prompt or "").strip()
    if not prompt:
        raise LongMotionError("Prompt Motion Control không được để trống.")
    images = [str(p) for p in image_paths if p]
    if not 1 <= len(images) <= 3:
        raise LongMotionError("Cần 1–3 ảnh tham chiếu (nhân vật, bối cảnh).")
    for p in images:
        if not Path(p).is_file():
            raise LongMotionError(f"Không thấy ảnh tham chiếu: {Path(p).name}")
    opts = _clean_options(options)
    jid = uuid.uuid4().hex[:12]
    folder = job_dir(jid)
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / "source.mp4"
    shutil.copyfile(source, dest)
    try:
        info = merge_mod.probe(dest)
        segs = plan_mod.plan_segments(info["duration"], opts["overlap_seconds"] if opts["overlap"] else 0.0)
    except (merge_mod.MergeError, plan_mod.PlanError) as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise LongMotionError(str(exc)) from exc
    ratio = aspect_ratio if aspect_ratio in ("9:16", "16:9") else ("9:16" if info["height"] >= info["width"] else "16:9")
    job = {
        "id": jid, "created_at": _now(), "updated_at": _now(), "filename": filename or "video.mp4",
        "source": {"duration": info["duration"], "width": info["width"], "height": info["height"], "fps": info["fps"],
                   "has_audio": info["has_audio"]},
        "prompt": prompt, "image_paths": images, "aspect_ratio": ratio, "resolution": "720p", "options": opts,
        "project": None, "queue_running": False,
        "segments": [{**s, "state": "idle", "attempts": 0, "veo_job_id": None, "error": None, "note": None,
                      "output": None, "out_duration": None} for s in segs],
        "merge": {"state": "idle"}, "exports": {},
    }
    with _lock:
        _jobs[jid] = job
        _save(job)
    return public(job)


def public(job: dict[str, Any]) -> dict[str, Any]:
    """Bản trả cho giao diện: không lộ đường dẫn nội bộ."""
    out = {k: v for k, v in job.items() if k not in ("image_paths",)}
    out["images"] = [Path(p).name for p in job.get("image_paths", [])]
    out["credits"] = plan_mod.estimate_credits(job["segments"])
    out["credits_remaining"] = plan_mod.FLOW_CREDIT_PER_SEGMENT * sum(1 for s in job["segments"] if s["state"] != "done")
    out["overlaps"] = plan_mod.overlaps(job["segments"])
    out["worker_alive"] = _worker_alive(job["id"])
    f = job_dir(job["id"]) / "final.mp4"
    out["final_ready"] = f.is_file()
    out["clean_ready"] = (job_dir(job["id"]) / "final_clean.mp4").is_file()
    return out


def get_job(jid: str) -> dict[str, Any]:
    _load_all()
    job = _jobs.get(jid)
    if not job:
        raise LongMotionError("Không tìm thấy lượt Motion dài này.")
    return job


def list_jobs() -> list[dict[str, Any]]:
    _load_all()
    return [public(j) for j in sorted(_jobs.values(), key=lambda j: j["created_at"], reverse=True)]


def delete_job(jid: str) -> None:
    job = get_job(jid)
    if _worker_alive(jid) or any(s["state"] in BUSY_STATES for s in job["segments"]):
        raise LongMotionError("Đang có đoạn chạy; hãy đợi xong hoặc dừng hàng đợi trước khi xóa.")
    with _lock:
        _jobs.pop(jid, None)
    shutil.rmtree(job_dir(jid), ignore_errors=True)


# ───────────────────────────── hàng đợi tạo đoạn ─────────────────────────────

def _worker_alive(jid: str) -> bool:
    t = _workers.get(jid)
    return bool(t and t.is_alive())


def _set_segment(job: dict[str, Any], index: int, **fields: Any) -> None:
    with _lock:
        job["segments"][index].update(fields)
        _save(job)


def start_queue(jid: str, indices: list[int] | None = None) -> dict[str, Any]:
    """Chạy các đoạn (mặc định: mọi đoạn chưa xong) lần lượt. Đoạn đã xong chỉ chạy lại khi được chỉ định rõ."""
    job = get_job(jid)
    with _lock:
        if _worker_alive(jid):
            raise LongMotionError("Hàng đợi đang chạy. Đợi xong hoặc bấm Dừng.")
        if any(s["state"] in BUSY_STATES for s in job["segments"]):
            raise LongMotionError("Có đoạn đang xử lý trên Flow; đợi đoạn đó xong.")
        if indices is None:
            todo = [s["index"] for s in job["segments"] if s["state"] != "done"]
        else:
            todo = sorted({int(i) for i in indices})
            for i in todo:
                if not 0 <= i < len(job["segments"]):
                    raise LongMotionError(f"Không có đoạn {i + 1}.")
        if not todo:
            raise LongMotionError("Mọi đoạn đã xong. Bấm Ghép video, hoặc chọn một đoạn để tạo lại.")
        for i in todo:
            job["segments"][i].update(state="queued", error=None, note=None)
        _save(job)
    _stop_flags.discard(jid)
    _start_worker(jid, todo)
    return public(job)


def stop_queue(jid: str) -> dict[str, Any]:
    """Không chạy thêm đoạn nào sau đoạn hiện tại (đoạn đang render trên Flow vẫn chạy tiếp, không hủy được)."""
    job = get_job(jid)
    _stop_flags.add(jid)
    with _lock:
        for seg in job["segments"]:
            if seg["state"] == "queued":
                seg["state"] = "idle"
                seg["note"] = "Đã dừng hàng đợi."
        _save(job)
    return public(job)


def _start_worker(jid: str, indices: list[int], attach_only: bool = False) -> None:
    t = threading.Thread(target=_worker, args=(jid, indices, attach_only), daemon=True, name=f"motion-long-{jid}")
    _workers[jid] = t
    t.start()


def _worker(jid: str, indices: list[int], attach_only: bool) -> None:
    job = _jobs[jid]
    try:
        with _lock:
            job["queue_running"] = True
            _save(job)
        for i in indices:
            if jid in _stop_flags:
                break
            ok = _attach_segment(job, i) if attach_only else _run_segment(job, i)
            if not ok:
                break          # đoạn lỗi: dừng hàng đợi, chờ người dùng quyết định
    except Exception as exc:  # noqa: BLE001
        logger.exception("[motion_long] worker %s lỗi", jid)
        for seg in job["segments"]:
            if seg["state"] in ("queued",) + BUSY_STATES and not seg.get("veo_job_id"):
                _set_segment(job, seg["index"], state="error", error=f"Lỗi nội bộ: {exc}")
    finally:
        with _lock:
            for seg in job["segments"]:
                if seg["state"] == "queued":
                    seg["state"] = "idle"
            job["queue_running"] = False
            _save(job)


def explain_error(message: str) -> str:
    """Thêm lời giải thích dễ hiểu cho các lỗi Flow hay gặp; giữ nguyên lỗi gốc ở dòng đầu để tra cứu."""
    low = (message or "").lower()
    if "unusual_activity" in low:
        return (f"{message}\nFlow tạm từ chối vì chống hoạt động bất thường (thường gặp khi gửi nhiều lượt liên tiếp). "
                "Lệnh bị từ chối lúc gửi nên chưa tạo video. Hãy chờ vài phút rồi bấm “Thử lại đoạn này”; app không tự gửi lại.")
    if "recitation" in low:
        return (f"{message}\nFlow chặn kết quả vì quá giống nội dung có sẵn (RECITATION). Có thể thử lại đoạn này một lần; "
                "nếu vẫn lỗi, thêm ảnh bối cảnh khác hoặc đổi ảnh nhân vật.")
    return message


def _fail(job: dict[str, Any], index: int, message: str) -> bool:
    logger.warning("[motion_long] %s đoạn %d lỗi: %s", job["id"], index + 1, message)
    _set_segment(job, index, state="error", error=explain_error(message))
    return False


def _ensure_project(job: dict[str, Any]) -> dict[str, str]:
    if job.get("project"):
        return job["project"]
    from app.veo import service as veo
    if job["options"]["project_mode"] == "active":
        proj = veo.get_active_project()
        if not proj:
            raise LongMotionError("Chưa có Flow project đang hoạt động. Chọn project hoặc dùng chế độ tạo mới.")
    else:
        proj = veo.create_project(name=f"Motion dài · {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    if not proj.flow_project_id:
        raise LongMotionError("Project chưa có Google Flow project id để tải video lên.")
    with _lock:
        job["project"] = {"id": proj.id, "flow_project_id": proj.flow_project_id}
        _save(job)
    return job["project"]


def cut_segment(source: Path, seg: dict[str, Any], dest: Path) -> None:
    """Cắt đoạn từ video gốc, mã hóa lại đúng từng khung (không dùng cắt chép nhanh), 30 fps, bỏ âm thanh."""
    tmp = dest.with_name(f".{dest.stem}.tmp.mp4")
    cmd = ["ffmpeg", "-y", "-v", "error", "-ss", f"{seg['start']:.4f}", "-i", str(source), "-t", f"{seg['length']:.4f}",
           "-an", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
           "-movflags", "+faststart", str(tmp)]
    proc = subprocess.run(cmd, capture_output=True, timeout=300)
    if proc.returncode != 0 or not tmp.is_file() or tmp.stat().st_size <= 0:
        tmp.unlink(missing_ok=True)
        raise LongMotionError("ffmpeg không cắt được đoạn: " + (proc.stderr or b"").decode("utf-8", "replace")[-300:])
    os.replace(tmp, dest)


def _run_segment(job: dict[str, Any], index: int) -> bool:
    from fastapi import HTTPException

    from app.veo import router as veo_router
    from app.veo import service as veo
    from app.veo.schemas import InputMode, VeoJobRequest

    seg = job["segments"][index]
    folder = job_dir(job["id"])
    attempt = int(seg.get("attempts") or 0) + 1
    try:
        project = _ensure_project(job)
        _set_segment(job, index, state="cutting", attempts=attempt, error=None, note=None, veo_job_id=None)
        part = folder / f"seg_{index}_src.mp4"
        cut_segment(folder / "source.mp4", seg, part)

        _set_segment(job, index, state="uploading")
        req = veo_router.VideoUploadRequest(
            project_id=project["flow_project_id"], video_base64=base64.b64encode(part.read_bytes()).decode("ascii"),
            video_filename=f"{job['id']}_seg{index + 1}.mp4", force_fresh=True, native_ui=False)
        try:
            uploaded = veo_router.upload_video_reference(req)
        except HTTPException as exc:
            return _fail(job, index, f"Tải đoạn {index + 1} lên Flow thất bại: {exc.detail}")

        _set_segment(job, index, state="submitting")
        length = float(seg["length"])
        veo_job = veo.submit_job(VeoJobRequest(
            project_id=project["id"], prompt=job["prompt"], model_display_name=MODEL, input_mode=InputMode.VIDEO_EDIT,
            aspect_ratio=job["aspect_ratio"], duration_seconds=max(3, min(15, int(round(length)))),
            resolution=job["resolution"], num_outputs=1, ingredient_image_paths=job["image_paths"],
            reference_video_id=uploaded["media_id"], reference_video_start_seconds=0.0,
            reference_video_end_seconds=length, force_fresh_assets=True,
            idempotency_key=f"motionlong-{job['id']}-s{index}-a{attempt}"))
        _set_segment(job, index, state="generating", veo_job_id=veo_job.job_id)
    except LongMotionError as exc:
        return _fail(job, index, str(exc))
    except (ValueError, RuntimeError, TimeoutError) as exc:
        return _fail(job, index, str(exc))
    return _attach_segment(job, index)


def _attach_segment(job: dict[str, Any], index: int) -> bool:
    """Theo dõi job Veo của đoạn đến khi xong rồi lưu video. KHÔNG bao giờ gửi lại."""
    from app.veo import service as veo

    seg = job["segments"][index]
    veo_id = seg.get("veo_job_id")
    if not veo_id:
        return _fail(job, index, "Đoạn chưa có job Flow để theo dõi.")
    deadline = time.time() + JOB_TIMEOUT_SECONDS
    last_step = None
    while time.time() < deadline:
        out = veo.get_job(veo_id)
        if out is None:
            return _fail(job, index, "Không còn thấy job Flow này (đã bị xóa?). Hãy kiểm tra thư viện Flow trước khi tạo lại.")
        if out.current_step != last_step:
            last_step = out.current_step
            _set_segment(job, index, note=out.current_step or None)
        status = getattr(out.status, "value", out.status)
        if status == "error":
            detail = out.error_message or "Flow báo lỗi."
            if out.error_hint:
                detail = f"{detail}\n{out.error_hint}"
            return _fail(job, index, detail)
        if status == "done":
            files = list(out.output_files or [])
            if not files:
                return _fail(job, index, "Flow báo xong nhưng không có file video.")
            from app.veo.service import _VEO_DATA_DIR
            src = _VEO_DATA_DIR / files[0]
            if not src.is_file():
                return _fail(job, index, f"Không thấy file video đã tải: {files[0]}")
            dest = job_dir(job["id"]) / f"seg_{index}.mp4"
            shutil.copyfile(src, dest)
            try:
                dur = merge_mod.probe(dest)["duration"]
            except merge_mod.MergeError:
                dur = None
            with _lock:
                # Đoạn đổi thì bản ghép và bản xóa watermark cũ không còn đúng
                for stale in ("final.mp4", "final_clean.mp4"):
                    (job_dir(job["id"]) / stale).unlink(missing_ok=True)
                job["merge"] = {"state": "idle"}
                job["exports"] = {}
                seg.update(state="done", output=dest.name, out_duration=dur, error=None, note=None)
                for old in (job_dir(job["id"]) / f"seg_{index}_clean.mp4",):
                    old.unlink(missing_ok=True)
                _save(job)
            return True
        time.sleep(POLL_SECONDS)
    return _fail(job, index, "Hết thời gian chờ Flow (25 phút). Video có thể vẫn đang render; kiểm tra thư viện Flow trước khi tạo lại.")


# ───────────────────────────── ghép và xuất ─────────────────────────────

def _segment_files(job: dict[str, Any], clean: bool = False) -> list[Path]:
    folder = job_dir(job["id"])
    files = []
    for seg in job["segments"]:
        if seg["state"] != "done" or not seg.get("output"):
            raise LongMotionError(f"Đoạn {seg['index'] + 1} chưa xong; cần xong mọi đoạn trước khi ghép.")
        name = f"seg_{seg['index']}_clean.mp4" if clean else seg["output"]
        files.append(folder / name)
    return files


def _music_path(job: dict[str, Any]) -> Path | None:
    if job["options"]["audio"] != "bgm":
        return None
    track_id = job["options"].get("bgm_track_id")
    if not track_id:
        raise LongMotionError("Chọn bài nhạc trong Thư viện nhạc.")
    from app.campaign.executors.assemble import resolve_bgm
    tracks = resolve_bgm([track_id])
    return tracks[0][1]


def _do_merge(job: dict[str, Any], output: Path, clean_segments: bool = False) -> dict[str, Any]:
    opts = job["options"]
    return merge_mod.merge_segments(
        job["segments"], _segment_files(job, clean_segments), output, crossfade=opts["crossfade"] if opts["overlap"] else 0.0,
        audio_mode=opts["audio"], source_audio=job_dir(job["id"]) / "source.mp4" if job["source"]["has_audio"] else None,
        music=_music_path(job), music_volume=opts["bgm_volume"])


def start_merge(jid: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    job = get_job(jid)
    with _lock:
        if job["merge"].get("state") == "running":
            raise LongMotionError("Đang ghép.")
        if any(s["state"] != "done" for s in job["segments"]):
            raise LongMotionError("Cần xong mọi đoạn trước khi ghép.")
        if options:
            merged = {**job["options"], **{k: v for k, v in options.items() if k in ("audio", "bgm_track_id", "bgm_volume", "crossfade")}}
            merged["overlap"], merged["overlap_seconds"] = job["options"]["overlap"], job["options"]["overlap_seconds"]
            merged["project_mode"] = job["options"]["project_mode"]
            job["options"] = _clean_options(merged)
        if job["options"]["audio"] == "original" and not job["source"]["has_audio"]:
            raise LongMotionError("Video gốc không có âm thanh. Chọn nhạc nền hoặc không âm thanh.")
        _music_path(job)          # báo lỗi nhạc ngay, trước khi ghép
        job["merge"] = {"state": "running", "message": "Đang ghép các đoạn…"}
        (job_dir(jid) / "final_clean.mp4").unlink(missing_ok=True)
        job["exports"] = {}
        _save(job)
    threading.Thread(target=_merge_worker, args=(jid,), daemon=True, name=f"motion-long-merge-{jid}").start()
    return public(job)


def _merge_worker(jid: str) -> None:
    job = _jobs[jid]
    try:
        report = _do_merge(job, job_dir(jid) / "final.mp4")
        drift = [round(s["out_duration"] - s["length"], 2) for s in job["segments"] if s.get("out_duration")]
        with _lock:
            job["merge"] = {"state": "done", "duration": report["duration"], "audio": report["audio"],
                            "joints": [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in j.items()} for j in report["joints"]],
                            "duration_drift": drift}
            _save(job)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[motion_long] ghép %s lỗi", jid)
        with _lock:
            job["merge"] = {"state": "error", "error": str(exc)}
            _save(job)


def start_clean_export(jid: str) -> dict[str, Any]:
    """Xóa watermark MỘT lần cho video đã ghép. gwr nhận logo ở vị trí chuẩn của clip Flow; video ghép chưa crop/phóng nên
    thử trên chính video ghép trước. Nếu gwr từ chối thì xóa trên từng đoạn rồi ghép lại (kết quả cuối vẫn là một file)."""
    job = get_job(jid)
    with _lock:
        if not (job_dir(jid) / "final.mp4").is_file() or job["merge"].get("state") != "done":
            raise LongMotionError("Hãy ghép video trước khi xóa watermark.")
        if job["exports"].get("clean", {}).get("state") == "running":
            raise LongMotionError("Đang xóa watermark.")
        job["exports"]["clean"] = {"state": "running", "message": "Đang xóa watermark…", "method": None}
        _save(job)
    threading.Thread(target=_clean_worker, args=(jid,), daemon=True, name=f"motion-long-clean-{jid}").start()
    return public(job)


def _clean_worker(jid: str) -> None:
    from app.watermark import service as wm

    job = _jobs[jid]
    folder = job_dir(jid)

    def progress(message: str, method: str) -> None:
        with _lock:
            job["exports"]["clean"] = {"state": "running", "message": message, "method": method}
            _save(job)

    try:
        final_clean = folder / "final_clean.mp4"
        try:
            progress("Đang xóa watermark trên video đã ghép…", "merged")
            wm.remove_video_watermark_sync(folder / "final.mp4", final_clean,
                                           on_progress=lambda d, t: progress(f"Đang xóa watermark… {d}/{t} khung", "merged"))
            method = "merged"
        except wm.WatermarkVideoError as exc:
            logger.info("[motion_long] gwr từ chối video ghép (%s); xóa theo từng đoạn rồi ghép lại", exc)
            for seg in job["segments"]:
                src, dst = folder / seg["output"], folder / f"seg_{seg['index']}_clean.mp4"
                if dst.is_file():
                    continue
                progress(f"Đang xóa watermark đoạn {seg['index'] + 1}/{len(job['segments'])}…", "segments")
                wm.remove_video_watermark_sync(src, dst)
            progress("Đang ghép lại các đoạn đã xóa watermark…", "segments")
            _do_merge(job, final_clean, clean_segments=True)
            method = "segments"
        with _lock:
            job["exports"]["clean"] = {"state": "done", "method": method}
            _save(job)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[motion_long] xóa watermark %s lỗi", jid)
        with _lock:
            job["exports"]["clean"] = {"state": "error", "error": str(exc)}
            _save(job)


def file_path(jid: str, kind: str, index: int | None = None) -> Path:
    job = get_job(jid)
    folder = job_dir(jid)
    if kind == "final":
        path = folder / "final.mp4"
    elif kind == "clean":
        path = folder / "final_clean.mp4"
    elif kind == "source":
        path = folder / "source.mp4"
    elif kind == "segment":
        if index is None or not 0 <= index < len(job["segments"]) or not job["segments"][index].get("output"):
            raise LongMotionError("Đoạn này chưa có video.")
        path = folder / job["segments"][index]["output"]
    else:
        raise LongMotionError("Loại file không hợp lệ.")
    if not path.is_file():
        raise LongMotionError("File chưa sẵn sàng.")
    return path
