"""Gemini recap generator — HTTP thuần, đọc template từ ``config.json`` (KHÔNG dùng HAR).

Port logic từ ``tests/gemini/test_files.py`` (recap prototype) + ``tests/gemini/test_gemini_config.py``
(HTTP đã validate 200). recap.py là layer "cơ chế AI": nhận ``youtube_url`` + transcript + system prompt
→ recap dict (scenes/segments). KHÔNG lưu file — trả dict cho service giữ state in-memory.

Luồng ``generate_recap``:
  1. đọc ``cookies`` + ``inner_template`` (97-pt đã sanitize idx 3/4/59) + ``user_agent`` từ config.
  2. ``GET /app`` bằng cookies → regex fresh ``at``/``bl``/``f.sid`` (runtime, không lưu).
  3. upload transcript + system prompt (resumable start + finalize) → 2 attachment.
  4. clone inner_template → đè ``inner[0]=[youtube_url, 0, None, [attachments], None, None, 0]``
     → encode ``f.req`` (1 lần) → POST StreamGenerate.
  5. parse stream frames → trích khối JSON (code-fence json) → recap dict.
"""
import copy
import json
import re
import urllib.parse

import httpx

from app.core.storage import read_config

# Push-ID / X-Client-Pctx cố định của Gemini web (telemetry routing cho push upload service).
# Lấy từ HAR gốc (cùng account đã capture inner_template) — đã chạy được trong test_files.py.
PUSH_ID = "feeds/mcudyrk2a4khkz"
X_CLIENT_PCTX = "CgcSBWjK7pYx"
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
)


class RecapConfigError(RuntimeError):
    """Thiếu config (cookies/inner_template) — user cần login + capture trước."""


def _gemini_config() -> dict:
    """Đọc phần persist từ config.json; raise RecapConfigError nếu thiếu."""
    g = read_config().get("gemini", {})
    cookies = g.get("cookies", "")
    inner = g.get("inner_template")
    if not cookies:
        raise RecapConfigError("Chưa có cookies Gemini — chạy /api/settings/gemini/login trước.")
    if not inner:
        raise RecapConfigError("Chưa có inner_template — chạy app.ai.gemini.capture trước.")
    return {
        "cookies": cookies,
        "inner_template": inner,
        "user_agent": g.get("user_agent") or DEFAULT_UA,
    }


def _fresh_tokens(client: httpx.Client, cookies: str, ua: str) -> tuple[str, str, str]:
    """GET /app → regex token fresh (at/bl/f.sid). Raise nếu cookie hết hạn."""
    r = client.get("https://gemini.google.com/app", headers={"User-Agent": ua, "Cookie": cookies})
    at_val = re.search(r'"SNlM0e":"(.*?)"', r.text)
    bl_val = re.search(r'"cfb2h":"(.*?)"', r.text)
    fsid_val = re.search(r'"FdrFJe":"(.*?)"', r.text)
    if not (at_val and bl_val and fsid_val):
        raise RuntimeError("Không lấy được token fresh (at/bl/f.sid) — cookie hết hạn? Re-login Gemini.")
    return at_val.group(1), bl_val.group(1), fsid_val.group(1)


def _upload_file(client: httpx.Client, content: bytes, name: str, cookies: str, ua: str) -> str:
    """Resumable upload (start + finalize) → trả gcs path (/contrib_service/...)."""
    common = {
        "User-Agent": ua,
        "Referer": "https://gemini.google.com/",
        "Origin": "https://gemini.google.com",
        "X-Tenant-Id": "bard-storage",
        "Push-ID": PUSH_ID,
        "X-Client-Pctx": X_CLIENT_PCTX,
        "Cookie": cookies,
    }
    # Bước 1: start
    r1 = client.post(
        "https://push.clients6.google.com/upload/",
        content=f"File name: {name}".encode("utf-8"),
        headers={
            **common,
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(len(content)),
        },
    )
    upload_url = r1.headers.get("x-goog-upload-url")
    if not upload_url:
        raise RuntimeError(f"upload start fail [{name}]: HTTP {r1.status_code} — {r1.text[:200]}")
    # Bước 2: upload + finalize
    r2 = client.post(
        upload_url,
        content=content,
        headers={
            **common,
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
            "X-Goog-Upload-Command": "upload, finalize",
            "X-Goog-Upload-Offset": "0",
        },
    )
    gcs = r2.text.strip()
    if not gcs.startswith("/contrib_service"):
        raise RuntimeError(f"upload finalize fail [{name}]: HTTP {r2.status_code} — {r2.text[:200]}")
    return gcs


def _parse_stream_frames(raw: str) -> list:
    """Tách response streaming thành list payload JSON đã decode."""
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


def _extract_recap_json(raw: str) -> dict | None:
    """Trích recap dict từ response Gemini.

    Ưu tiên khối JSON được bọc trong code-fence json; nếu Gemini tuân theo prompt
    (không bọc fence) thì parse trực tiếp chunk JSON thô. Lấy candidate đầy đủ nhất.
    """
    payloads = _parse_stream_frames(raw)
    candidates: list[str] = []
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
                if isinstance(txt, str) and len(txt) > 10:
                    candidates.append(txt)
    # 1) khối ```json ... ```
    for txt in sorted(candidates, key=len, reverse=True):
        if "```json" in txt:
            start = txt.find("```json")
            end = txt.rfind("```")
            if start != -1 and end > start:
                try:
                    return json.loads(txt[start + len("```json"):end].strip())
                except json.JSONDecodeError:
                    continue
    # 2) fallback: JSON thô (không fence)
    for txt in sorted(candidates, key=len, reverse=True):
        stripped = txt.strip()
        if stripped.startswith("{") and '"scenes"' in stripped:
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                continue
    return None


def generate_recap(
    youtube_url: str,
    raw_bytes: bytes,
    raw_name: str,
    prompt_bytes: bytes,
    prompt_name: str,
) -> dict:
    """Tạo recap dict từ YouTube URL + transcript + system prompt (HTTP thuần, sync)."""
    cfg = _gemini_config()
    cookies, inner_template, ua = cfg["cookies"], cfg["inner_template"], cfg["user_agent"]
    with httpx.Client(http2=False, timeout=180, follow_redirects=True) as client:
        at_val, bl_val, fsid_val = _fresh_tokens(client, cookies, ua)

        gcs_raw = _upload_file(client, raw_bytes, raw_name, cookies, ua)
        gcs_prompt = _upload_file(client, prompt_bytes, prompt_name, cookies, ua)
        attachments = [
            [[gcs_raw, 3, None, "text/plain"], raw_name, None, None, None, None, None, None, [0]],
            [[gcs_prompt, 3, None, "text/plain"], prompt_name, None, None, None, None, None, None, [0]],
        ]

        inner = copy.deepcopy(inner_template)
        inner[0] = [youtube_url, 0, None, attachments, None, None, 0]
        nj = json.dumps(
            [None, json.dumps(inner, ensure_ascii=False, separators=(",", ":"))],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        enc = urllib.parse.quote(nj, safe="")  # encode 1 LẦN
        body = "f.req=" + enc + "&at=" + urllib.parse.quote_plus(at_val) + "&"

        url = (
            "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
            f"?bl={bl_val}&f.sid={fsid_val}&hl=vi&_reqid=100000&rt=c"
        )
        rr = client.post(
            url,
            content=body,
            headers={
                "User-Agent": ua,
                "Cookie": cookies,
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "Origin": "https://gemini.google.com",
                "Referer": "https://gemini.google.com/",
                "X-Same-Domain": "1",
            },
            timeout=300,
        )
        if rr.status_code != 200 or '"er"' in rr.text[:200]:
            raise RuntimeError(f"Gemini StreamGenerate fail: HTTP {rr.status_code} — {rr.text[:300]}")
        recap = _extract_recap_json(rr.text)
        if recap is None:
            raise RuntimeError("Không trích được khối JSON recap từ response Gemini (có thể Gemini đổi format).")
        return recap
