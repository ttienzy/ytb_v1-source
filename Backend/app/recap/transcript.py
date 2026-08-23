"""Fetch YouTube transcript qua Playwright — bắt response ``get_panel``.

Tái dựng đúng flow thủ công: mở video → "Show transcript" → F12 copy **response** JSON.
Guest/headless (không login) — incognito vẫn lấy được transcript public. Intercept
network response có ``panelId=PAmodern_transcript_view`` → trả JSON dict (= raw.txt hiện tại).

CLI::
    python -m app.recap.transcript "https://www.youtube.com/watch?v=P08Yr7yV1J0" [out_path]
    # mặc định ghi ra <repo>/raw.txt
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import time
from pathlib import Path

PANEL_URL_FRAG = "youtubei/v1/get_panel"
TRANSCRIPT_PANEL_ID = "PAmodern_transcript_view"
DEFAULT_TIMEOUT_MS = 60_000
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def video_id_from_url(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})", url)
    if not m:
        raise ValueError(f"Không thấy video ID trong URL: {url!r}")
    return m.group(1)


def fetch_transcript_raw(
    url: str,
    headless: bool = False,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> dict:
    """Trả JSON response của ``get_panel`` transcript (giống raw.txt hiện tại).

    Raise ``RuntimeError`` nếu không mở được transcript panel hoặc không bắt được response
    (video không có transcript / UI YouTube đổi).
    """
    from playwright.sync_api import sync_playwright

    video_id = video_id_from_url(url)
    watch_url = f"https://www.youtube.com/watch?v={video_id}"

    captured: list = []

    def _on_response(resp):
        # QUAN TRỌNG (sync Playwright): KHÔNG truy cập property nào của resp trong listener
        # (resp.request.post_data, resp.json()... đều là channel call → phá vỡ sync loop → crash
        # "TypeError: function takes exactly 5 arguments"). Chỉ append object, filter + đọc body bên ngoài.
        captured.append(resp)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx = browser.new_context(
            user_agent=DEFAULT_UA,
            locale="en-US",
            viewport={"width": 1280, "height": 800},
        )
        page = ctx.new_page()
        page.set_default_timeout(timeout_ms)
        page.on("response", _on_response)

        try:
            page.goto(watch_url, wait_until="domcontentloaded")
            page.wait_for_timeout(4000)  # để description transcript section render (lazy)
            _open_transcript(page)
            # chờ request get_panel transcript xuất hiện (poll nhẹ, không đọc property trong listener)
            deadline = time.time() + timeout_ms / 1000
            while time.time() < deadline:
                # decode + lọc ngoài listener: get_panel nào có transcript segment
                data = _extract_transcript(captured)
                if data is not None:
                    return data
                page.wait_for_timeout(300)
            raise RuntimeError(
                "Không bắt được response get_panel transcript — có thể video không có transcript "
                "hoặc UI YouTube đã đổi. Thử headless=False để debug."
            )
        finally:
            ctx.close()
            browser.close()


def _extract_transcript(responses) -> dict | None:
    """Lọc + decode response get_panel transcript.

    Không dùng ``request.post_data`` (đôi khi None/empty dù là request transcript) —
    thay vào đó decode body mỗi get_panel, lấy response có transcript segment.
    Đọc body + decompress ở ngoài listener (channel-call an toàn).
    """
    for resp in reversed(responses):  # Ưu tiên response mới nhất.
        try:
            if PANEL_URL_FRAG not in resp.url:
                continue
        except Exception:
            continue
        try:
            raw = resp.body()
        except Exception:
            continue
        decompressed = _decompress(raw)
        if (
            b"transcriptSegmentViewModel" in decompressed
            or TRANSCRIPT_PANEL_ID.encode() in decompressed
        ):
            try:
                return json.loads(decompressed)
            except Exception:
                continue
    return None


def _decompress(raw: bytes) -> bytes:
    """Giải mã gzip/deflate nếu cần (Playwright đôi khi không tự giải mã)."""
    if raw[:2] == b"\x1f\x8b":
        return gzip.decompress(raw)
    if raw[:1] == b"\x78":
        import zlib
        return zlib.decompress(raw)
    return raw


def _decode_json(response) -> dict:
    """Back-compat: decode 1 response bất kỳ (dùng khi đã chắc chắn đúng response)."""
    return json.loads(_decompress(response.body()))


def _open_transcript(page) -> None:
    """Trigger transcript panel.

    "Show transcript" nằm TRONG phần Description (collapsed mặc định) → phải expand
    description + cuộn xuống thì nút mới hiện. Sau khi click → YouTube fire request
    get_panel (panelId=PAmodern_transcript_view).
    """
    from playwright.sync_api import TimeoutError as PWTimeout

    # 0) Expand description (nút "more"/#expand) — lộ transcript section bên trong.
    page.evaluate(
        """() => {
          const sel = ['#description #expand', 'ytd-expander #expand', '#expand',
                        'tp-yt-paper-button#expand', 'ytd-text-inline-expander #expand'];
          for (const s of sel) {
            const el = document.querySelector(s);
            if (el) { el.click(); return 'expanded:'+s; }
          }
          return 'no-expand-btn';
        }"""
    )
    page.wait_for_timeout(1500)

    # 1) Cuộn xuống cuối description (reveal transcript section) + cuộn trang.
    page.evaluate(
        """() => {
          const containers = document.querySelectorAll(
            '#description, ytd-expander, ytd-text-inline-expander, #description-inner'
          );
          containers.forEach(d => { d.scrollTop = d.scrollHeight; });
          window.scrollBy(0, 800);
        }"""
    )
    page.wait_for_timeout(1200)

    # 2) Click "Show transcript" — thử Playwright click thật (nút visible sau expand),
    #    fallback JS click (nút vẫn ẩn / headless).
    selectors = [
        'button[aria-label="Show transcript"]',
        'ytd-button-renderer button[aria-label="Show transcript"]',
        '[aria-label="Transcript"]',                 # chip role=tab (engagement bar)
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=8000)
            loc.click(timeout=8000)
            return
        except Exception:
            pass
        clicked = page.evaluate(
            """(sel) => {
              const el = document.querySelector(sel);
              if (!el) return false;
              el.scrollIntoView({block: 'center'});
              el.click();
              return true;
            }""",
            sel,
        )
        if clicked:
            page.wait_for_timeout(1500)
            return

    # 3) Fallback cuối: overflow "..." menu → menuitem.
    try:
        page.locator('button[aria-label="More actions"]').first.click(timeout=8000)
        page.wait_for_timeout(900)
        page.get_by_role("menuitem", name="Show transcript").first.click(timeout=8000)
        return
    except (PWTimeout, Exception):
        pass

    raise RuntimeError(
        "Không tìm thấy nút 'Show transcript' — UI YouTube có thể đã đổi hoặc video không có transcript. "
        "Chạy với headless=False để xem trang thực tế."
    )


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Cách dùng: python -m app.recap.transcript <YouTube_URL> [out_path]")
        return 2
    url = argv[1]
    out = Path(argv[2]) if len(argv) > 2 else Path(__file__).resolve().parents[3] / "raw.txt"
    print(f"[transcript] fetch get_panel cho {url}")
    data = fetch_transcript_raw(url)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    blob = json.dumps(data, ensure_ascii=False)
    n_seg = blob.count("transcriptSegmentViewModel")
    print(f"[transcript] OK -> {out}")
    print(f"            {out.stat().st_size:,} bytes | {n_seg} transcript segments")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
