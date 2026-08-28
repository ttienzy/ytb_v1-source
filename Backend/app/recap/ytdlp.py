"""yt-dlp wrapper — tải video YouTube, video-only 1080p avc1 (KHÔNG audio).

Phase R2: recap pipeline thay toàn bộ audio gốc bằng VO Việt (Phase R3), nên không tải audio
gốc — bỏ bước mux. Chọn avc1 (H.264) để stream-copy cut + concat (R4) sạch, tương thích Chromium.

Cờ chạy được (xác định thực tế, 2026-08):
  --js-runtimes node            dùng Node để giải n-challenge (YouTube yêu cầu JS runtime).
  --remote-components ejs:github tải challenge-solver lib (1 lần, cached) — không có thì URL bị 403.
  KHÔNG dùng cookies mặc định: cookies login kích hoạt SABR-only streaming (account bị thử nghiệm),
  làm biến mất mọi format DASH; không cookies → client visionos ra URL DASH hợp lệ (1080p).
Cần yt-dlp >= nightly 2026.8.20 (bản stable cũ bị 403 / SABR). Idempotent: đã có video.mp4 thì skip.

**Fallback bot-wall** (xác định 2026-08-24, xem [[ytdlp-youtube-block]]): IP có thể bị YouTube gắn
cờ bot → tường "Sign in to confirm" chặn ngay trang (no-cookies = block hoàn toàn). Khi đó retry
với ``--cookies yt_cookies_file`` + ``--extractor-args youtube:player_client=mweb`` — cookies
vượt IP wall, client ``mweb`` vượt SABR-only experiment (client ``web_creator`` mặc định bị SABR
→ 360p; ``mweb`` cho tới 2160p với cùng account). No-cookies vẫn được thử TRƯỚC để giữ 1080p khi IP sạch.
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings

# video-only 1080p avc1 (H.264). Fallback qua 1080p mp4 khác → 1080p bất kỳ → bestvideo
# → /best (combined, thường 360p format 18) khi account bị SABR-only (không còn video-only).
# Source có audio combined vô hại — R4 mux_segment chỉ map 0:v, bỏ audio gốc.
FORMAT = (
    "bestvideo[height<=1080][ext=mp4][vcodec^=avc1]"
    "/bestvideo[height<=1080][ext=mp4]"
    "/bestvideo[height<=1080]"
    "/bestvideo"
    "/best"
)
TIMEOUT = 600  # 10p — đủ cho video dài 60p ở 1080p (~1GB).
# Dấu hiệu IP bot-wall (YouTube đòi sign-in) → triggers fallback cookies.
BOT_WALL_MARKERS = ("sign in to confirm", "not a bot")
# Cookie auth Google/YouTube — SAPISID = đã login account.
YT_AUTH_COOKIE = "SAPISID"
LOGIN_TIMEOUT_SECONDS = 180  # 3' — đủ user login 2FA thủ công.


def download_video(youtube_url: str, dest_dir: Path) -> Path:
    """Tải video-only về ``dest_dir/video.mp4``. Skip nếu đã có (idempotent).

    Thử no-cookies trước (1080p khi IP sạch). Nếu bị IP bot-wall (sign-in) VÀ đã có
    ``yt_cookies_file`` (login qua Cài đặt) → retry với cookies (vượt wall; chất lượng
    tùy account — SABR 360p hoặc 1080p nếu account không bị SABR).
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / "video.mp4"
    if out.exists() and out.stat().st_size:
        return out

    base_cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", FORMAT,
        "-o", str(dest_dir / "video.%(ext)s"),
        "--no-playlist", "--no-part", "--no-progress",
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
    ]

    has_cookies = settings.yt_cookies_file.exists() and settings.yt_cookies_file.stat().st_size
    # Attempt 1: no-cookies, client web mặc định (1080p khi IP sạch).
    # Attempt 2: cookies + client ``mweb`` — cookies vượt IP bot-wall, mweb vượt SABR-only
    # (web_creator mặc định bị SABR → 360p; mweb cho tới 2160p với cùng account). Xác định 2026-08-24.
    attempts: list[tuple[bool, list[str]]] = [(False, [])]
    if has_cookies:
        attempts.append((True, [
            "--cookies", str(settings.yt_cookies_file),
            "--extractor-args", "youtube:player_client=mweb",
        ]))

    last_tail = ""
    for use_cookies, extra in attempts:
        cmd = [*base_cmd, *extra, youtube_url]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            # yt-dlp hang/throttle quá TIMEOUT — raise RuntimeError để ``cut()`` bắt được
            # (nếu không, TimeoutExpired không phải RuntimeError → cut_status stuck "running").
            raise RuntimeError(
                f"yt-dlp tải quá {TIMEOUT}s (có thể bị throttle/hang) — thử lại, hoặc video quá lớn. "
                f"cmd tail: {last_tail or 'không rõ'}"
            )
        if proc.returncode == 0:
            if out.exists() and out.stat().st_size:
                return out
            found = sorted(dest_dir.glob("video.*"))
            if found:
                return found[0]
            last_tail = (proc.stderr or proc.stdout or "")[-600:]
            continue  # lạ: returncode 0 mà không ra file — thử attempt kế nếu có
        last_tail = (proc.stderr or proc.stdout or "")[-600:]
        # Chỉ fallback cookies nếu đang no-cookies, gặp bot-wall, VÀ có cookies.
        if use_cookies:
            break  # đã dùng cookies rồi mà vẫn fail → không thử lại
        is_bot_wall = any(m in last_tail.lower() for m in BOT_WALL_MARKERS)
        if not (is_bot_wall and has_cookies):
            raise RuntimeError(f"yt-dlp tải thất bại: {last_tail or 'không rõ lỗi'}")
        # bot-wall + có cookies → tiếp tục attempt cookies

    raise RuntimeError(f"yt-dlp tải thất bại: {last_tail or 'không rõ lỗi'}")


# ── YouTube login (cho fallback cookies) ─────────────────────────────────────

def login_youtube() -> dict:
    """Mở Chrome THẬT tới youtube.com, chờ user login Google, rồi xuất cookies Netscape.

    Khác login Gemini: KHÔNG dùng ``launch_persistent_context`` (Playwright bật
    ``--enable-automation`` + ``navigator.webdriver`` → Google chặn "This browser
    or app may not be secure"). Thay vào đó launch ``chrome.exe`` trực tiếp qua
    subprocess (không cờ automation → Google cho login), mở ``--remote-debugging-port``
    rồi Playwright ``connect_over_cdp`` để lấy cookie — CDP trả giá trị đã decrypt
    (vượt App-Bound Encryption yt-dlp #7271).

    Trả ``{ok, logged_in, cookie_count}``. Raise 408 nếu chưa login sau timeout / Chrome
    đóng sớm, 503 nếu thiếu Chrome, 504 nếu CDP không mở, 409 nếu launch fail.
    """
    import time
    import urllib.request

    from fastapi import HTTPException
    from playwright.sync_api import sync_playwright

    if not settings.chrome_executable.exists():
        raise HTTPException(status_code=503, detail=f"Không tìm thấy Chrome: {settings.chrome_executable}")
    settings.yt_profile_dir.mkdir(parents=True, exist_ok=True)

    port = 9222
    cdp_url = f"http://127.0.0.1:{port}"

    # Launch chrome.exe trực tiếp — KHÔNG automation flag. Google sẽ cho login.
    try:
        proc = subprocess.Popen(
            [
                str(settings.chrome_executable),
                f"--user-data-dir={settings.yt_profile_dir}",
                f"--remote-debugging-port={port}",
                "--no-first-run",
                "--no-default-browser-check",
                "https://www.youtube.com/",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as error:
        raise HTTPException(
            status_code=409,
            detail=f"Không mở được Chrome: {error}",
        ) from error

    try:
        # Chờ CDP endpoint sẵn sàng (Chrome khởi động mất vài giây).
        cdp_up = False
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"{cdp_url}/json/version", timeout=2) as resp:
                    if resp.status == 200:
                        cdp_up = True
                        break
            except Exception:
                time.sleep(1)
        if not cdp_up:
            raise HTTPException(status_code=504, detail=f"Chrome không mở CDP tại {cdp_url} sau 30 giây.")

        cookies: list = []
        with sync_playwright() as playwright:
            browser = None
            for _ in range(15):
                try:
                    browser = playwright.chromium.connect_over_cdp(cdp_url)
                    break
                except Exception:
                    time.sleep(1)
            if browser is None:
                raise HTTPException(status_code=504, detail="Không connect_over_cdp được Chrome.")
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            for _ in range(LOGIN_TIMEOUT_SECONDS):
                try:
                    cookies = context.cookies(["https://youtube.com", "https://google.com"])
                except Exception:
                    cookies = []
                if any(c["name"] == YT_AUTH_COOKIE for c in cookies):
                    break
                time.sleep(1)
            if not any(c["name"] == YT_AUTH_COOKIE for c in cookies):
                raise HTTPException(
                    status_code=408,
                    detail=f"Chưa phát hiện đăng nhập YouTube sau {LOGIN_TIMEOUT_SECONDS} giây. "
                    "Có thể Google vẫn chặn — thử lại, hoặc login account khác.",
                )
            time.sleep(5)  # chờ Chrome ghi ổn cookie phiên
            _write_netscape_cookies(cookies, settings.yt_cookies_file)
            count = len(cookies)
            try:
                browser.close()
            except Exception:
                pass
            return {"ok": True, "logged_in": True, "cookie_count": count}
    except HTTPException:
        raise
    except Exception as error:
        if type(error).__name__ == "TargetClosedError":
            raise HTTPException(
                status_code=408,
                detail="Chrome đã đóng trước khi login xong.",
            ) from error
        raise HTTPException(
            status_code=409,
            detail=f"Lỗi khi đọc cookie YouTube: {error}",
        ) from error
    finally:
        # Đóng Chrome ta đã launch (subprocess) — giải phóng profile + port.
        try:
            proc.terminate()
            proc.wait(timeout=8)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def _write_netscape_cookies(cookies: list, path: Path) -> None:
    """Ghi cookies dạng Netscape cookies.txt (yt-dlp ``--cookies`` đọc được).

    Format: domain  include_subdomain  path  secure  expiry  name  value (tab-separated).
    """
    lines = ["# Netscape HTTP Cookie File", "# https://curl.se/docs/http-cookies.html"]
    for c in cookies:
        domain = c.get("domain", "")
        flag = "TRUE" if domain.startswith(".") else "FALSE"
        cpath = c.get("path", "/") or "/"
        secure = "TRUE" if c.get("secure") else "FALSE"
        exp = int(c.get("expires", -1) or -1)
        if exp <= 0:
            exp = 0  # session cookie
        name = c.get("name", "")
        value = c.get("value", "")
        lines.append("\t".join([domain, flag, cpath, secure, str(exp), name, value]))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def yt_login_status() -> dict:
    """Trạng thái login YouTube: có cookies file không, bao nhiêu cookie, khi nào."""
    f = settings.yt_cookies_file
    if not (f.exists() and f.stat().st_size):
        return {"logged_in": False, "cookie_count": 0, "saved_at": None}
    text = f.read_text(encoding="utf-8", errors="replace")
    n = sum(1 for ln in text.splitlines() if ln and not ln.startswith("#"))
    mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat()
    return {"logged_in": True, "cookie_count": n, "saved_at": mtime}

