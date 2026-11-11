"""Test offline: dựng lại request `nprQif` (frames đầu–cuối) và so BYTE-FOR-BYTE với request thật trong các HAR.

Chạy:  python -X utf8 Backend/poc/flow_http/verify_har_frames.py
KHÔNG gọi mạng, KHÔNG in cookie/token.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import parse_qs

sys.path.insert(0, str(Path(__file__).parent))
import flow_rpc as F  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
HARS = [
    "flow.google_2_test_gd_7.com",
    "flow.google_2_new_credit_check_11_09_v2.com",
]
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ok_all = True


def check(name: str, ok: bool, detail: str = "") -> None:
    global ok_all
    ok_all &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  -- {detail}" if detail else ""))


for har_name in HARS:
    entries = json.loads((ROOT / har_name).read_text(encoding="utf-8"))["log"]["entries"]
    frames = [e for e in entries if f"rpcids={F.RPC_SUBMIT_FRAMES}" in e["request"]["url"]]
    print(f"\n{har_name}: {len(frames)} request nprQif")
    for n, e in enumerate(frames, 1):
        body = e["request"]["postData"]["text"]
        rpc, payload = F.decode_request_payload(body)
        item = payload[0][0]
        prompt = item[0][2][0][0][0]
        model, aspect = item[1], item[2]
        start, end = item[4], item[5]
        m = F.MODEL_OMNI_12_I2V_FL_RE.match(model)
        check(f"#{n} model i2v_fl hợp lệ", bool(m), model)
        mine = F.build_frames_payload(
            prompt, model, payload[1][5], payload[1][10][0], start[1], end[1], aspect=aspect,
            start_crop=start[5], end_crop=end[5], id_a=item[6][4], id_b=item[6][5], scene_id=payload[2][0],
        )
        check(f"#{n} payload dựng lại == payload trong HAR", mine == payload)
        at = parse_qs(body, keep_blank_values=True)["at"][0]
        qs = parse_qs(e["request"]["url"].split("?", 1)[1])
        url_path, mine_body = F.encode_request(
            F.RPC_SUBMIT_FRAMES, mine, at=at, build_label=qs["bl"][0], session_id=qs["f.sid"][0],
            source_path=qs["source-path"][0], hl=qs["hl"][0], reqid=int(qs["_reqid"][0]),
        )
        check(f"#{n} f.req + at == HAR (so khớp theo tham số form, như verify_har.py)", parse_qs(mine_body, keep_blank_values=True) == parse_qs(body, keep_blank_values=True))
        # hình chữ nhật cắt: dạng [trên, trái, dưới, phải]; None = 0; chiều cắt là một trong hai trục
        for label, slot in (("đầu", start), ("cuối", end)):
            crop = slot[5]
            top, left, bottom, right = [(0 if v is None else v) for v in crop]
            kept_w, kept_h = right - left, bottom - top
            check(f"#{n} crop khung {label} hợp lệ", 0 <= top < bottom <= 1 and 0 <= left < right <= 1, f"{crop}")
print("\nKẾT QUẢ:", "TẤT CẢ ĐẠT" if ok_all else "CÓ LỖI")
sys.exit(0 if ok_all else 1)
