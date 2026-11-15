"""POC: dùng Muse qua HTTP + WebSocket/Noise, KHÔNG mở trình duyệt.

Lấy cookie từ tài khoản đã thêm ở Cài đặt → Muse AI (Data/muse_accounts.json).

    cd Backend
    .venv/Scripts/python poc/muse_http/run_poc.py status            # auth + VM + bắt tay Noise
    .venv/Scripts/python poc/muse_http/run_poc.py history -n 10     # 10 tin gần nhất (chat chính)
    .venv/Scripts/python poc/muse_http/run_poc.py files -n 40       # file media trong lịch sử
    .venv/Scripts/python poc/muse_http/run_poc.py download <sandbox://...>
    .venv/Scripts/python poc/muse_http/run_poc.py send "Create an image of ..." [--new-chat] [--wait 600]

Tùy chọn chung: --account <id> (mặc định: tài khoản active đầu tiên), --out <thư mục> (mặc định:
thư mục tải video Muse trong cấu hình, để Muse Studio thấy luôn).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from app.ai.muse.gateway import (  # noqa: E402
    MuseGateway,
    event_resources,
    event_text,
    guess_media_kind,
    node_id_for,
    wait_for_result,
)
from app.core.config import DATA_DIR  # noqa: E402


def load_account(account_id: str | None) -> dict:
    data = json.loads((DATA_DIR / "muse_accounts.json").read_text(encoding="utf-8"))
    accs = data.get("accounts", [])
    if account_id:
        acc = next((a for a in accs if a.get("id") == account_id), None)
    else:
        acc = next((a for a in accs if a.get("status") == "active"), None) or (accs[0] if accs else None)
    if not acc:
        sys.exit("Không có tài khoản Muse nào trong Data/muse_accounts.json")
    return acc


def default_out() -> Path:
    try:
        cfg = json.loads((DATA_DIR / "config.json").read_text(encoding="utf-8")).get("muse", {})
        if cfg.get("download_dir"):
            return Path(cfg["download_dir"])
    except Exception:
        pass
    return DATA_DIR / "Downloads"


def connect(acc: dict) -> MuseGateway:
    t = time.time()
    gw = MuseGateway(acc["cookies"], acc.get("ua", ""))
    print(f"[ok] đã kết nối VM {gw.vm_id} (viewer …{gw.viewer_id[-6:]}) trong {time.time() - t:.1f}s")
    return gw


def save(gw: MuseGateway, res: dict, out: Path, prefix: str = "muse_http") -> Path:
    out.mkdir(parents=True, exist_ok=True)
    base = os.path.basename(str(res["path"]).split("?")[0]) or "file"
    dest = out / f"{prefix}_{time.strftime('%Y%m%d_%H%M%S')}_{base}"
    t = time.time()
    n = gw.download(res, str(dest))
    print(f"[ok] tải {res['path']} -> {dest} ({n / 1024:.0f} KB, {time.time() - t:.1f}s)")
    return dest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--account")
    ap.add_argument("--out", type=Path)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    h = sub.add_parser("history")
    h.add_argument("-n", type=int, default=10)
    h.add_argument("--session")
    f = sub.add_parser("files")
    f.add_argument("-n", type=int, default=40)
    f.add_argument("--session")
    d = sub.add_parser("download")
    d.add_argument("ref")
    s = sub.add_parser("send")
    s.add_argument("text")
    s.add_argument("--new-chat", action="store_true")
    s.add_argument("--wait", type=float, default=600)
    s.add_argument("--want", default="video,image", help="'' = chỉ chờ câu trả lời chữ")
    s.add_argument("--attach", action="append", default=[], help="file đính kèm (lặp lại được)")
    s.add_argument("--session", help="gửi vào chat có sẵn")
    args = ap.parse_args()

    acc = load_account(args.account)
    out = args.out or default_out()
    print(f"tài khoản: {acc.get('label')} ({acc['id']})")
    with connect(acc) as gw:
        if args.cmd == "status":
            evs = gw.history(limit=1)
            print(f"[ok] chat.history trả {len(evs)} sự kiện, seq mới nhất {evs[-1].get('seq') if evs else '-'}")
        elif args.cmd == "history":
            for ev in gw.history(args.session, limit=args.n):
                p = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
                res = event_resources(ev)
                print(f"#{ev.get('seq')} {ev.get('event_name')} status={p.get('status')} "
                      f"reply_to={bool(ev.get('reply_to_message_id') or p.get('reply_to_message_id'))} "
                      f"| {event_text(ev)[:140]!r}" + (f" | files={[r['path'] for r in res]}" if res else ""))
        elif args.cmd == "files":
            for ev in gw.history(args.session, limit=args.n):
                for r in event_resources(ev):
                    print(f"#{ev.get('seq')} {guess_media_kind(r):5} {r.get('mime', '')} {r['path']}")
        elif args.cmd == "download":
            save(gw, {"path": args.ref}, out)
        elif args.cmd == "send":
            session_id = args.session or (gw.start_session(title="CreatorFlow POC") if args.new_chat else None)
            if session_id and not args.session:
                print(f"[ok] tạo chat mới {session_id}")
            evs = gw.history(session_id, limit=1)
            baseline = max([e.get("seq") or 0 for e in evs] or [0])
            items = [{"type": "text", "text": args.text}]
            if args.attach:
                t = time.time()
                items += gw.attachment_items(args.attach)
                print(f"[ok] chuẩn bị {len(args.attach)} đính kèm ({[i['type'] for i in items[1:]]}) trong {time.time() - t:.1f}s")
            sid = gw.send_items(items, node_id_for(gw.viewer_id), session_id)
            print(f"[ok] đã gửi prompt (stream {sid}), baseline seq {baseline}. Đang chờ Muse…")
            t0 = time.time()
            last = [""]

            def progress(msg: str) -> None:
                if msg != last[0]:
                    print(f"  +{time.time() - t0:5.0f}s  {msg}")
                    last[0] = msg

            want = {w for w in args.want.split(",") if w}
            res = wait_for_result(gw, session_id, baseline, want=want, timeout=args.wait,
                                  settle=15 if want else 5, on_progress=progress)
            print(f"trả lời chữ: {res.reply_text[:300]!r}")
            if res.timed_out:
                print("[!] hết thời gian chờ media")
            for r in res.resources:
                if guess_media_kind(r) in ("video", "image"):
                    save(gw, r, out)
                else:
                    print(f"(bỏ qua file khác: {r['path']})")


if __name__ == "__main__":
    main()
