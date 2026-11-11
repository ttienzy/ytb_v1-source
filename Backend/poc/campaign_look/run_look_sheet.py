"""GĐ0 (docs/PLAN_ai_workflow_campaign.md): thử "look sheet" - nhân vật + áo thật -> ảnh mẫu mặc đúng áo.

Dùng ĐÚNG prompt mặc định người dùng đưa (prompts/look_sheet.txt), ảnh tham chiếu theo thứ tự [nhân vật, áo].
Chạy từ thư mục Backend:  python -X utf8 poc/campaign_look/run_look_sheet.py [--runs 2] [--only shirt1]
Kết quả: poc/campaign_look/out/<tên>_<lần>.png + results.json (prompt, thứ tự ảnh, tài khoản dùng, thời gian).
Không in cookie/token. Tài khoản chỉ ghi dưới dạng 8 ký tự đầu của id.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
DEMO = Path(r"C:\Users\nguye\OneDrive\Pictures\demo")

CHARACTER = DEMO / "images.jpg"
SHIRTS = {
    "shirt1_haim": DEMO / "Screenshot 2026-09-30 195431.png",
    "shirt2_ny": DEMO / "Screenshot 2026-09-11 200909.png",
}


def build_prompt(changes: str = "") -> str:
    body = (HERE / "prompts" / "look_sheet.txt").read_text(encoding="utf-8")
    block = ""
    if changes.strip():
        block = (
            "\n[OPTIONAL CHANGES]: " + changes.strip()
        )
    return body.replace("{{changes_block}}", block).rstrip() + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--only", default="")
    ap.add_argument("--changes", default="")
    args = ap.parse_args()

    from app.ai.image_gen.service import get_account_store, get_image_client

    for p in [CHARACTER, *SHIRTS.values()]:
        if not p.exists():
            print(f"THIẾU FILE: {p}")
            return 2

    OUT.mkdir(parents=True, exist_ok=True)
    store = get_account_store()
    client = get_image_client()
    prompt = build_prompt(args.changes)
    results_path = OUT / "results.json"
    results = json.loads(results_path.read_text(encoding="utf-8")) if results_path.exists() else []

    def last_used_map() -> dict[str, float]:
        return {a["id"]: float(a.get("lastUsed") or 0) for a in store.list_accounts()}

    for name, shirt in SHIRTS.items():
        if args.only and args.only not in name:
            continue
        for i in range(1, args.runs + 1):
            dest = OUT / f"{name}_{int(time.time())}_{i}.png"
            before = last_used_map()
            t0 = time.time()
            rec = {
                "name": name, "run": i, "dest": dest.name, "aspect": "16:9",
                "ref_order": [CHARACTER.name, shirt.name], "prompt": prompt,
            }
            try:
                client.generate(prompt=prompt, dest=str(dest), ref_paths=[str(CHARACTER), str(shirt)], aspect="16:9")
                rec["ok"] = True
            except Exception as exc:  # noqa: BLE001
                rec["ok"] = False
                rec["error"] = str(exc)[:300]
            rec["seconds"] = round(time.time() - t0, 1)
            after = last_used_map()
            rec["account"] = next((k[:8] for k, v in after.items() if v > before.get(k, 0)), None)
            results.append(rec)
            results_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"{name} #{i}: ok={rec['ok']} {rec['seconds']}s acc={rec['account']}"
                  + (f" err={rec.get('error')}" if not rec["ok"] else ""), flush=True)

    print("XONG ->", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
