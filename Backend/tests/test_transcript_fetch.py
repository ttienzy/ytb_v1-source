"""
test_transcript_fetch.py — Test tu dong fetch transcript tu YouTube URL.

Chay:
    .venv\Scripts\python -m pytest tests/test_transcript_fetch.py -v
    hoac chay thang:
    .venv\Scripts\python tests/test_transcript_fetch.py
"""

import sys
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

VIDEOS = {
    "public_en": {
        "id": "P08Yr7yV1J0",
        "url": "https://www.youtube.com/watch?v=P08Yr7yV1J0",
        "desc": "Vietnam exotic bird (EN, co auto-captions)",
    },
}


# === Ham fetch_transcript (se tich hop vao service sau) =====================

def fetch_transcript(video_id: str, prefer_langs: list = None) -> dict:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.formatters import TextFormatter

    langs = prefer_langs or ["vi", "en"]
    api = YouTubeTranscriptApi()
    transcript = api.fetch(video_id, languages=langs)

    # Format 1: plain text
    plain = TextFormatter().format_transcript(transcript)

    # Format 2: [MM:SS.ss] text
    ts_lines = []
    for s in transcript:
        m = int(s.start // 60)
        sec = s.start % 60
        ts_lines.append(f"[{m:02d}:{sec:05.2f}]  {s.text}")
    text_ts = "\n".join(ts_lines)

    segs = list(transcript)
    return {
        "text": plain,
        "text_ts": text_ts,
        "segments": [{"text": s.text, "start": s.start, "duration": s.duration} for s in segs],
        "count": len(segs),
    }


def video_id_from_url(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if not m:
        raise ValueError(f"Khong tim thay video ID: {url!r}")
    return m.group(1)


# === Tests ==================================================================

def test_video_id_from_url():
    cases = [
        ("https://www.youtube.com/watch?v=P08Yr7yV1J0", "P08Yr7yV1J0"),
        ("https://youtu.be/P08Yr7yV1J0", "P08Yr7yV1J0"),
        ("https://www.youtube.com/watch?v=P08Yr7yV1J0&t=120s", "P08Yr7yV1J0"),
    ]
    for url, expected in cases:
        result = video_id_from_url(url)
        assert result == expected, f"{url} -> {result!r} != {expected!r}"
        print(f"  OK  {url[:55]}  ->  {result}")


def test_fetch_and_validate():
    v = VIDEOS["public_en"]
    print(f"\n  Video: {v['desc']}")
    print(f"  URL  : {v['url']}")

    result = fetch_transcript(v["id"])

    assert result["count"] > 0, "Khong co segment"
    assert len(result["text"]) > 100
    assert len(result["text_ts"]) > 100
    print(f"  OK  {result['count']} segments")
    print(f"  OK  plain text  : {len(result['text']):,} chars")
    print(f"  OK  text+ts     : {len(result['text_ts']):,} chars")

    # Timestamp format [MM:SS.ss]
    pattern = re.compile(r"^\[\d{2}:\d{2}\.\d{2}\]  .+")
    lines = result["text_ts"].split("\n")
    bad = [l for l in lines[:20] if not pattern.match(l)]
    assert not bad, f"Timestamp format sai: {bad}"
    print(f"  OK  timestamp format dung: {len(lines)} dong")

    # Segment fields
    for i, seg in enumerate(result["segments"][:5]):
        assert seg["text"] and seg["start"] >= 0 and seg["duration"] > 0
    print(f"  OK  segment fields (kiem tra 5/{result['count']} dau)")

    # Khong co JSON noise
    noise = result["text"].count("{") + result["text"].count("responseContext")
    assert noise < 5, f"Co the van con JSON: score={noise}"
    print(f"  OK  khong co JSON noise (score={noise})")

    return result


def test_compare_with_raw_txt():
    raw_path = ROOT.parent / "raw.txt"
    if not raw_path.exists():
        print("  SKIP  raw.txt khong ton tai")
        return
    raw = raw_path.read_text(encoding="utf-8", errors="replace")
    is_json = raw.lstrip().startswith("{")
    print(f"  raw.txt: {raw_path.stat().st_size:,} bytes")
    print(f"  format : {'JSON (raw API response)' if is_json else 'plain text'}")
    print(f"  preview: {raw[:100].strip()!r}")


def print_preview(result: dict):
    sep = "-" * 60
    print(f"\n{sep}")
    print("PLAIN TEXT (600 chars):")
    print(result["text"][:600])
    print(f"... ({len(result['text']):,} chars total)")

    print(f"\n{sep}")
    print("TEXT + TIMESTAMP (600 chars):")
    print(result["text_ts"][:600])
    print(f"... ({len(result['text_ts']):,} chars total)")

    print(f"\n{sep}")
    print("RAW SEGMENTS (first 3):")
    for seg in result["segments"][:3]:
        print(f"  start={seg['start']:.2f}s  dur={seg['duration']:.2f}s  text={seg['text']!r}")


def run_all():
    passed = failed = 0

    def run(name, fn, *args):
        nonlocal passed, failed
        print(f"\n{'='*60}")
        print(f"TEST: {name}")
        try:
            fn(*args)
            passed += 1
            print(f"  -> PASS")
        except Exception as e:
            failed += 1
            print(f"  -> FAIL: {e}")

    run("video_id_from_url", test_video_id_from_url)
    run("compare_with_raw_txt", test_compare_with_raw_txt)

    print(f"\n{'='*60}")
    print("TEST: fetch_transcript (live network)")
    try:
        result = test_fetch_and_validate()
        passed += 1
        print("  -> PASS")
        print_preview(result)
    except Exception as e:
        failed += 1
        print(f"  -> FAIL: {e}")

    print(f"\n{'='*60}")
    print(f"SUMMARY: {passed} passed, {failed} failed")
    return failed == 0


if __name__ == "__main__":
    ok = run_all()
    sys.exit(0 if ok else 1)
