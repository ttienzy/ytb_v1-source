from __future__ import annotations

import json
import logging
import os
import socket
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from playwright.sync_api import sync_playwright

from app.core.config import DATA_DIR, settings
from app.core.storage import mark_saved, read_config, write_config
from app.ai.image_gen.gptimage.accounts import ChatgptAccountStore

logger = logging.getLogger("ai.image_gen")

CGPT_PROFILES_DIR = DATA_DIR / "chatgpt-profiles"

STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', { get: () => false });
try { window.chrome = window.chrome || { runtime: {} }; } catch (e) {}
try {
  const q = window.navigator.permissions && window.navigator.permissions.query;
  if (q) window.navigator.permissions.query = (p) =>
    p && p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : q(p);
} catch (e) {}
"""

HEADER_SNIFF_JS = """
(() => {
  if (window.__oaiSniff) return; window.__oaiSniff = true;
  window.__oaiHeaders = window.__oaiHeaders || {};
  const WANT = ['oai-device-id', 'oai-client-version', 'oai-client-build-number', 'x-oai-is-client-observation'];
  function grab(h) {
    try {
      if (!h) return;
      const get = (k) => (h.get ? h.get(k) : (h[k] || h[k.toLowerCase()]));
      for (const k of WANT) {
        const v = get(k);
        if (v) window.__oaiHeaders[k] = String(v);
      }
    } catch (e) {}
  }
  const of = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (init && init.headers) grab(new Headers(init.headers));
      else if (input && input.headers) grab(input.headers);
    } catch (e) {}
    return of.apply(this, arguments);
  };
  const xset = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(k, v) {
    try {
      const lk = String(k).toLowerCase();
      if (WANT.includes(lk)) window.__oaiHeaders[lk] = String(v);
    } catch (e) {}
    return xset.apply(this, arguments);
  };
})();
"""


def find_free_cdp_port(start_port: int = 9228) -> int:
    """Tìm một cổng mạng còn trống để làm remote debugging port cho Chrome."""
    for port in range(start_port, start_port + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start_port


def wait_for_cdp(port: int, max_wait: float = 15.0) -> bool:
    """Chờ Chrome khởi động hoàn tất và mở giao diện DevTools Protocol."""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.4)
    return False


def get_account_store() -> ChatgptAccountStore:
    return ChatgptAccountStore(DATA_DIR)


def get_image_settings() -> dict[str, Any]:
    cfg = read_config()
    current = cfg.get("image_gen", {})
    return {
        "provider": "chatgpt",
        "saved_at": current.get("saved_at"),
    }


def chatgpt_login(timeout_seconds: int = 420) -> dict[str, Any]:
    """Mở Google Chrome thật (nổi trên màn hình Windows) để người dùng đăng nhập ChatGPT Plus, sniffs session & oai headers."""
    chrome_exe = Path(settings.chrome_executable).resolve()
    if not chrome_exe.exists():
        raise RuntimeError(f"Không tìm thấy trình duyệt Google Chrome tại: {chrome_exe}")

    profile_id = f"cgpt-{int(time.time() * 1000)}"
    profile_dir = CGPT_PROFILES_DIR / profile_id
    profile_dir.mkdir(parents=True, exist_ok=True)

    cdp_port = find_free_cdp_port(9228)

    DETACHED_PROCESS = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200

    cmd = [
        str(chrome_exe),
        f"--user-data-dir={profile_dir}",
        f"--remote-debugging-port={cdp_port}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=650,850",
        "--window-position=200,100",
        "https://chatgpt.com/",
    ]

    logger.info(f"Khởi động Chrome độc lập trên port CDP {cdp_port} với profile {profile_dir}...")
    proc = subprocess.Popen(
        cmd,
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )

    if not wait_for_cdp(cdp_port, max_wait=15.0):
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        raise RuntimeError(f"Chrome không mở cổng debug tại port {cdp_port}. Vui lòng thử lại.")

    sniffed_headers: dict[str, str] = {}

    def on_request(req):
        try:
            h = req.headers
            for k in ["oai-device-id", "oai-client-version", "oai-client-build-number", "x-oai-is-client-observation"]:
                v = h.get(k)
                if v and not sniffed_headers.get(k):
                    sniffed_headers[k] = str(v)
        except Exception:
            pass

    out = None
    user_email = ""

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
        try:
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            ctx.on("request", on_request)
            ctx.add_init_script(STEALTH_JS)
            ctx.add_init_script(HEADER_SNIFF_JS)

            # Bơm sniff script vào các trang đã tải sẵn
            for pg in ctx.pages:
                try:
                    pg.evaluate(HEADER_SNIFF_JS)
                except Exception:
                    pass

            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            try:
                ua = page.evaluate("() => navigator.userAgent") or ""
            except Exception:
                ua = ""

            deadline = time.time() + timeout_seconds

            while time.time() < deadline:
                if proc.poll() is not None:
                    import shutil
                    try:
                        shutil.rmtree(profile_dir, ignore_errors=True)
                    except Exception:
                        pass
                    raise RuntimeError("Cửa sổ Chrome đã bị đóng trước khi hoàn tất đăng nhập.")

                try:
                    cookies = ctx.cookies(["https://chatgpt.com", "https://openai.com"])
                except Exception:
                    cookies = []

                cookie_map = {c["name"]: c["value"] for c in cookies}
                logged = any(k.startswith("__Secure-next-auth.session-token") for k in cookie_map.keys())

                # Đọc headers từ các tab
                for pg in ctx.pages:
                    try:
                        hdrs = pg.evaluate("() => window.__oaiHeaders || {}") or {}
                        for k, v in hdrs.items():
                            if v and not sniffed_headers.get(k):
                                sniffed_headers[k] = str(v)
                    except Exception:
                        pass

                # Trích xuất email/username nếu có từ cookie oai-client-auth-info
                if not user_email:
                    auth_info_raw = cookie_map.get("oai-client-auth-info", "")
                    if auth_info_raw:
                        try:
                            info = json.loads(urllib.parse.unquote(auth_info_raw))
                            user_obj = info.get("user") or {}
                            user_email = user_obj.get("email") or user_obj.get("name") or ""
                        except Exception:
                            pass

                if logged and sniffed_headers.get("oai-client-version"):
                    cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
                    if not ua:
                        try:
                            ua = page.evaluate("() => navigator.userAgent") or ""
                        except Exception:
                            pass
                    out = {
                        "email": user_email or f"session_{int(time.time())}",
                        "cookies": cookie_str,
                        "ua": ua,
                        "client_version": sniffed_headers.get("oai-client-version", ""),
                        "client_build": sniffed_headers.get("oai-client-build-number", ""),
                        "oai_is": sniffed_headers.get("x-oai-is-client-observation", ""),
                        "device_id": sniffed_headers.get("oai-device-id", ""),
                        "partition": str(profile_dir),
                    }
                    break

                time.sleep(1.5)
        finally:
            try:
                browser.close()
            except Exception:
                pass
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=3)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

    if not out:
        import shutil
        try:
            shutil.rmtree(profile_dir, ignore_errors=True)
        except Exception:
            pass
        raise RuntimeError(
            "Hết thời gian chờ đăng nhập ChatGPT — chưa bắt được session token hoặc header oai-client-version. "
            "Hãy đảm bảo bạn đã đăng nhập tài khoản ChatGPT Plus và mở 1 cuộc chat."
        )

    store = get_account_store()
    rec = store.add_account(
        email=out.get("email", ""),
        cookies=out["cookies"],
        ua=out["ua"],
        client_version=out["client_version"],
        client_build=out["client_build"],
        oai_is=out["oai_is"],
        device_id=out["device_id"],
        partition=out["partition"],
    )
    return rec


def chatgpt_capture(profile_dir: str, timeout_seconds: int = 90) -> dict[str, Any] | None:
    """Mở lại profile ChatGPT ẤM OFF-SCREEN để làm mới cookie & headers."""
    chrome_exe = Path(settings.chrome_executable).resolve()
    if not chrome_exe.exists():
        return None

    p_path = Path(profile_dir)
    if not p_path.exists():
        return None

    cdp_port = find_free_cdp_port(9235)
    DETACHED_PROCESS = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200

    cmd = [
        str(chrome_exe),
        f"--user-data-dir={p_path}",
        f"--remote-debugging-port={cdp_port}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-position=-2400,-2400",
        "--window-size=560,820",
        "https://chatgpt.com/",
    ]

    proc = subprocess.Popen(
        cmd,
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )

    if not wait_for_cdp(cdp_port, max_wait=12.0):
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        return None

    sniffed_headers: dict[str, str] = {}

    def on_request(req):
        try:
            h = req.headers
            for k in ["oai-device-id", "oai-client-version", "oai-client-build-number", "x-oai-is-client-observation"]:
                v = h.get(k)
                if v and not sniffed_headers.get(k):
                    sniffed_headers[k] = str(v)
        except Exception:
            pass

    out = None
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
        try:
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            ctx.on("request", on_request)
            ctx.add_init_script(STEALTH_JS)
            ctx.add_init_script(HEADER_SNIFF_JS)

            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            try:
                ua = page.evaluate("() => navigator.userAgent") or ""
            except Exception:
                ua = ""

            deadline = time.time() + timeout_seconds

            while time.time() < deadline:
                if proc.poll() is not None:
                    break

                try:
                    cookies = ctx.cookies(["https://chatgpt.com", "https://openai.com"])
                except Exception:
                    cookies = []

                cookie_map = {c["name"]: c["value"] for c in cookies}
                logged = any(k.startswith("__Secure-next-auth.session-token") for k in cookie_map.keys())

                for pg in ctx.pages:
                    try:
                        hdrs = pg.evaluate("() => window.__oaiHeaders || {}") or {}
                        for k, v in hdrs.items():
                            if v and not sniffed_headers.get(k):
                                sniffed_headers[k] = str(v)
                    except Exception:
                        pass

                if logged and sniffed_headers.get("oai-client-version"):
                    cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
                    if not ua:
                        try:
                            ua = page.evaluate("() => navigator.userAgent") or ""
                        except Exception:
                            pass
                    out = {
                        "cookies": cookie_str,
                        "ua": ua,
                        "client_version": sniffed_headers.get("oai-client-version", ""),
                        "client_build": sniffed_headers.get("oai-client-build-number", ""),
                        "oai_is": sniffed_headers.get("x-oai-is-client-observation", ""),
                        "device_id": sniffed_headers.get("oai-device-id", ""),
                    }
                    break

                time.sleep(1.5)
        finally:
            try:
                browser.close()
            except Exception:
                pass
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=3)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

    return out


_gpt_singleton = None


def get_image_client():
    global _gpt_singleton
    from app.ai.image_gen.gptimage.adapter import GptImageClient

    if _gpt_singleton is None:
        _gpt_singleton = GptImageClient(get_account_store())
    return _gpt_singleton


def test_generate_image(prompt: str, aspect_ratio: str = "9:16") -> dict[str, Any]:
    """Test sinh 1 ảnh thử nghiệm và lưu vào thư mục Media."""
    out_dir = DATA_DIR / "media" / "test_images"
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"test_{int(time.time())}.jpg"

    client = get_image_client()
    start_time = time.time()
    saved_path = client.generate(prompt=prompt, dest=str(dest), aspect=aspect_ratio)
    elapsed = round(time.time() - start_time, 2)

    return {
        "ok": True,
        "saved_path": saved_path,
        "relative_url": f"/api/media/image/{dest.name}",
        "elapsed_seconds": elapsed,
    }
