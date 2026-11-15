"""Muse Canvas → "Hoàn thiện video": từ (các) clip Muse ra 1 video hoàn chỉnh trong Thư Viện Video.

Các bước (ffmpeg):
  1. nhiều clip -> ghép (concat demuxer, stream copy);
  2. nhãn kênh: chữ (vd. "@kenh") và/hoặc logo -> 1 lần mã hóa lại video, giữ nguyên tiếng;
  3. âm thanh: tắt tiếng gốc hoặc chỉnh âm lượng, trộn nhạc nền từ Thư viện nhạc (render_audio của export);
  4. lưu vào WORKFLOW_EXPORTS_DIR + exports_history.json -> Thư Viện Video, mục "Hoàn chỉnh".

Clip Muse thô (thư mục tải video của Muse) cũng hiện trong Thư Viện Video: `muse_library_clips()`.
Mọi `drawtext` có `fontfile=font.ttf` + `textfile=` tương đối, chạy với cwd = thư mục tạm (xem app/media/fonts.py).
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.media.fonts import stage_font

Corner = Literal["tl", "tc", "tr", "bl", "bc", "br"]
LABEL_SIZES = {"s": 0.022, "m": 0.03, "l": 0.04}  # cỡ chữ theo chiều cao khung
MARGIN = 0.04  # lề theo bề rộng khung
SIDECAR_SUFFIX = ".muse.json"


class MuseFinishRequest(BaseModel):
    video_paths: list[str] = Field(..., min_length=1, max_length=20, description="Clip Muse theo thứ tự (1 clip = không ghép)")
    title: str = Field(default="", max_length=120)
    mute_original: bool = Field(default=False, description="Tắt hẳn tiếng gốc của clip Muse")
    original_volume: float = Field(default=1.0, ge=0, le=2)
    bgm_track_ids: list[str] = Field(default_factory=list, max_length=10, description="Nhạc từ Thư viện nhạc (/api/bgm)")
    bgm_volume: float = Field(default=0.3, ge=0, le=2)
    label_text: str = Field(default="", max_length=60, description="Nhãn kênh, vd. @kenhcuaban")
    label_position: Corner = "br"
    label_size: Literal["s", "m", "l"] = "m"
    logo_id: Optional[str] = Field(default=None, description="Logo kênh đã tải qua POST /api/audio/logo")
    logo_position: Corner = "tr"
    logo_size: float = Field(default=0.16, ge=0.05, le=0.5, description="Bề rộng logo / bề rộng khung")


def _xy(position: str, margin: int, w_expr: str, h_expr: str) -> tuple[str, str]:
    """Toạ độ góc cho drawtext (text_w/text_h) hoặc overlay (w/h)."""
    if position.endswith("l"):
        x = f"{margin}"
    elif position.endswith("r"):
        x = f"W-{w_expr}-{margin}"
    else:
        x = f"(W-{w_expr})/2"
    y = f"{margin}" if position.startswith("t") else f"H-{h_expr}-{margin}"
    return x, y


def build_label_filter(
    width: int,
    height: int,
    *,
    has_label: bool,
    label_position: str = "br",
    label_size: str = "m",
    logo_index: int | None = None,
    logo_position: str = "tr",
    logo_size: float = 0.16,
) -> tuple[str, str]:
    """filter_complex phủ nhãn kênh (chữ trong label.txt, font.ttf) và logo (input `logo_index`). Hàm thuần để test."""
    steps: list[str] = []
    label = "0:v"
    margin = max(8, int(width * MARGIN))
    if logo_index is not None:
        x, y = _xy(logo_position, margin, "w", "h")
        steps.append(f"[{logo_index}:v]scale={max(16, int(width * logo_size))}:-1,format=rgba,colorchannelmixer=aa=0.92[logo]")
        steps.append(f"[{label}][logo]overlay=x={x}:y={y}:shortest=1[vlogo]")
        label = "vlogo"
    if has_label:
        fs = max(14, int(height * LABEL_SIZES.get(label_size, LABEL_SIZES["m"])))
        x, y = _xy(label_position, margin, "text_w", "text_h")
        # drawtext dùng w/h cho khung; đổi W/H (cú pháp overlay) sang w/h
        x, y = x.replace("W", "w").replace("H", "h"), y.replace("W", "w").replace("H", "h")
        steps.append(
            f"[{label}]drawtext=fontfile=font.ttf:textfile=label.txt:fontcolor=white:fontsize={fs}:"
            f"borderw={max(1, fs // 14)}:bordercolor=black@0.7:box=1:boxcolor=black@0.35:boxborderw={max(4, fs // 3)}:"
            f"x={x}:y={y}[vlabel]"
        )
        label = "vlabel"
    if not steps:
        raise ValueError("Không có nhãn kênh / logo nào để phủ.")
    return ";".join(steps), label


def _probe(path: Path) -> dict:
    from app.workflow.export_media import probe_media

    return probe_media(path)


def _apply_label(video: Path, work: Path, req: MuseFinishRequest, logo: Path | None) -> Path:
    """Phủ nhãn kênh / logo (mã hóa lại video một lần, giữ tiếng gốc nguyên vẹn để bước âm thanh xử lý)."""
    media = _probe(video)
    text = req.label_text.strip()
    has_label = bool(text) and stage_font(work)
    if text and not has_label:
        raise RuntimeError("Không tìm thấy font để vẽ nhãn kênh (Backend/resources/fonts).")
    if has_label:
        # write_bytes: write_text trên Windows đổi LF thành CRLF, drawtext coi CR là dòng trống
        (work / "label.txt").write_bytes(text.encode("utf-8"))
    inputs = ["-i", str(video)]
    logo_index = None
    if logo is not None:
        logo_index = 1
        inputs += ["-loop", "1", "-i", str(logo)]
    graph, out_label = build_label_filter(
        media["width"], media["height"], has_label=has_label, label_position=req.label_position, label_size=req.label_size,
        logo_index=logo_index, logo_position=req.logo_position, logo_size=req.logo_size,
    )
    output = work / "labeled.mp4"
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", graph,
           "-map", f"[{out_label}]", "-map", "0:a?", "-c:a", "copy", "-t", f"{media['duration']:.3f}",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output.name]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800, cwd=str(work))
    if proc.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"Không phủ được nhãn kênh (ffmpeg exit {proc.returncode}): {(proc.stderr or '').strip()[-600:]}")
    return output


def _resolve_clip(raw: str) -> Path:
    p = Path(raw)
    if p.is_file() and p.stat().st_size:
        return p
    found = find_muse_clip(p.name)
    if found:
        return found
    raise FileNotFoundError(f"Không tìm thấy clip: {raw}")


def finish_video(req: MuseFinishRequest) -> dict[str, Any]:
    """Chạy cả chuỗi, trả {filename, file_path, video_url, duration_sec, title}."""
    from app.recap.ffmpeg import concat_segments
    from app.workflow.export_media import render_audio
    from app.workflow.service import WORKFLOW_EXPORTS_DIR, _load_exports_metadata, _save_exports_metadata

    clips = [_resolve_clip(p) for p in req.video_paths]
    logo = None
    if req.logo_id:
        from app.media.audio_workflow import logo_path

        logo = logo_path(req.logo_id)
        if logo is None:
            raise FileNotFoundError("Không tìm thấy logo kênh — tải lại logo.")

    bgm_paths: list[Path] = []
    if req.bgm_track_ids:
        from app.db import SessionLocal
        from app.media.service import resolve_for_polish

        with SessionLocal() as db:
            bgm_paths, _ = resolve_for_polish(db, req.bgm_track_ids)

    WORKFLOW_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    job = uuid.uuid4().hex[:8]
    work = WORKFLOW_EXPORTS_DIR / f"temp_muse_{job}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        video = clips[0] if len(clips) == 1 else concat_segments(clips, work / "concat.mp4", work / "concat_tmp")
        if req.label_text.strip() or logo is not None:
            video = _apply_label(video, work, req, logo)
        rendered = work / "final.mp4"
        render_audio(
            video, rendered, voiceover=None, bgm_paths=bgm_paths, bgm_volume=req.bgm_volume,
            mix_original_audio=not req.mute_original, veo_ambient_volume=0.0 if req.mute_original else req.original_volume,
            work_dir=work,
        )
        media = _probe(rendered)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out = WORKFLOW_EXPORTS_DIR / f"muse_final_{stamp}_{job[:4]}.mp4"
        shutil.move(str(rendered), str(out))

        w, h = media["width"], media["height"]
        ratio = w / h if w and h else 0
        aspect = "16:9" if abs(ratio - 16 / 9) < 0.05 else "1:1" if abs(ratio - 1) < 0.05 else "9:16"
        title = req.title.strip() or f"Video Muse ({int(media['duration'])}s)"
        parts = []
        if req.mute_original:
            parts.append("tắt tiếng gốc")
        if bgm_paths:
            parts.append(f"{len(bgm_paths)} nhạc nền")
        if req.label_text.strip():
            parts.append(f"nhãn {req.label_text.strip()}")
        if logo is not None:
            parts.append("logo kênh")
        history = _load_exports_metadata()
        history[out.name] = {
            "id": job,
            "filename": out.name,
            "duration_sec": media["duration"],
            "size_bytes": out.stat().st_size,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "scene_count": len(clips),
            "width": w,
            "height": h,
            "aspect_ratio": aspect,
            "resolution": f"{w}x{h}",
            "title": title,
            "prompt": "Muse Canvas · " + (", ".join(parts) or "không chỉnh thêm"),
            "model_display_name": "Muse + FFmpeg",
            "source": "muse",
        }
        _save_exports_metadata(history)
        return {
            "filename": out.name,
            "file_path": str(out.resolve()),
            "video_url": f"/api/workflow/exports/{out.name}",
            "duration_sec": media["duration"],
            "title": title,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---------------------------------------------------------------- clip Muse trong Thư Viện Video


def muse_video_dir() -> Path | None:
    try:
        from app.ai.muse.service import muse_service

        return muse_service.get_download_dir()
    except Exception:
        return None


def _is_muse_clip(p: Path) -> bool:
    """Chỉ nhận file Muse: có sidecar .muse.json, hoặc tên bắt đầu "muse" (file cũ trước khi có sidecar).
    Thư mục tải Muse có thể là Downloads của người dùng — không liệt kê mp4 lạ."""
    return p.suffix.lower() == ".mp4" and (sidecar_for(p).is_file() or p.name.lower().startswith("muse"))


def sidecar_for(video: Path) -> Path:
    return video.with_name(video.stem + SIDECAR_SUFFIX)


def write_sidecar(video: Path, meta: dict[str, Any]) -> None:
    try:
        sidecar_for(video).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def find_muse_clip(filename: str) -> Path | None:
    d = muse_video_dir()
    if d is None:
        return None
    name = Path(filename).name
    p = (d / name).resolve()
    if str(p).startswith(str(d.resolve())) and p.is_file() and _is_muse_clip(p):
        return p
    return None


def delete_muse_clip(filename: str) -> bool:
    p = find_muse_clip(filename)
    if p is None:
        return False
    p.unlink()
    sidecar_for(p).unlink(missing_ok=True)
    return True


def muse_library_clips(skip: set[str]) -> list[dict[str, Any]]:
    """Clip Muse (thư mục tải video của Muse) dưới dạng item của Thư Viện Video (source_type=muse_clip)."""
    d = muse_video_dir()
    if d is None or not d.exists():
        return []
    items = []
    for f in d.glob("*.mp4"):
        if f.name in skip or not f.is_file() or not _is_muse_clip(f):
            continue
        meta: dict[str, Any] = {}
        sc = sidecar_for(f)
        if sc.is_file():
            try:
                meta = json.loads(sc.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        stat = f.stat()
        dur = float(meta.get("duration_sec") or 0)
        if not dur:
            try:
                dur = float(_probe(f)["duration"])
            except Exception:
                dur = 0.0
        prompt = str(meta.get("prompt") or "")
        title = str(meta.get("chat_title") or "").strip() or (re.sub(r"\s+", " ", prompt)[:70] if prompt else f"Clip Muse ({f.stem})")
        items.append({
            "id": f.stem,
            "filename": f.name,
            "video_url": f"/api/workflow/exports/{f.name}",
            "file_path": str(f.resolve()),
            "size_bytes": stat.st_size,
            "duration_sec": dur,
            "created_at": meta.get("created_at") or datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "scene_count": 1,
            "aspect_ratio": meta.get("aspect_ratio") or "9:16",
            "resolution": meta.get("resolution") or "720x1280",
            "title": title,
            "source_type": "muse_clip",
            "is_motion_control": False,
            "input_mode": "",
            "prompt": prompt,
            "model_display_name": "Meta Muse" + (f" · {meta['account_label']}" if meta.get("account_label") else ""),
        })
    return items
