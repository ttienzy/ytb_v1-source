r"""Integration test Phase R2 (cut) — seed state từ response.txt rồi chạy service.cut.

Chạy (từ repo root, venv Backend):
  set PYTHONPATH=Backend && Backend\.venv\Scripts\python.exe -m tests.recap.test_cut

Không qua HTTP vì state in-memory không share giữa process — gọi service.cut trực tiếp.
Dùng ``response.txt`` (recap thật, 10 scene / 25 segment, video 29p) làm đầu vào.
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

from app.recap import service, state  # noqa: E402
from app.recap.paths import clips_dir, job_dir_of, source_dir  # noqa: E402


def _load_recap() -> tuple[str, dict]:
    raw = RESPONSE_TXT.read_text(encoding="utf-8")
    data = json.loads(raw)
    recap = {"video_url": data.get("video_url", ""), "scenes": data.get("scenes", [])}
    url_field = str(data.get("video_url", ""))
    m = re.search(r"https?://[^\s\)\]]+watch\?v=[\w-]+", url_field)
    youtube_url = m.group(0) if m else "https://www.youtube.com/watch?v=oa4WoU-dm0o"
    return youtube_url, recap


async def main() -> None:
    youtube_url, recap = _load_recap()
    segs = [s for sc in recap["scenes"] for s in sc.get("segments", [])]
    print(f"[seed] {youtube_url} | {len(recap['scenes'])} scene | {len(segs)} segment")

    job = state.create_job(youtube_url)
    state.update_job(job.job_id, status="recap_done", recap=recap)

    print(f"[cut] chạy service.cut(job_id={job.job_id}) — tải video 1080p + cắt {len(segs)} đoạn…")
    result = await service.cut(job.job_id)
    print(f"[cut] status={result.status} | clips={len(result.clips or [])}")

    jdir = job_dir_of(job.job_id)
    clips = sorted(clips_dir(job.job_id).glob("clip_*.mp4"))
    src_video = source_dir(job.job_id) / "video.mp4"
    print(f"[verify] {jdir} (source/ · clips/ · voice/)")
    for f in clips:
        print(f"   clips/{f.name}  {f.stat().st_size / 1024:.0f} KB")
    assert result.status == "cut_done", f"status sai: {result.status} err={result.error}"
    assert len(clips) == len(segs), f"số clip {len(clips)} != segment {len(segs)}"
    assert src_video.exists(), "source/video.mp4 chưa có sau cut (file nguồn phải giữ lại)"
    print(f"\n✅ R2 OK: {len(clips)} clip trong clips/, source/video.mp4 đã giữ.")


if __name__ == "__main__":
    asyncio.run(main())
