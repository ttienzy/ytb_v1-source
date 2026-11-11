"""Test đầu-cuối: gửi 1 prompt thật tới Gemini web, dùng CHỈ config.json (cookies + inner_template
đã sanitize + user_agent) — KHÔNG dùng *.har.

Mục đích: chứng minh template sanitize + cookies lưu trong config đủ để recap.py chạy được.
Chạy:  cd Backend && .venv/Scripts/python test_gemini_config.py
"""
import copy
import json
import re
import urllib.parse

import httpx

CONFIG = r"D:\GOOGLE SEARCH\tools\Backend\Data\config.json"
PROMPT = "Hãy cho tôi biết về Thủ tướng Việt Nam hiện nay là ai"

cfg = json.load(open(CONFIG, encoding="utf-8"))["gemini"]
cookies = cfg["cookies"]
ua = cfg["user_agent"]
inner_template = cfg["inner_template"]  # 97-pt đã sanitize (idx 3/4/59 = None)


def parse_stream_frames(raw):
    payloads = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line.startswith("[["):
            continue
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            continue
        for item in frame:
            if isinstance(item, list) and len(item) >= 3 and item[0] == "wrb.fr" and isinstance(item[2], str):
                try:
                    payloads.append(json.loads(item[2]))
                except json.JSONDecodeError:
                    pass
    return payloads


def extract_answer_text(raw):
    """Gom text phản hồi từ các rc chunk — lấy chuỗi dài nhất (đầy đủ nhất)."""
    payloads = parse_stream_frames(raw)
    texts = []
    for p in payloads:
        try:
            rc_block = p[4]
        except (IndexError, TypeError):
            continue
        if not isinstance(rc_block, list):
            continue
        for rc in rc_block:
            if isinstance(rc, list) and len(rc) >= 2 and isinstance(rc[1], list) and rc[1]:
                txt = rc[1][0]
                if isinstance(txt, str):
                    texts.append(txt)
    return max(texts, key=len) if texts else None


with httpx.Client(http2=False, timeout=120, follow_redirects=True) as client:
    # 1) token fresh từ trang (at/bl/f.sid) — runtime, KHÔNG lấy từ config
    r = client.get("https://gemini.google.com/app", headers={"User-Agent": ua, "Cookie": cookies})
    at_val = re.search(r'"SNlM0e":"(.*?)"', r.text).group(1)
    bl_val = re.search(r'"cfb2h":"(.*?)"', r.text).group(1)
    fsid_val = re.search(r'"FdrFJe":"(.*?)"', r.text).group(1)
    print(f"[1] fresh tokens OK (at/bl/f.sid)")

    # 2) dựng f.req từ inner_template (sanitize) — chỉ đè inner[0][0] = prompt, không có attachment
    inner = copy.deepcopy(inner_template)
    inner[0] = [PROMPT, 0, None, None, None, None, 0]
    nj = json.dumps([None, json.dumps(inner, ensure_ascii=False, separators=(",", ":"))],
                    ensure_ascii=False, separators=(",", ":"))
    enc = urllib.parse.quote(nj, safe="")  # encode 1 LẦN
    body = "f.req=" + enc + "&at=" + urllib.parse.quote_plus(at_val) + "&"
    print(f"[2] f.req built (inner len={len(inner)}, prompt={len(PROMPT)} chars)")

    url = ("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
           f"?bl={bl_val}&f.sid={fsid_val}&hl=vi&_reqid=100000&rt=c")
    rr = client.post(url, content=body, headers={
        "User-Agent": ua, "Cookie": cookies,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Origin": "https://gemini.google.com", "Referer": "https://gemini.google.com/",
        "X-Same-Domain": "1",
    }, timeout=180)
    print(f"[3] POST StreamGenerate -> HTTP {rr.status_code}, resp={len(rr.text)} bytes")

    if rr.status_code != 200 or '"er"' in rr.text[:200]:
        print("\n--- LỖI — raw response (first 800) ---")
        print(rr.text[:800])
    else:
        answer = extract_answer_text(rr.text)
        if answer is None:
            print("\n⚠ Không trích được text. Lưu raw ra file để inspect.")
            open(r"D:\GOOGLE SEARCH\tools\Backend\Data\test_config_response.txt", "w", encoding="utf-8").write(rr.text)
        else:
            print("\n=== CÂU TRẢ LỜI GEMINI ===")
            print(answer)
