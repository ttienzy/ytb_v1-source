import json
import shutil
import subprocess
import wave
import zipfile
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.muse_production import media, router, runner, store
from app.muse_production.contracts import Channel, NewEpisode, validate_reply
from app.workflow import muse_projects

BRIEF = {
    "topic": "Tin thử",
    "summary": "Tóm tắt",
    "facts": [
        {
            "claim": "Dữ kiện",
            "source_title": "Article",
            "evidence": "Excerpt",
            "url": "https://science.nasa.gov/news/test/",
        }
    ],
    "hooks": [{"angle": f"Góc {i}", "hook": f"Hook {i}"} for i in range(3)],
}
SCRIPT = {
    "title": "Tập thử",
    "hook": 1,
    "scenes": [
        {
            "scene": i,
            "seconds": 5,
            "narration": f"Câu {i}",
            "visual": "Mây",
            "mood": "Vui",
            "cut": "Cắt",
            "fact_ids": [1],
        }
        for i in (1, 2)
    ],
}
MANIFEST = {
    "continuity": "Màu xanh",
    "scenes": [{"scene": i, "image_prompt": "Mây", "motion_prompt": "Pan"} for i in (1, 2)],
}
YES = {"decision": "approved", "score": 9, "feedback": "Đạt.", "scenes": []}


@pytest.fixture
def studio(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ROOT", tmp_path / "studio")
    monkeypatch.setattr(muse_projects, "PROJECTS_DIR", tmp_path / "projects")
    store.init()
    channel = Channel(
        name="Khoa học",
        sources=["https://nasa.gov"],
        brand_voice="Ngắn",
        seconds=10,
        accounts={r: r for r in runner.ROLES},
        preview_first=True,
    )
    req = NewEpisode(request_id="first-episode-123", topic="Tin khoa học", channel=channel)
    return req, store.create(req)


def run_until_gate(eid):
    for _ in range(50):
        ep = store.get_episode(eid)
        if ep["status"] != "queued":
            return ep
        assert runner.run_one()
    pytest.fail("Queue did not reach a gate")


def act(ep, action, **kw):
    return router.action(ep["id"], router.Action(version=ep["version"], action=action, **kw))


def test_contracts_preserve_source_and_scene_alignment(studio):
    _, ep = studio
    assert validate_reply("scout", "Opening source…\n" + json.dumps(BRIEF), ep)["topic"] == "Tin thử"
    offsite = {**BRIEF, "facts": [{**BRIEF["facts"][0], "url": "https://nasa.gov.untrusted.test/news/"}]}
    with pytest.raises(ValueError, match="URL"):
        validate_reply("scout", json.dumps(offsite), ep)
    ep["brief"] = BRIEF
    with pytest.raises(ValueError, match="giây"):
        validate_reply("script", json.dumps({**SCRIPT, "scenes": SCRIPT["scenes"][:1]}), ep)
    timed = validate_reply("script", json.dumps(SCRIPT), ep)
    assert [(s["start_sec"], s["end_sec"]) for s in timed["scenes"]] == [(0, 5), (5, 10)]


def test_progress_message_does_not_finish_scout():
    from app.ai.muse.gateway import ChatResult
    from app.ai.muse.service import _has_structured_reply

    output = ChatResult(session_id="s", baseline_seq=0, reply_texts=["Đang mở trang NASA."])
    assert not _has_structured_reply(output)
    output.reply_texts.append(json.dumps(BRIEF))
    assert _has_structured_reply(output)


def test_fallback_before_dispatch_only(studio, monkeypatch):
    _, ep = studio
    accounts = SimpleNamespace(usable_accounts=lambda: [{"id": "scout"}, {"id": "backup"}])
    monkeypatch.setattr(runner.muse_service, "get_store", lambda: accounts)
    visited = []

    def generate(req, *, receipt, on_dispatch):
        visited.append(req.account_id)
        if req.account_id == "scout":
            return SimpleNamespace(ok=False, error="Hết phiên")
        on_dispatch({"account": req.account_id, "session": "s", "baseline": 0})
        return SimpleNamespace(ok=True, error=None, reply_text=json.dumps(BRIEF))

    monkeypatch.setattr(runner.muse_service, "generate_video", generate)
    runner.run_one()
    assert visited == ["scout", "backup"]
    assert store.get_episode(ep["id"])["stage"] == "brief_review"


def test_schedule_and_manual_submissions_are_idempotent(studio):
    req, ep = studio
    assert store.create(req)["id"] == ep["id"]
    store.save_channel(req.channel.model_copy(update={"daily_at": "08:30", "daily_topic": "Tin mới"}))
    store.schedule(datetime(2026, 11, 24, 8, 29))
    assert len(store.episodes()) == 1
    store.schedule(datetime(2026, 11, 24, 9))
    store.schedule(datetime(2026, 11, 24, 18))
    assert len(store.episodes()) == 2
    store.schedule(datetime(2026, 11, 25, 12))
    assert len(store.episodes()) == 3


def test_uncertain_dispatch_resumes_same_receipt_and_worker_claim(studio, monkeypatch):
    _, ep = studio
    got = []
    cursor = {"account": "scout", "session": "dedicated", "baseline": 15}
    monkeypatch.setattr(
        runner.muse_service, "get_store", lambda: SimpleNamespace(usable_accounts=lambda: [{"id": "scout"}])
    )

    def generate(req, *, receipt, on_dispatch):
        got.append(receipt)
        if not receipt:
            on_dispatch(cursor)
            raise RuntimeError("disconnected")
        return SimpleNamespace(ok=True, error=None, reply_text=json.dumps(BRIEF))

    monkeypatch.setattr(runner.muse_service, "generate_video", generate)
    runner.run_one()
    failed = store.get_episode(ep["id"])
    assert failed["status"] == "attention" and failed["receipt"] == cursor
    act(failed, "retry")
    runner.run_one()
    assert got == [None, cursor]
    assert store.get_episode(ep["id"])["stage"] == "brief_review"
    lost = store.claim()
    store.recover()
    reclaimed = store.claim()
    with store.transaction() as db:
        assert not store.owns_claim(db, lost) and store.owns_claim(db, reclaimed)


def test_rejected_brief_never_approves_after_limit(studio, monkeypatch):
    _, ep = studio
    reject = {**YES, "decision": "revise", "feedback": "Cần mới hơn"}
    monkeypatch.setattr(
        runner,
        "call",
        lambda e, *a, **k: SimpleNamespace(reply_text=json.dumps(BRIEF if e["stage"] == "scout" else reject)),
    )
    ended = run_until_gate(ep["id"])
    assert ended["status"] == "attention" and ended["script"] is None and ended["rounds"]["brief"] == 2


def test_malformed_json_has_bounded_repairs(studio, monkeypatch):
    _, ep = studio
    monkeypatch.setattr(runner, "call", lambda *a, **k: SimpleNamespace(reply_text="{oops}"))
    ended = run_until_gate(ep["id"])
    assert ended["status"] == "attention" and ended["rounds"]["format"] == 3


def test_asset_revision_only_rebuilds_selected_visuals(studio):
    _, ep = studio
    ep.update(
        status="draft_gate",
        stage="draft",
        script=SCRIPT,
        draft="draft.mp4",
        media={
            "1": {"image": "a", "clip": "b", "voice": "v", "segment": "c"},
            "2": {"image": "d", "clip": "e", "voice": "w", "segment": "f"},
        },
    )
    router.apply_action(
        ep, router.Action(version=ep["version"], action="revise", feedback="Sửa cảnh 2", scenes=[2])
    )
    assert ep["media"]["1"]["segment"] == "c" and ep["media"]["2"] == {"voice": "w"}
    assert not ep["draft"] and ep["stage"] == "assets"


@pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="requires local ffmpeg")
def test_end_to_end_draft_and_package(studio, tmp_path, monkeypatch):
    _, ep = studio
    clip, image, voice = tmp_path / "source.mp4", tmp_path / "source.png", tmp_path / "voice.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=blue:s=160x120:d=1",
            "-pix_fmt",
            "yuv420p",
            str(clip),
        ],
        check=True,
    )
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(clip), "-frames:v", "1", str(image)], check=True)
    with wave.open(str(voice), "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", ""))
        w.writeframes(bytes(32000))
    replies = {
        "scout": BRIEF,
        "brief_review": YES,
        "script": SCRIPT,
        "manifest": MANIFEST,
        "visual_review": YES,
    }

    def generate(e, prompt, kind="text", refs=()):
        if e["stage"] == "visual_review":
            assert Path(refs[0]).is_file()
        if kind == "text":
            return SimpleNamespace(reply_text=json.dumps(replies[e["stage"]]))
        return SimpleNamespace(local_path=str(clip if kind == "video" else image))

    monkeypatch.setattr(runner, "call", generate)
    monkeypatch.setattr(media, "narrate", lambda *a: str(voice))
    eid = ep["id"]
    script_gate = run_until_gate(eid)
    assert script_gate["status"] == "script_gate" and not script_gate["media"]
    act(script_gate, "approve")
    with pytest.raises(Exception) as stale:
        act(script_gate, "approve")
    assert stale.value.status_code == 409
    sample = run_until_gate(eid)
    assert sample["status"] == "sample_gate" and list(sample["media"]) == ["1"]
    act(sample, "approve")
    ready = run_until_gate(eid)
    assert ready["status"] == "draft_gate" and media.assemble.probe(Path(ready["draft"]))["duration"] >= 9.9
    snap = act(ready, "canvas")
    assert len(muse_projects.get_graph(snap["project"]).nodes) == 6
    assert media.canvas_snapshot(snap) == snap["project"]
    final = act(snap, "approve")
    assert final["status"] == "approved"
    app = FastAPI()
    app.include_router(router.router)
    client = TestClient(app)
    base = f"/api/muse-production/episodes/{eid}"
    assert client.get(base + "/files/trend_brief.json").json()["topic"] == BRIEF["topic"]
    assert client.get(base + "/assets/1/voice").content == voice.read_bytes()
    import io

    names = zipfile.ZipFile(io.BytesIO(client.get(base + "/package").content)).namelist()
    assert set(router.ARTIFACTS) <= set(names) and "draft.mp4" in names and "scenes/2/clip.mp4" in names


def test_recover_deduplicates_restart_logs(studio):
    _, ep = studio
    with store.transaction(True) as db:
        ep["status"] = "running"
        store.save(db, ep)

    store.recover()
    history1 = store.history(ep["id"])
    assert history1[0]["message"] == "Khôi phục công việc sau khi mở lại ứng dụng."

    # Gọi recover lần 2 ngay lập tức (mô phỏng server reload nhanh)
    with store.transaction(True) as db:
        ep["status"] = "running"
        store.save(db, ep)

    store.recover()
    history2 = store.history(ep["id"])
    # Không tạo thêm log trùng lặp
    assert len([h for h in history2 if h["message"] == "Khôi phục công việc sau khi mở lại ứng dụng."]) == 1


def test_flexible_channel_and_scene_duration_limit(studio):
    from pydantic import ValidationError
    from app.muse_production.contracts import Scene, prompt_for

    # 1. Channel không bắt buộc sources
    channel = Channel(name="Kênh tự do", seconds=50)
    assert channel.sources == []
    assert channel.brand_voice == "Tự nhiên, lôi cuốn, gần gũi và truyền cảm hứng."

    # 2. Scene seconds le=10 (vì Muse engine max 10s mỗi cảnh)
    with pytest.raises(ValidationError):
        Scene(scene=1, seconds=11, narration="Dài quá", visual="Hình", mood="Vui", cut="Cắt")

    valid_scene = Scene(scene=1, seconds=10, narration="Vừa vặn", visual="Hình", mood="Vui", cut="Cắt")
    assert valid_scene.seconds == 10

    # 3. Kịch bản 50s chia thành 5 cảnh x 10s
    ep = {
        "stage": "script",
        "topic": "Khám phá vũ trụ 50 giây",
        "channel": channel.model_dump(),
        "brief": BRIEF,
        "rounds": {"format": 0, "brief": 0, "visual": 0},
    }
    script_50s = {
        "title": "Hành trình 50s",
        "hook": 1,
        "scenes": [
            {
                "scene": i,
                "seconds": 10,
                "narration": f"Đoạn {i}",
                "visual": f"Cảnh {i}",
                "mood": "Kỳ bí",
                "cut": "Chuyển",
                "fact_ids": [1],
            }
            for i in range(1, 6)
        ],
    }
    validated = validate_reply("script", json.dumps(script_50s), ep)
    assert len(validated["scenes"]) == 5
    assert sum(s["seconds"] for s in validated["scenes"]) == 50
    assert [(s["start_sec"], s["end_sec"]) for s in validated["scenes"]] == [
        (0, 10),
        (10, 20),
        (20, 30),
        (30, 40),
        (40, 50),
    ]

    # 4. Prompt stage script hướng dẫn đúng quy tắc cảnh <= 10s và chia 5 cảnh cho 50s
    prompt_script = prompt_for(ep, [])
    assert "tối đa 10 giây" in prompt_script
    assert "50 giây" in prompt_script
    assert "5 phân cảnh" in prompt_script

    # 5. Prompt stage scout khi sources rỗng
    ep["stage"] = "scout"
    prompt_scout = prompt_for(ep, [])
    assert "nghiên cứu nội dung và phát triển dữ liệu" in prompt_scout
    # Khi sources rỗng, validate_reply không chặn URL ngoài
    scout_reply = validate_reply(
        "scout",
        json.dumps({**BRIEF, "facts": [{**BRIEF["facts"][0], "url": "https://anywhere.org/news"}]}),
        ep,
    )
    assert scout_reply["facts"][0]["url"] == "https://anywhere.org/news"

    # 6. Cho phép approve brief khi đang ở trạng thái attention để chuyển sang script
    attention_ep = {
        "version": 1,
        "status": "attention",
        "stage": "brief_review",
        "brief": BRIEF,
        "script": None,
        "rounds": {"brief": 2, "format": 0, "visual": 0},
        "feedback": "",
        "channel": channel.model_dump(),
    }
    router.apply_action(attention_ep, router.Action(version=1, action="approve"))
    assert attention_ep["status"] == "queued"
    assert attention_ep["stage"] == "script"
    assert attention_ep["rounds"]["brief"] == 0
