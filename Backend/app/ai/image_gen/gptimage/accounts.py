"""Account store + rotation cho ChatGPT (reverse-gpt).

Lưu nhiều account ChatGPT vào Backend/Data/chatgpt_accounts.json.
Cookie hết hạn → 'error' (auto-heal reopen profile ẤM, hoặc login lại);
đụng rate-limit ảnh → 'exhausted' (thử lại sau cooldown).
GptImageClient (adapter.py) đọc store này, lease account để render đa luồng + xoay khi lỗi.

Account record:
  { id, email, cookies, ua, client_version, client_build, oai_is, device_id, partition,
    status, message, added_at, last_used, exhausted_at }
status: active | exhausted | error
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from app.core.config import DATA_DIR


class RotatingAccountStore:
    """Kho có nhiều account dùng luân phiên, mỗi account có thể bị rate-limit / hết hạn cookie."""

    FILENAME: str = "chatgpt_accounts.json"
    ROOT_KEY: str = "accounts"
    EXHAUST_COOLDOWN: float = 3 * 3600  # 3 giờ

    def __init__(self, data_dir: Path | str | None = None):
        base = Path(data_dir) if data_dir else DATA_DIR
        self._path = base / self.FILENAME
        self._lock = threading.Lock()

    def _now(self) -> float:
        return time.time()

    def _load(self) -> dict:
        if not self._path.exists():
            return {self.ROOT_KEY: []}
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get(self.ROOT_KEY), list):
                return data
        except (ValueError, OSError):
            pass
        return {self.ROOT_KEY: []}

    def _save(self, data: dict) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        blob = json.dumps(data, ensure_ascii=False, indent=2)
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(blob)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self._path)

    def _records(self, data: dict) -> list[dict]:
        return data.setdefault(self.ROOT_KEY, [])

    def list_raw(self) -> list[dict]:
        return self._load().get(self.ROOT_KEY, [])

    def list_accounts(self) -> list[dict]:
        return [self._public(a) for a in self.list_raw()]

    def get_account(self, account_id: str) -> Optional[dict]:
        return next((a for a in self.list_raw() if a.get("id") == account_id), None)

    def update_account(self, account_id: str, /, **fields: Any) -> Optional[dict]:
        with self._lock:
            data = self._load()
            for a in self._records(data):
                if a.get("id") != account_id:
                    continue
                for k, v in fields.items():
                    if v is not None:
                        a[k] = v
                if fields.get("status") == "active":
                    a["exhausted_at"] = 0
                    a["message"] = fields.get("message", "")
                self._save(data)
                return self._public(a)
            return None

    def delete_account(self, account_id: str) -> bool:
        with self._lock:
            data = self._load()
            before = len(self._records(data))
            data[self.ROOT_KEY] = [a for a in self._records(data) if a.get("id") != account_id]
            self._save(data)
            return len(data[self.ROOT_KEY]) < before

    def touch(self, account_id: str) -> None:
        with self._lock:
            data = self._load()
            for a in self._records(data):
                if a.get("id") == account_id:
                    a["last_used"] = self._now()
                    break
            self._save(data)

    def set_status(self, account_id: str, status: str, message: str = "") -> None:
        with self._lock:
            data = self._load()
            for a in self._records(data):
                if a.get("id") == account_id:
                    a["status"] = status
                    a["message"] = message
                    if status == "exhausted":
                        a["exhausted_at"] = self._now()
                    elif status == "active":
                        a["exhausted_at"] = 0
                    break
            self._save(data)

    def _has_credentials(self, a: dict) -> bool:
        return bool(a.get("cookies") and a.get("ua"))

    def _is_usable(self, a: dict) -> bool:
        if not self._has_credentials(a):
            return False
        st = a.get("status")
        if st in ("active", "error"):
            return True
        return (st == "exhausted" and (self._now() - (a.get("exhausted_at") or 0)) > self.EXHAUST_COOLDOWN)

    def usable_accounts(self) -> list[dict]:
        usable = [a for a in self.list_raw() if self._is_usable(a)]
        usable.sort(key=lambda a: (a.get("status") != "active", a.get("last_used") or 0))
        return usable

    def has_active(self) -> bool:
        return len(self.usable_accounts()) > 0

    def _public(self, a: dict) -> dict:
        return {
            "id": a.get("id"),
            "email": a.get("email"),
            "hasSession": bool(a.get("cookies") and a.get("ua")),
            "partition": a.get("partition") or "",
            "hasProfile": bool(a.get("partition")),
            "status": a.get("status", "active"),
            "message": a.get("message", ""),
            "addedAt": a.get("added_at", 0),
            "lastUsed": a.get("last_used", 0),
            "exhaustedAt": a.get("exhausted_at", 0),
        }


class ChatgptAccountStore(RotatingAccountStore):
    FILENAME = "chatgpt_accounts.json"
    EXHAUST_COOLDOWN = 3 * 3600  # 3 giờ

    @staticmethod
    def session_of(a: dict) -> dict:
        """Record → dict session GPTPlus dùng (GPT_*)."""
        return {
            "GPT_COOKIES": a.get("cookies") or "",
            "GPT_USER_AGENT": a.get("ua") or "",
            "GPT_CLIENT_VERSION": a.get("client_version") or "",
            "GPT_CLIENT_BUILD": a.get("client_build") or "",
            "GPT_OAI_IS": a.get("oai_is") or "",
            "GPT_DEVICE_ID": a.get("device_id") or "",
            "GPT_MODEL": a.get("model") or "auto",
        }

    def add_account(
        self,
        *,
        email: str = "",
        cookies: str = "",
        ua: str = "",
        client_version: str = "",
        client_build: str = "",
        oai_is: str = "",
        device_id: str = "",
        partition: str = "",
    ) -> dict:
        with self._lock:
            data = self._load()
            accounts = self._records(data)
            key_email = (email or "").strip()
            existing = None
            if key_email:
                existing = next((a for a in accounts if a.get("email") == key_email), None)
            if existing is None and partition:
                existing = next((a for a in accounts if a.get("partition") == partition), None)
            if existing is None and not key_email:
                key_email = f"session_{int(self._now())}"
            rec = existing or {
                "id": uuid.uuid4().hex[:10],
                "email": key_email or f"session_{int(self._now())}",
                "added_at": self._now(),
            }
            rec.update(
                {
                    "cookies": cookies or rec.get("cookies", ""),
                    "ua": ua or rec.get("ua", ""),
                    "client_version": client_version or rec.get("client_version", ""),
                    "client_build": client_build or rec.get("client_build", ""),
                    "oai_is": oai_is if oai_is is not None else rec.get("oai_is", ""),
                    "device_id": device_id or rec.get("device_id", ""),
                    "partition": partition or rec.get("partition", ""),
                    "status": "active",
                    "message": "",
                    "exhausted_at": 0,
                    "last_used": rec.get("last_used", 0),
                }
            )
            if existing is None:
                accounts.append(rec)
            self._save(data)
            return self._public(rec)
