"""Façade của Campaign engine: thao tác chiến dịch/bước/artifact/cổng + runner. Router chỉ gọi lớp này."""
from __future__ import annotations

import json
import mimetypes
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import graph
from .engine import Engine
from .fingerprint import canonical, sha
from .models import ALL_TABLES, Artifact, Campaign, CampaignStep, CastLibraryItem, Gate, Run
from .prompts import PromptLibrary
from .runner import AlreadyRunning, Runner
from .store import ArtifactStore

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class CampaignError(ValueError):
    """Lỗi nghiệp vụ có thông điệp tiếng Việt hiển thị được cho người dùng."""


class CampaignService:
    def __init__(self, session_factory: Callable[[], Session], root: Path, engine_bind: Any = None,
                 executors: dict[str, Any] | None = None):
        self._factory = session_factory
        self.store = ArtifactStore(root)
        self.prompts = PromptLibrary(session_factory)
        self.engine = Engine(self.store, self.prompts)
        self.runner = Runner(self.engine, session_factory, executors)
        self._bind = engine_bind

    # ── hạ tầng ──────────────────────────────────────────────────────────────
    def ensure_tables(self) -> None:
        if self._bind is not None:
            from app.db import Base
            Base.metadata.create_all(bind=self._bind, tables=ALL_TABLES)

    @contextmanager
    def session(self) -> Iterator[Session]:
        s = self._factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    def _campaign(self, s: Session, cid: str) -> Campaign:
        c = s.get(Campaign, cid)
        if c is None:
            raise LookupError(f"Không tìm thấy chiến dịch: {cid}")
        return c

    @staticmethod
    def _step(step_key: str) -> graph.StepDef:
        try:
            return graph.get_step(step_key)
        except KeyError as exc:
            raise CampaignError(str(exc)) from None

    def _check_element(self, s: Session, cid: str, sd: graph.StepDef, element_key: str) -> None:
        if not element_key:
            return
        if not sd.map_from:
            raise CampaignError(f"Bước '{sd.key}' không phải bước theo danh sách nên không có phần tử.")
        keys = self.engine.elements(s, cid, sd)
        if keys is None or element_key not in keys:
            raise CampaignError(f"Phần tử '{element_key}' không có trong danh sách của bước '{sd.key}'.")

    # ── chiến dịch ───────────────────────────────────────────────────────────
    @staticmethod
    def _campaign_dict(c: Campaign) -> dict[str, Any]:
        return {"id": c.id, "name": c.name, "niche": c.niche, "platform": c.platform, "credit_cap": c.credit_cap,
                "created_at": c.created_at.isoformat(), "updated_at": c.updated_at.isoformat()}

    def create_campaign(self, name: str, niche: str = "fashion", platform: str = "tiktok",
                        credit_cap: int | None = None) -> dict[str, Any]:
        if not name.strip():
            raise CampaignError("Tên chiến dịch không được để trống.")
        if credit_cap is not None and credit_cap < 0:
            raise CampaignError("Trần credit không được âm.")
        with self.session() as s:
            c = Campaign(name=name.strip(), niche=niche, platform=platform, credit_cap=credit_cap)
            s.add(c)
            s.flush()
            return self._campaign_dict(c)

    def list_campaigns(self) -> list[dict[str, Any]]:
        with self.session() as s:
            rows = s.scalars(select(Campaign).order_by(Campaign.updated_at.desc())).all()
            return [self._campaign_dict(c) for c in rows]

    def update_campaign(self, cid: str, **fields: Any) -> dict[str, Any]:
        with self.session() as s:
            c = self._campaign(s, cid)
            for k in ("name", "niche", "platform", "credit_cap"):
                if k in fields and (fields[k] is not None or k == "credit_cap"):
                    setattr(c, k, fields[k])
            s.flush()
            return self._campaign_dict(c)

    def delete_campaign(self, cid: str) -> None:
        if self.runner.active_exec(cid):
            raise CampaignError("Chiến dịch đang chạy; hãy hủy trước khi xóa.")
        with self.session() as s:
            self._campaign(s, cid)
            for model in (CampaignStep, Artifact, Run, Gate):
                s.execute(delete(model).where(model.campaign_id == cid))
            s.execute(delete(Campaign).where(Campaign.id == cid))
        self.store.delete_campaign_files(cid)

    def state(self, cid: str, tier: str = "draft") -> dict[str, Any]:
        with self.session() as s:
            self._campaign(s, cid)
            # Hỏi "đang chạy không" TRƯỚC khi đọc DB: nếu lượt chạy kết thúc giữa chừng thì ảnh chụp chỉ dư ("đang chạy")
            # chứ không mâu thuẫn (exec=None nhưng run vẫn running) làm giao diện dừng polling khi chưa cập nhật.
            active_exec = self.runner.active_exec(cid)
            progress = self.runner.progress_for(cid)
            out = self.engine.campaign_state(s, cid, tier)
            out["active_exec"] = active_exec
            for block in out["blocks"]:
                for step in block["steps"]:
                    for el in step["elements"]:
                        el["progress"] = progress.get((step["key"], el["element_key"])) if el.get("active_run") else None
            return out

    # ── tham số / đầu vào ────────────────────────────────────────────────────
    def set_params(self, cid: str, step_key: str, params: dict[str, Any], element_key: str = "") -> dict[str, Any]:
        """Gộp nông vào tham số hiện có; giá trị None = xóa khóa. Sửa tham số KHÔNG xóa artifact nào."""
        sd = self._step(step_key)
        with self.session() as s:
            self._campaign(s, cid)
            self._check_element(s, cid, sd, element_key)
            row = self.store.step_row(s, cid, step_key, element_key, create=True)
            cur = json.loads(row.params_json or "{}")
            for k, v in params.items():
                if v is None:
                    cur.pop(k, None)
                else:
                    cur[k] = v
            row.params_json = json.dumps(cur, ensure_ascii=False)
            return cur

    def upload_image(self, cid: str, filename: str, data: bytes) -> dict[str, Any]:
        ext = Path(filename or "").suffix.lower()
        if ext not in IMAGE_EXT:
            raise CampaignError("Chỉ nhận ảnh png/jpg/jpeg/webp.")
        if not data:
            raise CampaignError("File rỗng.")
        if len(data) > MAX_UPLOAD_BYTES:
            raise CampaignError("Ảnh vượt 20MB.")
        safe = re.sub(r"[^\w.\- ]", "_", Path(filename).name)[:120]
        with self.session() as s:
            self._campaign(s, cid)
            art = self.store.add_artifact(s, campaign_id=cid, kind="image", data=data, ext=ext,
                                          meta={"filename": safe, "size": len(data), "source": "upload"})
            return self._artifact_dict(art)

    def set_input_files(self, cid: str, step_key: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        """items = [{"artifact_id":..., "role":...}] theo THỨ TỰ (thứ tự là một phần của đầu vào)."""
        sd = self._step(step_key)
        if sd.kind != "input_files":
            raise CampaignError(f"Bước '{step_key}' không nhận file đầu vào.")
        if not items:
            raise CampaignError("Cần ít nhất một ảnh.")
        with self.session() as s:
            self._campaign(s, cid)
            members, hashes = [], []
            for it in items:
                art = s.get(Artifact, it.get("artifact_id") or "")
                if art is None or art.campaign_id != cid or art.kind != "image":
                    raise CampaignError(f"Ảnh không hợp lệ: {it.get('artifact_id')}")
                members.append({"artifact_id": art.id, "role": it.get("role", "")})
                hashes.append([art.content_hash, it.get("role", "")])
            # Nội dung bundle chỉ phụ thuộc hash ảnh + vai trò + thứ tự, nên cùng bộ ảnh -> cùng vân tay.
            bundle = self.store.add_json(s, campaign_id=cid, kind="bundle", content={"members": hashes},
                                         meta={"members": members, "step": step_key},
                                         step_key=step_key, content_hash=sha(canonical(hashes)))
            self.store.select(s, cid, step_key, "", bundle.id)
            return self._artifact_dict(bundle)

    # ── thư viện nhân vật ────────────────────────────────────────────────────
    @staticmethod
    def _cast_dict(c: CastLibraryItem) -> dict[str, Any]:
        return {"id": c.id, "name": c.name, "filename": c.filename, "content_hash": c.content_hash,
                "created_at": c.created_at.isoformat()}

    def cast_library_list(self) -> list[dict[str, Any]]:
        with self.session() as s:
            rows = s.scalars(select(CastLibraryItem).order_by(CastLibraryItem.created_at.desc())).all()
            return [self._cast_dict(c) for c in rows]

    def cast_library_add(self, cid: str, artifact_id: str, name: str) -> dict[str, Any]:
        """Lưu một ảnh nhân vật của chiến dịch vào thư viện (sao chép file, không phụ thuộc chiến dịch)."""
        if not name.strip():
            raise CampaignError("Tên nhân vật không được để trống.")
        with self.session() as s:
            self._campaign(s, cid)
            art = s.get(Artifact, artifact_id)
            if art is None or art.campaign_id != cid or art.kind != "image":
                raise CampaignError("Ảnh không hợp lệ.")
            src = self.store.abs_path(art)
            if not src.is_file():
                raise CampaignError("File ảnh không còn trên đĩa.")
            rel = Path("cast_library") / f"{art.content_hash}{src.suffix.lower()}"
            dest = self.store.root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists():
                dest.write_bytes(src.read_bytes())
            item = CastLibraryItem(name=name.strip(), filename=str(ArtifactStore.meta(art).get("filename") or src.name),
                                   path=rel.as_posix(), content_hash=art.content_hash)
            s.add(item)
            s.flush()
            return self._cast_dict(item)

    def cast_library_delete(self, library_id: str) -> None:
        with self.session() as s:
            item = s.get(CastLibraryItem, library_id)
            if item is None:
                raise LookupError("Không tìm thấy nhân vật trong thư viện.")
            still_used = s.scalars(select(CastLibraryItem.id).where(
                CastLibraryItem.content_hash == item.content_hash, CastLibraryItem.id != item.id)).first()
            path = self.store.root / item.path
            s.delete(item)
        if not still_used:
            path.unlink(missing_ok=True)

    def cast_library_file(self, library_id: str) -> tuple[Path, str]:
        with self.session() as s:
            item = s.get(CastLibraryItem, library_id)
            path = self.store.root / item.path if item else None
            if path is None or not path.is_file():
                raise LookupError("Không tìm thấy ảnh nhân vật.")
            return path, mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    def cast_library_use(self, cid: str, library_id: str) -> dict[str, Any]:
        """Dùng nhân vật trong thư viện cho chiến dịch: nhập ảnh vào bước `cast` (vai trò identity)."""
        with self.session() as s:
            self._campaign(s, cid)
            item = s.get(CastLibraryItem, library_id)
            if item is None:
                raise LookupError("Không tìm thấy nhân vật trong thư viện.")
            path = self.store.root / item.path
            if not path.is_file():
                raise CampaignError("File ảnh nhân vật đã mất.")
            name, data = item.filename, path.read_bytes()
        art = self.upload_image(cid, name or path.name, data)
        return self.set_input_files(cid, "cast", [{"artifact_id": art["id"], "role": "identity"}])

    # ── artifact ─────────────────────────────────────────────────────────────
    def _artifact_dict(self, a: Artifact) -> dict[str, Any]:
        return {"id": a.id, "kind": a.kind, "content_hash": a.content_hash, "step_key": a.step_key,
                "element_key": a.element_key, "fingerprint": a.fingerprint, "meta": ArtifactStore.meta(a),
                "parent_ids": json.loads(a.parent_ids_json or "[]"), "created_at": a.created_at.isoformat()}

    def list_artifacts(self, cid: str, step_key: str | None = None, element_key: str | None = None) -> list[dict[str, Any]]:
        with self.session() as s:
            self._campaign(s, cid)
            q = select(Artifact).where(Artifact.campaign_id == cid)
            if step_key:
                q = q.where(Artifact.step_key == step_key)
            if element_key is not None:
                q = q.where(Artifact.element_key == element_key)
            return [self._artifact_dict(a) for a in s.scalars(q.order_by(Artifact.created_at.desc())).all()]

    def artifact_file(self, artifact_id: str) -> tuple[Path, str]:
        with self.session() as s:
            a = s.get(Artifact, artifact_id)
            if a is None:
                raise LookupError("Không tìm thấy artifact.")
            path = self.store.abs_path(a)
            if not path.is_file():
                raise LookupError("File artifact không còn trên đĩa.")
            return path, mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    def select_artifact(self, cid: str, step_key: str, artifact_id: str, element_key: str = "") -> None:
        sd = self._step(step_key)
        with self.session() as s:
            self._campaign(s, cid)
            self._check_element(s, cid, sd, element_key)
            a = s.get(Artifact, artifact_id)
            if a is None or a.campaign_id != cid or a.step_key != step_key or a.element_key != (element_key or ""):
                raise CampaignError("Artifact không thuộc bước/phần tử này.")
            self.store.select(s, cid, step_key, element_key, a.id)

    def edit_artifact(self, cid: str, step_key: str, content: Any, element_key: str = "") -> dict[str, Any]:
        """Người dùng sửa tay kết quả JSON (vd. mô tả shot 2): tạo artifact MỚI, bản cũ giữ nguyên.

        Artifact mới ghi vân tay của đầu vào hiện tại, nên coi như "mới" so với đầu vào lúc sửa; upstream đổi sau đó
        mới làm nó "cũ".
        """
        sd = self._step(step_key)
        if sd.kind != "compute" or sd.output != "json":
            raise CampaignError(f"Bước '{step_key}' không phải kết quả JSON sửa tay được.")
        with self.session() as s:
            self._campaign(s, cid)
            self._check_element(s, cid, sd, element_key)
            from .executors import NORMALIZERS
            parts, blockers, refs = self.engine.current_parts(s, cid, sd, element_key, "draft")
            if blockers:
                raise CampaignError("Chưa đủ đầu vào để sửa tay: " + "; ".join(f"{b['dep']}: {b['reason']}" for b in blockers))
            if sd.key in NORMALIZERS:
                if not isinstance(content, dict):
                    raise CampaignError("Nội dung phải là một đối tượng JSON.")
                content = NORMALIZERS[sd.key](content, refs, self.engine.get_params(s, cid, sd.key, element_key))
            from .fingerprint import make_fingerprint
            prev = self.store.selected(s, cid, step_key, element_key)
            art = self.store.add_json(s, campaign_id=cid, kind="json", content=content,
                                      meta={"manual": True}, step_key=step_key, element_key=element_key,
                                      fingerprint=make_fingerprint(parts), parts=parts,
                                      parent_ids=[prev.id] if prev else [])
            self.store.select(s, cid, step_key, element_key, art.id)
            return self._artifact_dict(art)

    def set_pin(self, cid: str, step_key: str, pinned: bool, element_key: str = "") -> None:
        sd = self._step(step_key)
        with self.session() as s:
            self._campaign(s, cid)
            self._check_element(s, cid, sd, element_key)
            self.store.step_row(s, cid, step_key, element_key, create=True).pinned = pinned

    def reroll(self, cid: str, step_key: str, element_key: str = "") -> int:
        """Muốn kết quả khác với cùng đầu vào (vd. tạo lại ảnh): tăng _nonce -> vân tay mới -> artifact mới."""
        sd = self._step(step_key)
        with self.session() as s:
            self._campaign(s, cid)
            self._check_element(s, cid, sd, element_key)
            row = self.store.step_row(s, cid, step_key, element_key, create=True)
            cur = json.loads(row.params_json or "{}")
            cur["_nonce"] = int(cur.get("_nonce") or 0) + 1
            row.params_json = json.dumps(cur, ensure_ascii=False)
            return cur["_nonce"]

    # ── cổng duyệt ───────────────────────────────────────────────────────────
    def decide_gate(self, cid: str, step_key: str, decision: str, element_key: str = "",
                    artifact_id: str | None = None, note: str = "") -> dict[str, Any]:
        sd = self._step(step_key)
        if not sd.gate:
            raise CampaignError(f"Bước '{step_key}' không có cổng duyệt.")
        if decision not in ("approved", "rejected"):
            raise CampaignError("decision phải là approved hoặc rejected.")
        with self.session() as s:
            self._campaign(s, cid)
            self._check_element(s, cid, sd, element_key)
            if artifact_id:  # duyệt/từ chối một ứng viên cụ thể => đồng thời chọn nó
                a = s.get(Artifact, artifact_id)
                if a is None or a.campaign_id != cid or a.step_key != step_key or a.element_key != (element_key or ""):
                    raise CampaignError("Artifact không thuộc bước/phần tử này.")
                self.store.select(s, cid, step_key, element_key, a.id)
            selected = self.store.selected(s, cid, step_key, element_key)
            if selected is None:
                raise CampaignError("Chưa có kết quả để duyệt.")
            g = self.engine._gate_row(s, cid, step_key, element_key)
            if g is None:
                g = Gate(campaign_id=cid, step_key=step_key, element_key=element_key or "")
                s.add(g)
            g.artifact_id, g.state, g.note = selected.id, decision, note
            s.flush()
            return {"step_key": step_key, "element_key": element_key, "artifact_id": g.artifact_id,
                    "state": g.state, "note": g.note}

    # ── xem trước prompt ─────────────────────────────────────────────────────
    def preview_prompt(self, cid: str, step_key: str, element_key: str = "", tier: str = "draft") -> dict[str, Any]:
        """Prompt cuối cùng + thứ tự ảnh tham chiếu đúng như lúc chạy (dùng chung hàm dựng với executor)."""
        sd = self._step(step_key)
        from .executors import PREVIEWERS
        build = PREVIEWERS.get(step_key)
        if build is None:
            raise CampaignError(f"Bước '{step_key}' chưa có prompt để xem trước.")
        with self.session() as s:
            self._campaign(s, cid)
            self._check_element(s, cid, sd, element_key)
            params = self.engine.get_params(s, cid, step_key, element_key)
            _, blockers, refs = self.engine.current_parts(s, cid, sd, element_key, tier)
            if blockers:
                raise CampaignError("Chưa đủ đầu vào: " + "; ".join(f"{b['dep']}: {b['reason']}" for b in blockers))
            gate = self.engine._gate_row(s, cid, step_key, element_key)
            note = gate.note if gate is not None and gate.state == "rejected" else ""
            return build(self.prompts, {**params, "_tier": tier}, refs, note)

    # ── gợi ý điền form ──────────────────────────────────────────────────────
    def suggest_params(self, cid: str, step_key: str) -> dict[str, Any]:
        """Gemini đọc ảnh áo + hồ sơ áo (+ format đã chọn) và gợi ý giá trị cho form Brief / Các cảnh & phong cách. Không lưu gì."""
        from .executors import suggest
        if step_key not in suggest.SPECS:
            raise CampaignError(f"Bước '{step_key}' chưa có gợi ý tự động.")
        with self.session() as s:
            self._campaign(s, cid)
            bundle = self.store.selected(s, cid, "garment_source")
            paths: list[str] = []
            for m in (ArtifactStore.meta(bundle).get("members", []) if bundle else []):
                art = s.get(Artifact, m.get("artifact_id"))
                if art is not None and self.store.abs_path(art).is_file():
                    paths.append(str(self.store.abs_path(art)))
            if not paths:
                raise CampaignError("Chưa có ảnh sản phẩm để Gemini xem. Hãy tải ảnh áo ở khối 1 trước.")
            fs = self.store.selected(s, cid, "fact_sheet")
            garment = self.store.load_json(fs) if fs is not None else {}
            brief = self.engine.get_params(s, cid, "brief")
            fmt = self.engine.get_params(s, cid, "format")
            existing = {k: v for k, v in self.engine.get_params(s, cid, step_key).items() if v not in (None, "", [])}
            if step_key == "scene_set":
                existing.update({k: v for k, v in self.engine.get_params(s, cid, "style").items() if v not in (None, "")})
        out = suggest.suggest(self.prompts, step_key, garment=garment, brief=brief, existing=existing, image_paths=paths, format_params=fmt)
        out["used_fact_sheet"] = bool(garment)
        return out

    @staticmethod
    def list_formats() -> list[dict[str, Any]]:
        from . import formats
        return formats.list_formats()

    # ── kế hoạch / chạy ──────────────────────────────────────────────────────
    def _check_elements(self, cid: str, target: str | None, elements: list[str] | None) -> None:
        if elements is None:
            return
        if not target:
            raise CampaignError("Chọn phần tử cần có bước đích.")
        sd = self._step(target)
        with self.session() as s:
            for e in elements:
                self._check_element(s, cid, sd, e)

    def plan(self, cid: str, target: str | None = None, tier: str = "draft", only_approved: bool | None = None,
             elements: list[str] | None = None) -> dict[str, Any]:
        if target:
            self._step(target)
        with self.session() as s:
            self._campaign(s, cid)
        self._check_elements(cid, target, elements)
        with self.session() as s:
            return self.engine.plan(s, cid, target, tier, only_approved, elements).to_dict()

    def run(self, cid: str, target: str | None = None, tier: str = "draft", only_approved: bool | None = None,
            confirm_credit: bool = False, elements: list[str] | None = None) -> dict[str, Any]:
        if target:
            self._step(target)
        with self.session() as s:
            self._campaign(s, cid)
        self._check_elements(cid, target, elements)
        exec_id, plan = self.runner.execute(cid, target, tier, only_approved, confirm_credit, elements)
        return {"exec_id": exec_id, "plan": plan.to_dict()}

    def list_runs(self, cid: str, limit: int = 50) -> list[dict[str, Any]]:
        with self.session() as s:
            self._campaign(s, cid)
            rows = s.scalars(select(Run).where(Run.campaign_id == cid).order_by(Run.created_at.desc()).limit(limit)).all()
            return [{"id": r.id, "step_key": r.step_key, "element_key": r.element_key, "state": r.state,
                     "attempt": r.attempt, "credit_est": r.credit_est, "credit_actual": r.credit_actual,
                     "external_ref": r.external_ref, "error": r.error, "artifact_id": r.artifact_id,
                     "created_at": r.created_at.isoformat(),
                     "finished_at": r.finished_at.isoformat() if r.finished_at else None} for r in rows]

    def resolve_run(self, run_id: str, outcome: str) -> None:
        self.runner.resolve_run(run_id, outcome)


# ── singleton cho router ──────────────────────────────────────────────────────
_service: CampaignService | None = None


def get_service() -> CampaignService:
    global _service
    if _service is None:
        from app.core.config import DATA_DIR
        from app.db import SessionLocal, engine
        from .executors import register_all
        register_all()
        _service = CampaignService(SessionLocal, DATA_DIR / "campaigns", engine_bind=engine)
        _service.ensure_tables()
        _service.runner.recover()
    return _service


def set_service(service: CampaignService | None) -> None:
    global _service
    _service = service
