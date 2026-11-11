"""GĐ0: Gemini chấm "ảnh mẫu có đúng áo thật không" để đo độ đáng tin của Fidelity Check.

Chạy từ Backend:  python -X utf8 poc/campaign_look/run_fidelity_check.py
Đọc out/results.json (do run_look_sheet.py ghi), gửi [ảnh áo thật, ảnh tạo ra] cho Gemini, ghi out/fidelity.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
DEMO = Path(r"C:\Users\nguye\OneDrive\Pictures\demo")
SHIRT = {
    "shirt1_haim": DEMO / "Screenshot 2026-09-30 195431.png",
    "shirt2_ny": DEMO / "Screenshot 2026-09-11 200909.png",
}

PROMPT = """You are a strict fashion QA inspector.
Image 1 is the REAL product photo (ground truth). Image 2 is an AI-generated character sheet that should show the person wearing EXACTLY the garment from Image 1 (the right-hand part, neck-down turnaround).
Compare ONLY the garment(s) that appear in Image 1 against the garment in Image 2. Ignore the face, hair, background, and any extra items that are not in Image 1 (e.g. shoes, jeans) - but list those extra items under "extras".
Be sceptical: do not say "match" unless you can see it clearly.
Return ONLY a JSON object, no prose, with keys:
"length", "neckline", "sleeves", "fit", "color", "logo_text", "logo_position", "logo_shape", "other_details":
  each = {"verdict": "match" | "minor_diff" | "mismatch", "note": "<=15 words"}
"extras": [list of items in Image 2 not in Image 1],
"overall": "pass" | "warning" | "fail",
"why": "<=30 words"."""


def main() -> int:
    from app.workflow.service import execute_gemini_analysis

    results = json.loads((OUT / "results.json").read_text(encoding="utf-8"))
    out = []
    for rec in results:
        if not rec.get("ok"):
            continue
        ref = SHIRT[rec["name"]]
        gen = OUT / rec["dest"]
        try:
            raw, provider = execute_gemini_analysis(PROMPT, [str(ref), str(gen)])
            item = {"dest": rec["dest"], "provider": provider, "raw": raw}
        except Exception as exc:  # noqa: BLE001
            item = {"dest": rec["dest"], "error": str(exc)[:300]}
        out.append(item)
        print(rec["dest"], "->", ("ERR " + item["error"]) if "error" in item else "ok", flush=True)
    (OUT / "fidelity.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
