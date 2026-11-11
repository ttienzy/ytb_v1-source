"""Test đầy đủ: upload 2 file + prompt link YouTube -> lấy response đầy đủ. HTTP thuần."""
import json
import re
import urllib.parse

import httpx

CONFIG = r"D:\GOOGLE SEARCH\tools\Backend\Data\config.json"
TEMPLATE_HAR = r"D:\GOOGLE SEARCH\tools\gemini.google.com.har"
FILES = [
    r"D:\GOOGLE SEARCH\tools\raw.txt",
    r"D:\GOOGLE SEARCH\tools\Backend\prompts\System Prompt Food Review Recap.txt",
]
PROMPT = "https://www.youtube.com/watch?v=oa4WoU-dm0o"

cfg = json.load(open(CONFIG, encoding="utf-8"))["gemini"]
cookies = cfg["cookies"]
ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"

# Push-ID / X-Client-Pctx cố định của Gemini (tái dùng từ HAR)
UPLOAD_COMMON = {
    "User-Agent": ua,
    "Referer": "https://gemini.google.com/",
    "Origin": "https://gemini.google.com",
    "X-Tenant-Id": "bard-storage",
    "Push-ID": "feeds/mcudyrk2a4khkz",
    "X-Client-Pctx": "CgcSBWjK7pYx",
    "Cookie": cookies,
}


def upload_file(client, path):
    content = open(path, "rb").read()
    name = path.rsplit("\\", 1)[-1]
    # Bước 1: start
    r1 = client.post("https://push.clients6.google.com/upload/",
                     content=f"File name: {name}".encode("utf-8"),
                     headers={**UPLOAD_COMMON,
                              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                              "X-Goog-Upload-Protocol": "resumable",
                              "X-Goog-Upload-Command": "start",
                              "X-Goog-Upload-Header-Content-Length": str(len(content))})
    upload_url = r1.headers.get("x-goog-upload-url")
    if not upload_url:
        raise RuntimeError(f"start fail {name}: {r1.status_code} {r1.text[:200]}")
    # Bước 2: upload + finalize
    r2 = client.post(upload_url, content=content,
                     headers={**UPLOAD_COMMON,
                              "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
                              "X-Goog-Upload-Command": "upload, finalize",
                              "X-Goog-Upload-Offset": "0"})
    gcs = r2.text.strip()
    if not gcs.startswith("/contrib_service"):
        raise RuntimeError(f"finalize fail {name}: {r2.status_code} {r2.text[:200]}")
    print(f"  uploaded {name} ({len(content)}B) -> {gcs[:70]}...")
    return gcs, name


def parse_stream_frames(raw):
    """Tách response streaming thành list các payload JSON đã decode."""
    payloads = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line.startswith("[["):
            continue
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            continue
        # frame = [["wrb.fr", null, "<json-string>"], ...] hoặc [["e",...],...]
        for item in frame:
            if isinstance(item, list) and len(item) >= 3 and item[0] == "wrb.fr" and isinstance(item[2], str):
                try:
                    payloads.append(json.loads(item[2]))
                except json.JSONDecodeError:
                    pass
    return payloads


def extract_recap_json(raw):
    """Trích khối ```json...``` từ text recap (lấy frame cuối đầy đủ)."""
    payloads = parse_stream_frames(raw)
    # Gom các text chunk từ rc_xxx (frame sau chứa text tích luỹ đầy đủ nhất)
    texts = []
    for p in payloads:
        # p = [null, [conv,resp], null, null, [[\"rc_xxx\",[\"text\",...]], ...]] (dạng thay đổi)
        try:
            rc_block = p[4]  # list of [rc_id, [text, ...]]
        except (IndexError, TypeError):
            continue
        if not isinstance(rc_block, list):
            continue
        for rc in rc_block:
            if isinstance(rc, list) and len(rc) >= 2 and isinstance(rc[1], list) and rc[1]:
                txt = rc[1][0]
                if isinstance(txt, str) and "```json" in txt:
                    texts.append(txt)
    if not texts:
        return None
    # Lấy text dài nhất (đầy đủ nhất)
    full = max(texts, key=len)
    start = full.find("```json")
    end = full.rfind("```")
    if start == -1 or end == -1 or end <= start:
        return None
    json_str = full[start + len("```json"):end].strip()
    return json.loads(json_str)


# Load inner template (97-pt + relay token) từ HAR
har = json.load(open(TEMPLATE_HAR, encoding="utf-8"))
cap = [e for e in har["log"]["entries"] if "StreamGenerate" in e["request"]["url"]][0]
parts = {p.split("=", 1)[0]: p.split("=", 1)[1] for p in cap["request"]["postData"]["text"].split("&") if "=" in p}
outer = json.loads(urllib.parse.unquote(parts["f.req"]))
inner_tmpl = json.loads(outer[1])

with httpx.Client(http2=False, timeout=120, follow_redirects=True) as client:
    # 1) Lấy token fresh từ trang
    r = client.get("https://gemini.google.com/app", headers={"User-Agent": ua, "Cookie": cookies})
    at_val = re.search(r'"SNlM0e":"(.*?)"', r.text).group(1)
    bl_val = re.search(r'"cfb2h":"(.*?)"', r.text).group(1)
    fsid_val = re.search(r'"FdrFJe":"(.*?)"', r.text).group(1)
    print("fresh tokens: at/bl/fsid OK")

    # 2) Upload 2 file
    print("\n[1] Uploading files...")
    attachments = []
    for p in FILES:
        gcs, name = upload_file(client, p)
        attachments.append([[gcs, 3, None, "text/plain"], name, None, None, None, None, None, None, [0]])

    # 3) Dựng f.req: inner[0] = [prompt, 0, null, [attachments], null, null, 0]
    inner = json.loads(json.dumps(inner_tmpl))
    inner[0] = [PROMPT, 0, None, attachments, None, None, 0]
    nj = json.dumps([outer[0], json.dumps(inner, ensure_ascii=False, separators=(",", ":"))],
                    ensure_ascii=False, separators=(",", ":"))
    enc = urllib.parse.quote(nj, safe="")  # encode 1 LẦN
    body = "f.req=" + enc + "&at=" + urllib.parse.quote_plus(at_val) + "&"

    url = ("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
           f"?bl={bl_val}&f.sid={fsid_val}&hl=vi&_reqid=100000&rt=c")
    print("\n[2] Sending prompt + attachments...")
    rr = client.post(url, content=body, headers={
        "User-Agent": ua, "Cookie": cookies,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Origin": "https://gemini.google.com", "Referer": "https://gemini.google.com/",
        "X-Same-Domain": "1",
    }, timeout=180)
    print(f"   -> HTTP {rr.status_code}, resp={len(rr.text)} bytes")
    open(r"D:\GOOGLE SEARCH\tools\Backend\Data\test_files_response.txt", "w", encoding="utf-8").write(rr.text)

    if rr.status_code != 200 or '"er"' in rr.text[:200]:
        print("\n--- RAW RESPONSE (first 800) ---")
        print(rr.text[:800])
    else:
        recap = extract_recap_json(rr.text)
        if recap is None:
            print("\n⚠ Không trích được khối JSON. Xem raw response.")
        else:
            out_json = r"D:\GOOGLE SEARCH\tools\Backend\Data\recap.json"
            with open(out_json, "w", encoding="utf-8") as f:
                json.dump(recap, f, ensure_ascii=False, indent=2)
            scenes = recap.get("scenes", [])
            n_vo = sum(len(s.get("segments", [])) for s in scenes)
            print(f"\n✅ Đã lưu JSON sạch: {out_json}")
            print(f"   video_url: {recap.get('video_url')}")
            print(f"   scenes: {len(scenes)} | segments (vietnamese_vo): {n_vo}")
            print("\n--- Preview (scene 1) ---")
            print(json.dumps(scenes[0] if scenes else recap, ensure_ascii=False, indent=2)[:900])