"""Kho tài khoản Gemini (giống tài khoản ChatGPT): nhiều account, mỗi account một profile Chrome riêng.

Lưu ở `DATA_DIR/gemini_accounts.json`: { id, email (nhãn hiển thị), cookies, ua, partition (thư mục profile Chrome ấm),
status active|exhausted|error, message, added_at, last_used, exhausted_at }. Cookie hết hạn → "error" (làm mới bằng profile
ấm hoặc đăng nhập lại); chạm giới hạn tốc độ → "exhausted" (cooldown ngắn). Pool (pool.py) lease + xoay account khi lỗi.

Cookie Gemini cũ (một chuỗi cookie trong config.json, đăng nhập bằng profile `ChromeProfile`) được chuyển một lần thành
account đầu tiên để người dùng đang chạy không phải đăng nhập lại.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from app.ai.image_gen.gptimage.accounts import RotatingAccountStore
from app.core.config import DATA_DIR, settings
from app.core.storage import read_config, write_config

LEGACY_LABEL = "Tài khoản Gemini cũ"
PROFILES_DIRNAME = "gemini-profiles"


def profiles_dir() -> Path:
    return DATA_DIR / PROFILES_DIRNAME


class GeminiAccountStore(RotatingAccountStore):
    FILENAME = "gemini_accounts.json"
    # Gemini web giới hạn theo nhịp/ngày ngắn hơn ChatGPT: thử lại sau 30 phút là đủ.
    EXHAUST_COOLDOWN = 30 * 60

    def add_account(self, *, email: str = "", cookies: str, ua: str, partition: str) -> dict:
        """Thêm account; trùng email (hoặc cùng profile) thì cập nhật cookie của account đó."""
        import time
        import uuid

        with self._lock:
            data = self._load()
            accounts = self._records(data)
            key = (email or "").strip()
            existing = next((a for a in accounts if key and a.get("email") == key), None)
            if existing is None and partition:
                existing = next((a for a in accounts if a.get("partition") == partition), None)
            rec = existing or {"id": uuid.uuid4().hex[:10], "added_at": self._now()}
            rec.update({
                "email": key or rec.get("email") or f"session_{int(time.time())}",
                "cookies": cookies,
                "ua": ua,
                "partition": partition or rec.get("partition", ""),
                "status": "active",
                "message": "",
                "exhausted_at": 0,
                "last_used": rec.get("last_used", 0),
            })
            if existing is None:
                accounts.append(rec)
            self._save(data)
            return self._public(rec)

    def delete_account(self, account_id: str) -> bool:
        """Xóa record; profile do app tạo (gemini-profiles/…) được dọn luôn, profile cũ `ChromeProfile` thì giữ."""
        rec = self.get_account(account_id)
        deleted = super().delete_account(account_id)
        if deleted and rec:
            part = rec.get("partition")
            if part:
                try:
                    p = Path(part).resolve()
                    if p.parent == profiles_dir().resolve():
                        shutil.rmtree(p, ignore_errors=True)
                except OSError:
                    pass
        return deleted


def _migrate_legacy_cookie(store: GeminiAccountStore) -> None:
    """Chưa từng có file account mà config.json còn cookie Gemini cũ → thành account đầu tiên (profile ChromeProfile)."""
    if store._path.exists():
        return
    config = read_config()
    g = config.get("gemini", {})
    cookies = (g.get("cookies") or "").strip()
    if not cookies:
        return
    from app.ai.gemini.template import DEFAULT_UA

    store.add_account(email=LEGACY_LABEL, cookies=cookies, ua=g.get("user_agent") or DEFAULT_UA,
                      partition=str(settings.chrome_profile_dir))
    g["cookies"] = ""
    g["cookie_count"] = 0
    g["legacy_migrated"] = True
    config["gemini"] = g
    write_config(config)


def get_store() -> GeminiAccountStore:
    store = GeminiAccountStore(DATA_DIR)
    _migrate_legacy_cookie(store)
    return store
