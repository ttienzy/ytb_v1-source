#!/usr/bin/env python3
r"""
test_cat_video.py — Script kiểm thử tự động tạo video "Cat" 6s và tải về máy.

Cách chạy:
    python test_cat_video.py
hoặc trong PowerShell:
    & ".\Backend\.venv\Scripts\python.exe" test_cat_video.py
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error
from pathlib import Path

# Force UTF-8 on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BACKEND_URL = "http://127.0.0.1:8000"

def log(tag: str, msg: str):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] [{tag}] {msg}", flush=True)

def http_get(endpoint: str) -> dict:
    url = f"{BACKEND_URL}{endpoint}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))

def http_post(endpoint: str, data: dict) -> dict:
    url = f"{BACKEND_URL}{endpoint}"
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def main():
    print("=" * 65)
    print(">> VEO STUDIO - KIEM THU TAO VIDEO PROMPT 'CAT' (6s)")
    print("=" * 65)

    # 1. Kiểm tra trạng thái Backend & Extension
    log("CHECK", "Đang kiểm tra kết nối Backend & Extension...")
    try:
        status = http_get("/api/veo/status")
    except Exception as e:
        log("ERROR", f"Không thể kết nối Backend tại {BACKEND_URL}: {e}")
        log("HINT", "Hãy đảm bảo lệnh 'npm start' đang chạy trong thư mục Desktop.")
        sys.exit(1)

    bridge_ok = status.get("bridge_running", False)
    ext_info = status.get("extension", {})
    ext_connected = ext_info.get("connected", False)
    accounts = status.get("accounts", [])

    log("STATUS", f"Bridge running: {bridge_ok} (port: {status.get('bridge_port')})")
    log("STATUS", f"Extension connected: {ext_connected} (tabs: {ext_info.get('tab_count', 0)})")

    if not accounts:
        log("WARN", "Chưa phát hiện tài khoản Google Flow nào.")
        log("HINT", "Mở tab Google Flow trên trình duyệt và đăng nhập tài khoản.")
    else:
        for acc in accounts:
            log("ACCOUNT", f"Email: {acc.get('email')} | Tier: {acc.get('tier')} | Credits: {acc.get('credits')}")

    # 2. Gửi request tạo Video
    prompt_text = "Cat"
    duration = 6
    model = "Omni 1.1 Flash"
    aspect = "16:9"

    log("SUBMIT", f"Đang gửi yêu cầu tạo video: '{prompt_text}' ({duration}s, {aspect}, {model})...")
    try:
        job = http_post("/api/veo/jobs", {
            "input_mode": "text_to_video",
            "prompt": prompt_text,
            "model_display_name": model,
            "duration_seconds": duration,
            "aspect_ratio": aspect,
            "resolution": "720p",
            "num_outputs": 1
        })
    except Exception as e:
        log("ERROR", f"Lỗi khi gửi job: {e}")
        sys.exit(1)

    job_id = job.get("job_id")
    log("SUBMIT", f"Tạo job thành công! Mã Job ID: {job_id}")

    # 3. Vòng lặp theo dõi tiến trình (Poll realtime)
    start_time = time.time()
    last_step = ""
    timeout_seconds = 420  # Tối đa 7 phút

    while True:
        elapsed = int(time.time() - start_time)
        if elapsed > timeout_seconds:
            log("TIMEOUT", f"Đã quá thời gian chờ ({timeout_seconds}s).")
            break

        try:
            current = http_get(f"/api/veo/jobs/{job_id}")
        except Exception as e:
            log("WARN", f"Mất kết nối tạm thời khi lấy trạng thái: {e}")
            time.sleep(2)
            continue

        job_status = current.get("status")
        current_step = current.get("current_step", "")

        if current_step != last_step:
            last_step = current_step
            log("PROGRESS", f"[{elapsed:02d}s] Trang thai: {job_status.upper()} - {current_step}")

        # Trường hợp hoàn tất thành công
        if job_status == "done":
            outputs = current.get("output_files", [])
            print("\n" + "=" * 65)
            log("SUCCESS", f"[OK] TAO VA TAI VIDEO THANH CONG sau {elapsed} giay!")
            print("=" * 65)
            if outputs:
                for idx, file_path in enumerate(outputs, 1):
                    p = Path(file_path)
                    if p.exists():
                        size_mb = p.stat().st_size / (1024 * 1024)
                        print(f"  [{idx}] Duong dan file: {file_path}")
                        print(f"      Dung luong:    {size_mb:.2f} MB")
                    else:
                        print(f"  [{idx}] Duong dan: {file_path}")
            print("=" * 65)
            return

        # Trường hợp gặp lỗi
        if job_status == "error":
            err_msg = current.get("error_message", "Loi khong xac dinh")
            log("FAIL", f"Job bao loi: {err_msg}")
            break

        time.sleep(2)

if __name__ == "__main__":
    main()
