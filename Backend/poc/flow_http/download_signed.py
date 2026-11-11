"""PoC bước 2: tải mp4 từ URL ký của Flow bằng Python (httpx), KHÔNG cookie, KHÔNG trình duyệt.

Chứng minh backend có thể tự tải video mà không phải nhờ extension.

Cách dùng:
  1) Trên tab project Flow (Console, đã dán live_probe.js):  await flowPoc({ mediaId: "<id>", copyUrl: true });  copy(__flowUrl)
  2) Chạy (URL nằm trong clipboard):
       PowerShell:  Get-Clipboard | Backend/.venv/Scripts/python.exe -I Backend/poc/flow_http/download_signed.py
     hoặc truyền URL qua stdin/đối số đầu tiên.
  Tùy chọn: --out <file.mp4>   (mặc định chỉ kiểm tra 200/mp4/kích thước và lưu vào thư mục tạm)

Không in URL ký / chữ ký.
"""
from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = None
    if "--out" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--out") + 1])
        args = [a for a in args if a != str(out)]
    url = (args[0] if args else sys.stdin.read()).strip()
    if not url.startswith("https://flow-content.google/video/"):
        print("FAIL: không phải URL flow-content.google/video/...")
        return 2

    q = parse_qs(urlparse(url).query)
    exp = int(q.get("Expires", ["0"])[0])
    left = exp - int(time.time())
    print(f"URL ký: host={urlparse(url).netloc} Expires còn {left}s ({'HẾT HẠN' if left <= 0 else 'còn hạn'}) tham số={sorted(q)}")
    if left <= 0:
        print("FAIL: URL đã hết hạn, lấy lại bằng flowPoc({ mediaId, copyUrl: true })")
        return 3

    dest = out or Path(tempfile.mkdtemp(prefix="flow_dl_")) / "video.mp4"
    t0 = time.time()
    with httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": "python-httpx"}) as c:
        with c.stream("GET", url) as r:
            ctype = r.headers.get("content-type", "")
            print(f"HTTP {r.status_code} type={ctype} content-length={r.headers.get('content-length')}")
            if r.status_code != 200:
                print("FAIL: tải không cookie bị từ chối ->", r.read()[:200])
                return 4
            n = 0
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(1 << 16):
                    f.write(chunk)
                    n += len(chunk)
    head = dest.read_bytes()[:12]
    is_mp4 = head[4:8] == b"ftyp"
    print(f"Đã tải {n:,} byte trong {time.time() - t0:.1f}s -> {dest}")
    print(f"{'PASS' if (is_mp4 and ctype == 'video/mp4') else 'FAIL'}: header MP4 'ftyp' = {is_mp4}")
    return 0 if is_mp4 else 5


if __name__ == "__main__":
    sys.exit(main())
