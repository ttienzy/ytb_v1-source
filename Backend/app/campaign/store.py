"""Kho artifact bất biến: file theo nội dung + dòng DB. Không commit; người gọi quản lý transaction."""
from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .fingerprint import sha
from .models import Artifact, CampaignStep


class ArtifactStore:
    def __init__(self, root: Path):
        self.root = Path(root)

    # ── file ─────────────────────────────────────────────────────────────────
    def campaign_dir(self, campaign_id: str) -> Path:
        return self.root / campaign_id

    def abs_path(self, art: Artifact) -> Path:
        return self.root / art.path

    def _write_file(self, campaign_id: str, content_hash: str, ext: str, data: bytes) -> str:
        ext = ext.lstrip(".").lower() or "bin"
        rel = Path(campaign_id) / "artifacts" / content_hash[:2] / f"{content_hash}.{ext}"
        full = self.root / rel
        if not full.exists():  # cùng nội dung -> dùng lại file, không ghi đè
            full.parent.mkdir(parents=True, exist_ok=True)
            # Tên tạm riêng cho mỗi lần ghi: hai việc chạy song song có thể sinh ra cùng nội dung (cùng hash)
            tmp = full.with_name(f"{full.name}.{uuid.uuid4().hex[:8]}.part")
            tmp.write_bytes(data)
            try:
                tmp.replace(full)
            except OSError:
                if not full.exists():
                    raise
                tmp.unlink(missing_ok=True)  # nơi khác vừa đặt đúng file này (cùng nội dung) -> bỏ bản tạm
        return rel.as_posix()

    # ── artifact ─────────────────────────────────────────────────────────────
    def add_artifact(
        self,
        s: Session,
        *,
        campaign_id: str,
        kind: str,
        data: bytes,
        ext: str,
        meta: dict[str, Any] | None = None,
        step_key: str | None = None,
        element_key: str = "",
        fingerprint: str | None = None,
        parts: dict[str, Any] | None = None,
        parent_ids: list[str] | None = None,
        content_hash: str | None = None,
    ) -> Artifact:
        chash = content_hash or sha(data)
        rel = self._write_file(campaign_id, chash, ext, data)
        art = Artifact(
            campaign_id=campaign_id,
            kind=kind,
            content_hash=chash,
            path=rel,
            meta_json=json.dumps(meta or {}, ensure_ascii=False),
            step_key=step_key,
            element_key=element_key or "",
            fingerprint=fingerprint,
            parts_json=json.dumps(parts or {}, ensure_ascii=False, sort_keys=True),
            parent_ids_json=json.dumps(parent_ids or []),
        )
        s.add(art)
        s.flush()
        return art

    def add_json(self, s: Session, *, content: Any, **kw: Any) -> Artifact:
        data = json.dumps(content, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8")
        return self.add_artifact(s, data=data, ext="json", **kw)

    def load_json(self, art: Artifact) -> Any:
        return json.loads(self.abs_path(art).read_text(encoding="utf-8"))

    @staticmethod
    def meta(art: Artifact) -> dict[str, Any]:
        return json.loads(art.meta_json or "{}")

    @staticmethod
    def parts(art: Artifact) -> dict[str, Any]:
        return json.loads(art.parts_json or "{}")

    def find_by_fingerprint(self, s: Session, campaign_id: str, fingerprint: str) -> Artifact | None:
        return s.scalars(
            select(Artifact)
            .where(Artifact.campaign_id == campaign_id, Artifact.fingerprint == fingerprint)
            .order_by(Artifact.created_at.desc())
        ).first()

    # ── con trỏ "đang chọn" ──────────────────────────────────────────────────
    def step_row(self, s: Session, campaign_id: str, step_key: str, element_key: str = "", create: bool = False) -> CampaignStep | None:
        row = s.scalars(
            select(CampaignStep).where(
                CampaignStep.campaign_id == campaign_id,
                CampaignStep.step_key == step_key,
                CampaignStep.element_key == (element_key or ""),
            )
        ).first()
        if row is None and create:
            row = CampaignStep(campaign_id=campaign_id, step_key=step_key, element_key=element_key or "", params_json="{}")
            s.add(row)
            s.flush()
        return row

    def select(self, s: Session, campaign_id: str, step_key: str, element_key: str, artifact_id: str | None) -> None:
        row = self.step_row(s, campaign_id, step_key, element_key, create=True)
        row.selected_artifact_id = artifact_id
        s.flush()

    def selected(self, s: Session, campaign_id: str, step_key: str, element_key: str = "") -> Artifact | None:
        row = self.step_row(s, campaign_id, step_key, element_key)
        if row is None or not row.selected_artifact_id:
            return None
        return s.get(Artifact, row.selected_artifact_id)

    def delete_campaign_files(self, campaign_id: str) -> None:
        shutil.rmtree(self.campaign_dir(campaign_id), ignore_errors=True)
