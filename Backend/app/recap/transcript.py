"""Fetch YouTube transcript qua Playwright — bắt response ``get_panel`` (cũ) hoặc
``get_transcript`` (mới, cần attestation PoG).

Tái dựng đúng flow thủ công: mở video → "Show transcript" → F12 copy **response** JSON.
3 mức fallback (xem ``fetch_transcript_raw``):
  1. Playwright headless + cookies (Netscape) — vượt IP bot-wall, bắt cả get_panel/get_transcript.
  2. Nếu get_transcript bị 400 "Precondition check failed" (attestation PoG, headless không tính
     được webResponse) → detect → fallback Mức 3.
  3. Chrome thật qua CDP (connect_over_cdp) — browser thật tính attestation → pass. Mirror
     ``login_youtube`` (chrome.exe subprocess tránh automation-block). Xem [[ytdlp-youtube-block]].

Trả JSON dict (= raw.txt hiện tại). Raise ``TranscriptFetchError`` (kind: attestation |
no_transcript | generic) để service báo UX rõ (gợi ý dán raw thủ công khi không fetch được).

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

from app.core.config import settings

PANEL_URL_FRAG = "youtubei/v1/get_panel"
TRANSCRIPT_URL_FRAG = "youtubei/v1/get_transcript"  # endpoint mới (cần attestation PoG)
# Hai endpoint đều có thể fire tùy video (YouTube đang migrate get_panel → get_transcript).
TRANSCRIPT_URL_FRAGS = (PANEL_URL_FRAG, TRANSCRIPT_URL_FRAG)
TRANSCRIPT_PANEL_ID = "PAmodern_transcript_view"
# Dấu hiệu attestation PoG bị chặn (headless không tính được webResponse) → fallback Chrome thật.
ATTESTATION_MARKERS = (b"Precondition check failed", b"Precondition check", b"FAILED_PRECONDITION")
DEFAULT_TIMEOUT_MS = 60_000
REAL_CHROME_CDP_PORT = 9223  # port CDP cho fallback Chrome thật (khác 9222 của login)
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


class TranscriptFetchError(RuntimeError):
    """Lỗi fetch transcript — ``kind`` phân loại để orchestrator quyết fallback / báo UX.

    kind:
      - "attestation": endpoint get_transcript bị chặn PoG (headless) → thử Chrome thật.
      - "no_transcript": video không có transcript → không retry.
      - "generic": lỗi khác (UI đổi, timeout, bot-wall...).
    """

    def __init__(self, msg: str, kind: str = "generic"):
        super().__init__(msg)
        self.kind = kind


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
    """Trả JSON response transcript (get_panel hoặc get_transcript) — giống raw.txt.

    Flow 3 mức:
      1. Playwright headless (cookies nếu có) — bắt cả ``get_panel`` (cũ) VÀ ``get_transcript``
         (mới). Nhanh, dùng cho video chưa bị attestation-wall.
      2. Nếu ``get_transcript`` bị chặn attestation PoG (400 "Precondition check failed") →
         fallback **Chrome thật qua CDP** (browser thật tính được webResponse → pass attestation).
      3. Nếu vẫn fail (video không có transcript / UI đổi) → raise ``TranscriptFetchError`` với
         kind rõ, để UI gợi ý user dán raw thủ công.
    """
    try:
        return _fetch_with_playwright(url, headless=headless, timeout_ms=timeout_ms)
    except TranscriptFetchError as err:
        if err.kind == "attestation":
            # Mức 3: fallback Chrome thật (attestation chỉ pass trong browser thật).
            try:
                return _fetch_via_real_chrome(url, timeout_ms=timeout_ms)
            except TranscriptFetchError:
                raise  # lỗi rõ từ real-chrome, đã có message UX
            except Exception as exc:  # CDP/launch fail → vẫn báo rõ cho user
                raise TranscriptFetchError(
                    f"YouTube đòi xác thực bot (attestation) cho video này và fallback Chrome thật "
                    f"thất bại: {exc}. Dán transcript thủ công vào ô raw (mở video → 'Show transcript' "
                    f"→ copy).",
                    kind="attestation",
                ) from exc
        raise


def _fetch_with_playwright(url: str, *, headless: bool, timeout_ms: int) -> dict:
    """Mức 1+2: Playwright headless — bắt cả get_panel/get_transcript, detect attestation."""
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
        # Nạp cookies YouTube (Netscape) nếu có — vượt IP bot-wall (guest/headless
        # không cookies bị wall chặn transcript → không fire get_panel). Xem [[ytdlp-youtube-block]].
        if settings.yt_cookies_file.exists() and settings.yt_cookies_file.stat().st_size:
            try:
                ctx.add_cookies(_load_netscape_cookies(settings.yt_cookies_file))
            except Exception:
                pass  # cookies hỏng/hết hạn → fallback guest (vẫn chạy được khi IP sạch)
        page = ctx.new_page()
        page.set_default_timeout(timeout_ms)
        page.on("response", _on_response)

        try:
            page.goto(watch_url, wait_until="domcontentloaded")
            page.wait_for_timeout(4000)  # để description transcript section render (lazy)
            try:
                _open_transcript(page)
            except RuntimeError as err:
                # Không thấy nút "Show transcript" → video có thể không có transcript.
                raise TranscriptFetchError(
                    f"{err} Dán transcript thủ công vào ô raw nếu cần.",
                    kind="no_transcript",
                ) from err
            # chờ request transcript xuất hiện (poll nhẹ, không đọc property trong listener)
            deadline = time.time() + timeout_ms / 1000
            saw_attestation = False
            while time.time() < deadline:
                data = _extract_transcript(captured)
                if data is not None:
                    return data
                if _detect_attestation_failure(captured):
                    saw_attestation = True
                    break  # get_transcription bị wall attestation → thoát sớm fallback Mức 3
                page.wait_for_timeout(300)
            if saw_attestation:
                raise TranscriptFetchError(
                    "YouTube đòi xác thực bot (attestation PoG) cho transcript video này — "
                    "Playwright headless không tính được. Fallback Chrome thật...",
                    kind="attestation",
                )
            raise TranscriptFetchError(
                "Không bắt được response transcript sau khi mở panel — có thể video không có "
                "transcript, UI YouTube đã đổi, hoặc IP vẫn bị bot-wall (kiểm tra yt_cookies.txt "
                "còn hạn + đăng nhập lại qua Cài đặt). Thử headless=False để debug hoặc dán raw thủ công.",
                kind="generic",
            )
        finally:
            ctx.close()
            browser.close()


def _detect_attestation_failure(responses) -> bool:
    """Mức 2: phát hiện get_transcript bị 400 'Precondition check failed' (attestation PoG).

    Đọc body + decompress ở ngoài listener (channel-call an toàn). True → fallback Chrome thật.
    """
    for resp in reversed(responses):
        try:
            if TRANSCRIPT_URL_FRAG not in resp.url:
                continue
        except Exception:
            continue
        try:
            raw = resp.body()
        except Exception:
            continue
        decompressed = _decompress(raw)
        if any(m in decompressed for m in ATTESTATION_MARKERS):
            return True
    return False


def _fetch_via_real_chrome(url: str, *, timeout_ms: int) -> dict:
    """Mức 3: fallback Chrome thật qua CDP — attestation PoG pass trong browser thật.

    Launch ``chrome.exe`` (profile yt_profile_dir đã login) + ``--remote-debugging-port``,
    Playwright ``connect_over_cdp`` attach → mở transcript panel → bắt get_transcript/get_panel.
    Phản射 pattern ``login_youtube`` (chrome.exe subprocess tránh automation-block). Xem
    [[ytdlp-youtube-block]].
    """
    import subprocess
    import time
    import urllib.request

    from fastapi import HTTPException
    from playwright.sync_api import sync_playwright

    if not settings.chrome_executable.exists():
        raise TranscriptFetchError(
            f"Không tìm thấy Chrome để fallback attestation: {settings.chrome_executable}",
            kind="generic",
        )
    settings.yt_profile_dir.mkdir(parents=True, exist_ok=True)
    port = REAL_CHROME_CDP_PORT
    cdp_url = f"http://127.0.0.1:{port}"
    video_id = video_id_from_url(url)
    watch_url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        proc = subprocess.Popen(
            [
                str(settings.chrome_executable),
                f"--user-data-dir={settings.yt_profile_dir}",
                f"--remote-debugging-port={port}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-blink-features=AutomationControlled",
                watch_url,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        raise TranscriptFetchError(f"Không mở được Chrome (fallback): {exc}", kind="generic") from exc

    captured: list = []
    try:
        # Chờ CDP endpoint sẵn sàng.
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
            raise TranscriptFetchError(
                f"Chrome (fallback) không mở CDP tại {cdp_url} sau 30 giây.",
                kind="generic",
            )

        browser = None
        with sync_playwright() as p:
            for _ in range(15):
                try:
                    browser = p.chromium.connect_over_cdp(cdp_url)
                    break
                except Exception:
                    time.sleep(1)
            if browser is None:
                raise TranscriptFetchError(
                    "Không connect_over_cdp được Chrome (fallback).", kind="generic"
                )
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.set_default_timeout(timeout_ms)

            def _on_response(resp):
                captured.append(resp)

            page.on("response", _on_response)
            try:
                # Reload watch page SAU khi attach listener → attestation challenge embed
                # lúc load còn tươi khi click (đợi 4s như cũ làm challenge stale → 400 attestation).
                try:
                    page.goto(watch_url, wait_until="domcontentloaded")
                except Exception:
                    pass  # page đã ở watch_url rồi (chrome.exe launch arg) → vẫn dùng được.
                page.wait_for_timeout(1500)  # chờ attestation JS init (ngắn để challenge chưa stale)
                try:
                    _open_transcript(page)
                except RuntimeError as err:
                    raise TranscriptFetchError(
                        f"Chrome thật cũng không thấy nút transcript — {err} "
                        "Video có thể không có transcript. Dán raw thủ công.",
                        kind="no_transcript",
                    ) from err
                deadline = time.time() + timeout_ms / 1000
                _dbg_path = settings.yt_profile_dir.parent / "_debug_transcript_responses.txt"
                while time.time() < deadline:
                    data = _extract_transcript(captured)
                    if data is not None:
                        return data
                    # Dump mọi response transcript-endpoint ra file debug (khi fail mới xem).
                    try:
                        _dump_transcript_responses(captured, _dbg_path)
                    except Exception:
                        pass
                    page.wait_for_timeout(300)
                raise TranscriptFetchError(
                    "Chrome thật mở transcript nhưng không bắt được response — video có thể không có "
                    "transcript hoặc UI đã đổi. Dán raw thủ công.",
                    kind="no_transcript",
                )
            finally:
                try:
                    browser.close()
                except Exception:
                    pass
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=8)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def _dump_transcript_responses(responses, out_path: Path) -> None:
    """Debug: ghi mọi response get_panel/get_transcript (status + url + body preview) ra file.

    Khi real-chrome fallback fail, file này cho thấy shape response thật → sửa ``_extract_transcript``
    (filter hiện đang bắt ``transcriptSegmentViewModel`` / ``PAmodern_transcript_view``; get_transcript
    mới có thể dùng key khác → bị skip → polling timeout).
    """
    lines: list[str] = []
    n = 0
    for resp in responses:
        try:
            if not any(frag in resp.url for frag in TRANSCRIPT_URL_FRAGS):
                continue
        except Exception:
            continue
        n += 1
        try:
            status = resp.status
        except Exception:
            status = "?"
        try:
            body = _decompress(resp.body())
        except Exception as exc:
            body = f"<body đọc lỗi: {exc}>".encode()
        preview = body[:2000].decode("utf-8", errors="replace")
        lines.append(f"=== #{n} status={status} url={resp.url}\n{preview}\n")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        f"[debug] {n} response transcript-endpoint\n" + "\n".join(lines),
        encoding="utf-8",
    )


def _extract_transcript(responses) -> dict | None:
    """Lọc + decode response transcript (get_panel CŨ hoặc get_transcript MỚI).

    Không dùng ``request.post_data`` (đôi khi None/empty dù là request transcript) —
    thay vào đó decode body mỗi response transcript, lấy response có transcript segment.
    Đọc body + decompress ở ngoài listener (channel-call an toàn).
    """
    for resp in reversed(responses):  # Ưu tiên response mới nhất.
        try:
            if not any(frag in resp.url for frag in TRANSCRIPT_URL_FRAGS):
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


def transcript_to_text(data: dict) -> str:
    """Convert get_panel/get_transcript JSON → text sạch ``[MM:SS] caption`` (mỗi dòng 1 segment).

    Thay thế logic cũ (dump nguyên JSON 47KB upload cho Gemini phải tự mò nested) bằng text
    gọn ~3KB, deterministic, prompt đã chấp nhận ("raw JSON/text transcripts" + timestamp MM:SS).
    YouTube 2 shape:
      - MỚI: ``transcriptSegmentViewModel`` trong ``macroMarkersPanelItemViewModel``, mỗi seg có
        ``simpleText`` + ``timestamp`` ("0:00"). Path sâu nhưng generic đệ quy bắt hết.
      - CŨ: ``transcriptSegments[].snippet.runs[].text`` + ``startMs`` (ms) → đổi sang MM:SS.
    Generic: đệ quy tìm mọi ``transcriptSegmentViewModel`` dict, lấy timestamp+text, sort theo thời gian.
    Fallback: nếu không extract được segment nào → trả JSON dump (không mất data, Gemini vẫn xử lý được).
    """
    found: list[tuple[float, str, str]] = []  # (sec, "MM:SS", text)

    def _mmss(sec: float) -> str:
        sec = max(0, int(sec))
        h, rem = divmod(sec, 3600)
        m, s = divmod(rem, 60)
        return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

    def _to_sec(ts) -> float:
        parts = str(ts).split(":")
        try:
            nums = [float(p) for p in parts]
        except ValueError:
            return 0.0
        sec = 0.0
        for n in nums:
            sec = sec * 60 + n
        return sec

    def _walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "transcriptSegmentViewModel" and isinstance(v, dict):
                    ts = v.get("timestamp")
                    if ts is None and v.get("startMs") is not None:
                        try:
                            ts = _mmss(float(v["startMs"]) / 1000)
                        except (TypeError, ValueError):
                            ts = "0:00"
                    txt = v.get("simpleText")
                    if txt is None:
                        snip = v.get("snippet")
                        if isinstance(snip, dict) and isinstance(snip.get("runs"), list):
                            txt = " ".join(
                                r.get("text", "") for r in snip["runs"] if isinstance(r, dict)
                            )
                        elif isinstance(snip, str):
                            txt = snip
                    if ts is not None and txt:
                        found.append((_to_sec(ts), str(ts), txt.strip()))
                _walk(v)
        elif isinstance(o, list):
            for v in o:
                _walk(v)

    _walk(data)
    if not found:
        # Fallback: không parse được → giữ JSON (Gemini vẫn xử lý được, không mất data).
        return json.dumps(data, ensure_ascii=False)
    found.sort(key=lambda x: x[0])
    return "\n".join(f"[{ts}] {txt}" for _, ts, txt in found)


def normalize_raw_input(raw_bytes: bytes) -> bytes:
    """Chuẩn hoá raw do user dán thủ công — bất kể JSON hay text đều ra input sạch cho Gemini.

    - JSON transcript (get_panel/get_transcript, 47KB) → ``transcript_to_text`` (text '[MM:SS] ...'
      gọn ~3KB, deterministic). Giúp user dán nguyên response JSON vẫn không phình payload.
    - Text thường (đã '[MM:SS] caption' hoặc tự do) → giữ nguyên (prompt chấp nhận text).
    - JSON không phải transcript / parse lỗi → giữ nguyên (Gemini vẫn xử lý được).
    """
    text = raw_bytes.decode("utf-8", errors="replace").strip()
    if not text:
        return raw_bytes
    # Chỉ clean nếu có vẻ JSON object + chứa marker transcript (tránh đụng text thường).
    if text.startswith("{") and "transcript" in text.lower():
        try:
            data = json.loads(text)
        except Exception:
            return raw_bytes
        if isinstance(data, dict):
            cleaned = transcript_to_text(data)
            # transcript_to_text fallback (0 segment) → json.dumps → đừng ghi đè nguyên bản.
            if cleaned.startswith("[") and "transcriptSegmentViewModel" not in cleaned:
                return cleaned.encode("utf-8")
    return raw_bytes


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


def _load_netscape_cookies(path: Path) -> list[dict]:
    """Parse Netscape cookies.txt → list cookie dict cho Playwright ``add_cookies``.

    Format (7 cột tab-separated, do ``ytdlp._write_netscape_cookies`` ghi):
    domain  include_subdomain  path  secure  expiry  name  value
    Guest/headless bị IP bot-wall chặn transcript → nạp cookies (SAPISID) vượt wall,
    đồng bộ với cách ``download_video`` retry cookies. Xem [[ytdlp-youtube-block]].
    """
    cookies: list[dict] = []
    for ln in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not ln or ln.startswith("#"):
            continue
        parts = ln.split("\t")
        if len(parts) < 7:
            continue
        domain, _flag, cpath, secure, expiry, name, value = parts[:7]
        try:
            exp = int(expiry)
        except ValueError:
            exp = 0
        cookies.append({
            "name": name,
            "value": value,
            "domain": domain,
            "path": cpath or "/",
            "secure": secure.upper() == "TRUE",
            "httpOnly": False,
            "expires": exp if exp > 0 else -1,
        })
    return cookies


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
    print(f"[transcript] fetch transcript cho {url}")
    data = fetch_transcript_raw(url)
    text = transcript_to_text(data)  # text sạch '[MM:SS] caption' — cùng format service feed Gemini
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    n_seg = text.count("\n") + 1 if text.startswith("[") else text.count("transcriptSegmentViewModel")
    print(f"[transcript] OK -> {out}")
    print(f"            {out.stat().st_size:,} bytes | {n_seg} transcript segments (text)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
