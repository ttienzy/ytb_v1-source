"""Đo thời gian từng phase của recap job.

Mỗi phase lưu ``{started_at, ended_at, duration_sec, ok, attempts, detail?}`` vào
``JobState.timings`` (FE đọc qua ``JobOut.timings``) và ghi ``Downloads/{job_id}/timings.json``
để không mất sau khi restart server (``rehydrate`` đọc lại).

Phase: ``transcript``, ``cookie_check``, ``gemini`` (detail: chunks / rate_limit_wait_sec /
cookie_refresh_sec), ``cut``, ``voice`` (+ ``voice_tts`` / ``voice_unpack``), ``merge``,
``polish``, ``drive`` và ``total`` (tạo job → video thành phẩm sẵn sàng).

Resume chạy lại 1 phase thì ``attempts`` +1 và số liệu của phase đó là lần chạy gần nhất.
"""
from __future__ import annotations

import json
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from app.recap import state
from app.recap.paths import timings_path

_LOCK = threading.Lock()
# (job_id, phase) → perf_counter lúc bắt đầu — chỉ trong process, không persist.
_T0: dict[tuple[str, str], float] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _persist(job_id: str, timings: dict) -> None:
    try:
        p = timings_path(job_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(timings, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass  # không ghi được file thì vẫn còn số liệu trong memory


def load(job_id: str) -> dict:
    """Đọc timings.json (rehydrate). Hỏng/không có → {}."""
    try:
        data = json.loads(timings_path(job_id).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _update(job_id: str, phase: str, fn) -> None:
    job = state.get_job(job_id)
    if job is None:
        return
    with _LOCK:
        timings = dict(job.timings or {})
        entry = dict(timings.get(phase) or {})
        fn(entry)
        timings[phase] = entry
        state.update_job(job_id, timings=timings)
        _persist(job_id, timings)


def begin(job_id: str, phase: str) -> None:
    _T0[(job_id, phase)] = time.perf_counter()

    def _f(e: dict) -> None:
        e.update(started_at=_now_iso(), ended_at=None, duration_sec=None, ok=None,
                 attempts=int(e.get("attempts") or 0) + 1)

    _update(job_id, phase, _f)


def finish(job_id: str, phase: str, ok: bool = True) -> float | None:
    t0 = _T0.pop((job_id, phase), None)
    dur = round(time.perf_counter() - t0, 2) if t0 is not None else None

    def _f(e: dict) -> None:
        e.update(ended_at=_now_iso(), duration_sec=dur, ok=ok)

    _update(job_id, phase, _f)
    if dur is not None:
        print(f"[Recap {job_id}] thoi gian {phase}: {dur:.1f}s{'' if ok else ' (LOI)'}", flush=True)
    return dur


def set_detail(job_id: str, phase: str, **detail: Any) -> None:
    def _f(e: dict) -> None:
        d = dict(e.get("detail") or {})
        d.update(detail)
        e["detail"] = d

    _update(job_id, phase, _f)


@contextmanager
def timed(job_id: str, phase: str) -> Iterator[None]:
    """``with timed(job_id, "merge"): ...`` — ghi ok=False nếu khối ném exception."""
    begin(job_id, phase)
    ok = False
    try:
        yield
        ok = True
    finally:
        finish(job_id, phase, ok)


def record_total(job_id: str) -> None:
    """Tổng thời gian từ lúc tạo job tới khi video thành phẩm sẵn sàng (chưa tính upload Drive)."""
    job = state.get_job(job_id)
    if job is None:
        return
    dur = round((datetime.now(timezone.utc) - job.created_at).total_seconds(), 2)

    def _f(e: dict) -> None:
        e.update(started_at=job.created_at.isoformat(), ended_at=_now_iso(), duration_sec=dur, ok=True,
                 attempts=int(e.get("attempts") or 0) + 1)

    _update(job_id, "total", _f)
    print(f"[Recap {job_id}] TONG thoi gian: {dur:.1f}s ({dur / 60:.1f} phut)", flush=True)
