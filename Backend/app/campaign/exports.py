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
_hook_jobs: dict[tuple[str, str], dict[str, Any]] = {}       # (campaign, artifact) -> {state, message, error, items}
MAX_HOOK_VARIANTS = 5


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


# ── Hook Multiplier (0 credit Flow: 1 bộ clip -> nhiều biến thể Hook/Audio/CTA) ────
def _safe_hook_id(raw_id: Any, idx: int) -> str:
    import re
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", str(raw_id or ""))[:24]
    return cleaned or f"hook_{idx + 1}"


def _load_campaign_copy_context(svc: Any, cid: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    with svc.session() as s:
        svc._campaign(s, cid)
        fs_art = svc.store.selected(s, cid, "fact_sheet")
        sc_art = svc.store.selected(s, cid, "script")
        fact = svc.store.load_json(fs_art) if fs_art is not None else {}
        script = svc.store.load_json(sc_art) if sc_art is not None else {}
        brief = dict(svc.engine.get_params(s, cid, "brief") or {})
        return (fact if isinstance(fact, dict) else {}), (brief if isinstance(brief, dict) else {}), (script if isinstance(script, dict) else {})


def suggest_hook_variants(svc: Any, cid: str) -> dict[str, Any]:
    """Dùng 1 lượt Gemini gợi ý 3 biến thể Hook 3 giây đầu + CTA chuẩn TikTok Shop (0 credit Flow)."""
    import json as _json
    from .executors import llm

    fact, brief, script = _load_campaign_copy_context(svc, cid)
    prompt = (
        "You are a Vietnam TikTok Shop fashion performance marketer (GMV Max). "
        "Suggest 3 distinct opening hooks and short CTAs for 3-second scroll-stopping A/B testing on the SAME already-rendered video clips.\n"
        f"PRODUCT: {_json.dumps(fact, ensure_ascii=False)}\n"
        f"BRIEF: {_json.dumps(brief, ensure_ascii=False)}\n"
        f"CURRENT HOOK/CTA: {_json.dumps({'hook': script.get('hook'), 'cta': script.get('cta')}, ensure_ascii=False)}\n"
        "RULES:\n"
        "- Language: Vietnamese (spoken, urgent, native TikTok Shop style; no fake 'tôi đã mua' testimonial; respect garment.do_not_say).\n"
        "- opening_text: 3 to 7 punchy words shown on screen at 0-1.2s.\n"
        "- cta_text: 3 to 7 punchy words pointing to the orange cart / size check.\n"
        "- Angles MUST cover: 1) Nỗi đau dáng người (Fit Pain), 2) Kết quả & chất vải (Visual/Texture Proof), 3) Neo giá trị / Phối đồ (Value/Styling).\n"
        'Return ONLY JSON: {"variants":[{"id":"hook_1","angle":"...","opening_text":"...","cta_text":"..."}]}\n'
    )
    data, _raw, provider = llm.call_llm_json(prompt, retries=1)
    raw_list = data.get("variants") if isinstance(data, dict) else None
    if not isinstance(raw_list, list) or not raw_list:
        raise ExportError("Gemini không trả về danh sách gợi ý hook hợp lệ.")
    variants: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_list[:MAX_HOOK_VARIANTS]):
        if not isinstance(item, dict):
            continue
        opening_text = str(item.get("opening_text") or "").strip()
        cta_text = str(item.get("cta_text") or "").strip()
        if not opening_text:
            continue
        variants.append({
            "id": _safe_hook_id(item.get("id"), idx),
            "angle": str(item.get("angle") or f"Góc #{idx + 1}").strip()[:60],
            "opening_text": opening_text[:80],
            "cta_text": cta_text[:80],
            "audio_mode": str(item.get("audio_mode") or ""),
            "ending_mode": str(item.get("ending_mode") or "cta_overlay"),
        })
    if not variants:
        raise ExportError("Không tách được hook hợp lệ từ gợi ý.")
    return {"variants": variants, "provider": provider}


def _manifest_path(svc: Any, cid: str, art_id: str) -> Path:
    return _dir(svc, cid, art_id) / "hooks_manifest.json"


def _read_hook_manifest(svc: Any, cid: str, art_id: str) -> list[dict[str, Any]]:
    import json as _json
    p = _manifest_path(svc, cid, art_id)
    if not p.is_file():
        return []
    try:
        data = _json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:  # noqa: BLE001
        return []


def hook_variants_status(svc: Any, cid: str) -> dict[str, Any]:
    try:
        art_id, fresh, _meta = _current(svc, cid)
    except ExportError as exc:
        return {"artifact_id": None, "fresh": False, "state": "idle", "variants": [], "reason": str(exc)}
    job = _hook_jobs.get((cid, art_id))
    saved = _read_hook_manifest(svc, cid, art_id)
    out: list[dict[str, Any]] = []
    for item in saved:
        vid = str(item.get("id") or "")
        mp4 = _dir(svc, cid, art_id) / f"hook_{vid}.mp4"
        out.append({
            **item,
            "state": "ready" if mp4.is_file() else (item.get("state") or "none"),
            "bytes": mp4.stat().st_size if mp4.is_file() else 0,
        })
    return {
        "artifact_id": art_id,
        "fresh": fresh,
        "state": job.get("state", "idle") if job else "idle",
        "message": job.get("message", "") if job else "",
        "error": job.get("error", "") if job else "",
        "variants": out,
        "reason": "" if fresh else "Video đang chọn đã cũ: hãy ghép lại trước khi tạo biến thể Hook.",
    }


def render_hook_variants(
    svc: Any,
    cid: str,
    variants: list[dict[str, Any]],
    *,
    clean: bool = False,
    executor: Callable[[ExecContext], Any] | None = None,
    wait: bool = False,
) -> dict[str, Any]:
    import json as _json

    art_id, fresh, _meta = _current(svc, cid)
    if not fresh:
        raise ExportError("Video đang chọn đã cũ: hãy ghép lại trước khi tạo biến thể Hook.")
    if not variants:
        raise ExportError("Cần ít nhất 1 biến thể hook để tạo video.")
    cleaned: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for idx, raw in enumerate(variants[:MAX_HOOK_VARIANTS]):
        vid = _safe_hook_id(raw.get("id"), idx)
        if vid in seen_ids:
            vid = f"{vid}_{idx + 1}"
        seen_ids.add(vid)
        cleaned.append({
            "id": vid,
            "angle": str(raw.get("angle") or f"Hook {idx + 1}").strip()[:60],
            "opening_text": str(raw.get("opening_text") or "").strip()[:80],
            "cta_text": str(raw.get("cta_text") or "").strip()[:80],
            "audio_mode": str(raw.get("audio_mode") or "").strip(),
            "ending_mode": str(raw.get("ending_mode") or "cta_overlay").strip(),
        })
    key = (cid, art_id)
    with _lock:
        if _hook_jobs.get(key, {}).get("state") == "running":
            return hook_variants_status(svc, cid)
        _hook_jobs[key] = {"state": "running", "message": f"Đang dựng 0/{len(cleaned)} biến thể…", "error": ""}
        mp = _manifest_path(svc, cid, art_id)
        mp.parent.mkdir(parents=True, exist_ok=True)
        mp.write_text(_json.dumps(cleaned, ensure_ascii=False, indent=1), encoding="utf-8")

    t = threading.Thread(
        target=_work_hooks,
        args=(svc, cid, art_id, cleaned, bool(clean), executor or assemble.run_assemble),
        daemon=True,
        name=f"hooks-{cid}",
    )
    t.start()
    if wait:
        t.join()
    return hook_variants_status(svc, cid)


def _work_hooks(
    svc: Any,
    cid: str,
    art_id: str,
    variants: list[dict[str, Any]],
    clean: bool,
    executor: Callable[[ExecContext], Any],
) -> None:
    import json as _json

    key = (cid, art_id)
    job = _hook_jobs[key]
    try:
        sd = graph.get_step("assemble")
        with svc.session() as s:
            base_params = dict(svc.engine.get_params(s, cid, "assemble"))
            _, blockers, refs = svc.engine.current_parts(s, cid, sd, "", "final")
        if blockers:
            raise ExportError("Chưa đủ đầu vào: " + "; ".join(f"{b['dep']}: {b['reason']}" for b in blockers))
        export_dir = _dir(svc, cid, art_id)
        export_dir.mkdir(parents=True, exist_ok=True)
        done_items: list[dict[str, Any]] = []
        for idx, var in enumerate(variants):
            job["message"] = f"Đang dựng biến thể {idx + 1}/{len(variants)} ({var['angle']})…"
            params = dict(base_params)
            params[assemble.EXPORT_CLEAN] = clean
            params[assemble.EXPORT_OPENING_TEXT] = var["opening_text"]
            params[assemble.EXPORT_CTA_TEXT] = var["cta_text"]
            if var.get("audio_mode") in assemble.AUDIO_MODES:
                params[assemble.EXPORT_AUDIO_MODE] = var["audio_mode"]
            if var.get("ending_mode") in assemble.ENDING_MODES:
                params[assemble.EXPORT_ENDING_MODE] = var["ending_mode"]
            ctx = ExecContext(
                campaign_id=cid, step_key="assemble", element_key="", tier="final",
                params=params, inputs=refs, fingerprint=f"hook:{var['id']}", note="",
                store=svc.store, set_external_ref=lambda r: None, cancelled=lambda: False,
                report=lambda m, _i=idx: job.__setitem__("message", f"[{_i + 1}/{len(variants)}] {m}"),
            )
            result = executor(ctx)
            data = result.artifacts[0].data
            target = export_dir / f"hook_{var['id']}.mp4"
            tmp = target.with_name(f".{target.stem}.part")
            tmp.write_bytes(data)
            os.replace(tmp, target)
            done_items.append({**var, "state": "ready", "bytes": len(data)})
        _manifest_path(svc, cid, art_id).write_text(_json.dumps(done_items, ensure_ascii=False, indent=1), encoding="utf-8")
        job.update(state="ready", message=f"Đã dựng xong {len(done_items)} biến thể.", error="")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Render hook variants cho %s lỗi", cid)
        job.update(state="error", error=str(exc)[:500])


def hook_variant_file_path(svc: Any, cid: str, variant_id: str) -> tuple[Path, str]:
    vid = _safe_hook_id(variant_id, 0)
    art_id, _, _ = _current(svc, cid)
    path = _dir(svc, cid, art_id) / f"hook_{vid}.mp4"
    if not path.is_file():
        raise ExportError("Biến thể hook này chưa được dựng.")
    with svc.session() as s:
        name = svc._campaign(s, cid).name
    return path, f"{name} - {vid}.mp4"
