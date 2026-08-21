"""Gửi prompt (ngắn/dài) tới Gemini web qua HTTP thuần — không automation.

Cách hoạt động:
1. Lấy cookies từ Data/config.json.
2. GET https://gemini.google.com/app để rút token fresh: at (SNlM0e), bl (cfb2h), f.sid (FdrFJe).
3. Dựng f.req = [null, "<inner json>"] với inner[0][0] = prompt (template 97 phần tử + relay token).
   Encode 1 LẦN bằng urllib.parse.quote(safe="")  (KHÔNG encode double — encode double gây 400).
4. POST tới StreamGenerate với query bl/f.sid/hl/_reqid/rt=c, headers X-Same-Domain:1.
5. Parse response streaming, gom text phản hồi.

Chạy:  python gemini_http.py
"""
import json
import re
import urllib.parse

import httpx

CONFIG = r"D:\GOOGLE SEARCH\tools\Backend\Data\config.json"
TEMPLATE_HAR = r"D:\GOOGLE SEARCH\tools\gemini.google.com.har"  # chỉ để mượn cấu trúc inner 97-pt + relay token


def load_inner_template():
    har = json.load(open(TEMPLATE_HAR, encoding="utf-8"))
    cap = [e for e in har["log"]["entries"] if "StreamGenerate" in e["request"]["url"]][0]
    parts = {p.split("=", 1)[0]: p.split("=", 1)[1] for p in cap["request"]["postData"]["text"].split("&") if "=" in p}
    outer = json.loads(urllib.parse.unquote(parts["f.req"]))
    return outer, json.loads(outer[1])


def extract_response_text(stream_text: str) -> str:
    """Gom các chuỗi markdown/text dài từ payload streaming Gemini."""
    found = re.findall(r'\\"([^"\\]{20,})\\"', stream_text)
    cand = [f.replace("\\n", "\n").replace('\\"', '"') for f in found if " " in f and any(c.isalpha() for c in f)]
    return "\n".join(cand)


def send_prompt(prompt: str, cookies: str, outer, inner_tmpl, client: httpx.Client) -> str:
    # 1) token fresh
    r = client.get("https://gemini.google.com/app", headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "Cookie": cookies,
    })
    at_val = re.search(r'"SNlM0e":"(.*?)"', r.text).group(1)
    bl_val = re.search(r'"cfb2h":"(.*?)"', r.text).group(1)
    fsid_val = re.search(r'"FdrFJe":"(.*?)"', r.text).group(1)

    # 2) f.req: clone template, đặt prompt vào inner[0][0]
    inner = json.loads(json.dumps(inner_tmpl))
    inner[0][0] = prompt
    nj = json.dumps([outer[0], json.dumps(inner, ensure_ascii=False, separators=(",", ":"))],
                    ensure_ascii=False, separators=(",", ":"))
    enc = urllib.parse.quote(nj, safe="")  # encode 1 LẦN
    body = "f.req=" + enc + "&at=" + urllib.parse.quote_plus(at_val) + "&"

    url = ("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
           f"?bl={bl_val}&f.sid={fsid_val}&hl=vi&_reqid=100000&rt=c")
    rr = client.post(url, content=body, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "Cookie": cookies,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Origin": "https://gemini.google.com",
        "Referer": "https://gemini.google.com/",
        "X-Same-Domain": "1",
    }, timeout=120)
    return rr.status_code, len(rr.text), extract_response_text(rr.text)


if __name__ == "__main__":
    cfg = json.load(open(CONFIG, encoding="utf-8"))["gemini"]
    outer, inner_tmpl = load_inner_template()

    prompts = [
        ("NGẮN", "Trả lời đúng một từ: OK"),
        ("DÀI (≈1600 ký tự)",
         "Bạn là trợ lý tóm tắt. Hãy liệt kê 5 đặc điểm nổi bật của Đà Nẵng. "
         "Mỗi đặc điểm viết 1 đoạn 40-60 từ có dẫn chứng địa danh/sự kiện cụ thể. "
         "Cuối cùng viết 1 đoạn kết ngắn về giá trị du lịch. " * 6
         + "Trả lời tiếng Việt, đánh số 1-5 rồi phần Kết luận."),
    ]
    with httpx.Client(http2=False, timeout=30, follow_redirects=True) as client:
        for label, p in prompts:
            status, n, text = send_prompt(p, cfg["cookies"], outer, inner_tmpl, client)
            print(f"\n=== [{label}] len={len(p)} -> HTTP {status}, resp={n} bytes ===")
            print(text[:600])
            print("..." if len(text) > 600 else "")