"""Meta Muse: nhiều tài khoản + tạo video/ảnh qua HTTP/WebSocket (không điều khiển trình duyệt).

- Tạo video, kiểm tra phiên: `gateway.py` (HTTPS muse.ai + WebSocket Noise tới VM của tài khoản),
  dùng cookie đã lưu trong muse_accounts.json.
- Chrome chỉ còn dùng cho bước ĐĂNG NHẬP (người dùng tự đăng nhập Meta trong cửa sổ app mở) và
  nút "Mở Chrome Muse"; cookie được đọc bằng lệnh CDP thô (`cdp.py`), không dùng Playwright.
"""
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional

from app.core.config import DATA_DIR, settings
from app.core.storage import read_config, write_config, mark_saved
from app.ai.muse import cdp
from app.ai.muse.accounts import MuseAccountStore
from app.ai.muse.gateway import (
    MuseAuthError,
    MuseGateway,
    auth_check,
    guess_media_kind,
    node_id_for,
    wait_for_result,
)
from app.ai.muse.schemas import (
    MuseSettingsPayload,
    MuseSettingsResponse,
    MuseStatusResponse,
    MuseGenerateRequest,
    MuseGenerateResponse,
    MuseHistoryItem,
    MuseHistoryResponse,
)

MUSE_PROFILES_DIR = DATA_DIR / "muse-profiles"
# Ảnh Muse tạo (vd. node "Tách áo quần" của Muse Canvas); xem qua /api/ai/muse/output?file=
MUSE_OUTPUT_DIR = DATA_DIR / "media" / "muse_outputs"
# Bài chữ Muse trả (output_kind=text, vd. node "Kịch bản video") — lưu .md để không mất khi đóng app
MUSE_TEXT_DIR = DATA_DIR / "media" / "muse_texts"
# Chế độ chữ: agent có thể viết nhiều tin liên tiếp -> chờ luồng chat im lặng lâu hơn mới chốt
TEXT_SETTLE_SECONDS = 30
MUSE_URL = "https://muse.ai/"
NO_ACCOUNT_MSG = "Chưa có tài khoản Muse. Vào Cài đặt → Muse AI (Meta) → “(+) Thêm tài khoản Muse”."

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200

NOT_LOGGED_MSG = "Hết phiên đăng nhập Muse — bấm “Đăng nhập lại” trên tài khoản này."
# Đầu chuỗi lỗi của job khi Muse xác nhận chưa đăng nhập -> đánh dấu tài khoản "error".
NOT_LOGGED_MARK = "[Chưa đăng nhập Muse]"
# Video Muse mất vài phút; cấu hình cũ mặc định 120 s là quá ngắn cho đường HTTP.
MIN_VIDEO_TIMEOUT = 600
# Agent trả lời chữ (hỏi lại / từ chối) mà im lặng chừng này giây không có video -> trả kết quả.
REPLY_GRACE = 180


@dataclass
class MuseTarget:
    """Một tài khoản Muse cùng profile Chrome (chỉ dùng để đăng nhập) của nó."""

    key: str
    profile_dir: Path
    port: int
    account: Optional[dict] = None

    @property
    def account_id(self) -> Optional[str]:
        return self.account.get("id") if self.account else None

    @property
    def label(self) -> str:
        if self.account:
            return self.account.get("label") or self.account.get("id") or "Muse"
        return "Muse"


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


class MuseService:
    def __init__(self):
        # Thư mục gốc dữ liệu (cùng chỗ với mặc định download_dir trong config.json)
        self.data_root = Path(settings.chrome_profile_dir).parent.resolve()
        self.executable = Path(settings.chrome_executable).resolve()
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    # ------------------------------------------------------------------ cấu hình

    def get_config(self) -> Dict[str, Any]:
        config = read_config()
        return config.get("muse", {})

    def _default_download_dir(self) -> str:
        return str(self.data_root / "Downloads")

    def get_settings(self) -> MuseSettingsResponse:
        cfg = self.get_config()
        return MuseSettingsResponse(
            ok=True,
            download_dir=cfg.get("download_dir") or self._default_download_dir(),
            timeout_seconds=max(int(cfg.get("timeout_seconds") or 0), MIN_VIDEO_TIMEOUT),
            default_prompt_prefix=cfg.get("default_prompt_prefix", ""),
        )

    def update_config(self, payload: MuseSettingsPayload) -> MuseSettingsResponse:
        config = read_config()
        # bỏ các khóa của cách điều khiển Chrome cũ
        current = {
            k: v
            for k, v in config.get("muse", {}).items()
            if k not in ("app_url", "cdp_port", "auto_download", "is_connected", "last_checked_at")
        }
        updated = {
            **current,
            "download_dir": payload.download_dir.strip() or self._default_download_dir(),
            "timeout_seconds": max(int(payload.timeout_seconds or 0), MIN_VIDEO_TIMEOUT),
            "default_prompt_prefix": payload.default_prompt_prefix.strip(),
        }
        config["muse"] = mark_saved(updated)
        write_config(config)
        return self.get_settings()

    # ------------------------------------------------------------------ chọn tài khoản

    @staticmethod
    def get_store() -> MuseAccountStore:
        return MuseAccountStore(DATA_DIR)

    def _lock_for(self, key: str) -> threading.Lock:
        with self._locks_guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = self._locks[key] = threading.Lock()
            return lock

    def _busy_keys(self) -> list[str]:
        with self._locks_guard:
            return [k for k, lk in self._locks.items() if lk.locked()]

    @staticmethod
    def _account_target(acc: dict) -> MuseTarget:
        return MuseTarget(acc["id"], Path(acc.get("partition") or "").resolve(), int(acc.get("cdp_port") or 0), acc)

    def _get_account_or_raise(self, account_id: str) -> dict:
        acc = self.get_store().get_account(account_id)
        if not acc:
            raise ValueError("Không tìm thấy tài khoản Muse này (có thể đã bị xóa).")
        return acc

    def _status_target(self, account_id: Optional[str] = None) -> MuseTarget:
        """Tài khoản để xem trạng thái / mở Chrome. Không lỗi khi mọi tài khoản đều hết phiên."""
        store = self.get_store()
        if account_id:
            return self._account_target(self._get_account_or_raise(account_id))
        raw = store.list_raw()
        if not raw:
            raise ValueError(NO_ACCOUNT_MSG)
        acc = store.pick() or raw[0]
        return self._account_target(acc)

    def _job_target(self, account_id: Optional[str] = None) -> MuseTarget:
        """Tài khoản chạy job: tài khoản được chọn, hoặc xoay vòng tài khoản dùng được."""
        store = self.get_store()
        if account_id:
            return self._account_target(self._get_account_or_raise(account_id))
        if not store.list_raw():
            raise RuntimeError(NO_ACCOUNT_MSG)
        acc = store.pick(busy=self._busy_keys())
        if not acc:
            raise RuntimeError(
                "Không có tài khoản Muse nào sẵn sàng. Vào Cài đặt → Muse AI (Meta) để đăng nhập lại tài khoản."
            )
        return self._account_target(acc)

    # ------------------------------------------------------------------ Chrome (chỉ để đăng nhập)

    def is_cdp_alive(self, port: int) -> bool:
        return bool(port) and cdp.browser_info(port, timeout=1.5) is not None

    def _launch_chrome(self, profile_dir: Path, port: int, *, visible: bool = True) -> subprocess.Popen:
        """Mở Chrome với profile + cổng CDP chỉ định, chờ cổng debug sẵn sàng."""
        if not self.executable.exists():
            raise FileNotFoundError(f"Không tìm thấy Google Chrome tại: {self.executable}")
        profile_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            str(self.executable),
            f"--user-data-dir={profile_dir}",
            f"--remote-debugging-port={port}",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1200,900",
        ]
        if not visible:
            cmd.append("--window-position=-2400,-2400")
        cmd.append(MUSE_URL)

        proc = subprocess.Popen(
            cmd,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
        for _ in range(30):
            time.sleep(0.5)
            if self.is_cdp_alive(port):
                return proc
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        raise TimeoutError(
            f"Không thể khởi động Chrome trên cổng CDP {port} sau 15 giây. "
            "Nếu profile này đang mở ở một cửa sổ Chrome khác, hãy đóng cửa sổ đó rồi thử lại."
        )

    def ensure_chrome_running(self, target: Optional[MuseTarget] = None) -> int:
        """Đảm bảo Chrome của profile đang chạy (hiện trên màn hình)."""
        target = target or self._status_target()
        if not self.is_cdp_alive(target.port):
            self._launch_chrome(target.profile_dir, target.port, visible=True)
        return target.port

    def _probe_session(
        self,
        port: int,
        *,
        timeout_seconds: float,
        wait_for_login: bool,
        proc: Optional[subprocess.Popen] = None,
        close_after: bool = False,
    ) -> Dict[str, Any]:
        """Đọc cookie muse.ai của Chrome ở `port` (CDP) và xác nhận bằng POST /api/auth/check (HTTP).

        wait_for_login=True : chờ người dùng đăng nhập tới khi hết giờ / đóng cửa sổ.
        wait_for_login=False: kiểm tra nhanh.
        close_after=True    : đóng Chrome êm (Browser.close) để profile ghi xong cookie.
        """
        out: Dict[str, Any] = {"logged_in": False, "closed": False, "detail": ""}
        deadline = time.time() + timeout_seconds
        misses = 0
        try:
            while time.time() < deadline:
                if proc is not None and proc.poll() is not None:
                    out["closed"] = True
                    out["detail"] = "Cửa sổ Chrome đã bị đóng trước khi hoàn tất đăng nhập."
                    break
                try:
                    cookies, ua = cdp.muse_cookies(port)
                except Exception as e:
                    cookies, ua = "", ""
                    out["detail"] = f"Không đọc được cookie từ Chrome: {e}"
                if "hatch_sess=" in cookies:
                    try:
                        auth = auth_check(cookies, ua)
                        out.update(
                            logged_in=True,
                            viewer_id=str(auth.get("viewer_id") or ""),
                            cookies=auth.get("_cookies") or cookies,
                            ua=ua,
                        )
                        break
                    except MuseAuthError as e:
                        misses += 1
                        out["detail"] = str(e)
                    except Exception as e:  # mạng chập chờn: thử lại
                        out["detail"] = f"Không gọi được muse.ai: {e}"
                else:
                    misses += 1
                    out["detail"] = "Chưa có phiên đăng nhập Muse trong Chrome."
                # kiểm tra nhanh: cho trang vài nhịp để nạp cookie rồi kết luận
                if not wait_for_login and misses >= 4:
                    break
                time.sleep(4.0 if wait_for_login else 2.5)
            else:
                if not out["detail"]:
                    out["detail"] = "Hết thời gian chờ đăng nhập Muse."
        finally:
            if close_after:
                cdp.close_browser(port)
                if proc is not None:
                    try:
                        proc.wait(timeout=8)
                    except Exception:
                        try:
                            proc.kill()
                        except Exception:
                            pass
        return out

    def _close_chrome_on(self, port: int) -> None:
        """Đóng êm Chrome đang chạy trên `port` (nếu có) và chờ cổng tắt."""
        if not self.is_cdp_alive(port):
            return
        cdp.close_browser(port)
        for _ in range(20):
            if not _port_in_use(port):
                return
            time.sleep(0.4)

    # ------------------------------------------------------------------ tài khoản

    def list_accounts(self) -> Dict[str, Any]:
        store = self.get_store()
        busy = set(self._busy_keys())
        accounts = []
        for a in store.list_accounts():
            a["running"] = self.is_cdp_alive(a.get("cdpPort") or 0)
            a["busy"] = a.get("id") in busy
            accounts.append(a)
        return {
            "accounts": accounts,
            "active_accounts_count": sum(1 for a in accounts if a.get("status") == "active"),
            "total_accounts_count": len(accounts),
        }

    def _new_profile(self) -> tuple[Path, int]:
        MUSE_PROFILES_DIR.mkdir(parents=True, exist_ok=True)
        profile = MUSE_PROFILES_DIR / f"muse-{int(time.time() * 1000)}"
        store = self.get_store()
        taken: set[int] = set()
        while True:
            port = store.allocate_port(taken)
            if not _port_in_use(port):
                return profile, port
            taken.add(port)

    def login_account(self, account_id: Optional[str] = None, timeout_seconds: int = 420) -> dict:
        """Mở Chrome để đăng nhập Muse.

        - Không có account_id: tạo profile mới -> thêm tài khoản.
        - Có account_id: mở lại profile của tài khoản đó để đăng nhập lại.
        """
        store = self.get_store()
        if account_id:
            acc = self._get_account_or_raise(account_id)
            target = self._account_target(acc)
            new_profile = False
        else:
            profile, port = self._new_profile()
            target = MuseTarget(f"new:{profile.name}", profile, port)
            new_profile = True

        lock = self._lock_for(target.key)
        if not lock.acquire(blocking=False):
            raise RuntimeError("Tài khoản này đang chạy một việc khác (tạo video / kiểm tra). Chờ xong rồi thử lại.")
        try:
            proc = None
            if not self.is_cdp_alive(target.port):
                proc = self._launch_chrome(target.profile_dir, target.port, visible=True)
            res = self._probe_session(
                target.port,
                timeout_seconds=timeout_seconds,
                wait_for_login=True,
                proc=proc,
                close_after=proc is not None,
            )
        finally:
            lock.release()

        def _discard_new_profile():
            if new_profile:
                shutil.rmtree(target.profile_dir, ignore_errors=True)

        if not res.get("logged_in"):
            _discard_new_profile()
            raise RuntimeError(res.get("detail") or "Chưa đăng nhập được Muse.")

        viewer_id = res["viewer_id"]
        dup = store.find_by_viewer(viewer_id)
        if dup and dup.get("id") != account_id:
            _discard_new_profile()
            raise RuntimeError(
                f"Tài khoản Muse này đã có trong danh sách (“{dup.get('label') or dup.get('id')}”). "
                "Dùng nút “Đăng nhập lại” trên dòng đó."
            )

        if account_id:
            return store.update_account(
                account_id,
                viewer_id=viewer_id,
                cookies=res.get("cookies") or None,
                ua=res.get("ua") or None,
                status="active",
                message="",
                last_checked_at=time.time(),
            )
        return store.add_account(
            viewer_id=viewer_id,
            cookies=res.get("cookies", ""),
            ua=res.get("ua", ""),
            partition=str(target.profile_dir),
            cdp_port=target.port,
        )

    def _refresh_from_profile(self, target: MuseTarget) -> Dict[str, Any]:
        """Lấy lại cookie từ profile Chrome (mở ẩn nếu cần) khi cookie đã lưu bị từ chối."""
        if not target.profile_dir.exists():
            return {"logged_in": False, "detail": "Mất thư mục profile Chrome — xóa tài khoản rồi thêm lại."}
        proc = None
        if not self.is_cdp_alive(target.port):
            proc = self._launch_chrome(target.profile_dir, target.port, visible=False)
        return self._probe_session(
            target.port, timeout_seconds=40, wait_for_login=False, proc=proc, close_after=proc is not None
        )

    def check_account(self, account_id: str) -> dict:
        """Kiểm tra phiên: gọi auth/check bằng cookie đã lưu (không mở Chrome).

        Cookie bị từ chối thì thử lấy cookie mới từ profile Chrome của tài khoản.
        """
        store = self.get_store()
        acc = self._get_account_or_raise(account_id)
        target = self._account_target(acc)
        lock = self._lock_for(target.key)
        if not lock.acquire(blocking=False):
            raise RuntimeError("Tài khoản đang chạy job, chưa kiểm tra được. Chờ job xong rồi thử lại.")
        try:
            res: Dict[str, Any]
            try:
                auth = auth_check(acc.get("cookies") or "", acc.get("ua") or "")
                res = {
                    "logged_in": True,
                    "viewer_id": str(auth.get("viewer_id") or ""),
                    "cookies": auth.get("_cookies") or acc.get("cookies"),
                    "ua": acc.get("ua"),
                }
            except MuseAuthError:
                res = self._refresh_from_profile(target)
            except Exception as e:
                raise RuntimeError(f"Không gọi được muse.ai để kiểm tra: {e}")
        finally:
            lock.release()

        if not res.get("logged_in"):
            msg = res.get("detail") if "profile" in str(res.get("detail", "")) else NOT_LOGGED_MSG
            store.update_account(account_id, status="error", message=msg, last_checked_at=time.time())
            return store._public(store.get_account(account_id))

        viewer_id = res["viewer_id"]
        dup = store.find_by_viewer(viewer_id)
        if dup and dup.get("id") != account_id:
            store.update_account(
                account_id,
                status="error",
                message=f"Profile này đang đăng nhập trùng tài khoản “{dup.get('label')}”. Đăng nhập lại đúng tài khoản.",
                last_checked_at=time.time(),
            )
            return store._public(store.get_account(account_id))
        return store.update_account(
            account_id,
            viewer_id=viewer_id,
            cookies=res.get("cookies") or None,
            ua=res.get("ua") or None,
            status="active",
            message="",
            last_checked_at=time.time(),
        )

    def rename_account(self, account_id: str, label: str) -> dict:
        label = (label or "").strip()[:60]
        if not label:
            raise ValueError("Tên tài khoản không được để trống.")
        self._get_account_or_raise(account_id)
        return self.get_store().update_account(account_id, label=label)

    def delete_account(self, account_id: str) -> bool:
        store = self.get_store()
        acc = self._get_account_or_raise(account_id)
        lock = self._lock_for(account_id)
        if not lock.acquire(blocking=False):
            raise RuntimeError("Tài khoản đang chạy job, không xóa được lúc này.")
        try:
            port = int(acc.get("cdp_port") or 0)
            partition = Path(acc.get("partition") or "")
            # chỉ xóa profile nằm trong muse-profiles/ do app tạo
            owned = bool(partition.parts) and MUSE_PROFILES_DIR.resolve() in partition.resolve().parents
            if owned:
                self._close_chrome_on(port)
            deleted = store.delete_account(account_id)
            if deleted and owned:
                shutil.rmtree(partition, ignore_errors=True)
            return deleted
        finally:
            lock.release()

    # ------------------------------------------------------------------ trạng thái

    def check_status(self, account_id: Optional[str] = None) -> MuseStatusResponse:
        """Trạng thái phiên Muse của một tài khoản: gọi auth/check bằng cookie đã lưu (không cần Chrome)."""
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            target = self._status_target(account_id)
        except ValueError as e:
            return MuseStatusResponse(is_connected=False, last_checked_at=now_iso, message=str(e))

        base = dict(last_checked_at=now_iso, account_id=target.account_id, account_label=target.label)
        store = self.get_store()
        acc = target.account
        try:
            auth = auth_check(acc.get("cookies") or "", acc.get("ua") or "")
        except MuseAuthError:
            store.update_account(target.account_id, status="error", message=NOT_LOGGED_MSG, last_checked_at=time.time())
            return MuseStatusResponse(is_connected=False, message=f"“{target.label}”: {NOT_LOGGED_MSG}", **base)
        except Exception as e:
            return MuseStatusResponse(is_connected=False, message=f"Không gọi được muse.ai: {e}", **base)

        new_cookies = auth.get("_cookies")
        store.update_account(
            target.account_id,
            status="active",
            message="",
            last_checked_at=time.time(),
            cookies=new_cookies if new_cookies and new_cookies != acc.get("cookies") else None,
        )
        return MuseStatusResponse(
            is_connected=True,
            message=f"Đã kết nối Muse AI ({target.label}) — phiên Meta hợp lệ.",
            **base,
        )

    def open_browser(self, account_id: Optional[str] = None) -> Dict[str, Any]:
        """Mở cửa sổ Chrome Muse của một tài khoản để người dùng xem / thao tác tay."""
        target = self._status_target(account_id)
        port = self.ensure_chrome_running(target)
        return {
            "ok": True,
            "cdp_port": port,
            "account_id": target.account_id,
            "account_label": target.label,
            "message": f"Chrome Muse ({target.label}) đã được mở trên màn hình.",
        }

    # ------------------------------------------------------------------ tạo video

    def generate_video(self, req: MuseGenerateRequest) -> MuseGenerateResponse:
        """Chọn tài khoản (chỉ định hoặc xoay vòng), rồi gửi prompt và đợi Muse tạo video."""
        try:
            target = self._job_target(req.account_id)
        except (ValueError, RuntimeError) as e:
            return MuseGenerateResponse(ok=False, prompt=req.prompt, error=str(e))
        lock = self._lock_for(target.key)
        if not lock.acquire(timeout=900):
            return MuseGenerateResponse(
                ok=False, prompt=req.prompt, error=f"Tài khoản “{target.label}” đang bận quá lâu, thử lại sau."
            )
        try:
            # đọc lại bản ghi mới nhất (cookie có thể vừa được làm mới)
            target.account = self.get_store().get_account(target.account_id) or target.account
            res = self._generate_http(target, req)
        finally:
            lock.release()

        res.account_id = target.account_id
        res.account_label = target.label
        store = self.get_store()
        if res.ok:
            store.touch(target.account_id)
        elif res.error and res.error.startswith(NOT_LOGGED_MARK):
            store.set_status(target.account_id, "error", NOT_LOGGED_MSG)
        return res

    @staticmethod
    def _reference_files(req: MuseGenerateRequest) -> list[str]:
        raw_media: list[str] = []
        for group in (req.reference_media, req.reference_images, req.reference_videos):
            if group:
                raw_media.extend(group)
        for single in (req.reference_image, req.reference_video):
            if single and single not in raw_media:
                raw_media.append(single)
        valid: list[str] = []
        for item in raw_media:
            if item and os.path.exists(item):
                resolved = str(Path(item).resolve())
                if resolved not in valid:
                    valid.append(resolved)
        return valid

    def _connect(self, acc: dict) -> MuseGateway:
        gw = MuseGateway(acc.get("cookies") or "", acc.get("ua") or "")
        if gw.cookies and gw.cookies != acc.get("cookies"):
            self.get_store().update_account(acc["id"], cookies=gw.cookies)
            acc["cookies"] = gw.cookies
        return gw

    @staticmethod
    def _register_library_image(dest: Path, req: MuseGenerateRequest, prompt: str, session_id: Optional[str],
                                account_label: str, media: list[str]) -> None:
        """Ảnh Muse vừa tạo -> Thư Viện Ảnh của Canvas AI (để dùng lại). Lỗi ở đây không làm hỏng job."""
        try:
            from app.workflow import image_library

            label = (req.chat_title or "").split("·", 1)[-1].strip() or dest.stem
            image_library.add_file(dest, source="muse", label=label, meta={
                "prompt": prompt[:4000],
                "chat_title": req.chat_title or "",
                "session_id": session_id or "",
                "account_label": account_label,
                "input_paths": media,
            })
        except Exception:
            pass

    @staticmethod
    def _write_video_sidecar(dest: Path, req: MuseGenerateRequest, prompt: str, session_id: Optional[str],
                             account_label: str, idx: int, total: int) -> None:
        """<video>.muse.json cạnh video Muse: Thư Viện Video đọc để hiện tiêu đề / prompt. Lỗi ở đây không làm hỏng job."""
        try:
            from app.workflow.muse_finish import write_sidecar

            title = (req.chat_title or "").strip()
            if total > 1:
                title = f"{title} · {'bản chính' if idx == total else f'clip {idx}'}".strip(" ·")
            write_sidecar(dest, {
                "prompt": prompt[:4000],
                "chat_title": title,
                "session_id": session_id or "",
                "account_label": account_label,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass

    @staticmethod
    def _safe_prefix(raw: Optional[str], fallback: str) -> str:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (raw or "").strip())[:40]
        return safe or fallback

    def _finish_text(self, req, gw, result, final_prompt, session_id, timeout_sec, start, fail) -> MuseGenerateResponse:
        """output_kind=text: ghép mọi tin trả lời của agent (+ file .md/.txt nếu Muse đính kèm), lưu thành .md."""
        parts = [t.strip() for t in (result.reply_texts or [result.reply_text]) if t and t.strip()]
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        prefix = self._safe_prefix(req.file_prefix, "muse_text")
        MUSE_TEXT_DIR.mkdir(parents=True, exist_ok=True)
        # Muse đôi khi viết bài dài thành file trong sandbox thay vì tin nhắn: tải về và ghép vào.
        for i, res in enumerate(r for r in result.resources if str(r.get("path", "")).split("?")[0].lower().endswith((".md", ".txt"))):
            try:
                tmp = MUSE_TEXT_DIR / f"{prefix}_{stamp}_att{i}.txt"
                gw.download(res, str(tmp))
                body = tmp.read_text(encoding="utf-8", errors="replace").strip()
                tmp.unlink(missing_ok=True)
                if body and body not in parts:
                    parts.append(body)
            except Exception:
                continue
        text = "\n\n".join(parts).strip()
        if not text:
            if result.timed_out:
                return fail(f"Muse chưa trả lời sau {timeout_sec} giây. Prompt ĐÃ được gửi — mở chat Muse để xem, "
                            "đừng gửi lại để khỏi tốn lượt.")
            return fail("Muse không trả lời chữ nào.")
        dest = MUSE_TEXT_DIR / f"{prefix}_{stamp}_{uuid.uuid4().hex[:6]}.md"
        dest.write_text(text + "\n", encoding="utf-8")
        return MuseGenerateResponse(
            ok=True,
            prompt=final_prompt,
            output_kind="text",
            local_path=str(dest),
            file_size=dest.stat().st_size,
            duration_seconds=round(time.time() - start, 2),
            session_id=session_id,
            reply_text=text,
            # vẫn trả bài nhưng báo có thể chưa đủ (hết thời gian chờ khi agent còn viết)
            error=(f"Hết {timeout_sec} giây chờ — bài có thể chưa đủ, xem thêm trong chat Muse."
                   if result.timed_out else None),
        )

    def _generate_http(self, target: MuseTarget, req: MuseGenerateRequest) -> MuseGenerateResponse:
        """Gửi prompt (kèm media tham chiếu) qua gateway Noise rồi chờ sự kiện video/ảnh và tải về.

        Đã gửi prompt thì KHÔNG bao giờ gửi lại (mỗi lần gửi tốn hạn mức): lỗi mạng khi đang chờ
        chỉ kết nối lại để đọc tiếp lịch sử chat.
        """
        cfg = self.get_config()
        acc = target.account
        timeout_sec = req.timeout_seconds or max(int(cfg.get("timeout_seconds") or 0), MIN_VIDEO_TIMEOUT)
        kind = req.output_kind
        noun = {"video": "video", "image": "ảnh", "text": "câu trả lời"}.get(kind, kind)
        prefix = cfg.get("default_prompt_prefix", "").strip() if req.apply_prefix else ""
        final_prompt = f"{prefix} {req.prompt}".strip() if prefix else req.prompt.strip()
        if not final_prompt:
            return MuseGenerateResponse(ok=False, prompt="", error="Prompt không được để trống.")
        media = self._reference_files(req)
        download_dir = self.get_download_dir()
        start = time.time()

        def fail(msg: str) -> MuseGenerateResponse:
            return MuseGenerateResponse(
                ok=False, prompt=final_prompt, error=msg, duration_seconds=round(time.time() - start, 2)
            )

        try:
            gw = self._connect(acc)
        except MuseAuthError as e:
            return fail(f"{NOT_LOGGED_MARK} {e}")
        except Exception as e:
            return fail(f"Không kết nối được Muse: {e}")

        try:
            # Chọn chat: nối tiếp chat trước / chat mới riêng / chat chính.
            session_id: Optional[str] = None
            if req.continuation and acc.get("last_session_id"):
                session_id = acc["last_session_id"]
            elif req.use_side_chat:
                session_id = gw.start_session(title=(req.chat_title or f"CreatorFlow · {final_prompt[:40]}")[:80])

            history = gw.history(session_id, limit=1)
            baseline = max([e.get("seq") or 0 for e in history] or [0])
            items = [{"type": "text", "text": final_prompt}] + gw.attachment_items(media)
            gw.send_items(items, node_id_for(gw.viewer_id), session_id)
            self.get_store().update_account(acc["id"], last_session_id=session_id or "")
        except MuseAuthError as e:
            gw.close()
            return fail(f"{NOT_LOGGED_MARK} {e}")
        except Exception as e:
            gw.close()
            return fail(f"Lỗi khi gửi prompt tới Muse: {e}")

        # --- đã gửi: từ đây chỉ chờ + đọc lại, không gửi lại ---
        result = None
        reconnects = 0
        try:
            while True:
                remaining = timeout_sec - (time.time() - start)
                if remaining <= 0:
                    break
                try:
                    if kind == "text":
                        # chỉ cần câu trả lời chữ (want rỗng), chốt khi chat im lặng TEXT_SETTLE_SECONDS
                        result = wait_for_result(
                            gw, session_id, baseline, want=set(), timeout=remaining, settle=TEXT_SETTLE_SECONDS
                        )
                    else:
                        # settle_seconds: chờ chat im lặng lâu hơn (vd. Muse làm nhiều clip liên tiếp)
                        result = wait_for_result(
                            gw, session_id, baseline, want={kind}, timeout=remaining, reply_grace=REPLY_GRACE,
                            settle=req.settle_seconds or 15,
                        )
                    break
                except Exception:
                    reconnects += 1
                    gw.close()
                    if reconnects > 3:
                        return fail(f"Mất kết nối tới Muse nhiều lần khi đang chờ {noun}. Prompt ĐÃ được gửi — "
                                    "mở Chrome Muse để xem kết quả, đừng gửi lại.")
                    time.sleep(3)
                    gw = self._connect(acc)

            if result is None:
                return fail(f"Muse chưa trả {noun} sau {timeout_sec} giây. Prompt ĐÃ được gửi — mở Chrome Muse để xem, "
                            "đừng gửi lại để khỏi tốn lượt.")

            if kind == "text":
                return self._finish_text(req, gw, result, final_prompt, session_id, timeout_sec, start, fail)

            found = [r for r in result.resources if guess_media_kind(r) == kind]
            if not found:
                reply = (result.reply_text or "").strip()
                if result.timed_out:
                    return fail(f"Muse chưa trả {noun} sau {timeout_sec} giây. Prompt ĐÃ được gửi — mở Chrome Muse để "
                                "xem, đừng gửi lại để khỏi tốn lượt.")
                return fail(f"Muse trả lời nhưng không có {noun}: “{reply[:400]}”" if reply
                            else f"Muse không trả {noun} nào.")

            # collect_all: tải mọi file đúng loại theo thứ tự (vd. clip từng đoạn + bản ghép); file cuối là kết quả chính
            chosen = found[-1]
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            targets = found if req.collect_all else [chosen]
            paths: list[str] = []
            preview_url = None
            size = 0
            for idx, item in enumerate(targets, start=1):
                part = f"_{idx:02d}" if len(targets) > 1 else ""
                if kind == "video":
                    name = f"{self._safe_prefix(req.file_prefix, 'muse_video')}_{stamp}{part}.mp4"
                    dest = download_dir / name
                else:
                    ext = os.path.splitext(str(item.get("path")).split("?")[0])[1].lower() or ".webp"
                    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                        ext = ".webp"
                    name = f"{self._safe_prefix(req.file_prefix, 'muse_image')}_{stamp}{part}_{uuid.uuid4().hex[:6]}{ext}"
                    MUSE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                    dest = MUSE_OUTPUT_DIR / name
                    preview_url = f"/api/ai/muse/output?file={urllib.parse.quote(name)}"
                size = gw.download(item, str(dest))
                if kind == "image":
                    self._register_library_image(dest, req, final_prompt, session_id, target.label, media)
                else:
                    self._write_video_sidecar(dest, req, final_prompt, session_id, target.label, idx, len(targets))
                paths.append(str(dest))
            dest = Path(paths[-1])
            return MuseGenerateResponse(
                local_paths=paths,
                ok=True,
                prompt=final_prompt,
                output_kind=kind,
                preview_url=preview_url,
                video_url=str(chosen.get("path")),
                local_path=str(dest),
                file_size=size,
                duration_seconds=round(time.time() - start, 2),
                session_id=session_id,
                reply_text=result.reply_text or None,
            )
        except MuseAuthError as e:
            return fail(f"{NOT_LOGGED_MARK} {e}")
        except Exception as e:
            return fail(f"Lỗi khi chờ / tải {noun} Muse: {e}. Prompt ĐÃ được gửi — đừng gửi lại.")
        finally:
            gw.close()

    # ------------------------------------------------------------------ thư mục & lịch sử

    def get_download_dir(self) -> Path:
        """Lấy đường dẫn thư mục tải video."""
        cfg = self.get_config()
        download_dir_str = (cfg.get("download_dir") or "").strip()
        if download_dir_str:
            d = Path(download_dir_str)
        else:
            d = Path(self._default_download_dir())
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
