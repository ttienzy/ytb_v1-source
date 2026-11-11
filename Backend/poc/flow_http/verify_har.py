"""Test offline: replay HAR để chứng minh codec dựng đúng request Flow và đọc đúng response.

Chạy:  Backend/.venv/Scripts/python.exe Backend/poc/flow_http/verify_har.py [đường_dẫn_HAR]

KHÔNG gọi mạng, KHÔNG in cookie/token/URL đã ký.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).parent))
import flow_rpc as F  # noqa: E402

DEFAULT_HAR = Path(__file__).resolve().parents[3] / "flow.google_2_new_credit_check_11_09_v2.com"

try:
    sys.stdout.reconfigure(encoding="utf-8")  # console Windows mặc định cp1252
except Exception:
    pass

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"[{PASS if ok else FAIL}] {name}" + (f"  -- {detail}" if detail else ""))


def main() -> int:
    har_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_HAR
    entries = json.loads(har_path.read_text(encoding="utf-8"))["log"]["entries"]

    def rpc_entries(rpc: str) -> list[dict]:
        return [e for e in entries if f"rpcids={rpc}" in e["request"]["url"]]

    # ── 1. Dựng lại request submit t2v và so với request thật ───────────────
    sub = rpc_entries(F.RPC_SUBMIT_T2V)[0]
    qs = parse_qs(urlparse(sub["request"]["url"]).query)
    body_txt = sub["request"]["postData"]["text"]
    rec_rpc, rec_payload = F.decode_request_payload(body_txt)
    check("decode request submit", rec_rpc == F.RPC_SUBMIT_T2V)

    prompt = rec_payload[0][0][0][2][0][0][0]
    model = rec_payload[0][0][1]
    id_a, id_b = rec_payload[0][0][4][4], rec_payload[0][0][4][5]
    project_id = rec_payload[1][5]
    token = rec_payload[1][10][0]
    scene = rec_payload[2][0]
    at = parse_qs(body_txt, keep_blank_values=True)["at"][0]

    aspect = rec_payload[0][0][2]
    flag_360 = len(rec_payload[0][0]) > 7 and rec_payload[0][0][7] == [4]
    mine = F.build_t2v_payload(prompt, model, project_id, token, aspect=aspect, flag_360=flag_360, id_a=id_a, id_b=id_b, scene_id=scene)
    check("payload dựng lại == payload trong HAR", mine == rec_payload)
    check("model id trong HAR", model in (F.MODEL_OMNI_12_T2V_10S, F.MODEL_OMNI_12_T2V_10S_360P), f"model={model} aspect={aspect} flag360={flag_360}")

    path_q, body = F.encode_request(
        F.RPC_SUBMIT_T2V, mine, at=at,
        build_label=qs["bl"][0], session_id=qs["f.sid"][0], source_path=qs["source-path"][0],
        hl=qs["hl"][0], reqid=int(qs["_reqid"][0]),
    )
    check("query string == HAR", parse_qs(urlparse(path_q).query) == qs)
    check("f.req + at == HAR (byte-for-byte)", parse_qs(body, keep_blank_values=True) == parse_qs(body_txt, keep_blank_values=True))
    check("token captcha dài ~2.5KB nằm ở payload[1][10][0]", len(token) > 2000, f"len={len(token)}")

    # ── 2. Giải mã response submit ──────────────────────────────────────────
    sub_resp = F.parse_response(sub["response"]["content"]["text"])[F.RPC_SUBMIT_T2V]
    rec = F.media_record(F.RPC_SUBMIT_T2V, sub_resp)
    check("submit: có media id", bool(re.fullmatch(r"[0-9a-f-]{36}", F.media_id(rec))))
    check("submit: state = 6 (queued)", F.media_state(rec) == F.STATE_QUEUED, f"state={F.media_state(rec)}")
    bal = F.submit_balance(sub_resp)
    check("submit: số dư/credit đọc được", bal is not None, f"field={bal}")
    mid = F.media_id(rec)

    # ── 3. Poll: chuỗi trạng thái 2... -> 3 ─────────────────────────────────
    states, times = [], []
    for e in rpc_entries(F.RPC_POLL):
        pl = F.parse_response(e["response"]["content"]["text"]).get(F.RPC_POLL)
        r = F.media_record(F.RPC_POLL, pl)
        if F.media_id(r) != mid:
            continue
        states.append(F.media_state(r))
        times.append(e["startedDateTime"])
    check("poll jwpduf theo đúng media id", len(states) >= 3, f"{len(states)} lần, states={states}")
    check("poll: rendering(2)* rồi done(3)", states[-1] == F.STATE_DONE and set(states[:-1]) == {F.STATE_RENDERING})

    # ── 4. as29s: payload [mediaId] -> URL mp4 đã ký; biến thể [id,null,[1]] -> chỉ thumbnail ──
    url, req_ok, thumb_only = None, False, True
    for e in rpc_entries(F.RPC_ASSET):
        pl = F.parse_response(e["response"]["content"].get("text") or "").get(F.RPC_ASSET)
        if not pl or F.media_id(F.media_record(F.RPC_ASSET, pl)) != mid:
            continue
        _, req_pl = F.decode_request_payload(e["request"]["postData"]["text"])
        u = F.find_video_url(pl)
        if u:
            url = url or u
            req_ok = req_ok or req_pl == F.build_asset_payload(mid)
        elif req_pl == F.build_thumbnail_payload(mid):
            pass
        else:
            thumb_only = False
    check("as29s: có URL flow-content.google/video/<id> đã ký", bool(url) and mid in (url or ""))
    check("as29s: request lấy video == build_asset_payload ([mediaId])", req_ok)

    # ── 5. Tải mp4 = GET URL đã ký ──────────────────────────────────────────
    dl = [e for e in entries if "flow-content.google/video/" in e["request"]["url"]]
    good = [e for e in dl if e["response"]["status"] == 200
            and any(h["name"].lower() == "content-type" and h["value"] == "video/mp4" for h in e["response"]["headers"])]
    check("tải mp4: GET flow-content.google/video/<id>?Expires&KeyName&Signature -> 200 video/mp4",
          len(good) >= 1, f"{len(good)}/{len(dl)} request tải OK")
    print("      (HAR đã bị lược bỏ header Cookie nên chưa kết luận được URL ký có cần cookie hay không -> cần test live)")

    # ── 6. Thời gian render ────────────────────────────────────────────────
    from datetime import datetime

    def ts(s: str) -> float:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

    secs = ts(times[-1]) - ts(sub["startedDateTime"])
    print(f"      Render 10s clip: ~{secs:.0f}s từ submit đến poll=done")

    # ── 7. Mọi submit trong HAR: model id, độ dài, TỈ LỆ (item[2]; MZZa6b: item[3]) và độ phân giải server ghi nhận ──
    # Tỉ lệ: 1 = 9:16 dọc, 2 = 16:9 ngang. Số lượng video = số item trong payload[0] (KHÔNG phải item[2]).
    print("\n      Bảng submit (rpc | model | độ dài | tỉ lệ req→server | mã res | #item | số dư sau):")
    table, aspects_sent = [], set()
    for e in entries:
        m = re.search(r"rpcids=(YhhmEf|nprQif|MZZa6b)", e["request"]["url"])
        if not m or e["response"]["status"] != 200:
            continue
        pl = F.parse_response(e["response"]["content"].get("text") or "").get(m.group(1))
        if not pl:
            continue
        rec = pl[3][0]
        echo = rec[5][6][1][0]
        dur = rec[7][1][2][0] if rec[7] and rec[7][1] else None
        _, req_pl = F.decode_request_payload(e["request"]["postData"]["text"])
        item = req_pl[0][0]
        asp_req = item[3] if m.group(1) == "MZZa6b" else item[2]
        aspects_sent.add(asp_req)
        table.append((m.group(1), echo[0], dur, f"{asp_req}→{echo[4]}", echo[5], len(req_pl[0]), pl[1]))
    for row in table:
        print("      ", " | ".join(str(x) for x in row))
    check("model id có hậu tố _360p <=> server ghi nhận mã độ phân giải 4",
          bool(table) and all((r[1].endswith("_360p")) == (r[4] == 4) for r in table))
    check("tỉ lệ gửi (item[2]/item[3]) == tỉ lệ server ghi nhận", bool(table) and all(r[3].split("→")[0] == r[3].split("→")[1] for r in table))

    # Telemetry giao diện (RPC WuwhI) ghi lại cài đặt: aspectRatio phải trùng tỉ lệ đã gửi
    tele = set()
    for e in entries:
        if "rpcids=WuwhI" not in e["request"]["url"]:
            continue
        try:
            _, ev = F.decode_request_payload(e["request"]["postData"]["text"])
        except Exception:
            continue

        def walk(node):
            if isinstance(node, str) and '"aspectRatio"' in node:
                try:
                    tele.add(int(json.loads(node)["aspectRatio"]))
                except Exception:
                    pass
            elif isinstance(node, list):
                for child in node:
                    walk(child)

        walk(ev)
    if tele:
        check("telemetry UI aspectRatio == tỉ lệ trong request tạo video", tele <= aspects_sent, f"telemetry={sorted(tele)} gửi={sorted(aspects_sent)}")
    else:
        print("      (HAR này không có telemetry WuwhI MEDIA_GENERATION_SETTINGS)")

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
