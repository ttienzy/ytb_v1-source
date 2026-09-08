import logging
import os
import shutil
import subprocess
import time
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("ai.chatgpt")


def is_9router_running(port: int = 20128) -> bool:
    try:
        with httpx.Client(timeout=1.5, follow_redirects=True) as client:
            r = client.get(f"http://127.0.0.1:{port}")
            return r.status_code < 500
    except Exception:
        return False


def ensure_9router_running(port: int = 20128) -> bool:
    if is_9router_running(port):
        return True
    try:
        bin_path = shutil.which("9router.cmd") or shutil.which("9router") or "9router"
        subprocess.Popen(
            f'"{bin_path}" -p {port} -n --skip-update',
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        for _ in range(25):
            time.sleep(0.3)
            if is_9router_running(port):
                return True
    except Exception as e:
        logger.error(f"Failed to launch 9router: {e}")
    return False


def launch_9router_and_open_browser(port: int = 20128) -> dict:
    ready = ensure_9router_running(port)
    try:
        webbrowser.open(f"http://localhost:{port}/")
    except Exception:
        pass
    return {"ok": ready, "port": port, "url": f"http://localhost:{port}/"}


def get_local_cli_secret() -> str:
    """Tự động tìm kiếm file cli-secret của 9Router trong thư mục AppData người dùng."""
    candidates = [
        Path(os.environ.get("APPDATA", "")) / "9router" / "auth" / "cli-secret",
        Path.home() / "AppData" / "Roaming" / "9router" / "auth" / "cli-secret",
        Path.home() / ".9router" / "auth" / "cli-secret",
    ]
    for p in candidates:
        try:
            if p.is_file() and p.stat().st_size > 0:
                secret = p.read_text(encoding="utf-8").strip()
                if secret:
                    return secret
        except Exception:
            continue
    return ""


def normalize_endpoint(endpoint: str) -> str:
    """Chuẩn hóa endpoint OpenAI/9Router."""
    ep = (endpoint or "").strip()
    if not ep:
        return "http://localhost:20128/v1"
    if not ep.startswith("http://") and not ep.startswith("https://"):
        ep = f"http://{ep}"
    ep = ep.rstrip("/")
    if not ep.endswith("/v1"):
        # Nếu chỉ truyền http://localhost:20128 thì tự động append /v1
        ep = f"{ep}/v1"
    return ep


def _make_headers(api_key: str) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if api_key and api_key.strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"
    return headers


def fetch_models(endpoint: str, api_key: str, timeout: float = 4.0) -> list[str]:
    """Lấy danh sách các model khả dụng từ 9Router/OpenAI."""
    ep = normalize_endpoint(endpoint)
    url = f"{ep}/models"
    headers = _make_headers(api_key)

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                models = []
                for item in data.get("data", []):
                    model_id = item.get("id")
                    if model_id:
                        models.append(model_id)
                return sorted(models)
            logger.warning(f"Failed to fetch models from {url}: HTTP {resp.status_code}")
    except Exception as e:
        logger.warning(f"Error connecting to 9Router at {url}: {e}")
    return []


def test_connection(endpoint: str, api_key: str, model: str = "") -> dict[str, Any]:
    """Kiểm tra kết nối tới 9Router và gửi 1 prompt ping thử nghiệm."""
    ep = normalize_endpoint(endpoint)
    start_time = time.time()

    # Bước 1: Kiểm tra endpoint /models
    models = fetch_models(ep, api_key, timeout=4.0)
    if not models:
        # Thử kiểm tra xem 9router server có đang sống không
        base_url = ep.replace("/v1", "")
        is_live = False
        try:
            with httpx.Client(timeout=2.0) as client:
                r = client.get(base_url)
                if r.status_code in [200, 404, 401]:
                    is_live = True
        except Exception:
            pass

        if is_live:
            return {
                "ok": False,
                "latency_ms": int((time.time() - start_time) * 1000),
                "reply": "",
                "models_count": 0,
                "available_models": [],
                "error": "9Router đang chạy nhưng chưa lấy được danh sách Model. Vui lòng kiểm tra Secret/API Key hoặc thêm Provider trong 9Router Dashboard.",
            }
        return {
            "ok": False,
            "latency_ms": int((time.time() - start_time) * 1000),
            "reply": "",
            "models_count": 0,
            "available_models": [],
            "error": f"Không thể kết nối tới 9Router tại '{ep}'. Hãy đảm bảo bạn đã khởi động 9Router (chạy lệnh '9router' trong Terminal).",
        }

    # Bước 2: Thử chat completion ping test
    target_model = model or (models[0] if models else "gpt-4o")
    ping_url = f"{ep}/chat/completions"
    headers = _make_headers(api_key)
    payload = {
        "model": target_model,
        "messages": [
            {"role": "user", "content": "Ping test: Phản hồi chính xác chữ 'OK' nếu kết nối thành công."}
        ],
        "max_tokens": 20,
        "temperature": 0.2,
    }

    try:
        with httpx.Client(timeout=12.0) as client:
            resp = client.post(ping_url, json=payload, headers=headers)
            latency_ms = int((time.time() - start_time) * 1000)
            if resp.status_code == 200:
                data = resp.json()
                reply = ""
                choices = data.get("choices", [])
                if choices:
                    reply = choices[0].get("message", {}).get("content", "").strip()
                return {
                    "ok": True,
                    "latency_ms": latency_ms,
                    "reply": reply or "Kết nối thành công!",
                    "models_count": len(models),
                    "available_models": models,
                    "error": None,
                }
            else:
                error_detail = resp.text[:200]
                return {
                    "ok": False,
                    "latency_ms": latency_ms,
                    "reply": "",
                    "models_count": len(models),
                    "available_models": models,
                    "error": f"9Router phản hồi mã HTTP {resp.status_code}: {error_detail}",
                }
    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        return {
            "ok": False,
            "latency_ms": latency_ms,
            "reply": "",
            "models_count": len(models),
            "available_models": models,
            "error": f"Lỗi khi gửi ping chat completion: {e}",
        }


def chat_completion(
    endpoint: str,
    api_key: str,
    model: str,
    prompt: str,
    system_prompt: str = "",
    images: list[str] = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """Gửi yêu cầu Chat Completion (hỗ trợ cả văn bản và hình ảnh Base64/URL)."""
    ep = normalize_endpoint(endpoint)
    target_model = model or "gpt-4o"
    url = f"{ep}/chat/completions"
    headers = _make_headers(api_key)

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    # Multimodal image support
    if images and len(images) > 0:
        content_parts: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for img in images:
            img_url = img.strip()
            if img_url:
                content_parts.append({"type": "image_url", "image_url": {"url": img_url}})
        messages.append({"role": "user", "content": content_parts})
    else:
        messages.append({"role": "user", "content": prompt})

    payload = {
        "model": target_model,
        "messages": messages,
        "temperature": 0.7,
    }

    start_time = time.time()
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload, headers=headers)
            latency_ms = int((time.time() - start_time) * 1000)
            if resp.status_code == 200:
                data = resp.json()
                content = ""
                choices = data.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content", "").strip()
                return {
                    "ok": True,
                    "content": content,
                    "model": target_model,
                    "latency_ms": latency_ms,
                    "error": None,
                }
            else:
                return {
                    "ok": False,
                    "content": "",
                    "model": target_model,
                    "latency_ms": latency_ms,
                    "error": f"HTTP {resp.status_code}: {resp.text[:300]}",
                }
    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        return {
            "ok": False,
            "content": "",
            "model": target_model,
            "latency_ms": latency_ms,
            "error": str(e),
        }
