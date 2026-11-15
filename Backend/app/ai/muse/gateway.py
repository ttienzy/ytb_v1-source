"""Client HTTP + WebSocket/Noise cho Meta Muse — không cần trình duyệt.

Luồng (đã kiểm chứng với tài khoản thật):
  1. HTTPS muse.ai bằng cookie (bắt buộc có `hatch_sess`), TLS giả Chrome (curl_cffi):
       POST /api/auth/check          -> access_token
       GET  /api/session             -> vm_id (VM riêng của tài khoản)
       POST /api/hatch/vm/wake       (khi VM đang ngủ)
       POST /api/hatch/token         -> hatch token
  2. wss://hatch.metaaivm.com/v1/noise?vm_id=..&auth_token=..  + bắt tay Noise XX (noise_xx.py)
  3. Mỗi lời gọi là một "request HTTP" bọc trong protobuf:
       NoiseTransportFrame{chunk_id, chunk_index, total_chunks, payload=ServiceRequest{service,
         payload=ServiceFrame{stream_id, request=ApplicationRequest{verb, path, headers, body, end_body}}}}
     Trả lời: ServiceResponse{payload=ServiceFrame{response | body_chunk | reset}}
  4. Agent nằm sau service `daemon` (0): chat.history, chat.stream, session.start…
     File agent tạo ra (`sandbox://workspace/…`) tải bằng GET /media/raw/<path> qua cùng đường hầm.

Giao thức tham khảo từ muse-cli (https://github.com/nikships/muse-cli, MIT License,
Copyright (c) 2026 Nik Ships): đường dẫn route, framing và cách chờ trả lời. Code ở đây
viết lại; protobuf được mã hóa tay theo schema nên không cần file descriptor.
API nội bộ của Muse không có phiên bản, có thể đổi bất cứ lúc nào.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import struct
import threading
import time
import urllib.parse
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional

from curl_cffi import requests as rq
from curl_cffi.requests import WebSocket

from app.ai.muse.noise_xx import NoiseXX

MUSE_BASE = "https://muse.ai"
GATEWAY_HOST = "hatch.metaaivm.com"
IMPERSONATE = "chrome"
SERVICE_IDS = {"daemon": 0, "sentinel": 1, "vault": 2, "authd": 3, "ssh_access": 4, "yolk": 5}
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
)

# Các route dùng tới (trích từ bảng route của web client).
ROUTES: dict[str, dict[str, str]] = {
    "chat.history": {"http": "GET", "path": "/chat/history"},
    "chat.stream": {"http": "POST", "path": "/chat/stream"},
    "chat.cancel": {"http": "POST", "path": "/chat/cancel"},
    "sessions.list": {"http": "GET", "path": "/api/session/list"},
    "session.start": {"http": "POST", "path": "/session/start"},
    "session.rename": {"http": "POST", "path": "/session/rename"},
    "fs.write": {"http": "POST", "path": "/fs/write"},
    "fs.stat": {"http": "POST", "path": "/fs/stat"},
    "fs.rename": {"http": "POST", "path": "/fs/rename"},
    "fs.delete": {"http": "POST", "path": "/fs/delete"},
}

# Mỗi bản tin Noise tối đa 65535 byte (gồm 16 byte tag) -> chia payload thành khúc nhỏ hơn.
FRAME_CHUNK = 60000
# Theo web client: ghi file theo khúc 512 KB; ảnh luôn gửi thẳng trong tin nhắn; video < 60 MB và
# file khác < 10 MB gửi thẳng (data_base64), lớn hơn thì ghi vào sandbox rồi gửi file_ref.
UPLOAD_CHUNK = 524288
INLINE_VIDEO_MAX = 0x3C00000
INLINE_FILE_MAX = 0xA00000

SANDBOX_RE = re.compile(r"sandbox://[^\s)\]\"'>]+")


class MuseAuthError(RuntimeError):
    """Cookie hết hạn / chưa đăng nhập."""


class MuseGatewayError(RuntimeError):
    def __init__(self, status: int, detail: str):
        super().__init__(f"gateway status={status}: {detail}")
        self.status = status
        self.detail = detail


# --------------------------------------------------------------------------- protobuf (mã hóa tay)


def _varint(n: int) -> bytes:
    if n < 0:
        n += 1 << 64  # int64 âm -> 10 byte bù hai
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _key(field_no: int, wire: int) -> bytes:
    return _varint((field_no << 3) | wire)


def _f_varint(field_no: int, n: int) -> bytes:
    return _key(field_no, 0) + _varint(n)


def _f_bytes(field_no: int, data: bytes) -> bytes:
    return _key(field_no, 2) + _varint(len(data)) + data


def _read_varint(buf: bytes, i: int) -> tuple[int, int]:
    shift = n = 0
    while True:
        if i >= len(buf):
            raise ValueError("protobuf: varint cụt")
        b = buf[i]
        i += 1
        n |= (b & 0x7F) << shift
        if not b & 0x80:
            return n, i
        shift += 7
        if shift > 70:
            raise ValueError("protobuf: varint quá dài")


def _parse(buf: bytes) -> dict[int, list[Any]]:
    """Tách message thành {field_no: [giá trị…]} (varint -> int, length-delimited -> bytes)."""
    out: dict[int, list[Any]] = {}
    i = 0
    while i < len(buf):
        k, i = _read_varint(buf, i)
        fno, wire = k >> 3, k & 7
        if wire == 0:
            v, i = _read_varint(buf, i)
        elif wire == 2:
            ln, i = _read_varint(buf, i)
            v = bytes(buf[i : i + ln])
            i += ln
        elif wire == 1:
            v = bytes(buf[i : i + 8])
            i += 8
        elif wire == 5:
            v = bytes(buf[i : i + 4])
            i += 4
        else:
            raise ValueError(f"protobuf: wire type {wire} không hỗ trợ")
        out.setdefault(fno, []).append(v)
    return out


def _first(d: dict[int, list[Any]], fno: int, default: Any = None) -> Any:
    vals = d.get(fno)
    return vals[0] if vals else default


def _signed64(n: int) -> int:
    return n - (1 << 64) if n >= 1 << 63 else n


def encode_request(service: int, stream_id: int, verb: str, path: str, headers: dict[str, str], body: bytes) -> bytes:
    """ServiceRequest{service, payload=ServiceFrame{stream_id, request=ApplicationRequest{…}}}."""
    app = _f_bytes(1, verb.encode()) + _f_bytes(2, path.encode())
    for k, v in headers.items():
        app += _f_bytes(3, _f_bytes(1, k.encode()) + _f_bytes(2, v.encode()))
    if body:
        app += _f_bytes(4, body)
    app += _f_varint(5, 1)  # end_body = true
    frame = _f_varint(1, stream_id) + _f_bytes(2, app)
    return (_f_varint(1, service) if service else b"") + _f_bytes(2, frame)


def encode_transport(chunk_id: int, chunk_index: int, total: int, payload: bytes) -> bytes:
    """NoiseTransportFrame (các trường đều là proto3 optional nên ghi cả giá trị 0)."""
    return _f_varint(1, chunk_id) + _f_varint(2, chunk_index) + _f_varint(3, total) + _f_bytes(4, payload)


@dataclass
class Frame:
    """Một ServiceFrame đã giải mã."""

    stream_id: int
    kind: str  # response | body_chunk | reset | request | unknown
    status: int = 0
    headers: dict[str, str] = field(default_factory=dict)
    data: bytes = b""
    end_body: bool = False
    reset_code: int = 0
    reset_reason: str = ""


def decode_frame(service_response: bytes) -> Frame:
    sr = _parse(service_response)
    sf = _parse(_first(sr, 1, b""))
    sid = _signed64(_first(sf, 1, 0))
    if 3 in sf:  # ApplicationResponse
        r = _parse(sf[3][0])
        hdrs = {}
        for h in r.get(2, []):
            hp = _parse(h)
            hdrs[_first(hp, 1, b"").decode("utf-8", "replace").lower()] = _first(hp, 2, b"").decode("utf-8", "replace")
        status = _first(r, 1, 0)
        if status >= 1 << 31:
            status -= 1 << 32
        return Frame(sid, "response", status=status, headers=hdrs, data=_first(r, 3, b""), end_body=bool(_first(r, 4, 0)))
    if 4 in sf:  # BodyChunk
        c = _parse(sf[4][0])
        return Frame(sid, "body_chunk", data=_first(c, 1, b""), end_body=bool(_first(c, 2, 0)))
    if 5 in sf:  # Reset
        r = _parse(sf[5][0])
        return Frame(sid, "reset", reset_code=_first(r, 1, 0), reset_reason=_first(r, 2, b"").decode("utf-8", "replace"))
    if 2 in sf:
        return Frame(sid, "request")
    return Frame(sid, "unknown")


# --------------------------------------------------------------------------- HTTP bootstrap


def _web_headers(cookies: str, ua: str, access_token: Optional[str] = None) -> dict[str, str]:
    h = {
        "User-Agent": ua or DEFAULT_UA,
        "Referer": MUSE_BASE + "/",
        "Origin": MUSE_BASE,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Cookie": cookies,
    }
    if access_token:
        h["Authorization"] = f"Bearer {access_token}"
    return h


def merge_cookies(cookies: str, response: Any) -> str:
    """Gộp Set-Cookie của muse.ai (nếu máy chủ xoay vòng phiên) vào chuỗi cookie hiện có."""
    jar: dict[str, str] = {}
    for part in cookies.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            jar[k.strip()] = v.strip()
    try:
        for c in response.cookies.jar:
            if "muse.ai" in (c.domain or "muse.ai") and c.value is not None:
                jar[c.name] = c.value
    except Exception:
        return cookies
    return "; ".join(f"{k}={v}" for k, v in jar.items())


def auth_check(cookies: str, ua: str = "") -> dict[str, Any]:
    """POST /api/auth/check -> {ok, access_token, viewer_id, …, "_cookies": cookie đã gộp}.

    Lỗi phiên -> MuseAuthError. Không ghi access_token ra log.
    """
    r = rq.post(MUSE_BASE + "/api/auth/check", headers=_web_headers(cookies, ua), data=b"", impersonate=IMPERSONATE, timeout=20)
    data: dict[str, Any] = {}
    try:
        data = r.json()
    except ValueError:
        pass
    if r.status_code != 200 or not data.get("ok") or not data.get("access_token"):
        raise MuseAuthError(f"Muse từ chối phiên đăng nhập (auth/check HTTP {r.status_code}). Hãy đăng nhập lại tài khoản.")
    data["_cookies"] = merge_cookies(cookies, r)
    return data


def session_info(cookies: str, ua: str = "") -> dict[str, Any]:
    r = rq.get(MUSE_BASE + "/api/session?vm_state=live", headers=_web_headers(cookies, ua), impersonate=IMPERSONATE, timeout=20)
    if r.status_code in (401, 403):
        raise MuseAuthError(f"api/session HTTP {r.status_code}: cookie hết hạn.")
    try:
        return r.json()
    except ValueError:
        raise MuseGatewayError(r.status_code, f"api/session trả về không phải JSON: {r.text[:120]!r}")


def wake_vm(cookies: str, ua: str, access_token: str, vm_id: str) -> None:
    rq.post(
        MUSE_BASE + "/api/hatch/vm/wake",
        headers=_web_headers(cookies, ua, access_token),
        json={"vm_id": vm_id, "retry_count": 0, "connect_attempt_id": str(uuid.uuid4())},
        impersonate=IMPERSONATE,
        timeout=20,
    )


def resolve_vm(cookies: str, ua: str, access_token: str, wait_seconds: float = 90) -> str:
    """vm_id của tài khoản; đánh thức VM nếu đang ngủ / khởi động lại."""
    deadline = time.time() + wait_seconds
    woke = False
    last: dict[str, Any] = {}
    while True:
        last = session_info(cookies, ua)
        vm_id = last.get("vm_id")
        state = str(last.get("vm_state") or "").upper()
        if vm_id and state in ("", "RUNNING"):
            return vm_id
        if vm_id and not woke:
            wake_vm(cookies, ua, access_token, vm_id)
            woke = True
        if time.time() > deadline:
            if vm_id:
                return vm_id  # thử kết nối luôn, gateway sẽ báo lỗi rõ hơn
            raise MuseGatewayError(-1, f"VM Muse chưa sẵn sàng: {json.dumps(last)[:200]}")
        time.sleep(3)


def hatch_token(cookies: str, ua: str, access_token: str, vm_id: str) -> str:
    r = rq.post(
        MUSE_BASE + "/api/hatch/token",
        headers=_web_headers(cookies, ua, access_token),
        json={"vmAddress": f"wss://{vm_id}.metaaivm.com/", "vmName": vm_id},
        impersonate=IMPERSONATE,
        timeout=20,
    )
    try:
        tok = r.json().get("token")
    except ValueError:
        tok = None
    if r.status_code != 200 or not tok:
        raise MuseAuthError(f"hatch/token HTTP {r.status_code}: {r.text[:160]}")
    return tok


# --------------------------------------------------------------------------- gateway


def media_path(ref: Any) -> str:
    """sandbox://… / URL media / dict resource -> /media/raw/<path>."""
    if isinstance(ref, dict):
        ref = (ref.get("variants") or {}).get("original") or ref.get("path") or ref.get("url")
        if not ref:
            raise ValueError("resource không có path")
    ref = str(ref)
    if ref.startswith("sandbox://"):
        rel = ref[len("sandbox://") :]
    elif ref.startswith(("https://", "http://")):
        rel = urllib.parse.urlsplit(ref).path
    else:
        rel = ref
    rel = rel.lstrip("/")
    if rel.startswith("media/raw/"):
        rel = rel[len("media/raw/") :]
    rel = urllib.parse.unquote(rel)
    if not rel or ".." in rel.split("/"):
        raise ValueError(f"đường dẫn sandbox không hợp lệ: {ref!r}")
    return "/media/raw/" + urllib.parse.quote(rel, safe="/")


class MuseGateway:
    """Một kết nối đã xác thực tới VM Muse của một tài khoản.

    Chỉ một luồng được đọc frame tại một thời điểm (đọc song song làm lệch nonce Noise).
    """

    def __init__(self, cookies: str, ua: str = "", vm_id: Optional[str] = None, connect_timeout: float = 25):
        if "hatch_sess=" not in cookies:
            raise MuseAuthError("Cookie Muse thiếu hatch_sess — hãy đăng nhập lại tài khoản.")
        self.cookies = cookies
        self.ua = ua or DEFAULT_UA
        auth = auth_check(cookies, self.ua)
        self.cookies = cookies = auth.get("_cookies") or cookies  # lưu lại nếu máy chủ xoay vòng cookie
        self.viewer_id = str(auth.get("viewer_id") or "")
        access_token = auth["access_token"]
        self.vm_id = vm_id or resolve_vm(cookies, self.ua, access_token)
        token = hatch_token(cookies, self.ua, access_token, self.vm_id)

        url = f"wss://{GATEWAY_HOST}/v1/noise?vm_id={self.vm_id}&auth_token={urllib.parse.quote(token, safe='')}&app_id=hatch-web"
        self.ws = WebSocket()
        self._lock_send = threading.Lock()
        self._lock_recv = threading.Lock()
        self._chunks: dict[int, dict[int, bytes]] = {}
        self._stream = 1
        try:
            self.ws.connect(
                url,
                impersonate=IMPERSONATE,
                timeout=connect_timeout,
                verify=True,  # mặc định của curl_cffi WebSocket là KHÔNG kiểm chứng chỉ
                headers={"Origin": MUSE_BASE, "User-Agent": self.ua},
            )
            self.noise = NoiseXX(initiator=True)
            self.ws.send_bytes(self.noise.write_message(b""), timeout=connect_timeout)
            m2, _ = self.ws.recv(timeout=connect_timeout)
            self.noise.read_message(bytes(m2))
            self.ws.send_bytes(self.noise.write_message(b""), timeout=connect_timeout)
        except BaseException:
            self.close()
            raise

    # ---- vào / ra
    def __enter__(self) -> "MuseGateway":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass

    # ---- frame thấp
    def _send(self, service: int, payload: bytes) -> None:
        """Gửi một ServiceRequest; payload lớn được chia nhiều frame cùng chunk_id."""
        chunk_id = struct.unpack("<q", os.urandom(8))[0]
        parts = [payload[i : i + FRAME_CHUNK] for i in range(0, len(payload), FRAME_CHUNK)] or [b""]
        with self._lock_send:
            for idx, part in enumerate(parts):
                frame = encode_transport(chunk_id, idx, len(parts), part)
                self.ws.send_bytes(self.noise.encrypt(frame))

    def _read(self, deadline: Optional[float]) -> Frame:
        with self._lock_recv:
            while True:
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    raise TimeoutError("gateway Muse không trả lời kịp")
                try:
                    data, _flags = self.ws.recv(timeout=remaining)
                except Exception as e:
                    if "timeout" in type(e).__name__.lower() or "timed out" in str(e).lower():
                        raise TimeoutError("gateway Muse không trả lời kịp") from None
                    raise
                ntf = _parse(self.noise.decrypt(bytes(data)))
                payload = _first(ntf, 4, b"")
                total = _first(ntf, 3, 1) or 1
                if total == 1:
                    break
                cid = _signed64(_first(ntf, 1, 0))
                parts = self._chunks.setdefault(cid, {})
                parts[_first(ntf, 2, 0)] = payload
                if all(i in parts for i in range(total)):
                    del self._chunks[cid]
                    payload = b"".join(parts[i] for i in range(total))
                    break
        return decode_frame(payload)

    def open(
        self,
        method: str,
        body: Any = None,
        query: Optional[dict[str, Any]] = None,
        route: Optional[dict[str, str]] = None,
    ) -> int:
        """Gửi một request, trả stream_id (không chờ trả lời)."""
        route = route or ROUTES[method]
        path = route["path"]
        if query:
            qs = urllib.parse.urlencode({k: v for k, v in query.items() if v is not None}, doseq=True)
            if qs:
                path += ("&" if "?" in path else "?") + qs
        raw = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        headers = {"x-request-id": str(uuid.uuid4())}
        if raw:
            headers["content-type"] = "application/json"
        sid = self._stream
        self._stream += 1
        self._send(
            SERVICE_IDS.get(route.get("service", "daemon"), 0),
            encode_request(SERVICE_IDS.get(route.get("service", "daemon"), 0), sid, route["http"], path, headers, raw),
        )
        return sid

    def request(
        self,
        method: str,
        body: Any = None,
        query: Optional[dict[str, Any]] = None,
        timeout: float = 30,
        route: Optional[dict[str, str]] = None,
        sink: Optional[Callable[[bytes], None]] = None,
    ) -> bytes:
        """Request một lần; trả body (hoặc đẩy từng mảnh vào sink)."""
        route = route or ROUTES[method]
        if route["http"] == "GET" and body is not None and query is None:
            query, body = body, None
        sid = self.open(method, body, query, route)
        deadline = time.monotonic() + timeout
        status: Optional[int] = None
        ok_parts: list[bytes] = []
        err_parts: list[bytes] = []
        done = False

        def feed(data: bytes) -> None:
            if not data:
                return
            if status is not None and 200 <= status < 300:
                (sink or ok_parts.append)(data)
            else:
                err_parts.append(data)

        while not done:
            fr = self._read(deadline)
            if fr.stream_id != sid:
                continue
            if fr.kind == "response":
                status = fr.status
                feed(fr.data)
                done = fr.end_body
            elif fr.kind == "body_chunk" and status is not None:
                feed(fr.data)
                done = fr.end_body
            elif fr.kind == "reset":
                raise MuseGatewayError(-1, f"stream reset {fr.reset_code}: {fr.reset_reason}")
        if status is None or not (200 <= status < 300):
            raise MuseGatewayError(status or -1, b"".join(err_parts)[:500].decode("utf-8", "replace"))
        return b"".join(ok_parts)

    def call_json(self, method: str, body: Any = None, query: Optional[dict[str, Any]] = None, timeout: float = 30) -> Any:
        raw = self.request(method, body, query, timeout)
        try:
            d = json.loads(raw) if raw else {}
        except ValueError:
            raise MuseGatewayError(-1, f"trả lời không phải JSON: {raw[:200]!r}")
        if isinstance(d, dict) and d.get("ok") is False:
            raise MuseGatewayError(-1, f"lỗi API: {d.get('error')}")
        return d.get("result", d) if isinstance(d, dict) else d

    def download(self, ref: Any, dest: str, timeout: float = 600) -> int:
        """Tải một file trong sandbox của agent về `dest` (ghi .part rồi đổi tên). Trả số byte."""
        route = {"http": "GET", "path": media_path(ref)}
        tmp = dest + ".part"
        written = 0
        with open(tmp, "wb") as fh:

            def sink(data: bytes) -> None:
                nonlocal written
                fh.write(data)
                written += len(data)

            self.request("media.raw", timeout=timeout, route=route, sink=sink)
        os.replace(tmp, dest)
        return written

    # ---- chat
    def history(self, session_id: Optional[str] = None, limit: int = 20) -> list[dict]:
        q: dict[str, Any] = {"limit": limit}
        if session_id:
            q["session_id"] = session_id
        evs = self.call_json("chat.history", query=q).get("chat_events", [])
        return sorted(evs, key=lambda e: e.get("seq") or 0)

    def start_session(self, title: Optional[str] = None) -> str:
        res = self.call_json(
            "session.start",
            body={"method": "/api/session/start", "params": {"origin": "fresh", "lifecycle": "persistent"}},
        )
        sid = res.get("session_id") or res.get("id")
        if not sid:
            raise MuseGatewayError(-1, f"session.start không trả session_id: {res}")
        if title:
            try:
                self.call_json("session.rename", body={"session_id": sid, "title": title[:80]})
            except Exception:
                pass  # tên chat không quan trọng
        return sid

    def send_text(self, text: str, node_id: str, session_id: Optional[str] = None) -> int:
        return self.send_items([{"type": "text", "text": text}], node_id, session_id)

    def send_items(self, items: list[dict], node_id: str, session_id: Optional[str] = None) -> int:
        """Gửi một tin nhắn (chữ + đính kèm) — đúng body `chat.stream` của web client."""
        body: dict[str, Any] = {"items": items, "node_id": node_id, "capabilities": {}}
        if session_id:
            body["session_id"] = session_id
        return self.open("chat.stream", body=body)

    def upload_file(self, local_path: str, remote_path: str, timeout: float = 120) -> None:
        """Ghi file vào sandbox: /fs/write theo khúc 512 KB (nhiều khúc thì ghi file tạm rồi đổi tên)."""
        size = os.path.getsize(local_path)
        n_chunks = max(1, -(-size // UPLOAD_CHUNK))
        staged = n_chunks > 1
        folder = remote_path.rsplit("/", 1)[0] + "/" if "/" in remote_path else ""
        target = f"{folder}.upload-{uuid.uuid4()}.part" if staged else remote_path
        try:
            with open(local_path, "rb") as fh:
                for i in range(n_chunks):
                    data = fh.read(UPLOAD_CHUNK)
                    self.call_json(
                        "fs.write",
                        body={
                            "path": target,
                            "data_base64": base64.b64encode(data).decode(),
                            "overwrite": i == 0,
                            "append": i != 0,
                            "create_parent": i == 0,
                        },
                        timeout=timeout,
                    )
            if staged:
                st = self.call_json("fs.stat", body={"path": target})
                if st.get("kind") != "file" or st.get("size") != size:
                    raise MuseGatewayError(-1, f"file tải lên sai kích thước ({st.get('size')} != {size})")
                self.call_json(
                    "fs.rename",
                    body={"source": target, "destination": remote_path, "create_parent": True, "overwrite": True},
                )
        except BaseException:
            if staged:
                try:
                    self.call_json("fs.delete", body={"path": target, "recursive": False})
                except Exception:
                    pass
            raise

    def attachment_items(self, paths: Iterable[str]) -> list[dict]:
        """File trên máy -> items đính kèm theo đúng quy tắc của web client."""
        items: list[dict] = []
        for p in paths:
            name = os.path.basename(p)
            mime = guess_mime(name)
            size = os.path.getsize(p)
            category = mime.split("/", 1)[0]
            if category == "image":
                items.append({"type": "image", "mime_type": mime, "data_base64": _b64file(p), "filename": name})
                continue
            limit = INLINE_VIDEO_MAX if category == "video" else INLINE_FILE_MAX
            if size < limit:
                items.append({"type": "file", "mime_type": mime, "data_base64": _b64file(p), "filename": name})
                continue
            remote = upload_path_for(name)
            self.upload_file(p, remote)
            items.append({"type": "file_ref", "mime_type": mime, "path": remote, "filename": name})
        return items


# --------------------------------------------------------------------------- đọc sự kiện chat


def node_id_for(viewer_id: str) -> str:
    """node_id ổn định cho một tài khoản (web client tự sinh 16 hex và giữ cố định)."""
    return hashlib.sha256(f"creatorflow-muse:{viewer_id}".encode()).hexdigest()[:16]


_MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    ".heic": "image/heic", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".pdf": "application/pdf",
}


def guess_mime(name: str) -> str:
    return _MIME.get(os.path.splitext(name)[1].lower(), "application/octet-stream")


def _b64file(path: str) -> str:
    with open(path, "rb") as fh:
        return base64.b64encode(fh.read()).decode()


def upload_path_for(filename: str) -> str:
    """Giống web client: workspace/user/files/<tên an toàn>_<n>_<4 ký tự><đuôi>."""
    stem, ext = os.path.splitext(filename)
    stem = re.sub(r"[^a-zA-Z0-9._-]", "_", stem) or "file"
    ext = re.sub(r"[^a-zA-Z0-9.]", "_", ext)
    return f"workspace/user/files/{stem}_{int(time.time() * 1000) % 100000}_{uuid.uuid4().hex[:4]}{ext}"


def _payload(ev: dict) -> dict:
    p = ev.get("payload")
    return p if isinstance(p, dict) else {}


def event_text(ev: dict) -> str:
    p = _payload(ev)
    return p.get("display_text") or p.get("content") or ""


def is_reply(ev: dict, baseline: int) -> bool:
    """Trả lời thật của agent (không phải tin chủ động / tin nền) mới hơn baseline và đã viết xong."""
    if ev.get("event_name") != "message.assistant" or (ev.get("seq") or 0) <= baseline:
        return False
    p = _payload(ev)
    if ev.get("reply_to_message_id") or p.get("reply_to_message_id"):
        return False
    return bool(event_text(ev)) and bool(p.get("status"))


def event_resources(ev: dict) -> list[dict]:
    """Các file tải được (sandbox://… hoặc /media/raw/…) mà một sự kiện nhắc tới."""
    p = _payload(ev)
    found: dict[str, dict] = {}

    def add(item: Any, kind: str) -> None:
        if isinstance(item, str):
            item = {"path": item}
        if not isinstance(item, dict) or item.get("missing"):
            return
        path = item.get("path") or (item.get("variants") or {}).get("original")
        if not path or not (str(path).startswith("sandbox://") or "/media/raw/" in str(path)):
            return
        r = found.setdefault(path, {"path": path})
        r.setdefault("kind", kind)
        for k in ("mime", "byte_len", "label", "variants"):
            if item.get(k) is not None:
                r[k] = item[k]

    data = p.get("data") if isinstance(p.get("data"), dict) else {}
    for key, val in data.items():
        if isinstance(val, list):
            for item in val:
                add(item, key.rstrip("s"))
        elif isinstance(val, dict) and val.get("path"):
            add(val, key)
    for src in (ev.get("resources"), p.get("resources")):
        for item in src or []:
            add(item, "resource")
    for text in (p.get("fallback_text"), data.get("fallback_text"), p.get("display_text"), p.get("content")):
        if isinstance(text, str):
            for m in SANDBOX_RE.findall(text):
                add(m, "link")
    return list(found.values())


def guess_media_kind(res: dict) -> str:
    mime = str(res.get("mime") or "").lower()
    path = str(res.get("path") or "").lower().split("?")[0]
    if mime.startswith("video/") or path.endswith((".mp4", ".webm", ".mov")):
        return "video"
    if mime.startswith("image/") or path.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return "image"
    return "file"


@dataclass
class ChatResult:
    session_id: Optional[str]
    baseline_seq: int
    reply_text: str = ""
    # mọi câu trả lời chữ của agent sau baseline, theo thứ tự (bài dài có thể tách nhiều tin)
    reply_texts: list[str] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    resources: list[dict] = field(default_factory=list)
    timed_out: bool = False


def wait_for_result(
    gw: MuseGateway,
    session_id: Optional[str],
    baseline: int,
    *,
    want: Iterable[str] = ("video", "image"),
    timeout: float = 600,
    settle: float = 15,
    poll: float = 3,
    reply_grace: Optional[float] = None,
    on_progress: Optional[Callable[[str], None]] = None,
) -> ChatResult:
    """Đọc lại lịch sử chat tới khi có media mong muốn và luồng chat im lặng `settle` giây.

    Media tới thành sự kiện riêng, sau câu trả lời chữ (ảnh ~20 s, video lâu hơn).
    Nếu agent đã trả lời chữ mà không có media, vẫn chờ tới hết `timeout`.
    """
    want = set(want)
    result = ChatResult(session_id=session_id, baseline_seq=baseline)
    deadline = time.time() + timeout
    last_seq = baseline
    quiet_since = time.time()
    while time.time() < deadline:
        time.sleep(poll)
        try:
            evs = gw.history(session_id, limit=30)
        except (MuseGatewayError, TimeoutError):
            continue
        new = [e for e in evs if (e.get("seq") or 0) > baseline]
        top = max([e.get("seq") or 0 for e in new] or [baseline])
        if top > last_seq:
            last_seq, quiet_since = top, time.time()
        result.events = new
        res: dict[str, dict] = {}
        texts: list[str] = []
        for ev in sorted(new, key=lambda e: e.get("seq") or 0):
            for r in event_resources(ev):
                res.setdefault(r["path"], r)
            if is_reply(ev, baseline):
                result.reply_text = event_text(ev)
                texts.append(result.reply_text)
        result.reply_texts = texts
        result.resources = list(res.values())
        have_media = any(guess_media_kind(r) in want for r in result.resources)
        if on_progress:
            on_progress(
                f"{len(new)} sự kiện mới, {len(result.resources)} file, "
                f"{'đã có media' if have_media else 'chưa có media'}, im lặng {int(time.time() - quiet_since)}s"
            )
        # want rỗng = chỉ cần câu trả lời chữ
        done = have_media if want else bool(result.reply_text)
        if done and time.time() - quiet_since >= settle:
            return result
        # Agent đã trả lời chữ (vd. hỏi lại / từ chối) và im lặng lâu mà không có media -> thôi chờ.
        if reply_grace and result.reply_text and not have_media and time.time() - quiet_since >= reply_grace:
            return result
    result.timed_out = True
    return result
