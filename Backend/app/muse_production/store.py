"""Local, durable editorial queue. Media stays on disk, editorial versions stay in SQLite."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime

from app.core.config import DATA_DIR
from app.core.pagination import LIBRARY_PAGE_SIZE, page_window
from .contracts import Channel, NewEpisode

ROOT = DATA_DIR / "muse_production"


class Conflict(ValueError):
    pass


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


@contextmanager
def transaction(write=False):
    ROOT.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(ROOT / "production.sqlite3", timeout=15)
    db.row_factory = sqlite3.Row
    try:
        if write:
            db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    finally:
        db.close()


def init():
    with transaction(True) as db:
        db.execute("CREATE TABLE IF NOT EXISTS channel (name TEXT PRIMARY KEY, data TEXT NOT NULL)")
        db.execute("""CREATE TABLE IF NOT EXISTS episode (
            id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, channel TEXT NOT NULL,
            status TEXT NOT NULL, updated REAL NOT NULL, body TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS queue ON episode(status, updated)")
        db.execute("""CREATE TABLE IF NOT EXISTS event (
            seq INTEGER PRIMARY KEY, episode TEXT NOT NULL, at REAL NOT NULL, stage TEXT NOT NULL,
            message TEXT NOT NULL, artifact TEXT, account TEXT, session TEXT)""")
        db.execute("CREATE INDEX IF NOT EXISTS episode_events ON event(episode, seq)")


def save_channel(channel: Channel):
    with transaction(True) as db:
        db.execute("INSERT OR REPLACE INTO channel VALUES (?,?)", (channel.name, channel.model_dump_json()))


def channels():
    with transaction() as db:
        return [json.loads(r[0]) for r in db.execute("SELECT data FROM channel ORDER BY name")]


def _new(db, topic, channel, request_id):
    existing = db.execute("SELECT body FROM episode WHERE request_id=?", (request_id,)).fetchone()
    if existing:
        return json.loads(existing[0])
    eid = uuid.uuid4().hex
    ep = dict(
        id=eid,
        topic=topic,
        channel=channel,
        stage="scout",
        status="queued",
        version=1,
        brief=None,
        script=None,
        manifest=None,
        draft=None,
        media={},
        rounds={},
        receipt=None,
        feedback="",
        error="",
        created=time.time(),
        review=None,
        project=None,
    )
    db.execute(
        "INSERT INTO episode VALUES (?,?,?,?,?,?)",
        (eid, request_id, channel["name"], "queued", time.time(), encode(ep)),
    )
    log(db, ep, "Đã xếp lịch săn tin.")
    return ep


def create(req: NewEpisode):
    with transaction(True) as db:
        return _new(db, req.topic, req.channel.model_dump(mode="json"), req.request_id)


def schedule(now: datetime):
    with transaction(True) as db:
        for row in db.execute("SELECT data FROM channel"):
            ch = json.loads(row[0])
            if ch["daily_at"] and now.strftime("%H:%M") >= ch["daily_at"]:
                key = f"daily/{ch['name']}/{now.date().isoformat()}"
                _new(db, ch["daily_topic"], ch, key)


def get(db, eid):
    row = db.execute("SELECT body, updated FROM episode WHERE id=?", (eid,)).fetchone()
    if row is None:
        raise KeyError(eid)
    data = json.loads(row[0])
    data["updated"] = row[1]
    return data


def log(db, ep, message, artifact=None, receipt=None):
    receipt = receipt or {}
    db.execute(
        "INSERT INTO event (episode,at,stage,message,artifact,account,session) VALUES(?,?,?,?,?,?,?)",
        (
            ep["id"],
            time.time(),
            ep["stage"],
            message,
            encode(artifact) if artifact is not None else None,
            receipt.get("account"),
            receipt.get("session"),
        ),
    )


def save(db, ep):
    ep["version"] += 1
    now = time.time()
    ep["updated"] = now
    db.execute(
        "UPDATE episode SET status=?,updated=?,body=? WHERE id=?",
        (ep["status"], now, encode(ep), ep["id"]),
    )


def get_episode(eid):
    with transaction() as db:
        return get(db, eid)


def episode_page(page):
    with transaction() as db:
        total = db.execute("SELECT COUNT(*) FROM episode").fetchone()[0]
        page, offset = page_window(page, total)
        items = [
            dict(r)
            for r in db.execute(
                """SELECT id,channel,status,updated,
            json_extract(body, '$.topic') AS topic, json_extract(body, '$.stage') AS stage
            FROM episode ORDER BY rowid DESC LIMIT ? OFFSET ?""",
                (LIBRARY_PAGE_SIZE, offset),
            )
        ]
        return {"items": items, "total": total, "page": page, "page_size": LIBRARY_PAGE_SIZE}


def episodes():
    return episode_page(1)["items"]


def recent(ep):
    with transaction() as db:
        return [
            dict(r)
            for r in db.execute(
                """SELECT coalesce(json_extract(body,'$.brief.topic'),json_extract(body,'$.topic')) AS topic,
                   substr(json_extract(body,'$.brief.summary'),1,220) AS summary,
                   json_extract(body,'$.brief.facts[0].url') AS source,
                   json_extract(body,'$.script.title') AS title
            FROM episode WHERE channel=? AND id<>? ORDER BY rowid DESC LIMIT 30""",
                (ep["channel"]["name"], ep["id"]),
            )
        ]


def history(eid):
    with transaction() as db:
        get(db, eid)
        return [
            dict(r)
            for r in db.execute(
                """SELECT seq,at,stage,message,account,session,
            artifact IS NOT NULL AS has_artifact FROM event WHERE episode=? ORDER BY seq DESC""",
                (eid,),
            )
        ]


def claim():
    with transaction(True) as db:
        row = db.execute("SELECT body FROM episode WHERE status='queued' ORDER BY updated LIMIT 1").fetchone()
        if not row:
            return None
        ep = json.loads(row[0])
        ep["status"] = "running"
        ep["claim"] = uuid.uuid4().hex
        save(db, ep)
        return ep


def recover():
    with transaction(True) as db:
        now = time.time()
        for row in db.execute("SELECT body FROM episode WHERE status='running'").fetchall():
            ep = json.loads(row[0])
            ep["status"] = "queued"
            ep.pop("claim", None)
            last_event = db.execute(
                "SELECT message, at FROM event WHERE episode=? ORDER BY seq DESC LIMIT 1",
                (ep["id"],),
            ).fetchone()
            msg = "Khôi phục công việc sau khi mở lại ứng dụng."
            if not last_event or last_event["message"] != msg or (now - last_event["at"] > 120):
                log(db, ep, msg)
            save(db, ep)


def owns_claim(db, ep):
    current = get(db, ep["id"])
    return current["status"] == "running" and current.get("claim") == ep.get("claim")


def set_live_message(eid: str, msg: str):
    if not eid or not msg:
        return
    with transaction(True) as db:
        row = db.execute("SELECT body FROM episode WHERE id=?", (eid,)).fetchone()
        if row:
            data = json.loads(row[0])
            clean = msg.strip()[:1000]
            if data.get("live_message") != clean:
                data["live_message"] = clean
                db.execute("UPDATE episode SET body=? WHERE id=?", (encode(data), eid))


@contextmanager
def worker_lock():
    """A single scheduler/worker group may claim this data directory, including during reload."""
    import os

    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / "worker.lock").open("a+b") as lock:
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
        else:
            yield True
