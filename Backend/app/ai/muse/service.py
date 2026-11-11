import base64
import os
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional

from playwright.sync_api import sync_playwright

from app.core.config import settings
from app.core.storage import read_config, write_config, mark_saved
from app.ai.muse.schemas import (
    MuseSettingsPayload,
    MuseSettingsResponse,
    MuseStatusResponse,
    MuseGenerateRequest,
    MuseGenerateResponse,
    MuseHistoryItem,
    MuseHistoryResponse,
)


class MuseService:
    """Service xử lý tự động hóa tương tác với Meta Muse AI qua Chrome CDP."""

    def __init__(self):
        self.profile_dir = (Path(settings.chrome_profile_dir).parent / 'ChromeProfile_Muse').resolve()
        self.executable = Path(settings.chrome_executable).resolve()

    def get_config(self) -> Dict[str, Any]:
        config = read_config()
        return config.get("muse", {})

    def update_config(self, payload: MuseSettingsPayload) -> MuseSettingsResponse:
        config = read_config()
        current = config.get("muse", {})
        
        download_dir = payload.download_dir.strip()
        if not download_dir:
            download_dir = str(self.profile_dir.parent / "Downloads")

        updated = {
            **current,
            "app_url": payload.app_url.strip() or "https://muse.ai/",
            "cdp_port": payload.cdp_port if payload.cdp_port > 0 else 9225,
            "auto_download": payload.auto_download,
            "download_dir": download_dir,
            "timeout_seconds": payload.timeout_seconds if payload.timeout_seconds > 0 else 120,
            "default_prompt_prefix": payload.default_prompt_prefix.strip(),
        }

        config["muse"] = mark_saved(updated)
        write_config(config)

        return MuseSettingsResponse(
            ok=True,
            is_connected=updated.get("is_connected", False),
            last_checked_at=updated.get("last_checked_at"),
            app_url=updated["app_url"],
            cdp_port=updated["cdp_port"],
            auto_download=updated["auto_download"],
            download_dir=updated["download_dir"],
            timeout_seconds=updated["timeout_seconds"],
            default_prompt_prefix=updated["default_prompt_prefix"],
            profile_dir=str(self.profile_dir),
        )

    def is_cdp_alive(self, port: int) -> bool:
        """Kiểm tra cổng CDP có phản hồi không."""
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1.5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def ensure_chrome_running(self) -> int:
        """Đảm bảo Chrome đang chạy với đúng Profile và cổng CDP."""
        cfg = self.get_config()
        port = cfg.get("cdp_port", 9225)
        app_url = cfg.get("app_url", "https://muse.ai/")

        if self.is_cdp_alive(port):
            return port

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        if not self.executable.exists():
            raise FileNotFoundError(f"Không tìm thấy Google Chrome tại: {self.executable}")

        cmd = [
            str(self.executable),
            f"--user-data-dir={self.profile_dir}",
            f"--remote-debugging-port={port}",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
            app_url,
        ]

        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200

        subprocess.Popen(
            cmd,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )

        # Chờ Chrome sẵn sàng
        for _ in range(15):
            time.sleep(1)
            if self.is_cdp_alive(port):
                return port

        raise TimeoutError(f"Không thể khởi động Chrome trên cổng CDP {port} sau 15 giây.")

    def check_status(self) -> MuseStatusResponse:
        """Kiểm tra trạng thái kết nối và phiên đăng nhập Muse."""
        cfg = self.get_config()
        port = cfg.get("cdp_port", 9225)
        now_iso = datetime.now(timezone.utc).isoformat()

        if not self.is_cdp_alive(port):
            # Cập nhật config: disconnected
            config = read_config()
            config["muse"]["is_connected"] = False
            config["muse"]["last_checked_at"] = now_iso
            write_config(config)

            return MuseStatusResponse(
                is_connected=False,
                is_running=False,
                cdp_port=port,
                last_checked_at=now_iso,
                message="Chrome chưa khởi động hoặc chưa mở cổng debug.",
            )

        p = sync_playwright().start()
        try:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            context = browser.contexts[0]
            
            page = None
            for pg in context.pages:
                if "muse.ai" in pg.url:
                    page = pg
                    break

            if not page:
                return MuseStatusResponse(
                    is_connected=False,
                    is_running=True,
                    cdp_port=port,
                    last_checked_at=now_iso,
                    message="Chrome đang chạy nhưng chưa mở tab muse.ai.",
                )

            title = page.title()
            url = page.url
            body_text = page.locator("body").inner_text()

            # Phân tích trạng thái đăng nhập
            is_connected = False
            if "Connected" in body_text or "Today" in body_text:
                is_connected = True
                msg = "Đã kết nối với Muse AI (Phiên Meta hợp lệ)."
            elif "Log in" in body_text or "Continue" in body_text:
                msg = "Chưa đăng nhập tài khoản Meta trên Muse."
            else:
                is_connected = True
                msg = "Đang mở trang Muse AI."

            # Lưu vào config
            config = read_config()
            config["muse"]["is_connected"] = is_connected
            config["muse"]["last_checked_at"] = now_iso
            write_config(config)

            return MuseStatusResponse(
                is_connected=is_connected,
                is_running=True,
                cdp_port=port,
                tab_title=title,
                tab_url=url,
                last_checked_at=now_iso,
                message=msg,
            )
        except Exception as e:
            return MuseStatusResponse(
                is_connected=False,
                is_running=True,
                cdp_port=port,
                last_checked_at=now_iso,
                message=f"Lỗi kiểm tra session: {e}",
            )
        finally:
            p.stop()

    def open_browser(self) -> Dict[str, Any]:
        """Mở hoặc đưa cửa sổ Chrome Muse lên màn hình để người dùng thao tác."""
        port = self.ensure_chrome_running()
        return {"ok": True, "cdp_port": port, "message": "Chrome Muse đã được mở trên màn hình."}

    def generate_video(self, req: MuseGenerateRequest) -> MuseGenerateResponse:
        """Gửi prompt và đợi Muse AI tạo video thành phẩm."""
        cfg = self.get_config()
        port = self.ensure_chrome_running()
        timeout_sec = req.timeout_seconds or cfg.get("timeout_seconds", 180)
        prefix = cfg.get("default_prompt_prefix", "").strip()

        final_prompt = f"{prefix} {req.prompt}".strip() if prefix else req.prompt.strip()
        if not final_prompt:
            return MuseGenerateResponse(ok=False, prompt="", error="Prompt không được để trống.")

        download_dir = Path(cfg.get("download_dir", str(self.profile_dir.parent / "Downloads"))).resolve()
        download_dir.mkdir(parents=True, exist_ok=True)

        start_time = time.time()
        p = sync_playwright().start()

        try:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            context = browser.contexts[0]

            # Tìm tab muse.ai
            page = None
            for pg in context.pages:
                if "muse.ai" in pg.url:
                    page = pg
                    break

            if not page:
                page = context.new_page()
                page.goto(cfg.get("app_url", "https://muse.ai/"))
                page.wait_for_load_state("domcontentloaded")

            page.bring_to_front()

            # 1. Tuỳ chọn: Bắt đầu side chat mới nếu yêu cầu
            if req.use_side_chat:
                try:
                    new_side = page.locator("button[aria-label='New side chat'], [aria-label*='New side chat']").first
                    if new_side.is_visible():
                        new_side.click()
                        time.sleep(1)
                    else:
                        chats_btn = page.locator("button:has-text('Chats')").first
                        if chats_btn.is_visible():
                            chats_btn.click()
                            time.sleep(0.8)
                            new_side_menu = page.locator("button[aria-label='New side chat'], button:has-text('New side chat')").first
                            if new_side_menu.is_visible():
                                new_side_menu.click()
                                time.sleep(1)
                            else:
                                page.keyboard.press("Escape")
                except Exception:
                    pass

            # 2. Xử lý ảnh / video mẫu đính kèm (nhiều media cùng lúc)
            raw_media = []
            if req.reference_media:
                raw_media.extend(req.reference_media)
            if req.reference_images:
                raw_media.extend(req.reference_images)
            if req.reference_videos:
                raw_media.extend(req.reference_videos)
            if req.reference_image and req.reference_image not in raw_media:
                raw_media.append(req.reference_image)
            if req.reference_video and req.reference_video not in raw_media:
                raw_media.append(req.reference_video)

            valid_media = []
            for item in raw_media:
                if item and os.path.exists(item):
                    resolved_p = str(Path(item).resolve())
                    if resolved_p not in valid_media:
                        valid_media.append(resolved_p)

            if valid_media:
                try:
                    file_input = page.locator('input[type="file"]').first
                    if file_input.count() > 0:
                        file_input.set_input_files(valid_media)
                        time.sleep(2.0)
                except Exception as e:
                    print("Error attaching reference media:", e)

            # 3. Ghi nhận danh sách src của các video chat hiện có (LỌC BỎ AVATAR MASCOT)
            initial_video_srcs = page.evaluate("""() => {
                const isAvatar = (v) => {
                    return v.closest('.rounded-full') !== null || 
                           v.className.includes('rounded-full') || 
                           (v.offsetWidth > 0 && v.offsetWidth <= 100);
                };
                const vids = Array.from(document.querySelectorAll('video')).filter(v => !isAvatar(v));
                return vids.map(v => v.src || v.currentSrc).filter(Boolean);
            }""")

            # 4. Tìm ô nhập prompt
            textarea = page.locator("textarea[placeholder*='Message'], textarea[aria-label*='Message']").first
            if not textarea.is_visible():
                return MuseGenerateResponse(
                    ok=False,
                    prompt=final_prompt,
                    error="Không tìm thấy ô nhập tin nhắn. Hãy đảm bảo bạn đã đăng nhập Muse.",
                )

            textarea.click()
            textarea.fill(final_prompt)
            time.sleep(0.5)

            # 5. Gửi prompt
            send_btn = page.locator("button:has(svg), button[aria-label*='Send']").last
            if send_btn.is_visible():
                send_btn.click()
            else:
                textarea.press("Enter")

            # 6. Chờ tiến trình sinh video hoàn tất
            poll_interval = 3
            max_loops = int(timeout_sec / poll_interval)
            video_done = False
            found_src = None

            time.sleep(4)

            for loop in range(max_loops):
                time.sleep(poll_interval)
                state = page.evaluate("""(initSrcs) => {
                    const isAvatar = (v) => {
                        return v.closest('.rounded-full') !== null || 
                               v.className.includes('rounded-full') || 
                               (v.offsetWidth > 0 && v.offsetWidth <= 100);
                    };
                    
                    const chatVids = Array.from(document.querySelectorAll('video')).filter(v => !isAvatar(v));
                    
                    let newVid = null;
                    for (const v of chatVids) {
                        const s = v.src || v.currentSrc;
                        if (s && !initSrcs.includes(s) && (v.readyState >= 1 || v.duration > 0)) {
                            newVid = s;
                            break;
                        }
                    }

                    if (!newVid && chatVids.length > initSrcs.length) {
                        const last = chatVids[chatVids.length - 1];
                        const s = last.src || last.currentSrc;
                        if (s && (last.readyState >= 1 || last.duration > 0)) {
                            newVid = s;
                        }
                    }

                    const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="Cancel"], button:has(svg rect)');
                    const museStatus = document.querySelector('[class*="status"], [class*="badge"]')?.innerText || '';
                    const isCreating = !!stopBtn || museStatus.includes('Creating video');

                    return {
                        isCreating: isCreating,
                        newVidSrc: newVid,
                        chatVidsCount: chatVids.length
                    };
                }""", initial_video_srcs)

                if state["newVidSrc"] and not state["isCreating"]:
                    video_done = True
                    found_src = state["newVidSrc"]
                    break

            if not video_done:
                # Fallback: kiểm tra video chat cuối cùng nếu đã render xong
                fallback_src = page.evaluate("""() => {
                    const isAvatar = (v) => {
                        return v.closest('.rounded-full') !== null || 
                               v.className.includes('rounded-full') || 
                               (v.offsetWidth > 0 && v.offsetWidth <= 100);
                    };
                    const chatVids = Array.from(document.querySelectorAll('video')).filter(v => !isAvatar(v));
                    if (chatVids.length === 0) return null;
                    const last = chatVids[chatVids.length - 1];
                    return (last.readyState >= 1 || last.duration > 0) ? (last.src || last.currentSrc) : null;
                }""")
                if fallback_src:
                    video_done = True
                    found_src = fallback_src

            if not video_done:
                return MuseGenerateResponse(
                    ok=False,
                    prompt=final_prompt,
                    error=f"Timeout: Muse chưa hoàn thành tạo video sau {timeout_sec} giây.",
                    duration_seconds=round(time.time() - start_time, 2),
                )

            # 7. Trích xuất video CHAT thực tế (loại trừ Mascot Avatar)
            video_data = page.evaluate("""async (targetSrc) => {
                const isAvatar = (v) => {
                    return v.closest('.rounded-full') !== null || 
                           v.className.includes('rounded-full') || 
                           (v.offsetWidth > 0 && v.offsetWidth <= 100);
                };
                const chatVids = Array.from(document.querySelectorAll('video')).filter(v => !isAvatar(v));
                if (chatVids.length === 0) return null;

                let targetVid = null;
                if (targetSrc) {
                    targetVid = chatVids.find(v => (v.src || v.currentSrc) === targetSrc);
                }
                if (!targetVid) {
                    targetVid = chatVids[chatVids.length - 1];
                }

                const src = targetVid.src || targetVid.currentSrc;
                if (!src) return null;

                try {
                    const res = await fetch(src);
                    const blob = await res.blob();
                    return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve({
                            src: src,
                            base64: reader.result.split(',')[1],
                            size: blob.size,
                            type: blob.type,
                            duration: targetVid.duration,
                            width: targetVid.videoWidth,
                            height: targetVid.videoHeight
                        });
                        reader.readAsDataURL(blob);
                    });
                } catch (err) {
                    return { src: src, error: err.toString() };
                }
            }""", found_src)

            if not video_data or "base64" not in video_data:
                return MuseGenerateResponse(
                    ok=False,
                    prompt=final_prompt,
                    error="Video đã render nhưng không thể tải dữ liệu blob từ trang.",
                    duration_seconds=round(time.time() - start_time, 2),
                )

            # 8. Lưu file MP4 vào thư mục Downloads
            timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"muse_video_{timestamp_str}.mp4"
            dest_file = download_dir / filename

            with open(dest_file, "wb") as f:
                f.write(base64.b64decode(video_data["base64"]))

            elapsed = round(time.time() - start_time, 2)
            return MuseGenerateResponse(
                ok=True,
                prompt=final_prompt,
                video_url=video_data.get("src"),
                local_path=str(dest_file),
                file_size=video_data.get("size"),
                duration_seconds=elapsed,
            )

        except Exception as e:
            return MuseGenerateResponse(
                ok=False,
                prompt=final_prompt,
                error=f"Lỗi khi điều khiển Muse qua CDP: {e}",
                duration_seconds=round(time.time() - start_time, 2),
            )
        finally:
            p.stop()

    def get_download_dir(self) -> Path:
        """Lấy đường dẫn thư mục tải video."""
        cfg = self.get_config()
        download_dir_str = (cfg.get("download_dir") or "").strip()
        if download_dir_str:
            d = Path(download_dir_str)
        else:
            d = self.profile_dir.parent / "Downloads"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def get_history(self, limit: int = 50) -> MuseHistoryResponse:
        """Lấy danh sách các video đã tạo/tải về trong thư mục Downloads."""
        d = self.get_download_dir()
        items = []
        if d.exists():
            files = list(d.glob("*.mp4"))
            files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
            for f in files[:limit]:
                stat = f.stat()
                created_dt = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                items.append(
                    MuseHistoryItem(
                        id=f.name,
                        filename=f.name,
                        local_path=str(f.resolve()),
                        file_size=stat.st_size,
                        created_at=created_dt.isoformat(),
                        preview_url=f"/api/ai/muse/stream?file={urllib.parse.quote(f.name)}",
                    )
                )
        return MuseHistoryResponse(ok=True, items=items)

    def open_download_folder(self) -> Dict[str, Any]:
        """Mở thư mục Downloads trên Windows Explorer."""
        d = self.get_download_dir()
        if os.name == "nt":
            os.startfile(str(d))
        else:
            subprocess.Popen(["xdg-open", str(d)])
        return {"ok": True, "path": str(d)}


muse_service = MuseService()

