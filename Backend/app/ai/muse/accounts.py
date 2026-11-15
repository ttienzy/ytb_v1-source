"""Kho nhiều tài khoản Meta Muse (giống kho tài khoản ChatGPT).

Lưu ở DATA_DIR/muse_accounts.json. Mỗi tài khoản có profile Chrome riêng
(DATA_DIR/muse-profiles/<...>) và một cổng CDP cố định trong dải PORT_MIN..PORT_MAX,
để nhiều tài khoản có thể mở Chrome cùng lúc mà không giẫm lên nhau
(dải này tách khỏi 9222–9235 của Recap/Gemini/ChatGPT). Chrome chỉ dùng để đăng nhập; tạo video đi qua HTTP.

Account record:
  { id, label, viewer_id, cookies, ua, partition, cdp_port, last_session_id,
    status, message, added_at, last_used, last_checked_at, exhausted_at }
status: active | exhausted | error
  - active    : đã xác nhận đăng nhập (POST /api/auth/check trả viewer_id)
  - error     : hết phiên / chưa đăng nhập -> bấm "Đăng nhập lại"
  - exhausted : dành cho hết hạn mức (đặt tay hoặc sau này tự phát hiện), nghỉ EXHAUST_COOLDOWN
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Iterable, Optional

from app.ai.image_gen.gptimage.accounts import RotatingAccountStore


class MuseAccountStore(RotatingAccountStore):
    FILENAME = "muse_accounts.json"
    EXHAUST_COOLDOWN = 6 * 3600
    PORT_MIN = 9300
    PORT_MAX = 9399

    # Muse khác ChatGPT: tài khoản "error" là chưa đăng nhập, gửi job vào sẽ hỏng
    # ngay (không có ô chat), nên KHÔNG đưa vào vòng xoay tự động.
    def _is_usable(self, a: dict) -> bool:
        if not self._has_credentials(a):
            return False
        st = a.get("status")
        if st == "active":
            return True
        return st == "exhausted" and (self._now() - (a.get("exhausted_at") or 0)) > self.EXHAUST_COOLDOWN

    def allocate_port(self, taken: Iterable[int] = ()) -> int:
        """Cổng CDP chưa gán cho tài khoản nào (và không nằm trong `taken`)."""
        used = {int(a.get("cdp_port") or 0) for a in self.list_raw()} | {int(p) for p in taken}
        for port in range(self.PORT_MIN, self.PORT_MAX + 1):
            if port not in used:
                return port
        raise RuntimeError("Đã hết cổng CDP dành cho tài khoản Muse (tối đa 100 tài khoản).")

    def find_by_viewer(self, viewer_id: str) -> Optional[dict]:
        if not viewer_id:
            return None
        return next((a for a in self.list_raw() if a.get("viewer_id") == viewer_id), None)

    def find_by_partition(self, partition: str) -> Optional[dict]:
        if not partition:
            return None
        key = str(Path(partition).resolve()).lower()
        return next(
            (a for a in self.list_raw() if a.get("partition") and str(Path(a["partition"]).resolve()).lower() == key),
            None,
        )

    def add_account(
        self,
        *,
        viewer_id: str,
        cookies: str,
        ua: str,
        partition: str,
        cdp_port: int,
        label: str = "",
    ) -> dict:
        """Thêm mới, hoặc cập nhật bản ghi có cùng viewer_id / cùng profile."""
        with self._lock:
            data = self._load()
            accounts = self._records(data)
            existing = None
            if viewer_id:
                existing = next((a for a in accounts if a.get("viewer_id") == viewer_id), None)
            if existing is None and partition:
                key = str(Path(partition).resolve()).lower()
                existing = next(
                    (a for a in accounts if a.get("partition") and str(Path(a["partition"]).resolve()).lower() == key),
                    None,
                )
            now = self._now()
            rec = existing or {
                "id": uuid.uuid4().hex[:10],
                "added_at": now,
                "last_used": 0,
            }
            rec.update(
                {
                    "viewer_id": viewer_id or rec.get("viewer_id", ""),
                    "label": label or rec.get("label") or default_label(viewer_id),
                    "cookies": cookies or rec.get("cookies", ""),
                    "ua": ua or rec.get("ua", ""),
                    "partition": partition or rec.get("partition", ""),
                    "cdp_port": int(cdp_port or rec.get("cdp_port") or 0),
                    "status": "active",
                    "message": "",
                    "exhausted_at": 0,
                    "last_checked_at": now,
                }
            )
            if existing is None:
                accounts.append(rec)
            self._save(data)
            return self._public(rec)

    def pick(self, account_id: Optional[str] = None, busy: Iterable[str] = ()) -> Optional[dict]:
        """Chọn tài khoản để chạy job.

        - account_id có giá trị: đúng tài khoản đó (None nếu không tồn tại).
        - không có: tài khoản dùng được, ưu tiên cái đang rảnh, active, ít dùng gần đây.
        Trả None khi không có tài khoản dùng được.
        """
        if account_id:
            return self.get_account(account_id)
        usable = self.usable_accounts()
        if not usable:
            return None
        busy_set = set(busy)
        free = [a for a in usable if a.get("id") not in busy_set]
        return (free or usable)[0]

    def _public(self, a: dict) -> dict:
        return {
            "id": a.get("id"),
            "label": a.get("label") or default_label(a.get("viewer_id", "")),
            "viewerId": a.get("viewer_id", ""),
            "hasSession": self._has_credentials(a),
            "partition": a.get("partition") or "",
            "cdpPort": int(a.get("cdp_port") or 0),
            "status": a.get("status", "active"),
            "message": a.get("message", ""),
            "addedAt": a.get("added_at", 0),
            "lastUsed": a.get("last_used", 0),
            "lastCheckedAt": a.get("last_checked_at", 0),
            "exhaustedAt": a.get("exhausted_at", 0),
        }


def default_label(viewer_id: Any) -> str:
    vid = str(viewer_id or "")
    return f"Muse …{vid[-6:]}" if vid else "Muse"
