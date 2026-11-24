"""Local Muse editorial workflow API."""

import json
import tempfile
import zipfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from . import media, runner, store
from .contracts import Channel, NewEpisode

router = APIRouter(prefix="/api/muse-production", tags=["Muse Production"])


class Action(BaseModel):
    version: int
    action: Literal["approve", "revise", "revise_script", "retry", "resubmit", "canvas", "pin"]
    feedback: str = Field(default="", max_length=4000)
    scenes: list[int] = Field(default_factory=list)


def episode(eid):
    try:
        return store.get_episode(eid)
    except KeyError:
        raise HTTPException(404, "Không tìm thấy tập.")


@router.get("/channels")
def channels():
    return store.channels()


@router.put("/channels")
def save_channel(channel: Channel):
    channel.accounts = runner.roles_for(channel.model_dump())
    store.save_channel(channel)
    return channel


@router.get("/episodes")
def episodes(page: int | None = None):
    return store.episodes() if page is None else store.episode_page(page)


@router.post("/episodes")
def create(req: NewEpisode):
    req.channel.accounts = runner.roles_for(req.channel.model_dump())
    return store.create(req)


@router.get("/episodes/{eid}")
def detail(eid: str):
    return episode(eid)


@router.get("/episodes/{eid}/history")
def history(eid: str):
    episode(eid)
    return store.history(eid)


@router.get("/episodes/{eid}/history/{seq}")
def version(eid: str, seq: int):
    with store.transaction() as db:
        r = db.execute("SELECT artifact FROM event WHERE episode=? AND seq=?", (eid, seq)).fetchone()
    if not r or not r[0]:
        raise HTTPException(404, "Không tìm thấy bản bàn giao.")
    return json.loads(r[0])


def apply_action(ep, cmd):
    if ep["version"] != cmd.version or ep["status"] in ("running", "queued"):
        raise store.Conflict("Tập vừa thay đổi. Hãy xem phiên bản mới nhất.")
    status = ep["status"]
    if cmd.action == "canvas" and ep["manifest"]:
        ep["project"] = media.canvas_snapshot(ep)
    elif cmd.action == "approve" and status == "script_gate":
        runner.transition(ep, "manifest")
    elif cmd.action == "approve" and status == "sample_gate":
        ep["sample_approved"] = True
        runner.transition(ep, "assets")
    elif cmd.action == "approve" and status == "draft_gate":
        runner.transition(ep, "draft", "approved")
    elif cmd.action == "approve" and status == "attention" and ep.get("brief") and not ep.get("script"):
        ep["rounds"]["brief"] = 0
        runner.transition(ep, "script")
    elif (
        cmd.action == "revise_script"
        and ep["script"]
        and status in ("sample_gate", "draft_gate", "attention", "approved")
    ):
        if not cmd.feedback.strip() or ep.get("receipt"):
            raise store.Conflict("Cần góp ý cho kịch bản và xử lý lượt Muse đang dở.")
        ep["previous_cut"] = {"script": ep["script"], "manifest": ep["manifest"], "media": ep["media"]}
        ep.update(
            feedback=cmd.feedback.strip(),
            media={},
            manifest=None,
            draft=None,
            project=None,
            sample_approved=False,
            review=None,
        )
        ep["rounds"]["visual"] = 0
        runner.transition(ep, "script")
    elif cmd.action == "revise" and status in ("script_gate", "sample_gate", "draft_gate", "attention"):
        if not cmd.feedback.strip():
            raise store.Conflict("Nhập góp ý trước khi yêu cầu sửa.")
        ep["feedback"] = cmd.feedback.strip()
        if status == "script_gate":
            runner.transition(ep, "script")
        elif (
            status == "sample_gate"
            or status == "draft_gate"
            or (status == "attention" and ep["stage"] == "visual_review")
        ):
            targets = [1] if status == "sample_gate" else cmd.scenes
            if not targets or not set(targets) <= set(range(1, len(ep["script"]["scenes"]) + 1)):
                raise store.Conflict("Chọn đúng số cảnh cần sửa.")
            runner.redo_scenes(ep, targets)
            ep["rounds"]["visual"] = 0
            runner.transition(ep, "assets")
        else:
            if ep.get("receipt"):
                raise store.Conflict("Hãy đọc lại lượt Muse đang dở trước khi sửa.")
            ep["rounds"]["brief"] = 0
            runner.transition(ep, "scout" if ep["stage"] == "brief_review" else ep["stage"])
    elif cmd.action in ("retry", "resubmit") and status == "attention":
        if cmd.action == "resubmit":
            ep["receipt"] = None
        ep.update(status="queued", error="")
    else:
        raise store.Conflict("Thao tác không phù hợp ở bước này.")


@router.post("/episodes/{eid}/actions")
def action(eid: str, cmd: Action):
    try:
        with store.transaction(True) as db:
            ep = store.get(db, eid)
            prior = ep["stage"]
            if cmd.action == "pin":
                note = cmd.feedback.strip()
                if not note:
                    raise store.Conflict("Nhập quy tắc cần ghim.")
                row = db.execute("SELECT data FROM channel WHERE name=?", (ep["channel"]["name"],)).fetchone()
                ch = json.loads(row[0]) if row else {**ep["channel"], "daily_at": ""}
                if note not in ch["rules"]:
                    ch["rules"] = [*ch["rules"], note]
                config = Channel.model_validate(ch)
                db.execute(
                    "INSERT OR REPLACE INTO channel VALUES (?,?)", (config.name, config.model_dump_json())
                )
                store.log(db, ep, "Đã ghim quy tắc cho các tập sau.", {"rule": note})
                return ep
            apply_action(ep, cmd)
            store.log(db, {**ep, "stage": prior}, "Người dùng · " + cmd.action, cmd.model_dump())
            store.save(db, ep)
            return ep
    except KeyError:
        raise HTTPException(404, "Không tìm thấy tập.")
    except ValueError as e:
        raise HTTPException(409, str(e))


ARTIFACTS = {
    "trend_brief.json": "brief",
    "production_script.json": "script",
    "render_manifest.json": "manifest",
}


@router.get("/episodes/{eid}/files/{name}")
def file(eid: str, name: str):
    ep = episode(eid)
    if name in ARTIFACTS and ep.get(ARTIFACTS[name]):
        return JSONResponse(
            ep[ARTIFACTS[name]], headers={"Content-Disposition": f'attachment; filename="{name}"'}
        )
    if name == "draft.mp4" and ep["draft"] and Path(ep["draft"]).is_file():
        return FileResponse(ep["draft"], media_type="video/mp4")
    raise HTTPException(404, "Tập chưa có file này.")


@router.get("/episodes/{eid}/assets/{number}/{kind}")
def asset(eid: str, number: int, kind: str):
    ep = episode(eid)
    path = ep["media"].get(str(number), {}).get(kind)
    if kind not in ("image", "clip", "voice", "segment") or not path or not Path(path).is_file():
        raise HTTPException(404, "Cảnh chưa có file này.")
    return FileResponse(path)


@router.get("/episodes/{eid}/package")
def package(eid: str):
    ep = episode(eid)
    if not ep["draft"]:
        raise HTTPException(409, "Chưa có bản dựng.")
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        archive = Path(tmp.name)
    try:
        with zipfile.ZipFile(archive, "w", allowZip64=True) as z:
            for filename, key in ARTIFACTS.items():
                z.writestr(filename, json.dumps(ep[key], ensure_ascii=False, indent=2))
            for n, assets in ep["media"].items():
                for key, path in assets.items():
                    z.write(path, f"scenes/{n}/{key}{Path(path).suffix}")
            z.write(ep["draft"], "draft.mp4")
    except Exception:
        archive.unlink(missing_ok=True)
        raise
    return FileResponse(
        archive,
        media_type="application/zip",
        filename=f"muse-{eid[:8]}.zip",
        background=BackgroundTask(archive.unlink, missing_ok=True),
    )
