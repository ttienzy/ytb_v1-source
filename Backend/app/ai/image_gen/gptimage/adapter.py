"""GptImageClient — POOL rotator ChatGPT (reverse-gpt), khớp interface ImageBotClient (drop-in thay Leonardo).

Đa account (ChatgptAccountStore) → render đa luồng: `_make_image` của film_project được gọi ĐỒNG THỜI
(ảnh nhân vật + storyboard nhiều cảnh) → mỗi call `generate()` **lease 1 account riêng** (Condition var, như
GrokRotator) → chạy song song thật, 1 account không bị 2 luồng dùng chung. Lỗi → mark exhausted(limit)/error(cookie)
+ failover account khác; cookie hết hạn → auto-heal reopen profile ẤM (autoheal.capture).

Async↔sync: client gốc ASYNC + NodeSolver (subprocess) bound-loop → **1 event loop nền dùng chung**; mỗi account
1 GPTPlus (giữ solver ấm, lease đảm bảo 1 account/1 luồng nên không đua self._session).
"""
from __future__ import annotations

import asyncio
import threading
from typing import Optional

from . import autoheal
from .accounts import ChatgptAccountStore


class GptImageError(RuntimeError):
    pass


class GptImageClient:
    def __init__(self, store: ChatgptAccountStore):
        self._store = store
        self._progress = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._clients: dict[str, object] = {}          # account_id → GPTPlus (giữ solver ấm)
        self._clients_lock = threading.Lock()
        # lease pool (y GrokRotator)
        self._leased: set[str] = set()
        self._pool_cv = threading.Condition()

    # ── progress ────────────────────────────────────────────────────────────────
    def set_progress(self, fn):
        self._progress = fn

    def _notify(self, msg: str):
        if self._progress:
            try:
                self._progress(msg)
            except Exception:  # noqa: BLE001
                pass

    # ── loop nền + GPTPlus per-account ──────────────────────────────────────────
    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop and self._loop.is_running():
            return self._loop
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, daemon=True, name="gptimage-loop").start()
        return self._loop

    def _run(self, coro, timeout: float = 420.0):
        fut = asyncio.run_coroutine_threadsafe(coro, self._ensure_loop())
        return fut.result(timeout=timeout)

    def _gpt_for(self, acc: dict):
        """GPTPlus của account (tạo lần đầu, cập nhật session mỗi lần lấy — cookies có thể vừa heal)."""
        aid = acc["id"]
        session = ChatgptAccountStore.session_of(acc)
        with self._clients_lock:
            gpt = self._clients.get(aid)
            if gpt is None:
                try:
                    from .pkg import GPTPlus
                except Exception as exc:  # noqa: BLE001
                    raise GptImageError(
                        "Không nạp được ChatGPT image client — thiếu dependency? "
                        f"Cần curl_cffi + Pillow + Node 18+. (chi tiết: {exc})") from exc
                gpt = GPTPlus(session)
                self._clients[aid] = gpt
            else:
                gpt._session = session
            return gpt

    # ── lease/release (mirror GrokRotator) ──────────────────────────────────────
    def _lease_account(self, exclude: frozenset) -> Optional[dict]:
        with self._pool_cv:
            while True:
                usable = self._store.usable_accounts()
                free = [a for a in usable if a["id"] not in self._leased and a["id"] not in exclude]
                if free:
                    self._leased.add(free[0]["id"])
                    return free[0]
                if not any(a["id"] not in exclude for a in usable):
                    return None
                self._pool_cv.wait(timeout=10)

    def _release_account(self, account_id: str) -> None:
        with self._pool_cv:
            self._leased.discard(account_id)
            self._pool_cv.notify_all()

    def pool_size(self) -> int:
        return len(self._store.usable_accounts())

    # ── auto-heal (reopen profile ẤM) ──────────────────────────────────────────
    def _heal_account(self, acc: dict) -> bool:
        profile = acc.get("partition")
        if not profile:
            return False
        self._notify(f"ChatGPT cookie hết hạn — tự làm mới ({acc.get('email') or acc['id']})…")
        data = autoheal.capture(profile)
        if not data or not data.get("cookies"):
            return False
        self._store.update_account(
            acc["id"], cookies=data.get("cookies"), ua=data.get("ua") or None,
            client_version=data.get("client_version") or None, client_build=data.get("client_build") or None,
            oai_is=data.get("oai_is") or None, device_id=data.get("device_id") or None,
            status="active", message="")
        return True

    @staticmethod
    def _classify(err: Exception) -> str:
        m = str(err).lower()
        # ChatGPT trả lời bằng chữ thay vì ảnh: do NỘI DUNG yêu cầu, tài khoản vẫn tốt (xét trước "limit" vì lời giải thích
        # có thể chứa chữ đó; câu báo hết lượt thật đã bị check_limit_refusal bắt thành rate_limit từ trước).
        if "no_image:" in m:
            return "content"
        # ChatGPT chặn tạm thời (HTTP 403 "Unusual activity has been detected from your device. Try again later."), thường
        # khi gửi nhiều yêu cầu liên tục. Hết sau vài phút: KHÔNG phải cookie hỏng, cũng không phải hết lượt 3 giờ.
        if "unusual activity" in m:
            return "throttled"
        if any(k in m for k in ("accesstoken", "cookies expired", "401", "revoked", "sign in", "unauthorized")):
            return "auth"
        # Không dùng chữ "rate" trần: nó khớp nhầm "generate", "moderate"... và đánh dấu oan tài khoản hết lượt.
        if any(k in m for k in ("rate_limit", "rate limit", "ratelimit", "limit", "429", "no asset within timeout", "too many",
                                "giới hạn", "resets in", "free plan", "quá giới hạn")):
            return "rate"
        return "error"

    # ── viết chữ (thay 9router) ─────────────────────────────────────────────────
    def _lease_text_account(self, exclude: frozenset) -> Optional[dict]:
        """Tài khoản cho việc VIẾT CHỮ: chỉ cần còn session. Hết lượt ẢNH (exhausted) không chặn viết chữ vì ChatGPT tính
        hạn mức chữ và ảnh riêng. Dùng chung tập lease với tạo ảnh để một tài khoản không bị hai luồng dùng cùng lúc."""
        with self._pool_cv:
            while True:
                cands = [a for a in self._store.list_raw() if a.get("cookies") and a.get("ua") and a["id"] not in exclude]
                cands.sort(key=lambda a: (a.get("status") not in ("active", None), a.get("last_used") or 0))
                free = [a for a in cands if a["id"] not in self._leased]
                if free:
                    self._leased.add(free[0]["id"])
                    return free[0]
                if not cands:
                    return None
                self._pool_cv.wait(timeout=10)

    def chat_text(self, prompt: str, system: str = "", ref_paths: list[str] | None = None,
                  model: str = "auto", timeout: float = 300.0) -> tuple[str, str]:
        """Gửi một tin nhắn chữ (kèm ảnh nếu có) qua tài khoản ChatGPT web, trả (văn bản đã làm sạch, nhãn tài khoản).

        ChatGPT web không có vai trò system: hướng dẫn hệ thống được gộp lên đầu tin nhắn, kèm yêu cầu trả văn bản thuần
        và không tìm web (tìm web làm câu trả lời chèn trích dẫn/thẻ giao diện). Lỗi cookie -> tự làm mới rồi thử lại;
        lỗi khác -> chuyển tài khoản. KHÔNG đổi trạng thái "hết lượt ảnh" của tài khoản khi viết chữ lỗi."""
        from .pkg.gpt_plus import check_limit_refusal, clean_web_text

        if not any(a.get("cookies") and a.get("ua") for a in self._store.list_raw()):
            raise GptImageError("Chưa có tài khoản ChatGPT nào. Thêm tài khoản ở Cài đặt → Tạo ảnh AI → ChatGPT.")
        rules = ("[QUY TẮC TRẢ LỜI] Chỉ trả lời bằng văn bản thuần (Markdown đơn giản hoặc JSON nếu được yêu cầu). "
                 "Không tìm kiếm web, không chèn ảnh, trích dẫn hay thành phần giao diện.")
        message = "\n\n".join(x for x in (f"[HƯỚNG DẪN HỆ THỐNG]\n{system.strip()}" if system.strip() else "", rules, prompt.strip()) if x)
        refs = [str(p) for p in (ref_paths or []) if p]
        tried: set[str] = set()
        errors: list[str] = []
        while True:
            acc = self._lease_text_account(frozenset(tried))
            if acc is None:
                raise GptImageError("Không tài khoản ChatGPT nào trả lời được. " + " | ".join(errors[-3:]))
            label = acc.get("email") or acc["id"]
            try:
                for attempt in (1, 2):
                    try:
                        self._notify(f"ChatGPT đang viết… [{label}]")
                        res = self._run(self._gpt_for(acc).chat(message, image=False, model=model, ref_paths=refs or None,
                                                                check_refusal=False), timeout=timeout)
                        text = clean_web_text(res.get("message", ""))
                        if not text:
                            raise GptImageError("ChatGPT trả lời rỗng.")
                        # Câu báo hết lượt thật luôn ngắn; không dò trong câu trả lời dài (kịch bản có thể chứa "try again later"...).
                        if len(text) < 400 and check_limit_refusal(text):
                            raise GptImageError(f"rate_limit: {text[:160]}")
                        self._store.touch(acc["id"])
                        return text, label
                    except Exception as exc:  # noqa: BLE001
                        if attempt == 1 and self._classify(exc) == "auth" and self._heal_account(acc):
                            acc = self._store.get_account(acc["id"]) or acc
                            continue
                        if self._classify(exc) == "auth":
                            self._store.set_status(acc["id"], "error", "Cookie hết hạn — đăng nhập lại")
                        errors.append(f"{label}: {str(exc)[:160]}")
                        break
                tried.add(acc["id"])
            finally:
                self._release_account(acc["id"])

    # ── interface ImageBotClient ────────────────────────────────────────────────
    def generate(self, prompt: str, dest: str, ref_paths: list[str] | None = None,
                 ref_labels: list[str] | None = None,
                 timeout: int = 300, aspect: str = "9:16") -> str:
        """Gen 1 ảnh (kèm ref) → lưu `dest`. Lease account → failover khi lỗi. Khớp ImageBotClient.generate.
        `aspect` (9:16|16:9): ChatGPT không nhận kích thước cứng → tỉ lệ do prompt lo (đã ghi trong image_prompt).
        `ref_labels`: nhận cho khớp chữ ký ImageBotClient — ChatGPT bind theo THỨ TỰ + prompt nên bỏ qua."""
        if not self._store.has_active():
            raise GptImageError("Chưa có account ChatGPT nào khả dụng (tất cả tài khoản đều đã đụng giới hạn hoặc lỗi cookie). Hãy thêm account ChatGPT Plus khác trong Cài đặt.")
        refs = [str(p) for p in (ref_paths or []) if p]
        tried: set[str] = set()
        last_err = None
        while True:
            acc = self._lease_account(frozenset(tried))
            if acc is None and last_err is not None and self._classify(last_err) == "throttled":
                raise GptImageError(
                    "ChatGPT tạm chặn vì phát hiện \"hoạt động bất thường\" (gửi nhiều yêu cầu tạo ảnh liên tục). "
                    "Chờ vài phút rồi bấm tạo lại; không cần thêm tài khoản.") from last_err
            if acc is None:
                err_str = str(last_err)
                if "rate_limit:" in err_str:
                    err_str = err_str.split("rate_limit:", 1)[1].strip()
                raise GptImageError(
                    f"Tất cả tài khoản ChatGPT đều không khả dụng. Lý do: {err_str}. Hãy thêm tài khoản ChatGPT Plus khác trong Cài đặt.")
            try:
                try:
                    self._notify("ChatGPT: đang tạo ảnh…"
                                 + (f" ({len(refs)} ref)" if refs else "")
                                 + f" [{acc.get('email') or acc['id']}]")
                    self._run(self._gpt_for(acc).generate_image(prompt, save_to=str(dest),
                                                                ref_paths=refs or None),
                              timeout=float(timeout) + 120.0)
                    self._store.set_status(acc["id"], "active", "")
                    self._store.touch(acc["id"])
                    return str(dest)
                except Exception as exc:  # noqa: BLE001
                    last_err = exc
                    kind = self._classify(exc)
                    if kind == "content":
                        # Không đổi trạng thái tài khoản (trước đây bị đánh "error" oan rồi bị loại khỏi pool) và không thử
                        # tài khoản khác: cùng prompt sẽ bị trả lời y hệt, chỉ tốn thêm lượt ảnh.
                        said = str(exc).split("no_image:", 1)[1].strip()
                        raise GptImageError(
                            "ChatGPT không tạo ảnh cho yêu cầu này mà trả lời bằng chữ (tài khoản vẫn dùng được, "
                            f"thường do prompt). ChatGPT nói: {said}") from exc
                    if kind == "throttled":
                        # Chặn ngắn hạn: giữ nguyên trạng thái tài khoản, thử tài khoản khác (nếu có).
                        tried.add(acc["id"])
                        continue
                    if kind == "auth":
                        if self._heal_account(acc):
                            fresh = self._store.get_account(acc["id"]) or acc
                            try:
                                self._run(self._gpt_for(fresh).generate_image(
                                    prompt, save_to=str(dest), ref_paths=refs or None),
                                    timeout=float(timeout) + 120.0)
                                self._store.set_status(acc["id"], "active", "")
                                self._store.touch(acc["id"])
                                return str(dest)
                            except Exception as e2:  # noqa: BLE001
                                last_err = e2
                        self._store.set_status(acc["id"], "error", "Cookie hết hạn — đăng nhập lại")
                    elif kind == "rate":
                        clean_msg = str(exc)
                        if "rate_limit:" in clean_msg:
                            clean_msg = clean_msg.split("rate_limit:", 1)[1].strip()
                        self._store.set_status(acc["id"], "exhausted", f"Đụng giới hạn: {clean_msg[:100]}")
                    else:
                        self._store.set_status(acc["id"], "error", str(exc)[:160])
                    tried.add(acc["id"])
                    continue
            finally:
                self._release_account(acc["id"])

    def download(self, url: str, dest: str) -> str:
        """Parity ImageBotClient — ChatGPT tự tải PNG trong generate; đây là fallback tải URL trực tiếp."""
        import urllib.request
        urllib.request.urlretrieve(url, dest)
        return dest

    # ── cho UI/deps ─────────────────────────────────────────────────────────────
    def list_accounts(self):
        return self._store.list_accounts()

    def delete_account(self, account_id: str) -> dict:
        with self._clients_lock:
            self._clients.pop(account_id, None)
        return {"deleted": self._store.delete_account(account_id), "id": account_id}

    def status(self) -> dict:
        accs = self._store.list_accounts()
        usable = self._store.usable_accounts()
        return {"logged_in": len(accs) > 0, "accounts": len(accs), "usable": len(usable), "detail": accs}
