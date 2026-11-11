"""Bộ chạy: hàng đợi theo làn, idempotent, hủy được, khôi phục sau khi khởi động lại.

Nguyên tắc bất di bất dịch (docs/PLAN §3.4):
  * Bước tốn credit (paid) KHÔNG BAO GIỜ tự gửi lại. Nếu không rõ đã gửi hay chưa -> run "unknown", chặn chạy
    lại cho đến khi người dùng xác nhận (resolve_run).
  * Việc đang chạy trùng vân tay thì GIA NHẬP (đợi kết quả), không tạo job thứ hai.
  * Một chiến dịch chỉ có một lượt thực thi đang chạy.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, wait
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterator

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import graph
from .engine import Engine, Plan
from .fingerprint import canonical, sha
from .models import Run
from .store import ArtifactStore

logger = logging.getLogger("campaign.runner")


class SubmittedUnknown(RuntimeError):
    """Executor ném khi ĐÃ gửi việc tốn tiền nhưng không biết kết quả. Runner không bao giờ tự gửi lại."""


class ConfirmRequired(Exception):
    def __init__(self, plan: Plan):
        super().__init__("Cần xác nhận credit trước khi chạy.")
        self.plan = plan


class OverBudget(Exception):
    def __init__(self, plan: Plan):
        super().__init__("Vượt trần credit của chiến dịch.")
        self.plan = plan


class AlreadyRunning(Exception):
    pass


@dataclass
class ArtifactSpec:
    kind: str
    ext: str = "json"
    data: bytes | None = None
    json: Any = None
    meta: dict[str, Any] = field(default_factory=dict)
    # Nếu có: đây là artifact "bundle" gom các artifact ĐÃ tạo trước đó trong cùng kết quả: [(chỉ số, vai trò), ...]
    members: list[tuple[int, str]] | None = None


@dataclass
class ExecResult:
    artifacts: list[ArtifactSpec]
    credit_actual: int | None = None
    primary: int = 0            # artifact nào được chọn làm đầu ra hiện tại


@dataclass
class ExecContext:
    campaign_id: str
    step_key: str
    element_key: str
    tier: str
    params: dict[str, Any]
    inputs: dict[str, list[dict[str, Any]]]
    fingerprint: str
    note: str                                   # ghi chú từ lần từ chối cổng trước (đưa vào prompt lần chạy lại)
    store: ArtifactStore
    set_external_ref: Callable[[str], None]
    cancelled: Callable[[], bool]
    prompts: Any = None                         # PromptLibrary, để executor dựng prompt cuối cùng
    report: Callable[[str], None] = lambda message: None   # báo khâu đang chạy cho giao diện (vd. "Khung đầu...")
    attempt: int = 1                            # lần thử thứ mấy của cùng vân tay (chạy lại sau khi người dùng xác nhận = lần mới)


Executor = Callable[[ExecContext], ExecResult]
ERROR_MAX = 1500        # độ dài tối đa của lỗi ghi vào sổ chạy (giữ đủ lý do Flow trả về)

# Các giai đoạn sau đăng ký executor thật vào đây (hoặc truyền riêng khi test).
DEFAULT_EXECUTORS: dict[str, Executor] = {}


def register_executor(step_key: str, fn: Executor) -> None:
    graph.get_step(step_key)
    DEFAULT_EXECUTORS[step_key] = fn


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class ExecState:
    id: str
    campaign_id: str
    cancel: threading.Event = field(default_factory=threading.Event)
    state: str = "running"      # running | done | cancelled | error
    started_at: datetime = field(default_factory=_now)
    finished_at: datetime | None = None
    done_event: threading.Event = field(default_factory=threading.Event)
    error: str = ""


class Runner:
    def __init__(self, engine: Engine, session_factory: Callable[[], Session],
                 executors: dict[str, Executor] | None = None):
        self.engine = engine
        self._factory = session_factory
        self.executors = DEFAULT_EXECUTORS if executors is None else executors
        self._pools = {lane: ThreadPoolExecutor(max_workers=n, thread_name_prefix=f"campaign-{lane}")
                       for lane, n in graph.LANE_LIMITS.items()}
        self._lock = threading.Lock()
        self._inflight: dict[tuple[str, str], threading.Event] = {}
        self._progress: dict[tuple[str, str, str], dict[str, Any]] = {}
        self._execs: dict[str, ExecState] = {}

    @contextmanager
    def _scope(self) -> Iterator[Session]:
        s = self._factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    # ── API ──────────────────────────────────────────────────────────────────
    def execute(self, campaign_id: str, target: str | None = None, tier: str = "draft",
                only_approved: bool | None = None, confirm_credit: bool = False,
                elements: list[str] | None = None) -> tuple[str | None, Plan]:
        with self._scope() as s:
            plan = self.engine.plan(s, campaign_id, target, tier, only_approved, elements)
        if plan.runnable == 0:
            return None, plan
        if plan.over_budget:
            raise OverBudget(plan)
        if plan.needs_confirm and not confirm_credit:
            raise ConfirmRequired(plan)
        with self._lock:
            if any(e.campaign_id == campaign_id and e.state == "running" for e in self._execs.values()):
                raise AlreadyRunning("Chiến dịch đang chạy. Hãy hủy hoặc đợi xong.")
            ex = ExecState(id=uuid.uuid4().hex[:12], campaign_id=campaign_id)
            self._execs[ex.id] = ex
        threading.Thread(target=self._coordinate, args=(ex, target, tier, only_approved, elements),
                         daemon=True, name=f"campaign-exec-{ex.id}").start()
        return ex.id, plan

    def wait(self, exec_id: str, timeout: float = 30.0) -> bool:
        ex = self._execs.get(exec_id)
        return bool(ex and ex.done_event.wait(timeout))

    def status(self, exec_id: str) -> dict[str, Any] | None:
        ex = self._execs.get(exec_id)
        if ex is None:
            return None
        return {"id": ex.id, "campaign_id": ex.campaign_id, "state": ex.state, "error": ex.error,
                "started_at": ex.started_at.isoformat(), "finished_at": ex.finished_at.isoformat() if ex.finished_at else None}

    def progress_for(self, campaign_id: str) -> dict[tuple[str, str], dict[str, Any]]:
        """{(step, element): {message, started_at}} của các việc đang chạy."""
        return {(k[1], k[2]): dict(v) for k, v in list(self._progress.items()) if k[0] == campaign_id}

    def active_exec(self, campaign_id: str) -> str | None:
        return next((e.id for e in self._execs.values() if e.campaign_id == campaign_id and e.state == "running"), None)

    def cancel(self, campaign_id: str) -> bool:
        hit = False
        for e in self._execs.values():
            if e.campaign_id == campaign_id and e.state == "running":
                e.cancel.set()
                hit = True
        return hit

    # ── điều phối ────────────────────────────────────────────────────────────
    def _coordinate(self, ex: ExecState, target: str | None, tier: str, only_approved: bool | None,
                    elements: list[str] | None = None) -> None:
        only_approved = bool(only_approved)          # 720p không bắt buộc phải duyệt bản 360p trước (xem engine.plan)
        try:
            needed = graph.needed_for(target)
            for sd in graph.STEPS:
                if ex.cancel.is_set():
                    break
                if sd.key not in needed or sd.kind != "compute":
                    continue
                with self._scope() as s:
                    only = set(elements) if elements is not None and sd.key == target else None
                    todo = self._collect(s, ex.campaign_id, sd, tier, only_approved, only)
                if not todo:
                    continue
                pool = self._pools[sd.lane]
                futures: list[Future] = [pool.submit(self._run_one, ex, ex.campaign_id, sd.key, e, tier) for e in todo]
                wait(futures)
                for f in futures:
                    exc = f.exception()
                    if exc:
                        logger.error("Run %s lỗi ngoài dự kiến: %s", sd.key, exc)
            ex.state = "cancelled" if ex.cancel.is_set() else "done"
        except Exception as exc:  # noqa: BLE001
            logger.exception("Coordinator lỗi")
            ex.state, ex.error = "error", str(exc)[:300]
        finally:
            ex.finished_at = _now()
            ex.done_event.set()

    def _collect(self, s: Session, cid: str, sd: graph.StepDef, tier: str, only_approved: bool,
                 only: set[str] | None = None) -> list[str]:
        elems = self.engine.elements(s, cid, sd) if sd.map_from else [""]
        todo: list[str] = []
        for e in elems or []:
            if only is not None and e not in only:
                continue
            st = self.engine.state_of(s, cid, sd, e, tier)
            if st.blockers or st.state not in ("missing", "stale"):
                continue
            if self.engine.awaiting_approval(s, cid, sd, e):
                continue
            if only_approved and sd.uses_tier and sd.gate and tier == "final":
                g = self.engine._gate_row(s, cid, sd.key, e)
                if g is None or g.state != "approved":
                    continue
            if st.cached_artifact_id:
                self.engine.store.select(s, cid, sd.key, e, st.cached_artifact_id)
                s.add(Run(campaign_id=cid, step_key=sd.key, element_key=e, fingerprint=st.fingerprint, state="cached",
                          credit_est=0, credit_actual=0, artifact_id=st.cached_artifact_id,
                          started_at=_now(), finished_at=_now()))
                continue
            todo.append(e)
        return todo

    # ── một việc ─────────────────────────────────────────────────────────────
    def _run_one(self, ex: ExecState, cid: str, step_key: str, element_key: str, tier: str) -> None:
        sd = graph.get_step(step_key)
        s = self._factory()
        key: tuple[str, str] | None = None
        run_id = ""
        owner = False
        try:
            if ex.cancel.is_set():
                return
            st = self.engine.state_of(s, cid, sd, element_key, tier)
            if st.blockers or st.state not in ("missing", "stale") or self.engine.awaiting_approval(s, cid, sd, element_key):
                return
            fp = st.fingerprint or ""
            key = (cid, fp)
            with self._lock:
                event = self._inflight.get(key)
                if event is None:
                    self._inflight[key] = threading.Event()
                    owner = True
            if not owner:
                event.wait(timeout=3600)          # gia nhập việc đang chạy, không gửi lại
                return
            # Việc trùng vân tay có thể vừa xong giữa lúc kiểm tra và lúc nhận quyền chạy: kiểm lại với dữ liệu mới.
            s.rollback()
            st = self.engine.state_of(s, cid, sd, element_key, tier)
            if st.blockers or st.state not in ("missing", "stale"):
                return
            parts, _, refs = self.engine.current_parts(s, cid, sd, element_key, tier)

            params = self.engine.get_params(s, cid, step_key, element_key)
            attempt = len(s.scalars(select(Run.id).where(Run.campaign_id == cid, Run.fingerprint == fp)).all()) + 1
            est = (sd.cost(params, tier) if sd.cost else 0) if sd.paid else 0
            run = Run(campaign_id=cid, step_key=step_key, element_key=element_key, fingerprint=fp, state="running",
                      attempt=attempt, credit_est=est, started_at=_now())
            s.add(run)
            s.commit()
            run_id = run.id
            pkey = (cid, step_key, element_key)
            self._progress[pkey] = {"message": "Đang bắt đầu…", "started_at": time.time()}

            gate = self.engine._gate_row(s, cid, step_key, element_key)
            note = gate.note if gate is not None and gate.state == "rejected" else ""
            fn = self.executors.get(step_key)
            if fn is None:
                self._finish(s, run_id, "error", error=(
                    f"Chưa có executor cho bước '{step_key}'. Backend đang chạy có thể là bản cũ chưa nạp code mới: "
                    "hãy khởi động lại Backend."))
                return
            ctx = ExecContext(
                campaign_id=cid, step_key=step_key, element_key=element_key, tier=tier, params=params, inputs=refs,
                fingerprint=fp, note=note, store=self.engine.store,
                set_external_ref=lambda ref, _rid=run_id: self._set_ref(_rid, ref), cancelled=ex.cancel.is_set,
                prompts=self.engine.prompts, attempt=attempt,
                report=lambda message, _k=pkey: self._progress.__setitem__(
                    _k, {**self._progress.get(_k, {"started_at": time.time()}), "message": message}),
            )
            try:
                result = fn(ctx)
            except SubmittedUnknown as exc:
                s.rollback()
                self._finish(s, run_id, "unknown", error=str(exc)[:ERROR_MAX])
                return
            except Exception as exc:  # noqa: BLE001 - mọi lỗi executor chỉ ghi vào sổ, không retry
                s.rollback()
                self._finish(s, run_id, "error", error=f"{type(exc).__name__}: {exc}"[:ERROR_MAX])
                return
            self._store_result(s, cid, sd, element_key, tier, run_id, fp, parts, refs, result)
        except Exception as exc:  # noqa: BLE001
            s.rollback()
            if run_id:
                try:
                    self._finish(s, run_id, "error", error=f"{type(exc).__name__}: {exc}"[:ERROR_MAX])
                except Exception:  # noqa: BLE001
                    logger.exception("Không ghi được lỗi vào sổ chạy")
            else:
                raise
        finally:
            s.close()
            self._progress.pop((cid, step_key, element_key), None)
            if owner and key is not None:
                with self._lock:
                    event = self._inflight.pop(key, None)
                if event:
                    event.set()

    def _store_result(self, s: Session, cid: str, sd: graph.StepDef, element_key: str, tier: str, run_id: str,
                      fp: str, parts: dict[str, Any], refs: dict[str, list[dict[str, Any]]], result: ExecResult) -> None:
        if not result.artifacts:
            self._finish(s, run_id, "error", error="Executor không trả artifact nào.")
            return
        parents = sorted({r["artifact_id"] for lst in refs.values() for r in lst if "artifact_id" in r})
        created = []
        for spec in result.artifacts:
            meta = {**spec.meta, "run_id": run_id, "tier": tier if sd.uses_tier else None}
            kw = dict(campaign_id=cid, kind=spec.kind, meta=meta, step_key=sd.key, element_key=element_key,
                      fingerprint=fp, parts=parts, parent_ids=parents)
            if spec.members is not None:
                # Bundle: nội dung chỉ phụ thuộc hash các thành viên + vai trò + thứ tự (cùng bộ ảnh -> cùng hash)
                members = [(created[i], role) for i, role in spec.members]
                pairs = [[a.content_hash, role] for a, role in members]
                kw["meta"] = {**meta, "members": [{"artifact_id": a.id, "role": role} for a, role in members]}
                kw["parent_ids"] = sorted(set(parents) | {a.id for a, _ in members})
                art = self.engine.store.add_json(s, content={"members": pairs}, content_hash=sha(canonical(pairs)), **kw)
            elif spec.json is not None:
                art = self.engine.store.add_json(s, content=spec.json, **kw)
            else:
                art = self.engine.store.add_artifact(s, data=spec.data or b"", ext=spec.ext, **kw)
            created.append(art)
        chosen = created[min(max(result.primary, 0), len(created) - 1)]
        self.engine.store.select(s, cid, sd.key, element_key, chosen.id)
        # Duyệt bản nháp rồi chạy final: bản final kế thừa quyết định đã duyệt của phần tử đó.
        if sd.gate and sd.uses_tier and tier == "final":
            g = self.engine._gate_row(s, cid, sd.key, element_key)
            if g is not None and g.state == "approved":
                g.artifact_id = chosen.id
        run = s.get(Run, run_id)
        run.state, run.artifact_id, run.finished_at = "done", chosen.id, _now()
        run.credit_actual = result.credit_actual
        s.commit()

    def _finish(self, s: Session, run_id: str, state: str, error: str = "") -> None:
        run = s.get(Run, run_id)
        run.state, run.error, run.finished_at = state, error, _now()
        s.commit()

    def _set_ref(self, run_id: str, ref: str) -> None:
        with self._scope() as s:
            run = s.get(Run, run_id)
            if run is not None:
                run.external_ref = str(ref)[:255]

    # ── khởi động lại / xác nhận ────────────────────────────────────────────
    def recover(self) -> int:
        """Gọi lúc khởi động: các run đang dở không còn tiến trình nào chạy chúng."""
        n = 0
        with self._scope() as s:
            for r in s.scalars(select(Run).where(Run.state.in_(("queued", "running")))).all():
                sd = graph.STEP_BY_KEY.get(r.step_key)
                if sd is not None and sd.paid:
                    r.state = "unknown"
                    r.error = ("Ứng dụng khởi động lại khi đang chạy. Có thể ĐÃ gửi lên Flow; KHÔNG tự gửi lại. "
                               "Kiểm tra bên Flow rồi xác nhận.")
                else:
                    r.state, r.error = "error", "Bị ngắt do khởi động lại."
                r.finished_at = _now()
                n += 1
        return n

    def resolve_run(self, run_id: str, outcome: str) -> Run:
        """Người dùng xác nhận một run 'unknown'. 'not_sent' = chưa gửi gì -> cho phép chạy lại."""
        if outcome != "not_sent":
            raise ValueError("outcome hợp lệ: not_sent")
        with self._scope() as s:
            run = s.get(Run, run_id)
            if run is None or run.state != "unknown":
                raise ValueError("Chỉ xác nhận được run đang ở trạng thái 'unknown'.")
            run.state = "error"
            run.error = (run.error + " | Người dùng xác nhận: chưa gửi.").strip(" |")
            s.flush()
            s.expunge(run)
            return run
