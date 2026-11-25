"""Kho video có thể đăng qua Pippit: gom video AI đã có sẵn trên máy (Chiến dịch AI, Thư viện AI, Recap, file máy tính).

Không sao chép file: chỉ liệt kê đường dẫn thật + metadata sẵn có (caption/hashtag của Chiến dịch AI, caption của Recap,
prompt của Veo...) và đối chiếu `pippit_tasks.json` để biết video nào đã lên lịch ở kênh nào.
Mọi đường dẫn nhận từ giao diện đều phải qua `assert_allowed_video_path` (chỉ file video nằm trong thư mục dữ liệu của app).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.core.config import DATA_DIR

logger = logging.getLogger(__name__)

VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
SOURCE_TYPES = ("campaign", "ai_library", "recap", "local")
LOCAL_UPLOAD_DIRNAME = "pippit_local_uploads"
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024  # 1 GB / file: chặn nhầm file khổng lồ (client.upload đọc cả file vào RAM)
_FAILED_STATUSES = {4, 6, "4", "6", "failed", "cancelled", "error"}


class SourceError(ValueError):
    """Đường dẫn / file video không hợp lệ."""


def _data_dir() -> Path:
    return Path(DATA_DIR)


def local_upload_dir() -> Path:
    return _data_dir() / LOCAL_UPLOAD_DIRNAME


# ── an toàn đường dẫn ────────────────────────────────────────────────────────
def assert_allowed_video_path(raw: str | Path) -> Path:
    """Trả đường dẫn đã chuẩn hoá nếu là FILE VIDEO nằm trong thư mục dữ liệu của app, ngược lại ném SourceError."""
    text = str(raw or "").strip().strip('"')
    if not text:
        raise SourceError("Thiếu đường dẫn video.")
    try:
        path = Path(text).resolve()
        root = _data_dir().resolve()
    except (OSError, RuntimeError) as exc:
        raise SourceError(f"Đường dẫn không hợp lệ: {exc}") from exc
    if path.suffix.lower() not in VIDEO_EXTS:
        raise SourceError("Chỉ cho phép file video (.mp4, .mov, .webm, .mkv, .m4v).")
    if root != path and root not in path.parents:
        raise SourceError("File nằm ngoài thư mục dữ liệu của app nên không được phép đăng. Hãy dùng tab “Từ máy” để chọn file.")
    if not path.is_file():
        raise SourceError(f"File video không tồn tại: {path.name}")
    return path


def preview_url(path: Path | str) -> str:
    return f"/api/pippit/sources/preview?path={quote(str(path), safe='')}"


# ── tiện ích ─────────────────────────────────────────────────────────────────
def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _tags(value: Any) -> list[str]:
    raw = value if isinstance(value, list) else re.split(r"[\s,]+", str(value or ""))
    out: list[str] = []
    for t in raw:
        t = str(t or "").strip().replace(" ", "")
        if not t:
            continue
        t = t if t.startswith("#") else f"#{t}"
        if t.lower() not in {x.lower() for x in out}:
            out.append(t)
    return out


def _item(*, source_type: str, group: str, source_id: str, path: Path, title: str, label: str = "", created_at: str = "",
          duration: float | None = None, width: int = 0, height: int = 0, context_text: str = "",
          default_title: str = "", default_caption: str = "", default_hashtags: list[str] | None = None,
          default_cta: str = "") -> dict[str, Any] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return {
        "uid": f"{source_type}:{source_id}",
        "source_type": source_type,
        "group": group,
        "source_id": source_id,
        "label": label,
        "title": title or path.stem,
        "file_name": path.name,
        "file_path": str(path),
        "preview_url": preview_url(path),
        "size_bytes": st.st_size,
        "duration_seconds": duration,
        "width": width,
        "height": height,
        "created_at": created_at or _iso(st.st_mtime),
        "context_text": context_text,
        "default_title": default_title,
        "default_caption": default_caption,
        "default_hashtags": default_hashtags or [],
        "default_cta": default_cta,
        "published_channels": [],
    }


# ── Chiến dịch AI ────────────────────────────────────────────────────────────
CAMPAIGN_VARIANTS = {
    "clean": "Xóa watermark",
    "no_bgm": "Không nhạc nền",
    "clean_no_bgm": "Xóa watermark + không nhạc",
}


def _campaign_rows() -> list[dict[str, Any]]:
    """[{campaign_id, name, platform, video, artifact_id, seconds, size, exports_dir, script}] — video ghép đang chọn của mỗi chiến dịch."""
    from sqlalchemy import select

    from app.campaign.models import Artifact, Campaign
    from app.campaign.service import get_service

    svc = get_service()
    rows: list[dict[str, Any]] = []
    with svc.session() as s:
        for c in s.scalars(select(Campaign).order_by(Campaign.updated_at.desc())).all():
            art = svc.store.selected(s, c.id, "assemble", "")
            if art is None or art.kind != "video":
                art = s.scalars(select(Artifact).where(Artifact.campaign_id == c.id, Artifact.step_key == "assemble",
                                                        Artifact.kind == "video").order_by(Artifact.created_at.desc())).first()
            if art is None:
                continue
            script_art = svc.store.selected(s, c.id, "script", "")
            script = svc.store.load_json(script_art) if script_art is not None else {}
            meta = svc.store.meta(art)
            rows.append({
                "campaign_id": c.id, "name": c.name, "platform": c.platform,
                "video": svc.store.abs_path(art), "artifact_id": art.id,
                "seconds": meta.get("seconds"), "size": str(meta.get("size") or ""),
                "created_at": art.created_at.isoformat() if art.created_at else "",
                "exports_dir": svc.store.campaign_dir(c.id) / "exports" / art.id,
                "script": script if isinstance(script, dict) else {},
            })
    return rows


def campaign_items() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        rows = _campaign_rows()
    except Exception as exc:  # noqa: BLE001 - lỗi DB chiến dịch không được làm hỏng các nguồn khác
        logger.warning("[Pippit] Không đọc được video Chiến dịch AI: %s", exc)
        return out
    for r in rows:
        script = r["script"]
        defaults = {
            "default_title": str(script.get("hook") or "").strip(),
            "default_caption": str(script.get("caption") or "").strip(),
            "default_hashtags": _tags(script.get("hashtags")),
            "default_cta": str(script.get("cta") or "").strip(),
        }
        ctx = " | ".join(x for x in (r["name"], defaults["default_caption"]) if x)
        base_id = f"{r['campaign_id']}:{r['artifact_id']}"
        wh = [int(x) for x in re.findall(r"\d+", r["size"])[:2]] or [0, 0]
        w, h = (wh + [0, 0])[:2]
        variants: list[tuple[str, Path, str, str]] = [(base_id, Path(r["video"]), "Video ghép", r["name"])]
        for key, label in CAMPAIGN_VARIANTS.items():
            variants.append((f"{base_id}:{key}", r["exports_dir"] / f"{key}.mp4", label, f"{r['name']} — {label}"))
        hooks = _read_json(r["exports_dir"] / "hooks_manifest.json", [])
        for hk in hooks if isinstance(hooks, list) else []:
            vid = str(hk.get("id") or "")
            if vid:
                angle = str(hk.get("angle") or vid)
                variants.append((f"{base_id}:hook_{vid}", r["exports_dir"] / f"hook_{vid}.mp4", f"Hook · {angle}",
                                 f"{r['name']} — Hook {angle}"))
        for sid, path, label, title in variants:
            if not path.is_file():
                continue
            d = dict(defaults)
            if sid.rsplit(":", 1)[-1].startswith("hook_"):
                hook = next((x for x in hooks if f"hook_{x.get('id')}" == sid.rsplit(":", 1)[-1]), {})
                d["default_title"] = str(hook.get("opening_text") or d["default_title"]).strip()
                d["default_cta"] = str(hook.get("cta_text") or d["default_cta"]).strip()
            it = _item(source_type="campaign", group="campaign", source_id=sid, path=path, title=title,
                       label=f"Chiến dịch · {label}", created_at=r["created_at"], duration=r["seconds"], width=w, height=h,
                       context_text=ctx, **d)
            if it:
                out.append(it)
    return out


# ── Thư viện AI (Flow / Muse Canvas / Motion Long / Muse Studio / đã xử lý) ───
def _veo_history() -> list[Any]:
    from app.veo import service as veo_service
    return veo_service.get_history()


def ai_library_items() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    root = _data_dir()

    try:
        for v in _veo_history():
            p = Path(v.file_path)
            if not p.is_file():
                continue
            w, h = int(v.width or 0), int(v.height or 0)
            it = _item(source_type="ai_library", group="veo", source_id=f"veo:{v.video_id}", path=p,
                       title=(v.prompt or "").strip().splitlines()[0][:70] if (v.prompt or "").strip() else p.stem,
                       label=f"Flow · {v.model_display_name or 'Veo'}", created_at=v.created_at,
                       duration=float(v.duration_seconds or 0) or None, width=w, height=h, context_text=(v.prompt or "")[:600])
            if it:
                out.append(it)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Pippit] Không đọc được lịch sử Veo: %s", exc)

    exp_dir = root / "workflow_exports"
    history = _read_json(exp_dir / "exports_history.json", {})
    for p in sorted(exp_dir.glob("*.mp4")) if exp_dir.is_dir() else []:
        meta = history.get(p.name, {}) if isinstance(history, dict) else {}
        it = _item(source_type="ai_library", group="muse_canvas", source_id=f"wfx:{p.name}", path=p,
                   title=str(meta.get("title") or p.stem), label="Muse Canvas", created_at=str(meta.get("created_at") or ""),
                   duration=meta.get("duration_sec"), context_text=str(meta.get("title") or ""))
        if it:
            out.append(it)

    ml = root / "motion_long"
    for p in sorted(ml.glob("*/final.mp4")) if ml.is_dir() else []:
        it = _item(source_type="ai_library", group="motion_long", source_id=f"motion:{p.parent.name}", path=p,
                   title=f"Motion Long {p.parent.name[:6]}", label="Motion Long")
        if it:
            out.append(it)

    mp = root / "muse_production"
    for p in sorted(mp.glob("*/draft*.mp4")) if mp.is_dir() else []:
        it = _item(source_type="ai_library", group="muse_studio", source_id=f"muse:{p.parent.name}:{p.name}", path=p,
                   title=f"Muse Studio {p.parent.name[:6]}", label="Muse Studio")
        if it:
            out.append(it)

    for folder, prefix, label in ((root / "exports", "export", "Xuất ra"),
                                  (root / "media" / "videos" / "MergeVideo", "merge", "Video ghép")):
        for p in sorted(folder.glob("*.mp4")) if folder.is_dir() else []:
            it = _item(source_type="ai_library", group="processed", source_id=f"{prefix}:{p.name}", path=p, title=p.stem, label=label)
            if it:
                out.append(it)

    done = _read_json(root / "media" / "videos" / "done.json", [])
    for d in done if isinstance(done, list) else []:
        p = Path(str(d.get("file_path") or ""))
        if p.is_file():
            it = _item(source_type="ai_library", group="processed", source_id=f"done:{d.get('done_id')}", path=p,
                       title=Path(str(d.get("name") or p.name)).stem, label="Video đã xử lý", created_at=str(d.get("created_at") or ""))
            if it:
                out.append(it)
    return out


# ── Recap & Audio ────────────────────────────────────────────────────────────
def recap_items() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    base = _data_dir() / "Downloads"
    if not base.is_dir():
        return out
    for job_dir in sorted(base.iterdir()):
        if not job_dir.is_dir():
            continue
        video = next((job_dir / n for n in ("final_studio.mp4", "final_recap.mp4") if (job_dir / n).is_file()), None)
        if video is None:
            continue
        recap = _read_json(job_dir / "recap.json", {})
        cap = recap.get("caption") if isinstance(recap, dict) and isinstance(recap.get("caption"), dict) else {}
        title = str(cap.get("title") or "").strip()
        it = _item(source_type="recap", group="recap", source_id=f"recap:{job_dir.name}", path=video,
                   title=title or f"Recap {job_dir.name[:6]}", label="Recap & Audio",
                   created_at=str(recap.get("created_at") or "") if isinstance(recap, dict) else "",
                   context_text=" | ".join(x for x in (title, str(cap.get("description") or "")) if x)[:600],
                   default_title=title, default_caption=str(cap.get("description") or "").strip(),
                   default_hashtags=_tags(cap.get("hashtags")))
        if it:
            out.append(it)
    return out


# ── Từ máy ───────────────────────────────────────────────────────────────────
def _probe(path: Path) -> dict[str, Any]:
    exe = shutil.which("ffprobe")
    if not exe:
        return {}
    try:
        r = subprocess.run([exe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
                            "-of", "json", str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        j = json.loads(r.stdout or "{}")
        st = (j.get("streams") or [{}])[0]
        return {"duration": float((j.get("format") or {}).get("duration") or 0) or None,
                "width": int(st.get("width") or 0), "height": int(st.get("height") or 0)}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}


def _safe_name(name: str) -> str:
    stem = re.sub(r"[^\w\-. ]+", "_", Path(name or "video.mp4").name, flags=re.UNICODE).strip(" .") or "video.mp4"
    return stem[:120]


def save_local_upload(filename: str, data: bytes) -> dict[str, Any]:
    ext = Path(filename or "").suffix.lower()
    if ext not in VIDEO_EXTS:
        raise SourceError(f"“{filename}” không phải file video (.mp4, .mov, .webm, .mkv, .m4v).")
    if not data:
        raise SourceError(f"“{filename}” rỗng.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise SourceError(f"“{filename}” quá lớn (> 1 GB).")
    folder = local_upload_dir()
    folder.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(data).hexdigest()[:10]
    safe = _safe_name(filename)
    dest = folder / f"{Path(safe).stem}-{digest}{ext}"
    if not dest.exists():
        tmp = dest.with_name(dest.name + ".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
    index = _read_json(folder / "index.json", {})
    if not isinstance(index, dict):
        index = {}
    if dest.name not in index:
        index[dest.name] = {**_probe(dest), "original_name": safe, "uploaded_at": _iso(time.time())}
        (folder / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = index[dest.name]
    return _item(source_type="local", group="local", source_id=f"local:{dest.name}", path=dest, title=Path(meta.get("original_name") or safe).stem,
                 label="Từ máy", duration=meta.get("duration"), width=meta.get("width") or 0, height=meta.get("height") or 0) or {}


def local_items() -> list[dict[str, Any]]:
    folder = local_upload_dir()
    if not folder.is_dir():
        return []
    index = _read_json(folder / "index.json", {})
    out: list[dict[str, Any]] = []
    for p in sorted(folder.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if p.suffix.lower() not in VIDEO_EXTS or not p.is_file():
            continue
        meta = index.get(p.name, {}) if isinstance(index, dict) else {}
        it = _item(source_type="local", group="local", source_id=f"local:{p.name}", path=p,
                   title=Path(str(meta.get("original_name") or p.name)).stem, label="Từ máy", duration=meta.get("duration"),
                   width=meta.get("width") or 0, height=meta.get("height") or 0)
        if it:
            out.append(it)
    return out


# ── đối chiếu đã đăng ────────────────────────────────────────────────────────
def _pippit_tasks() -> list[dict]:
    from app.externals.pippit.service import _get_saved_tasks
    return _get_saved_tasks()


def enrich_published(items: list[dict[str, Any]]) -> None:
    """Gắn `published_channels` theo `source_id` / `local_path` của task Pippit (bỏ task lỗi/huỷ)."""
    try:
        tasks = [t for t in _pippit_tasks() if t.get("status") not in _FAILED_STATUSES]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Pippit] Không đọc được lịch sử để đối chiếu đã đăng: %s", exc)
        return
    by_key: dict[str, list[dict]] = {}
    for t in tasks:
        for key in (str(t.get("source_id") or ""), str(t.get("local_path") or "")):
            if key:
                by_key.setdefault(key, []).append(t)
    for it in items:
        seen: set[tuple[str, str]] = set()
        for t in by_key.get(it["source_id"], []) + by_key.get(it["file_path"], []):
            plat = t.get("platform") or "facebook"
            cid = str(t.get("page_id") or "")
            if (plat, cid) in seen:
                continue
            seen.add((plat, cid))
            it["published_channels"].append({
                "platform": plat, "channel_name": t.get("page_name") or cid, "channel_id": cid,
                "status": "scheduled" if t.get("status") in (1, "1") else "published",
                "task_id": t.get("task_id"), "post_url": t.get("post_url") or "",
            })


# ── API chính ────────────────────────────────────────────────────────────────
_PROVIDERS = {"campaign": campaign_items, "ai_library": ai_library_items, "recap": recap_items, "local": local_items}


def list_publishable_videos(source: str = "campaign", query: str = "", group: str = "", limit: int = 60, offset: int = 0) -> dict[str, Any]:
    if source not in _PROVIDERS:
        raise SourceError(f"Nguồn “{source}” không hợp lệ (chọn: {', '.join(SOURCE_TYPES)}).")
    counts = {name: 0 for name in SOURCE_TYPES}
    chosen: list[dict[str, Any]] = []
    for name, fn in _PROVIDERS.items():
        items = fn()
        counts[name] = len(items)
        if name == source:
            chosen = items
    groups: dict[str, int] = {}
    for it in chosen:
        groups[it["group"]] = groups.get(it["group"], 0) + 1
    q = query.strip().lower()
    if group:
        chosen = [it for it in chosen if it["group"] == group]
    if q:
        chosen = [it for it in chosen if q in it["title"].lower() or q in it["file_name"].lower() or q in it["context_text"].lower()]
    chosen.sort(key=lambda it: it["created_at"], reverse=True)
    total = len(chosen)
    page = chosen[max(0, offset): max(0, offset) + max(1, min(limit, 200))]
    enrich_published(page)
    return {"source": source, "items": page, "total": total, "counts": counts, "groups": groups}
