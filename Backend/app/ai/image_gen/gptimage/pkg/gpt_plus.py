"""
ChatGPT Plus full-RE flow.

Uses:
  - cookies + bearer for auth
  - Python: proof_token + PoW solver
  - Node subprocess: turnstile.dx → turnstile_token
  - 4-step server dance: /api/auth/session → /prepare → /finalize → /f/conversation

Image generation: send `image=True`. DALL-E tool runs async, so we poll
GET /backend-api/conversation/{id} until a multimodal_text part with an
asset_pointer appears, then download via /backend-api/files/{id}/download.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path
from uuid import uuid4

from curl_cffi import requests as cffi

from .proof import build_proof_token
from .pow import solve_pow
from .solver_client import NodeSolver

logger = logging.getLogger(__name__)

IMPERSONATE = os.getenv("GPT_IMPERSONATE", "chrome131")


class PlusError(Exception):
    pass


def _base_headers(cookies: str, ua: str, device_id: str, client_build: str,
                  client_version: str, oai_is: str, session_id: str) -> dict:
    return {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Content-Type": "application/json",
        "Cookie": cookies, "User-Agent": ua,
        "Origin": "https://chatgpt.com", "Referer": "https://chatgpt.com/",
        "OAI-Device-Id": device_id, "OAI-Language": "en-US",
        "oai-client-build-number": client_build, "oai-client-version": client_version,
        "oai-session-id": session_id, "x-oai-is-client-observation": oai_is,
        "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
        "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin",
    }


async def _fetch_bootstrap(client, cookies: str, ua: str) -> dict:
    """Fetch chatgpt.com HTML and parse <script id='client-bootstrap'> JSON."""
    r = await client.get("https://chatgpt.com/",
                         headers={"Cookie": cookies, "User-Agent": ua, "Accept": "text/html"})
    if r.status_code != 200:
        raise PlusError(f"GET / HTTP {r.status_code}")
    m = re.search(r'<script[^>]*id="client-bootstrap"[^>]*>(.*?)</script>', r.text, re.DOTALL)
    if not m:
        raise PlusError("client-bootstrap script not found in HTML")
    return json.loads(m.group(1))


class GPTPlus:
    BASE = "https://chatgpt.com"
    SESSION = f"{BASE}/api/auth/session"
    PREPARE = f"{BASE}/backend-api/sentinel/chat-requirements/prepare"
    FINALIZE = f"{BASE}/backend-api/sentinel/chat-requirements/finalize"
    CHAT = f"{BASE}/backend-api/f/conversation"

    def __init__(self, session: dict | None = None):
        self.solver = NodeSolver()
        self._session = dict(session or {})   # PATCH: session tiêm trực tiếp (không .env)
        self._bootstrap_cache: dict | None = None
        self._bootstrap_age: float = 0

    def _env(self, name: str, default: str = "") -> str:
        """PATCH: đọc session tiêm vào trước, rồi mới tới env — không mutate env toàn cục."""
        v = self._session.get(name)
        if v is None or v == "":
            v = os.getenv(name) or default
        return str(v).strip().strip('"').strip("'")

    async def close(self):
        await self.solver.stop()

    async def _bootstrap(self, client, cookies: str, ua: str) -> dict:
        # Cache bootstrap for 5 min to avoid hitting / on every chat
        if self._bootstrap_cache and time.time() - self._bootstrap_age < 300:
            return self._bootstrap_cache
        self._bootstrap_cache = await _fetch_bootstrap(client, cookies, ua)
        self._bootstrap_age = time.time()
        return self._bootstrap_cache

    async def chat(self, message: str, image: bool = False, model: str | None = None,
                   ref_paths: list | None = None, check_refusal: bool = True) -> dict:
        cookies = self._env("GPT_COOKIES")
        ua = self._env("GPT_USER_AGENT")
        device_id = self._env("GPT_DEVICE_ID") or str(uuid4())
        client_build = self._env("GPT_CLIENT_BUILD")
        client_version = self._env("GPT_CLIENT_VERSION")
        oai_is = self._env("GPT_OAI_IS")
        chosen_model = model or self._env("GPT_MODEL", "gpt-5-5-thinking")
        if not cookies or not ua:
            raise PlusError("Chưa có session ChatGPT (cookies/User-Agent) — Đăng nhập ChatGPT trong Settings.")

        async with cffi.AsyncSession(impersonate=IMPERSONATE, timeout=180) as client:
            # 1. accessToken
            r = await client.get(self.SESSION,
                                 headers={"Cookie": cookies, "User-Agent": ua, "Accept": "application/json"})
            if r.status_code != 200:
                raise PlusError(f"/api/auth/session HTTP {r.status_code}")
            access_token = r.json().get("accessToken")
            if not access_token:
                raise PlusError("no accessToken (cookies expired?)")
            logger.info("[plus] auth OK")

            # 2. bootstrap (cached)
            bootstrap = await self._bootstrap(client, cookies, ua)
            logger.info("[plus] bootstrap OK (%d keys)", len(bootstrap))

            # 3. /prepare
            proof_token = build_proof_token(ua, client_version)
            session_id = str(uuid4())
            h = _base_headers(cookies, ua, device_id, client_build, client_version, oai_is, session_id)
            h["Authorization"] = f"Bearer {access_token}"
            h["x-openai-target-path"] = "/backend-api/sentinel/chat-requirements/prepare"
            h["x-openai-target-route"] = "/backend-api/sentinel/chat-requirements/prepare"
            r = await client.post(self.PREPARE, headers=h, data=json.dumps({"p": proof_token}))
            if r.status_code != 200:
                raise PlusError(f"/prepare HTTP {r.status_code}: {r.text[:300]}")
            prep = r.json()
            logger.info("[plus] /prepare OK persona=%s", prep.get("persona"))

            # 4. Solve challenges in parallel
            pow_seed = prep["proofofwork"]["seed"]
            pow_diff = prep["proofofwork"]["difficulty"]
            dx = prep["turnstile"]["dx"]

            pow_task = asyncio.to_thread(solve_pow, pow_seed, pow_diff, ua)
            ts_task = self.solver.solve_turnstile(proof_token, dx, bootstrap, ua)
            pow_answer, ts_answer = await asyncio.gather(pow_task, ts_task)
            logger.info("[plus] PoW solved (%d chars), turnstile solved (%d chars)",
                        len(pow_answer), len(ts_answer))

            # 5. /finalize
            h["x-openai-target-path"] = "/backend-api/sentinel/chat-requirements/finalize"
            h["x-openai-target-route"] = "/backend-api/sentinel/chat-requirements/finalize"
            r = await client.post(self.FINALIZE, headers=h, data=json.dumps({
                "prepare_token": prep["prepare_token"],
                "proofofwork": pow_answer,
                "turnstile": ts_answer,
            }))
            if r.status_code != 200:
                raise PlusError(f"/finalize HTTP {r.status_code}: {r.text[:500]}")
            fin = r.json()
            final_token = fin.get("token")
            if not final_token:
                raise PlusError(f"/finalize: no token. body: {r.text[:300]}")
            logger.info("[plus] /finalize OK")

            # 6. /f/conversation
            h2 = _base_headers(cookies, ua, device_id, client_build, client_version, oai_is, session_id)
            h2["Accept"] = "text/event-stream"
            h2["Authorization"] = f"Bearer {access_token}"
            h2["openai-sentinel-chat-requirements-token"] = final_token
            h2["openai-sentinel-proof-token"] = pow_answer
            h2["openai-sentinel-turnstile-token"] = ts_answer
            h2["x-oai-turn-trace-id"] = str(uuid4())
            h2["x-openai-target-path"] = "/backend-api/f/conversation"
            h2["x-openai-target-route"] = "/backend-api/f/conversation"

            system_hints = ["picture_v2"] if image else []

            # PATCH ref-upload: có ref_paths → upload từng ảnh → message MULTIMODAL (image_asset_pointer + text)
            # + attachments metadata, để DALL-E/GPT-Image bám theo ảnh tham chiếu (mặt nhân vật / bối cảnh).
            content = {"content_type": "text", "parts": [message]}
            attachments = []
            if ref_paths:
                img_parts = []
                for rp in ref_paths:
                    try:
                        up = await self._upload_file(client, rp, access_token, cookies, ua)
                    except Exception as up_e:  # noqa: BLE001 — 1 ref lỗi không giết cả job
                        logger.warning("[plus] ref upload failed %s: %s", rp, up_e)
                        continue
                    # asset_pointer = sediment://<file_id> (theo HAR thật, KHÔNG phải file-service://).
                    img_parts.append({
                        "content_type": "image_asset_pointer",
                        "asset_pointer": f"sediment://{up['file_id']}",
                        "size_bytes": up["size_bytes"], "width": up["width"], "height": up["height"],
                    })
                    attachments.append({
                        "id": up["file_id"], "size": up["size_bytes"], "name": up["name"],
                        "mime_type": up["mime"], "width": up["width"], "height": up["height"],
                        "source": "local", "library_file_id": up.get("library_file_id") or "",
                        "is_big_paste": False,
                    })
                if img_parts:
                    content = {"content_type": "multimodal_text", "parts": img_parts + [message]}

            body = {
                "action": "next",
                "messages": [{
                    "id": str(uuid4()), "author": {"role": "user"},
                    "create_time": time.time(),
                    "content": content,
                    "metadata": {
                        "developer_mode_connector_ids": [],
                        "selected_github_repos": [], "selected_all_github_repos": False,
                        "system_hints": system_hints,
                        "attachments": attachments,
                        "serialization_metadata": {"custom_symbol_offsets": []},
                    },
                }],
                "parent_message_id": "client-created-root",
                "model": chosen_model,
                "client_prepare_state": "none",   # theo HAR (không dùng /f/conversation/prepare)
                "timezone_offset_min": -420, "timezone": "Asia/Bangkok",
                "conversation_mode": {"kind": "primary_assistant"},
                "enable_message_followups": True,
                "system_hints": system_hints,
                "supports_buffering": True, "supported_encodings": ["v1"],
                "client_contextual_info": {
                    "is_dark_mode": True, "time_since_loaded": 7,
                    "page_height": 945, "page_width": 1106, "pixel_ratio": 1,
                    "screen_height": 1080, "screen_width": 1920,
                    "app_name": "chatgpt.com",
                },
                "paragen_cot_summary_display_override": "allow",
                "force_parallel_switch": "auto", "thinking_effort": "standard",
            }
            r = await client.post(self.CHAT, headers=h2, data=json.dumps(body))

            logger.info("[plus] /conversation HTTP %d, %d bytes", r.status_code, len(r.text))
            if r.status_code != 200:
                raise PlusError(f"/conversation HTTP {r.status_code}: {r.text[:500]}")

            result = _parse_sse(r.text)

            # Kiểm tra phản hồi có phải là từ chối/hết hạn mức (limit) không để dừng ngay, không loop poll vô ích
            refusal = check_limit_refusal(result.get("message", "")) if check_refusal else None
            if refusal:
                logger.warning("[plus] ChatGPT từ chối tạo ảnh (đụng giới hạn): %s", refusal)
                raise PlusError(f"rate_limit: {refusal}")

            if image and not result.get("image_assets"):
                # DALL-E runs async — poll the mapping endpoint for the asset
                assets = await _poll_for_image(
                    client, cookies, ua, access_token,
                    device_id, client_build, client_version, oai_is,
                    conversation_id=result.get("conversation_id"),
                    max_attempts=20, interval=2.0,
                )
                result["image_assets"] = assets

        return result

    async def _upload_file(self, client, path, access_token: str, cookies: str, ua: str) -> dict:
        """Upload 1 ảnh tham chiếu lên ChatGPT (theo HAR thật):
        register `/files` → PUT bytes (Azure blob) → `/files/process_upload_stream` (chờ file_ready/completed,
        lấy library_file_id). Trả {file_id,width,height,size_bytes,mime,name,library_file_id}."""
        import io
        import mimetypes
        p = Path(path)
        data = p.read_bytes()
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as im:
                width, height = im.size
        except Exception:  # noqa: BLE001 — thiếu Pillow/ảnh lạ → mặc định vuông
            width = height = 1024
        mime = mimetypes.guess_type(p.name)[0] or "image/png"
        h = {"Authorization": f"Bearer {access_token}", "Cookie": cookies, "User-Agent": ua,
             "Content-Type": "application/json", "Origin": "https://chatgpt.com",
             "Referer": "https://chatgpt.com/"}
        # 1. register (body theo HAR: mime_type + store_in_library để có library_file_id)
        r = await client.post(
            f"{self.BASE}/backend-api/files", headers=h,
            data=json.dumps({
                "file_name": p.name, "file_size": len(data), "use_case": "multimodal",
                "timezone_offset_min": -420, "reset_rate_limits": False,
                "supports_direct_azure_multipart": True, "mime_type": mime,
                "entry_surface": "chat_composer", "selection_method": "file_picker",
                "client_resolved_mime_type": mime, "mime_resolution_source": "filename_extension",
                "store_in_library": True, "library_persistence_mode": "opportunistic"}))
        if r.status_code != 200:
            raise PlusError(f"/files register HTTP {r.status_code}: {r.text[:200]}")
        fd = r.json()
        file_id = fd.get("file_id") or fd.get("id")
        upload_url = fd.get("upload_url")
        if not file_id or not upload_url:
            raise PlusError(f"/files no upload_url: {str(fd)[:200]}")
        # 2. PUT bytes lên Azure blob
        pr = await client.put(upload_url, data=data, headers={
            "x-ms-blob-type": "BlockBlob", "x-ms-version": "2020-04-08", "Content-Type": mime})
        if pr.status_code not in (200, 201):
            raise PlusError(f"blob PUT HTTP {pr.status_code}: {pr.text[:150]}")
        # 3. process_upload_stream — chờ 'file.processing.completed', lấy library_file_id (metadata_object_id)
        fr = await client.post(
            f"{self.BASE}/backend-api/files/process_upload_stream", headers=h,
            data=json.dumps({
                "file_id": file_id, "use_case": "multimodal", "index_for_retrieval": False,
                "file_name": p.name, "library_persistence_mode": "opportunistic",
                "entry_surface": "chat_composer",
                "metadata": {"store_in_library": True, "is_temporary_chat": False,
                             "library_eligibility_reason": "eligible", "is_project_thread": False}}))
        if fr.status_code != 200:
            raise PlusError(f"/process_upload_stream HTTP {fr.status_code}: {fr.text[:200]}")
        library_file_id = ""
        ready = False
        for line in (fr.text or "").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            evn = ev.get("event") or ""
            if evn in ("file.processing.file_ready", "file.processing.completed"):
                ready = True
            extra = ev.get("extra") or {}
            if isinstance(extra, dict) and extra.get("metadata_object_id"):
                library_file_id = extra["metadata_object_id"]
        if not ready:
            raise PlusError(f"/process_upload_stream chưa 'ready': {fr.text[:200]}")
        return {"file_id": file_id, "width": width, "height": height,
                "size_bytes": len(data), "mime": mime, "name": p.name,
                "library_file_id": library_file_id}

    async def generate_image(self, prompt: str, save_to: str | Path | None = None,
                             model: str | None = None, ref_paths: list | None = None) -> dict:
        """High-level wrapper: send picture_v2 prompt (+ ảnh ref nếu có), poll for asset, download.

        Returns: {message, image_assets, local_path, image_url}
        """
        result = await self.chat(prompt, image=True, model=model, ref_paths=ref_paths)
        assets = result.get("image_assets") or []
        if not assets:
            msg = result.get("message", "").strip()
            refusal = check_limit_refusal(msg)
            if refusal:
                raise PlusError(f"rate_limit: {refusal}")
            if msg:
                # ChatGPT TRẢ LỜI BẰNG CHỮ thay vì tạo ảnh (vd. hiểu nhầm yêu cầu thành sửa ảnh): lỗi của nội dung yêu cầu,
                # không phải tài khoản hay mạng. Nhãn "no_image:" để adapter không đánh dấu tài khoản lỗi / không đổi tài khoản.
                raise PlusError(f"no_image: {msg[:300]}")
            raise PlusError("ChatGPT không trả ảnh trong thời gian chờ (timeout).")

        asset_pointer = assets[0]
        asset_id = asset_pointer.rsplit("/", 1)[-1]

        cookies = self._env("GPT_COOKIES")
        ua = self._env("GPT_USER_AGENT")

        async with cffi.AsyncSession(impersonate=IMPERSONATE, timeout=120) as client:
            r = await client.get(self.SESSION,
                                 headers={"Cookie": cookies, "User-Agent": ua, "Accept": "application/json"})
            access_token = r.json()["accessToken"]
            dh = {"Authorization": f"Bearer {access_token}", "Cookie": cookies, "User-Agent": ua,
                  "Accept": "application/json"}
            # Đường dẫn theo HAR: /backend-api/files/download/{id} → {download_url: estuary/content?…}
            dr = await client.get(f"{self.BASE}/backend-api/files/download/{asset_id}", headers=dh)
            if dr.status_code != 200:
                raise PlusError(f"file download meta HTTP {dr.status_code}: {dr.text[:200]}")
            cdn = dr.json().get("download_url") or dr.json().get("url")
            if not cdn:
                raise PlusError("no CDN URL in download meta")

            # estuary/content (chatgpt.com) cần auth cookie+bearer; CDN ngoài (oaiusercontent) thì signed URL.
            img_h = {"User-Agent": ua, "Referer": "https://chatgpt.com/"}
            if cdn.startswith("https://chatgpt.com") or cdn.startswith("/"):
                if cdn.startswith("/"):
                    cdn = self.BASE + cdn
                img_h.update({"Authorization": f"Bearer {access_token}", "Cookie": cookies})
            img = await client.get(cdn, headers=img_h)
            if img.status_code != 200 or len(img.content) < 1024:
                raise PlusError(f"image fetch HTTP {img.status_code}, {len(img.content)} bytes")

        out_path = Path(save_to) if save_to else Path("downloads") / f"gpt_{asset_id}.png"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(img.content)
        result["local_path"] = str(out_path.resolve())
        result["image_url"] = cdn
        result["asset_id"] = asset_id
        return result


def check_limit_refusal(text: str) -> str | None:
    """Kiểm tra xem phản hồi text từ ChatGPT có phải là thông báo đụng giới hạn (limit/quota) hoặc từ chối tạo ảnh không."""
    if not text:
        return None
    lower = text.lower()
    patterns = [
        "hit the free plan limit",
        "free plan limit",
        "hit the limit",
        "hit your limit",
        "reached your limit",
        "reached the limit",
        "limit for image generations",
        "limit for image generation",
        "generations requests",
        "resets in",
        "limit resets",
        "giới hạn lượt tạo ảnh",
        "giới hạn tạo ảnh",
        "chưa thể gọi công cụ tạo ảnh",
        "đã đạt giới hạn",
        "quá giới hạn",
        "too many requests",
        "try again later",
        "upgrade to plus",
        "need chatgpt plus",
        "hourly limit",
        "daily limit",
        "vượt quá giới hạn",
        "hết lượt tạo ảnh",
        "đã hết lượt",
    ]
    for p in patterns:
        if p in lower:
            return text.strip()
    return None


async def _poll_for_image(client, cookies, ua, access_token,
                          device_id, client_build, client_version, oai_is,
                          conversation_id: str | None,
                          max_attempts: int = 20, interval: float = 2.0) -> list[str]:
    """Poll /backend-api/conversation/{id} until a multimodal_text asset appears."""
    if not conversation_id:
        return []
    h = _base_headers(cookies, ua, device_id, client_build, client_version, oai_is, str(uuid4()))
    h["Authorization"] = f"Bearer {access_token}"
    h["x-openai-target-path"] = f"/backend-api/conversation/{conversation_id}"
    h["x-openai-target-route"] = "/backend-api/conversation/[id]"

    for attempt in range(max_attempts):
        await asyncio.sleep(interval)
        r = await client.get(f"https://chatgpt.com/backend-api/conversation/{conversation_id}", headers=h)
        if r.status_code != 200:
            logger.warning("[plus.poll] GET HTTP %d", r.status_code)
            continue
        data = r.json()
        assets = []
        for node in (data.get("mapping") or {}).values():
            if not isinstance(node, dict):
                continue
            msg = node.get("message")
            if not msg or not isinstance(msg, dict):
                continue
            # Ảnh GEN nằm ở message role='tool' (DALL-E tool), không phải 'assistant'. Lấy tool+assistant,
            # LOẠI 'user' (message user chứa ảnh ref vừa upload — cũng là multimodal_text).
            if (msg.get("author") or {}).get("role") == "user":
                continue
            content = msg.get("content") or {}
            ct = content.get("content_type")
            if ct == "multimodal_text":
                for part in content.get("parts") or []:
                    if isinstance(part, dict) and part.get("asset_pointer"):
                        assets.append(part["asset_pointer"])
            elif ct == "text":
                joined = "".join(x for x in (content.get("parts") or []) if isinstance(x, str))
                refusal = check_limit_refusal(joined)
                if refusal:
                    raise PlusError(f"rate_limit: {refusal}")
        logger.info("[plus.poll] attempt %d assets=%d", attempt, len(assets))
        if assets:
            return assets
    return []


def _parse_sse(text: str) -> dict:
    """Parse v1-encoding SSE stream from /f/conversation.

    Stream format (only assistant role contributes to output text):
      data: "v1"                              # encoding marker
      data: {"v": {"message": {role: assistant, content: {parts: [...]}}}, "o": "add"}
                                              # initial assistant message snapshot
      data: {"v": "delta", "p": "/message/content/parts/0", "o": "append"}
                                              # delta token append
      data: {"v": [<batched ops>]}            # batched deltas

    Rules learned from live streams (2026-11-11):
      - an event without "p"/"o" continues the LAST path/op (bare {"v": "more text"});
      - "replace" sets the text, "truncate" cuts it to N chars, "patch" carries a nested op list;
      - after a tool call (web search) ChatGPT streams the answer again as a NEW assistant message whose snapshot has
        empty parts: the text must restart there, otherwise the answer is duplicated.
    """
    full = ""
    conv_id = None
    image_assets = []
    state = {"path": "", "op": "", "text_msg": True}     # đang stream vào tin nhắn trả lời dạng text?

    def apply(entry: dict) -> None:
        nonlocal full
        if "p" in entry:
            state["path"] = entry.get("p") or ""
        if "o" in entry:
            state["op"] = entry.get("o") or ""
        val = entry.get("v")
        if state["op"] == "patch" and isinstance(val, list):
            for sub in val:
                if isinstance(sub, dict):
                    apply(sub)
            return
        if not state["text_msg"] or not state["path"].endswith("/message/content/parts/0"):
            return
        if state["op"] == "append" and isinstance(val, str):
            full += val
        elif state["op"] == "replace" and isinstance(val, str):
            full = val
        elif state["op"] == "truncate" and isinstance(val, int):
            full = full[:val]

    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        p = line[5:].strip()
        if not p or p == "[DONE]":
            continue
        try:
            ch = json.loads(p)
        except json.JSONDecodeError:
            continue
        if not isinstance(ch, dict):
            continue
        conv_id = ch.get("conversation_id") or conv_id

        v = ch.get("v")

        # Snapshot of a new message (v is dict with .message): text restarts from this snapshot.
        if isinstance(v, dict) and isinstance(v.get("message"), dict):
            msg = v["message"]
            role = (msg.get("author") or {}).get("role")
            content = msg.get("content") or {}
            ct = content.get("content_type")
            state.update(path="", op="", text_msg=(role == "assistant" and ct in ("text", "multimodal_text")))
            if role == "assistant" and ct == "text":
                full = "".join(x for x in (content.get("parts") or []) if isinstance(x, str))
            elif role == "assistant" and ct == "multimodal_text":
                for p2 in content.get("parts") or []:
                    if isinstance(p2, str):
                        full = p2
                    elif isinstance(p2, dict):
                        ap = p2.get("asset_pointer", "")
                        if ap:
                            image_assets.append(ap)
            continue

        # Batched operations {"v": [ {p,o,v}, ... ]} (no own path) or a single op / bare continuation.
        if isinstance(v, list) and "p" not in ch:
            for entry in v:
                if isinstance(entry, dict):
                    apply(entry)
        else:
            apply(ch)

    return {"message": full.strip(), "conversation_id": conv_id, "image_assets": image_assets}


_RICH_SELF_CLOSING = re.compile(r"<(?:Cite|AsyncImage|divider|Image|Citation)\b[^>]*/>", re.S)
_ENTITY = re.compile(r"<Entity\b[^>]*?\bvalue=\"([^\"]*)\"[^>]*/>", re.S)
_LAYOUT_TAGS = re.compile(r"</?(?:escape|box|row|column|col|grid|card|stack)\b[^>]*>", re.S)


def clean_web_text(text: str) -> str:
    """Bỏ các thẻ giao diện mà ChatGPT web chèn vào câu trả lời (Cite, AsyncImage, box/row, escape...).
    <Entity value="X"/> được thay bằng X để không mất chữ."""
    out = _ENTITY.sub(lambda m: m.group(1), text or "")
    out = _RICH_SELF_CLOSING.sub("", out)
    out = _LAYOUT_TAGS.sub("", out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()
