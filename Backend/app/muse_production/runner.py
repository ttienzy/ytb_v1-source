from __future__ import annotations

import logging
import threading
from datetime import datetime
from pathlib import Path

from app.ai.muse.schemas import MuseGenerateRequest
from app.ai.muse.service import muse_service
from . import media, store
from .contracts import ROLES, STAGE_ROLE, prompt_for, validate_reply

stop = threading.Event()
threads: list[threading.Thread] = []
logger = logging.getLogger(__name__)


def transition(ep, stage, status="queued"):
    ep.update(stage=stage, status=status, receipt=None, error="", format_error="")
    ep.pop("repair_reply", None)
    ep["rounds"].pop("format", None)


def hold(ep, message):
    ep.update(status="attention", error=message)


def revise(ep, gate, feedback, target):
    ep["feedback"] = feedback
    count = ep["rounds"].get(gate, 0)
    if count >= 2:
        hold(ep, feedback)
        return False
    ep["rounds"][gate] = count + 1
    transition(ep, target)
    return True


def redo_scenes(ep, numbers):
    for number in set(numbers):
        entry = ep["media"].get(str(number), {})
        for asset in ("image", "clip", "segment"):
            entry.pop(asset, None)
    ep.update(draft=None, project=None)


def roles_for(channel):
    accounts = muse_service.get_store().list_accounts()
    usable = [a for a in accounts if a["status"] == "active"]
    # Stable defaults across changes to last-used/rotation order.
    usable.sort(key=lambda a: (a.get("cdpPort", 0), a["id"]))
    return {
        role: channel["accounts"].get(role) or (usable[i % len(usable)]["id"] if usable else "")
        for i, role in enumerate(ROLES)
    }


def call(ep, prompt, kind="text", refs=()):
    role = STAGE_ROLE[ep["stage"]]
    receipt = ep.get("receipt")
    account = ep["channel"]["accounts"].get(role)
    if receipt:
        candidates = [receipt["account"]]
    else:
        available = [a["id"] for a in muse_service.get_store().usable_accounts()]
        candidates = [account] if account in available else []
        if ep["channel"]["fallback"]:
            candidates.extend(a for a in available if a != account)
        if not candidates:
            raise ValueError(f"Tài khoản vai {role} chưa sẵn sàng.")
    for ref in refs:
        if not Path(ref).is_file():
            raise ValueError(f"Thiếu file tham chiếu: {Path(ref).name}")
    req = MuseGenerateRequest(
        prompt=prompt,
        output_kind=kind,
        expect_json=kind == "text",
        timeout_seconds=600 if kind == "text" else None,
        account_id=account or None,
        apply_prefix=False,
        use_side_chat=True,
        reference_media=list(refs),
        chat_title=f"{ep['id'][:8]} · {role} · {ep['stage']}",
        file_prefix=f"muse_{ep['id'][:10]}_{ep['version']}",
    )

    def dispatched(cursor):
        with store.transaction(True) as db:
            if not store.owns_claim(db, ep):
                raise store.Conflict("Lượt này đã được worker khác tiếp quản.")
            ep["receipt"] = cursor
            store.log(db, ep, f"Đã ghi nhận lượt {role}.", receipt=cursor)
            store.save(db, ep)

    def progress_callback(msg: str):
        store.set_live_message(ep["id"], msg)

    for candidate in candidates:
        req.account_id = candidate
        try:
            result = muse_service.generate_video(
                req, receipt=receipt, on_dispatch=dispatched, on_progress=progress_callback
            )
        except TypeError:
            result = muse_service.generate_video(req, receipt=receipt, on_dispatch=dispatched)
        if result.ok and not result.error:
            ep.pop("live_message", None)
            return result
        if result.ok and result.reply_text and kind == "text":
            try:
                validate_reply(ep["stage"], result.reply_text, ep)
                ep.pop("live_message", None)
                return result
            except ValueError:
                pass
        if ep.get("receipt"):
            break
    raise ValueError(result.error or "Muse chưa hoàn tất.")


def apply_reply(ep, data):
    stage = ep["stage"]
    if "unavailable" in data:
        hold(ep, data["unavailable"])
    elif stage == "scout":
        ep["brief"] = data
        transition(ep, "brief_review")
    elif stage == "brief_review":
        ep["review"] = data
        if data["decision"] == "approved":
            ep["feedback"] = ""
            transition(ep, "script")
        else:
            revise(ep, "brief", data["feedback"], "scout")
    elif stage == "script":
        ep["script"] = data
        ep["feedback"] = ""
        transition(ep, "script", "script_gate")
    elif stage == "manifest":
        ep["manifest"] = data
        old = ep.pop("previous_cut", None)
        if old and old["manifest"]:
            for scene, shot in zip(ep["script"]["scenes"], data["scenes"]):
                idx = scene["scene"] - 1
                if idx >= len(old["script"]["scenes"]):
                    continue
                before = old["script"]["scenes"][idx]
                assets = old["media"].get(str(idx + 1), {})
                keep = {}
                if scene["narration"] == before["narration"] and assets.get("voice"):
                    keep["voice"] = assets["voice"]
                same_look = (
                    data["continuity"] == old["manifest"]["continuity"]
                    and shot == old["manifest"]["scenes"][idx]
                )
                if same_look:
                    keep.update({k: assets[k] for k in ("image", "clip") if assets.get(k)})
                    if "voice" in keep and scene["seconds"] == before["seconds"] and assets.get("segment"):
                        keep["segment"] = assets["segment"]
                ep["media"][str(idx + 1)] = keep
        transition(ep, "assets")
    else:
        ep["review"] = data
        if data["decision"] == "approved":
            transition(ep, "draft", "draft_gate")
            try:
                ep["project"] = media.canvas_snapshot(ep)
            except (OSError, ValueError) as exc:
                ep["error"] = f"Bản dựng đã sẵn sàng. Chưa tạo được project Muse Canvas: {exc}"
        elif revise(ep, "visual", data["feedback"], "assets"):
            redo_scenes(ep, data["scenes"])


def editorial(ep):
    prompt = prompt_for(ep, store.recent(ep) if ep["stage"] == "scout" else [])
    if ep.get("format_error"):
        prompt += "\nLần trước sai hợp đồng. Sửa lỗi sau và trả một JSON duy nhất: " + ep["format_error"]
        prompt += "\nPhản hồi cần sửa: " + ep.get("repair_reply", "")
    refs = [ep["draft"]] if ep["stage"] == "visual_review" else []
    res = call(ep, prompt, refs=refs)
    receipt = ep["receipt"]
    ep["receipt"] = None
    raw = res.reply_text or ""
    try:
        data = validate_reply(ep["stage"], raw, ep)
    except ValueError as exc:
        count = ep["rounds"].get("format", 0)
        ep["rounds"]["format"] = count + 1
        ep["format_error"] = str(exc)[:1500]
        ep["repair_reply"] = raw[-16000:]
        if count >= 2:
            hold(ep, "Muse trả sai cấu trúc sau hai lần yêu cầu sửa. " + ep["format_error"])
        else:
            ep["status"] = "queued"
        return "Cần sửa định dạng phản hồi.", {"reply": raw}, receipt
    apply_reply(ep, data)
    return "Đã nhận bàn giao.", data, receipt


def next_asset(ep):
    for scene, shot in zip(ep["script"]["scenes"], ep["manifest"]["scenes"]):
        n = str(scene["scene"])
        assets = ep["media"].setdefault(n, {})
        for key in ("image", "clip", "voice", "segment"):
            if not assets.get(key):
                return scene, shot, assets, key
    return None


def render_asset(ep):
    item = next_asset(ep)
    if not item:
        transition(ep, "assemble")
        return "Đủ cảnh để ghép.", None, None
    scene, shot, assets, key = item
    receipt = None
    n = scene["scene"]
    if key in ("image", "clip"):
        style = ep["manifest"]["continuity"] + "\n" + ep["channel"]["visual_style"]
        prompt = f"{ep['channel']['aspect']}. {style}\n" + (
            f"Tạo một ảnh minh họa. {shot['image_prompt']}"
            if key == "image"
            else f"Tạo video {scene['seconds']} giây theo đúng ảnh và chuyển động: {shot['motion_prompt']}"
        )
        if ep.get("feedback"):
            prompt += "\nGóp ý dựng hình: " + ep["feedback"]
        anchor = ep["media"].get("1", {}).get("image")
        refs = [assets["image"]] if key == "clip" else ([anchor] if anchor and n != 1 else [])
        res = call(ep, prompt, "video" if key == "clip" else "image", refs)
        if not res.local_path or not Path(res.local_path).is_file():
            raise ValueError("Chưa tải được file Muse. Đọc lại kết quả của lượt này.")
        assets[key], receipt = res.local_path, ep["receipt"]
    elif key == "voice":
        assets[key] = media.narrate(ep, scene)
    else:
        assets[key] = media.segment(ep, scene, assets)
    ep["receipt"] = None
    ep["status"] = "queued"
    if (
        key == "segment"
        and n == 1
        and ep["channel"]["preview_first"]
        and len(ep["script"]["scenes"]) > 1
        and not ep.get("sample_approved")
    ):
        ep["status"] = "sample_gate"
    return f"Cảnh {n} · {key}", {"scene": n, "asset": key, "path": assets[key]}, receipt


def run_one():
    ep = store.claim()
    if not ep:
        return False
    old_stage = ep["stage"]
    try:
        if old_stage == "assets":
            msg, artifact, receipt = render_asset(ep)
        elif old_stage == "assemble":
            ep["draft"] = media.draft(ep)
            transition(ep, "visual_review")
            msg, artifact, receipt = "Đã ghép bản dựng có giọng đọc.", {"draft": ep["draft"]}, None
        else:
            msg, artifact, receipt = editorial(ep)
    except Exception as exc:
        hold(ep, str(exc)[:2000] or type(exc).__name__)
        msg, artifact, receipt = ep["error"], None, ep.get("receipt")
    with store.transaction(True) as db:
        if not store.owns_claim(db, ep):
            return True
        store.log(db, {**ep, "stage": old_stage}, msg, artifact, receipt)
        ep.pop("claim", None)
        store.save(db, ep)
    return True


def loop(clock=False):
    last_minute = None
    while not stop.is_set():
        try:
            if clock:
                now = datetime.now().astimezone()
                minute = now.strftime("%Y-%m-%d %H:%M")
                if minute != last_minute:
                    store.schedule(now)
                    last_minute = minute
            elif run_one():
                continue
        except Exception:
            logger.exception("Lỗi hàng đợi sản xuất Muse")
        stop.wait(2 if clock else 1)


def supervise():
    while not stop.is_set():
        with store.worker_lock() as leader:
            if leader:
                store.recover()
                workers = [threading.Thread(target=loop, args=(i == 0,), daemon=True) for i in range(4)]
                for t in workers:
                    t.start()
                for t in workers:
                    t.join()
                return
        stop.wait(2)


def startup():
    if any(t.is_alive() for t in threads):
        return
    store.init()
    stop.clear()
    threads.clear()
    t = threading.Thread(target=supervise, name="muse-production", daemon=True)
    threads.append(t)
    t.start()


def shutdown():
    stop.set()
