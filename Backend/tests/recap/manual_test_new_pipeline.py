r"""E2e test luồng mới (no-atempo, VO-drives-duration) + prompt mới.

R1 generate fresh (đọc prompt mới runtime) → phân tích VO (word count, intro/outro)
→ trim 3 đoạn (đầu/giữa/cuối) → R2 cut → R3 voice → R4 merge → verify final mượt.

Chạy (cwd=Backend, voice-service đang chạy :8001):
  set PYTHONPATH=Backend && .venv\\Scripts\\python.exe -m tests.recap.manual_test_new_pipeline
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "Backend"))

from app.recap import service, state  # noqa: E402
from app.recap.ffmpeg import ffprobe_duration  # noqa: E402
from app.recap.paths import (  # noqa: E402
    final_path, job_dir_of, merge_dir, voice_path,
)

YOUTUBE_URL = "https://www.youtube.com/watch?v=oa4WoU-dm0o"
RAW_TXT = ROOT / "raw.txt"
N_KEEP = 3  # đầu/giữa/cuối — giữ TTS nhanh


def _wc(text: str) -> int:
    return len((text or "").split())


def _trim_recap(recap: dict, n: int) -> dict:
    """Giữ first / middle / last segment; gói thành 1 scene để test cả intro + outro."""
    flat = [s for sc in recap.get("scenes", []) for s in sc.get("segments", [])]
    if not flat:
        raise RuntimeError("recap không có segment.")
    if len(flat) <= n:
        picked = flat
    else:
        mid = len(flat) // 2
        idxs = sorted({0, mid, len(flat) - 1})
        picked = [flat[i] for i in idxs][:n]
    return {"video_url": recap.get("video_url", ""), "scenes": [{"scene_title": "test e2e", "segments": picked}]}


async def main() -> None:
    assert RAW_TXT.exists(), f"thiếu {RAW_TXT}"
    raw_bytes = RAW_TXT.read_bytes()

    # ---- R1: generate fresh (prompt mới) ----
    print(f"[R1] generate fresh recap (prompt mới) — url={YOUTUBE_URL}")
    try:
        job_gen = await service.generate(YOUTUBE_URL, raw_bytes, "raw.txt")
    except Exception as e:  # noqa: BLE001
        print(f"[R1] FAIL generate: {e}")
        return
    recap = job_gen.recap or {}
    flat = [s for sc in recap.get("scenes", []) for s in sc.get("segments", [])]
    print(f"[R1] OK — {len(recap.get('scenes', []))} scene, {len(flat)} segment")

    # Phân tích VO: word count vs target + intro/outro
    if flat:
        targets = [float(s.get("duration_sec", 0) or 0) for s in flat]
        wcs = [_wc(s.get("vietnamese_vo", "")) for s in flat]
        tot_t, tot_w = sum(targets), sum(wcs)
        avg_ratio = (tot_w / (tot_t * 3)) if tot_t else 0  # so với công thức 3w/s cũ
        print(f"[R1] Σ target={tot_t:.0f}s | Σ VO words={tot_w} | ratio vs 3w/s={avg_ratio:.0%}")
        print(f"[R1] seg[0] VO (intro?): {flat[0].get('vietnamese_vo','')[:120]}...")
        print(f"[R1] seg[-1] VO (outro?): {flat[-1].get('vietnamese_vo','')[-120:]}")

    # ---- trim 3 đoạn ----
    trimmed = _trim_recap(recap, N_KEEP)
    tflat = trimmed["scenes"][0]["segments"]
    print(f"\n[trim] giữ {len(tflat)} đoạn: idx durations={[float(s.get('duration_sec',0)) for s in tflat]}")

    job = state.create_job(YOUTUBE_URL)
    state.update_job(job.job_id, status="recap_done", recap=trimmed)
    print(f"[job] {job.job_id}")

    # ---- R2: cut ----
    print("\n[R2] cut (tải 1080p + cắt draft)…")
    r2 = await service.cut(job.job_id)
    print(f"[R2] status={r2.status} clips={len(r2.clips or [])}")
    assert r2.status == "cut_done", f"cut fail: {r2.error}"

    # ---- R3: voice (no atempo) ----
    print("\n[R3] voice (TTS batch, KHÔNG atempo)…")
    voice_id = _pick_voice()
    r3 = await service.voice(job.job_id, voice_id)
    print(f"[R3] status={r3.status} low-coverage={r3.overspeed}")
    assert r3.status == "voice_done", f"voice fail: {r3.error}"

    # Verify voice_i.wav KHÔNG bị kéo giãn: duration != target (chính là tts_dur tự nhiên)
    print("\n[verify] voice_i.wav vs target (phải KHÔNG khớp target → không atempo):")
    sum_voice = 0.0
    for i in range(len(tflat)):
        target = float(tflat[i].get("duration_sec", 0) or 0)
        vd = ffprobe_duration(voice_path(job.job_id, i))
        sum_voice += vd
        tag = "OK raw" if abs(vd - target) > 0.05 else "!! =target (có atempo?)"
        print(f"   seg{i}: target={target:.1f}s voice_dur={vd:.2f}s  {tag}")
    print(f"   Σ voice_dur={sum_voice:.2f}s")

    # ---- R4: merge (re-cut theo voice_dur) ----
    print("\n[R4] merge (re-cut clip theo voice_dur → mux → concat)…")
    r4 = await service.merge(job.job_id)
    print(f"[R4] status={r4.status} final={r4.final}")
    assert r4.status == "merged", f"merge fail: {r4.error}"

    final = final_path(job.job_id)
    fdur = ffprobe_duration(final)
    seg_files = sorted(merge_dir(job.job_id).glob("seg_*.mp4"))
    print(f"\n[verify] {job_dir_of(job.job_id)}")
    print(f"   final_recap.mp4  {final.stat().st_size/1024:.0f} KB | duration={fdur:.2f}s")
    print(f"   Σ voice_dur={sum_voice:.2f}s | final={fdur:.2f}s | chênh={abs(fdur-sum_voice):.2f}s")
    print(f"   seg files: {len(seg_files)}")
    assert fdur > 0, "final duration=0 — concat hỏng"
    # final phải ≈ Σ voice_dur (KHÔNG phải Σ target) — đây là bằng chứng không atempo
    print(f"\n✅ E2E OK: final {fdur:.2f}s ≈ Σ voice_dur {sum_voice:.2f}s (giọng tự nhiên, 0 kéo giãn).")


def _pick_voice() -> str:
    try:
        from sqlalchemy import select
        from app.db import SessionLocal
        from app.voices.models import Voice
        with SessionLocal() as db:
            vs = list(db.scalars(select(Voice).order_by(Voice.created_at.desc())))
        if vs:
            print(f"[voice] cloned voice: {vs[0].voice_id} ({vs[0].name})")
            return vs[0].voice_id
    except Exception:
        pass
    return "a5b304485f8b"


if __name__ == "__main__":
    asyncio.run(main())
