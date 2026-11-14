"""Bộ chạy: idempotent, lỗi, không gửi lại bước tốn tiền, hủy, khôi phục sau khởi động lại."""
import threading

import pytest
from sqlalchemy import select

from app.campaign.models import Run
from app.campaign.runner import ArtifactSpec, ExecResult, ExecState, SubmittedUnknown

from .conftest import approve_scene_anchors, element_state, prime, run_and_wait


def runs(svc, cid, step=None):
    return [r for r in svc.list_runs(cid) if step is None or r["step_key"] == step]


def ready(svc, cid):
    approve_scene_anchors(svc, cid)
    run_and_wait(svc, cid, "script")


def test_executor_error_is_recorded_and_downstream_does_not_run(env):
    svc, calls, executors = env
    cid = prime(svc)

    def boom(ctx):
        raise RuntimeError("Gemini lỗi mạng")
    executors["fact_sheet"] = boom
    run_and_wait(svc, cid, "script")
    assert [c for c in calls if c[0] != "cast_sheet"] == []              # script không chạy (cast_sheet là việc độc lập)
    r = runs(svc, cid, "fact_sheet")[0]
    assert r["state"] == "error" and "Gemini lỗi mạng" in r["error"]
    assert element_state(svc, cid, "fact_sheet")["state"] == "missing"
    assert element_state(svc, cid, "script")["state"] == "blocked"
    assert len(runs(svc, cid, "fact_sheet")) == 1                          # không tự retry


def test_missing_executor_gives_clear_error(env):
    svc, calls, executors = env
    cid = prime(svc)
    executors.pop("fact_sheet")
    run_and_wait(svc, cid, "fact_sheet")
    err = runs(svc, cid, "fact_sheet")[0]["error"]
    assert "Chưa có executor" in err and "khởi động lại Backend" in err


def test_paid_step_never_resends_after_unknown(env):
    svc, calls, executors = env
    cid = prime(svc)
    ready(svc, cid)
    sent = []

    def flaky(ctx):
        ctx.set_external_ref(f"veo-job-{ctx.element_key}")
        sent.append(ctx.element_key)
        if ctx.element_key == "shot:2":
            raise SubmittedUnknown("Mất kết nối sau khi gửi")
        return ExecResult([ArtifactSpec("video", ext="mp4", data=b"v-" + ctx.element_key.encode())], credit_actual=10)
    executors["clip"] = flaky

    run_and_wait(svc, cid, "clip", confirm=True)
    assert sorted(sent) == ["shot:1", "shot:2", "shot:3", "shot:4"]
    unknown = [r for r in runs(svc, cid, "clip") if r["state"] == "unknown"]
    assert len(unknown) == 1 and unknown[0]["external_ref"] == "veo-job-shot:2"

    st = element_state(svc, cid, "clip", "shot:2")
    assert st["state"] == "blocked" and st["blockers"][0]["dep"] == "run"
    plan = svc.plan(cid, "clip")
    assert [i["action"] for i in plan["items"] if i["step_key"] == "clip" and i["element_key"] == "shot:2"] == ["blocked"]

    sent.clear()
    out = svc.run(cid, "clip", confirm_credit=True)
    assert out["exec_id"] is None and sent == []                          # KHÔNG gửi lại

    svc.resolve_run(unknown[0]["id"], "not_sent")
    assert element_state(svc, cid, "clip", "shot:2")["state"] == "missing"
    run_and_wait(svc, cid, "clip", confirm=True)
    assert sent == ["shot:2"]


def test_concurrent_identical_work_joins_instead_of_resubmitting(env):
    svc, calls, executors = env
    cid = prime(svc)
    started, release = threading.Event(), threading.Event()
    n = []

    def slow(ctx):
        n.append(1)
        started.set()
        release.wait(10)
        return ExecResult([ArtifactSpec("json", json={"ok": True})])
    executors["fact_sheet"] = slow

    runner = svc.runner
    ex1, ex2 = ExecState("e1", cid), ExecState("e2", cid)
    t1 = threading.Thread(target=runner._run_one, args=(ex1, cid, "fact_sheet", "", "draft"))
    t1.start()
    assert started.wait(10)
    t2 = threading.Thread(target=runner._run_one, args=(ex2, cid, "fact_sheet", "", "draft"))
    t2.start()
    release.set()
    t1.join(10), t2.join(10)
    assert len(n) == 1
    assert len(runs(svc, cid, "fact_sheet")) == 1


def test_one_execution_per_campaign_and_cancel(env):
    svc, calls, executors = env
    cid = prime(svc)
    started, release = threading.Event(), threading.Event()

    def slow(ctx):
        started.set()
        release.wait(10)
        return ExecResult([ArtifactSpec("json", json={"ok": True})])
    executors["fact_sheet"] = slow

    out = svc.run(cid, "script")
    assert started.wait(10)
    from app.campaign.runner import AlreadyRunning
    with pytest.raises(AlreadyRunning):
        svc.run(cid, "script")
    assert svc.runner.cancel(cid) is True
    release.set()
    assert svc.runner.wait(out["exec_id"], 10)
    assert svc.runner.status(out["exec_id"])["state"] == "cancelled"
    assert not any(c[0] == "script" for c in calls)
    assert svc.runner.active_exec(cid) is None


def test_recover_after_restart(env):
    svc, calls, executors = env
    cid = prime(svc)
    with svc.session() as s:
        s.add(Run(campaign_id=cid, step_key="clip", element_key="shot:1", fingerprint="f1", state="running", external_ref="veo-job-9"))
        s.add(Run(campaign_id=cid, step_key="fact_sheet", element_key="", fingerprint="f2", state="running"))
    assert svc.runner.recover() == 2
    by_step = {r["step_key"]: r for r in svc.list_runs(cid)}
    assert by_step["clip"]["state"] == "unknown" and by_step["clip"]["external_ref"] == "veo-job-9"
    assert "KHÔNG tự gửi lại" in by_step["clip"]["error"]
    assert by_step["fact_sheet"]["state"] == "error"


def test_ledger_records_credit_and_attempts(svc, calls):
    cid = prime(svc)
    ready(svc, cid)
    run_and_wait(svc, cid, "clip", confirm=True)
    clip_runs = runs(svc, cid, "clip")
    assert len(clip_runs) == 4 and all(r["state"] == "done" and r["credit_actual"] == 20 for r in clip_runs)
    assert all(r["attempt"] == 1 for r in clip_runs)
    with svc.session() as s:
        assert svc.engine.spent_credit(s, cid) == 80


def test_delete_campaign_removes_rows_and_files(svc, tmp_path):
    cid = prime(svc)
    run_and_wait(svc, cid, "fact_sheet")
    assert (tmp_path / "campaigns" / cid).exists()
    svc.delete_campaign(cid)
    assert not (tmp_path / "campaigns" / cid).exists()
    assert svc.list_campaigns() == []
    with svc.session() as s:
        assert s.scalars(select(Run)).all() == []


def test_progress_is_reported_while_running_and_cleared_after(env):
    svc, calls, executors = env
    cid = prime(svc)
    started, release = threading.Event(), threading.Event()

    def slow(ctx):
        ctx.report("Khung đầu: đang tạo…")
        started.set()
        release.wait(10)
        return ExecResult([ArtifactSpec("json", json={"ok": True})])
    executors["fact_sheet"] = slow
    out = svc.run(cid, "fact_sheet")
    assert started.wait(10)
    el = next(e for b in svc.state(cid)["blocks"] for s in b["steps"] if s["key"] == "fact_sheet" for e in s["elements"])
    assert el["active_run"] and el["progress"]["message"] == "Khung đầu: đang tạo…" and el["progress"]["started_at"] > 0
    release.set()
    assert svc.runner.wait(out["exec_id"], 10)
    el = next(e for b in svc.state(cid)["blocks"] for s in b["steps"] if s["key"] == "fact_sheet" for e in s["elements"])
    assert el["progress"] is None and svc.runner.progress_for(cid) == {}
