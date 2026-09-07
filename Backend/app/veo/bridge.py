"""
Veo Bridge Server — HTTP server trên loopback cung cấp API cho Chrome Extension.

Chạy trong thread riêng (ThreadingHTTPServer) trên port 60526.
Extension FlowsVeo-Clean poll bridge này để:
  1. Lấy secret key xác thực
  2. Nhận config harvest
  3. Push credentials (cookies/tokens) từ tab labs.google
  4. Poll yêu cầu giải reCAPTCHA
  5. Trả token reCAPTCHA đã giải
  6. Gửi heartbeat, voice cookies

Bridge quản lý:
  - credentials_pool: Dict[email → credential data]
  - captcha_queue: pending captcha requests
  - extension_status: heartbeat info
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from queue import Queue, Empty

logger = logging.getLogger("veo.bridge")

# ─────────────────────────────────────────────────────────────────────────────
# Bridge State (module-level singleton)
# ─────────────────────────────────────────────────────────────────────────────

_bridge_lock = threading.Lock()

# Auth & Port
_bridge_secret: str = ""
_bridge_start_time: float = 0
_actual_port: int = 0

# Harvest config gửi cho Extension (base64-encoded JSON)
_harvest_config: dict[str, Any] = {
    "t": {
        "p": ["https://labs.google/*", "https://flow.google.com/*"],
        "o": "https://flow.google.com/",
    },
    "h": {
        "d": "labs.google",
        "cn": "__Secure-next-auth.session-token",
        "u": "https://labs.google/fx/api/auth/session",
        "tf": ["access_token"],
        "ti": "https://oauth2.googleapis.com/tokeninfo",
        "cu": "https://aisandbox-pa.googleapis.com/v1/credits",
        "co": "https://labs.google",
        "ap": [],
    },
    "c": {
        "m": "grecaptcha",
        "s": "enterprise",
        "da": "",
        "g": "___grecaptcha_cfg",
        "k": "clients",
        "p": "sitekey",
        "q": "script[src*=\"enterprise.js\"]",
    },
}
_config_version: str = "1.1"

# Credentials pool: email → credential data
_credentials_pool: dict[str, dict[str, Any]] = {}
_refresh_pending: list[dict[str, Any]] = []

# Captcha queue
_captcha_pending: Queue = Queue(maxsize=50)
_captcha_results: dict[str, dict[str, Any]] = {}   # request_id → {token, error, ts}
_flow_results: dict[str, dict[str, Any]] = {}      # request_id → Flow generation result
_project_results: dict[str, dict[str, Any]] = {}   # request_id → Flow project creation result
_image_results: dict[str, dict[str, Any]] = {}     # request_id → Flow image generation result
_captcha_busy: bool = False
_captcha_busy_until: float = 0
_captcha_stats = {"total_solved": 0, "last_solved_at": None}

# Extension status
_extension_info: dict[str, Any] = {
    "ext_fp": "",
    "version": "",
    "tab_count": 0,
    "last_heartbeat": None,
    "connected": False,
}

# Voice cookies
_voice_cookies: dict[str, Any] = {}

# Server instance
_server: ThreadingHTTPServer | None = None
_server_thread: threading.Thread | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Public API (called from service.py)
# ─────────────────────────────────────────────────────────────────────────────

def get_bridge_secret() -> str:
    return _bridge_secret


def get_bridge_port() -> int:
    return _actual_port


def get_credentials_pool() -> dict[str, dict[str, Any]]:
    with _bridge_lock:
        return dict(_credentials_pool)


def get_extension_info() -> dict[str, Any]:
    with _bridge_lock:
        info = dict(_extension_info)
        # Kiểm tra connected dựa trên heartbeat (timeout 90s)
        if info.get("last_heartbeat"):
            try:
                last = datetime.fromisoformat(info["last_heartbeat"])
                diff = (datetime.now(timezone.utc) - last).total_seconds()
                info["connected"] = diff < 90
            except Exception:
                info["connected"] = False
        return info


def get_captcha_stats() -> dict[str, Any]:
    with _bridge_lock:
        return {
            "queue_size": _captcha_pending.qsize(),
            **_captcha_stats,
        }


def request_captcha(
    action: str = "USER_GENERATION",
    flow_request: dict[str, Any] | None = None,
) -> str | None:
    """Enqueue captcha request, trả về request_id. None nếu queue đầy hoặc busy."""
    if _captcha_busy and time.time() < _captcha_busy_until:
        return None

    request_id = secrets.token_hex(16)
    job = {
        "request_id": request_id,
        "action": action,
        "created_at": time.time(),
    }
    if flow_request is not None:
        job["flow_request"] = flow_request
    try:
        _captcha_pending.put_nowait(job)
        return request_id
    except Exception:
        return None


def request_flow_recovery(provider_model_id: str = "") -> str | None:
    """Ask the extension to recover the video URL from the open Flow scene."""
    request_id = secrets.token_hex(16)
    try:
        _captcha_pending.put_nowait({
            "request_id": request_id,
            "flow_recovery": True,
            "provider_model_id": provider_model_id,
            "created_at": time.time(),
        })
        return request_id
    except Exception:
        return None


def request_create_project(name: str = "") -> str | None:
    """Yêu cầu Extension tự động tạo Project mới trên tab Google Flow."""
    request_id = secrets.token_hex(16)
    try:
        _captcha_pending.put_nowait({
            "request_id": request_id,
            "action": "CREATE_PROJECT",
            "project_name": name,
            "created_at": time.time(),
        })
        return request_id
    except Exception:
        return None


def wait_project_result(request_id: str, timeout: float = 35.0) -> dict[str, Any] | None:
    """Chờ Extension trả kết quả tạo Project trên tab Google Flow."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with _bridge_lock:
            if request_id in _project_results:
                return _project_results.pop(request_id)
        time.sleep(0.4)
    return None


def request_switch_project(flow_project_id: str, account_email: str = "") -> str | None:
    """Yêu cầu Extension tự động điều hướng / mở tab Project trên Google Flow."""
    request_id = secrets.token_hex(16)
    try:
        _captcha_pending.put_nowait({
            "request_id": request_id,
            "action": "SWITCH_PROJECT",
            "flow_project_id": flow_project_id,
            "account_email": account_email,
            "created_at": time.time(),
        })
        return request_id
    except Exception:
        return None


def wait_switch_result(request_id: str, timeout: float = 12.0) -> dict[str, Any] | None:
    """Chờ Extension trả kết quả chuyển tab Project."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with _bridge_lock:
            if request_id in _project_results:
                return _project_results.pop(request_id)
        time.sleep(0.3)
    return None


def request_generate_image(image_request: dict[str, Any]) -> str | None:
    """Yêu cầu Extension sinh ảnh trên Google Flow thông qua RPC ogiZ0b."""
    request_id = secrets.token_hex(16)
    try:
        _captcha_pending.put_nowait({
            "request_id": request_id,
            "action": "IMAGE_GENERATION",
            "captcha_action": "IMAGE_GENERATION",
            "image_request": image_request,
            "created_at": time.time(),
        })
        return request_id
    except Exception:
        return None


def wait_image_result(request_id: str, timeout: float = 60.0) -> dict[str, Any] | None:
    """Chờ Extension trả kết quả sinh ảnh từ Google Flow."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with _bridge_lock:
            if request_id in _image_results:
                return _image_results.pop(request_id)
        time.sleep(0.3)
    return None


def wait_captcha_result(request_id: str, timeout: float = 30.0) -> dict[str, Any] | None:
    """Chờ Extension trả token reCAPTCHA. Blocking call."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with _bridge_lock:
            if request_id in _captcha_results:
                return _captcha_results.pop(request_id)
        time.sleep(0.3)
    return None


def wait_flow_result(request_id: str, timeout: float = 300.0) -> dict[str, Any] | None:
    """Wait for the extension to finish the authenticated Flow browser request."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with _bridge_lock:
            if request_id in _flow_results:
                return _flow_results.pop(request_id)
        time.sleep(0.5)
    return None


def is_bridge_running() -> bool:
    return _server is not None and _server_thread is not None and _server_thread.is_alive()


def get_uptime() -> float:
    if _bridge_start_time:
        return time.time() - _bridge_start_time
    return 0


def request_refresh(reason: str = "user_refresh") -> None:
    """Gửi yêu cầu Extension quét và cập nhật lại cookie/credits từ tab Google Flow."""
    with _bridge_lock:
        _refresh_pending.append({
            "reason": reason,
            "requested_at": datetime.now(timezone.utc).isoformat(),
        })


def request_extension_reload() -> None:
    """Yêu cầu Extension tự gọi chrome.runtime.reload() qua hàng đợi poll."""
    try:
        _captcha_pending.put_nowait({"reload": True})
    except Exception:
        pass


def request_tab_reload(target_project_id: str = "") -> None:
    """Yêu cầu Extension làm mới tab Google Flow để xóa cờ WAF."""
    try:
        _captcha_pending.put_nowait({
            "request_id": secrets.token_hex(16),
            "action": "RELOAD_TAB",
            "target_project_id": target_project_id,
            "timestamp": time.time(),
        })
    except Exception:
        pass


def set_manual_credential(email: str, cookie: str, access_token: str = "") -> None:
    """Lưu credential nhập tay từ người dùng trên giao diện Cài đặt."""
    with _bridge_lock:
        _credentials_pool[email] = {
            "email": email,
            "cookie": cookie,
            "access_token": access_token,
            "tier": "MANUAL",
            "credit": None,
            "pushed_at": datetime.now(timezone.utc).isoformat(),
            "manual": True,
        }



# ─────────────────────────────────────────────────────────────────────────────
# HTTP Request Handler
# ─────────────────────────────────────────────────────────────────────────────

class BridgeHandler(BaseHTTPRequestHandler):
    """HTTP handler cho Bridge Server — phục vụ Extension."""

    def log_message(self, format: str, *args: Any) -> None:
        logger.debug("Bridge: %s", format % args)

    def _send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_no_content(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw)

    def _check_secret(self) -> bool:
        """Validate X-Bridge-Key header."""
        key = self.headers.get("X-Bridge-Key", "")
        return key == _bridge_secret

    def _send_harvest_config(self) -> None:
        """Shared config response for POST and older extension GET clients."""
        if not self._check_secret():
            self._send_json({"error": "forbidden"}, 403)
            return
        import base64

        payload = base64.b64encode(
            json.dumps(_harvest_config, ensure_ascii=False).encode("utf-8")
        ).decode("ascii")
        self._send_json({"payload": payload, "v": _config_version})

    # ── CORS preflight ──
    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    # ── GET routes ──
    def do_GET(self) -> None:
        global _captcha_busy, _captcha_busy_until

        if self.path == "/api/v1/config/init":
            self._send_harvest_config()
            return

        if self.path == "/bridge/secret":
            self._send_json({"secret": _bridge_secret})
            return

        if self.path == "/captcha/request":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            # Nếu đang busy (Extension refresh tab)
            if _captcha_busy and time.time() < _captcha_busy_until:
                self._send_no_content()
                return
            else:
                _captcha_busy = False

            try:
                job = _captcha_pending.get_nowait()
                self._send_json(job)
            except Empty:
                self._send_no_content()
            return

        if self.path == "/refresh/pending":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            with _bridge_lock:
                reqs = list(_refresh_pending)
                _refresh_pending.clear()
            self._send_json({"requests": reqs})
            return

        if self.path == "/captcha/health":
            self._send_json({"status": "ok", "service": "veo-bridge", "port": _actual_port})
            return

        if self.path == "/token":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            tok = ""
            with _bridge_lock:
                for cred in _credentials_pool.values():
                    if cred.get("access_token"):
                        tok = cred["access_token"]
                        break
            self._send_json({"access_token": tok})
            return

        # Fallback
        self._send_json({"error": "not found"}, 404)

    # ── POST routes ──
    def do_POST(self) -> None:
        global _captcha_busy, _captcha_busy_until

        if self.path == "/api/v1/config/init":
            self._send_harvest_config()
            return

        if self.path == "/credentials/push":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            data = self._read_json()
            credentials = data.get("credentials", [])
            with _bridge_lock:
                if not credentials:
                    # Extension clear pool
                    _credentials_pool.clear()
                else:
                    for cred in credentials:
                        email = cred.get("email", "")
                        if email:
                            old = _credentials_pool.get(email, {})
                            # Giữ lại số dư credit cũ nếu lượt quét này chưa mở dialog (credit == 0)
                            new_cred = int(cred.get("credit") or 0)
                            old_cred = int(old.get("credit") or 0)
                            if new_cred == 0 and old_cred > 0:
                                cred["credit"] = old_cred
                            _credentials_pool[email] = {
                                **cred,
                                "pushed_at": datetime.now(timezone.utc).isoformat(),
                            }
            logger.info("Credentials pushed: %d account(s)", len(credentials))
            self._send_json({"ok": True, "count": len(credentials)})
            return

        if self.path == "/captcha/response":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            data = self._read_json()
            request_id = data.get("request_id", "")
            token = data.get("token")
            error = data.get("error")
            if request_id:
                with _bridge_lock:
                    _captcha_results[request_id] = {
                        "token": token,
                        "error": error,
                        "received_at": time.time(),
                    }
                    if token:
                        _captcha_stats["total_solved"] += 1
                        _captcha_stats["last_solved_at"] = datetime.now(timezone.utc).isoformat()
            self._send_json({"ok": True})
            return

        if self.path == "/flow/response":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            data = self._read_json()
            request_id = data.get("request_id", "")
            if request_id:
                with _bridge_lock:
                    _flow_results[request_id] = {
                        "result": data.get("result"),
                        "error": data.get("error"),
                        "received_at": time.time(),
                    }
            self._send_json({"ok": True})
            return

        if self.path == "/flow/project-created":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            data = self._read_json()
            request_id = data.get("request_id", "")
            if request_id:
                with _bridge_lock:
                    _project_results[request_id] = {
                        "ok": bool(data.get("ok", False)),
                        "flow_project_id": data.get("flow_project_id", ""),
                        "account_email": data.get("account_email", ""),
                        "error": data.get("error"),
                        "received_at": time.time(),
                    }
            self._send_json({"ok": True})
            return

        if self.path == "/flow/project-switched":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            data = self._read_json()
            request_id = data.get("request_id", "")
            if request_id:
                with _bridge_lock:
                    _project_results[request_id] = {
                        "ok": bool(data.get("ok", False)),
                        "flow_project_id": data.get("flow_project_id", ""),
                        "tab_id": data.get("tab_id"),
                        "error": data.get("error"),
                        "received_at": time.time(),
                    }
            self._send_json({"ok": True})
            return

        if self.path == "/flow/image-response":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            data = self._read_json()
            request_id = data.get("request_id", "")
            if request_id:
                if data.get("logs"):
                    logger.info("Extension logs for %s: %s", request_id[:8], data.get("logs"))
                with _bridge_lock:
                    _image_results[request_id] = {
                        "result": data.get("result"),
                        "error": data.get("error"),
                        "logs": data.get("logs"),
                        "received_at": time.time(),
                    }
            self._send_json({"ok": True})
            return

        if self.path == "/captcha/busy":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            data = self._read_json()
            busy = data.get("busy", False)
            timeout_sec = data.get("timeout_sec", 20)
            _captcha_busy = busy
            _captcha_busy_until = time.time() + timeout_sec if busy else 0
            self._send_json({"ok": True})
            return

        if self.path == "/ext/heartbeat":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            data = self._read_json()
            with _bridge_lock:
                _extension_info["ext_fp"] = data.get("ext_fp", "")
                _extension_info["version"] = data.get("version", "")
                _extension_info["tab_count"] = data.get("tab_count", 0)
                _extension_info["tabs"] = data.get("tabs", [])
                _extension_info["last_heartbeat"] = datetime.now(timezone.utc).isoformat()
                _extension_info["connected"] = True
            self._send_json({"ok": True})
            return

        if self.path == "/voice/cookies":
            if not self._check_secret():
                self._send_json({"error": "forbidden"}, 403)
                return
            global _voice_cookies
            data = self._read_json()
            _voice_cookies = data
            self._send_json({"ok": True})
            return

        self._send_json({"error": "not found"}, 404)


# ─────────────────────────────────────────────────────────────────────────────
# Server Lifecycle
# ─────────────────────────────────────────────────────────────────────────────

def start_bridge(port: int = 60526) -> bool:
    """Khởi động Bridge Server trên loopback port. Non-blocking (chạy thread).
    Nếu cổng bị chặn (ví dụ Windows exclusion range), tự động thử các cổng dự phòng.
    """
    global _server, _server_thread, _bridge_secret, _bridge_start_time, _actual_port

    if is_bridge_running():
        logger.info("Bridge already running on port %d", _actual_port or port)
        return True

    _bridge_secret = secrets.token_hex(32)
    _bridge_start_time = time.time()

    env_port = os.environ.get("VEO_BRIDGE_PORT")
    ports_to_try = [int(env_port)] if env_port else [port, 56526, 46526, 36526, 26526]
    candidate_ports = list(dict.fromkeys(ports_to_try))

    for candidate in candidate_ports:
        try:
            _server = ThreadingHTTPServer(("127.0.0.1", candidate), BridgeHandler)
            _server.daemon_threads = True
            _server_thread = threading.Thread(
                target=_server.serve_forever,
                name="veo-bridge",
                daemon=True,
            )
            _server_thread.start()
            _actual_port = candidate
            logger.info("Bridge started on 127.0.0.1:%d (secret: %s...)", candidate, _bridge_secret[:8])
            return True
        except OSError as e:
            logger.warning("Port %d unavailable for Bridge: %s. Trying next candidate...", candidate, e)
            _server = None
            _server_thread = None

    logger.error("Failed to start bridge on any candidate port: %s", candidate_ports)
    _actual_port = 0
    return False


def stop_bridge() -> None:
    """Dừng Bridge Server."""
    global _server, _server_thread, _actual_port
    if _server:
        _server.shutdown()
        _server = None
    _server_thread = None
    _actual_port = 0
    logger.info("Bridge stopped")
