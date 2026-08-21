r"""Integration test Phase R4 (merge) — chạy full pipeline cut → voice → merge trên 1 job.

Chạy (từ repo root, venv Backend; cần voice-service đang chạy ở :8001):
  set PYTHONPATH=Backend && Backend\.venv\Scripts\python.exe -m tests.recap.test_merge

Dùng response.txt (25 segment). Kiểm tra:
  - status=merged, có final_recap.mp4
  - duration final ≈ Σ duration_sec (dung sai ~2s/đoạn do keyframe + -shortest)
  - merge/seg_i.mp4 đủ 25 file
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # d:\GOOGLE SEARCH\tools (repo root)
RESPONSE_TXT = ROOT / "response.txt"
sys.path.insert(0, str(ROOT / "Backend"))

from app.recap import service, state  # noqa: E402
from app.recap.paths import final_path, job_dir_of, merge_dir  # noqa: E402


def _load_recap() -> tuple[str, dict]:
    raw = RESPONSE_TXT.read_text(encoding="utf-8")
    data = json.loads(raw)
    recap = {"video_url": data.get("video_url", ""), "scenes": data.get("scenes", [])}
    url_field = str(data.get("video_url", ""))
    m = re.search(r"https?://[^\s\)\]]+watch\?v=[\w-]+", url_field)
    youtube_url = m.group(0) if m else "https://www.youtube.com/watch?v=oa4WoU-dm0o"
    return youtube_url, recap


def _pick_voice() -> str:
    from sqlalchemy import select  # noqa: E402
    from app.db import SessionLocal  # noqa: E402
    from app.voices.models import Voice  # noqa: E402
    with SessionLocal() as db:
        voices = list(db.scalars(select(Voice).order_by(Voice.created_at.desc())))
    if voices:
        print(f"[voice] cloned voice: {voices[0].voice_id} ({voices[0].name})")
        return voices[0].voice_id
    return "a5b304485f8b"


def _ffprobe_duration(path: Path) -> float | None:
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nk=1:nw=1", str(path)],
            text=True, timeout=15,
        ).strip()
        return float(out) if out else None
    except Exception:
        return None


async def main() -> None:
    youtube_url, recap = _load_recap()
    segs = [s for sc in recap["scenes"] for s in sc.get("segments", [])]
    voice_id = _pick_voice()
    total_target = sum(float(s.get("duration_sec", 0.0)) for s in segs)
    print(f"[seed] {len(segs)} segment | Σ duration_sec = {total_target:.1f}s | voice={voice_id}")

    job = state.create_job(youtube_url)
    state.update_job(job.job_id, status="recap_done", recap=recap)

    print(f"\n[cut] tải video 1080p + cắt {len(segs)} đoạn…")
    r1 = await service.cut(job.job_id)
    print(f"[cut] status={r1.status} | clips={len(r1.clips or [])}")

    print(f"\n[voice] TTS batch + atempo sync…")
    r2 = await service.voice(job.job_id, voice_id)
    print(f"[voice] status={r2.status} | overspeed={len(r2.overspeed or [])} đoạn")

    print(f"\n[merge] mux clip+voice → seg → concat…")
    r3 = await service.merge(job.job_id)
    print(f"[merge] status={r3.status} | final={r3.final}")
    assert r3.status == "merged", f"status sai: {r3.status} err={r3.error}"

    final = final_path(job.job_id)
    assert final.exists() and final.stat().st_size, "final_recap.mp4 chưa có"
    seg_files = sorted(merge_dir(job.job_id).glob("seg_*.mp4"))
    assert len(seg_files) == len(segs), f"số seg {len(seg_files)} != segment {len(segs)}"

    dur = _ffprobe_duration(final)
    jdir = job_dir_of(job.job_id)
    print(f"\n[verify] {jdir}")
    print(f"   final_recap.mp4  {final.stat().st_size / (1024*1024):.1f} MB | duration={dur}s")
    print(f"   Σ target={total_target:.1f}s | chênh={abs((dur or 0) - total_target):.1f}s")

    assert dur is not None and dur > 0, "final có duration=0 — concat hỏng"
    # Dung sai rộng: mỗi đoạn lệch keyframe ±~2s + -shortest.
    assert abs(dur - total_target) < len(segs) * 2.5, \
        f"duration lệch quá lớn: {dur:.1f}s vs {total_target:.1f}s"
    print(f"\n✅ R4 OK: final_recap.mp4 {dur:.1f}s (target {total_target:.1f}s), {len(seg_files)} seg intermediate.")


if __name__ == "__main__":
    asyncio.run(main())
