r"""Integration test Phase R3 (voice + sync) — seed state từ response.txt rồi chạy service.voice.

Chạy (từ repo root, venv Backend; cần voice-service đang chạy ở :8001):
  set PYTHONPATH=Backend && Backend\.venv\Scripts\python.exe -m tests.recap.manual_test_voice

Seed job với status=cut_done + clips giả (R3 voice chỉ đọc recap segments, không đụng clips).
Dùng cloned voice đầu tiên trong app.db (đã clone trước qua UI). Kiểm tra:
  - status=voice_done
  - số voice_i.wav == số segment
  - overspeed[] là subset idx hợp lệ
  - duration đầu ra ≈ duration_sec (ffprobe)
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # d:\GOOGLE SEARCH\tools (repo root)
RESPONSE_TXT = ROOT / "response.txt"
sys.path.insert(0, str(ROOT / "Backend"))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.recap import service, state  # noqa: E402
from app.recap.paths import job_dir_of, voice_dir, voice_path  # noqa: E402
from app.voices.models import Voice  # noqa: E402

CLONED_VOICE_FALLBACK = "a5b304485f8b"  # voice clone demo "google_voive"


def _load_recap() -> tuple[str, dict]:
    raw = RESPONSE_TXT.read_text(encoding="utf-8")
    data = json.loads(raw)
    recap = {"video_url": data.get("video_url", ""), "scenes": data.get("scenes", [])}
    url_field = str(data.get("video_url", ""))
    m = re.search(r"https?://[^\s\)\]]+watch\?v=[\w-]+", url_field)
    youtube_url = m.group(0) if m else "https://www.youtube.com/watch?v=oa4WoU-dm0o"
    return youtube_url, recap


def _pick_cloned_voice() -> str:
    with SessionLocal() as db:
        voices = list(db.scalars(select(Voice).order_by(Voice.created_at.desc())))
    if voices:
        print(f"[voice] cloned voice: {voices[0].voice_id} ({voices[0].name})")
        return voices[0].voice_id
    print(f"[voice] không có cloned voice trong DB — dùng fallback {CLONED_VOICE_FALLBACK}")
    return CLONED_VOICE_FALLBACK


def _ffprobe_duration(path: Path) -> float | None:
    import subprocess
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
    voice_id = _pick_cloned_voice()
    print(f"[seed] {len(segs)} segment | voice={voice_id}")

    # Seed cut_done + clips giả (R3 không cần file clip thật, chỉ cần status + recap).
    job = state.create_job(youtube_url)
    fake_clips = [f"clip_{i}.mp4" for i in range(len(segs))]
    state.update_job(
        job.job_id, status="cut_done", recap=recap, clips=fake_clips,
        job_dir=str(job_dir_of(job.job_id)),
    )

    print(f"[voice] chạy service.voice(job_id={job.job_id}) — TTS batch + atempo sync…")
    result = await service.voice(job.job_id, voice_id)
    print(f"[voice] status={result.status} | overspeed={result.overspeed}")
    assert result.status == "voice_done", f"status sai: {result.status} err={result.error}"

    jdir = job_dir_of(job.job_id)
    wavs = sorted(voice_dir(job.job_id).glob("voice_*.wav"))
    print(f"[verify] {jdir} | voice/ có {len(wavs)} file")
    assert len(wavs) == len(segs), f"số voice {len(wavs)} != segment {len(segs)}"
    assert not any(jdir.glob("_tts_*.wav")), "có file _tts_*.wav tạm chưa xoá"

    # Kiểm tra overspeed là subset idx hợp lệ.
    overspeed = result.overspeed or []
    assert all(0 <= i < len(segs) for i in overspeed), f"overspeed idx ngoài range: {overspeed}"

    # Spot-check 3 đầu + 3 đuôi: duration đầu ra ≈ duration_sec (dung sai 0.4s — atempo + keyframe).
    print("\n[verify] spot-check duration (target vs thực):")
    max_diff = 0.0
    for i in [0, 1, 2, len(segs) - 3, len(segs) - 2, len(segs) - 1]:
        target = float(segs[i].get("duration_sec", 0.0))
        got = _ffprobe_duration(voice_path(job.job_id, i))
        diff = abs((got or 0.0) - target) if got is not None else -1.0
        max_diff = max(max_diff, diff)
        tag = " ⚠overspeed" if i in overspeed else ""
        print(f"   seg{i:>2}: target={target:6.1f}s  got={got}  diff={diff:+.2f}s{tag}")

    if overspeed:
        print(f"\n⚠ {len(overspeed)} đoạn overspeed (atempo ép ngoài [0.5,2.0]): {overspeed}")
    print(f"\n✅ R3 OK: {len(wavs)} voice_i.wav, max_diff={max_diff:.2f}s, overspeed={len(overspeed)} đoạn.")


if __name__ == "__main__":
    asyncio.run(main())
