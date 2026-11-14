"""Engine: tính vân tay, trạng thái (fresh/stale/missing/blocked/pinned + gate) và kế hoạch chạy (dry-run).

Quy tắc cốt lõi (docs/PLAN §3.3–3.4):
  * "Cũ" được TÍNH (vân tay hiện tại != vân tay của artifact đang chọn), không lưu cờ.
  * Đổi đầu vào không xóa gì: artifact cũ vẫn còn, chỉ con trỏ "đang chọn" đổi khi chạy lại.
  * Bước gate: bước sau chỉ dùng artifact ĐÃ DUYỆT, nên upstream đổi chỉ làm cổng "cần duyệt lại".
  * Bước map: một phần tử/ mỗi item của artifact JSON nguồn; sửa shot 2 chỉ làm "cũ" phần tử shot:2.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import graph
from .fingerprint import canonical, diff_parts, make_fingerprint, sha
from .graph import StepDef
from .models import Artifact, Campaign, CampaignStep, Gate, Run
from .prompts import PromptLibrary
from .store import ArtifactStore

ACTIVE_RUN_STATES = ("queued", "running")


@dataclass
class StepState:
    step_key: str
    element_key: str
    state: str                      # blocked | missing | fresh | stale | pinned
    reasons: list[str] = field(default_factory=list)
    blockers: list[dict[str, str]] = field(default_factory=list)
    selected_artifact_id: str | None = None
    fingerprint: str | None = None
    cached_artifact_id: str | None = None
    pinned: bool = False
    stale: bool = False
    gate: str | None = None         # None | approved | need_approval | rejected
    active_run: str | None = None
    last_run: dict[str, Any] | None = None
    params: dict[str, Any] = field(default_factory=dict)     # tham số RIÊNG của phần tử (vd. bỏ qua kiểm cặp khung của một shot)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PlanItem:
    step_key: str
    element_key: str
    action: str   # run | cached | fresh | pinned | approval | waiting | blocked | skip_not_approved | input_missing
    reason: str = ""
    fingerprint: str | None = None
    lane: str = "local"
    credit: int | None = 0
    credit_estimate: int | None = None
    images: int = 0
    llm_calls: int = 0
    estimate: bool = False          # True = cận trên (phụ thuộc bước trước sẽ chạy lại)
    blockers: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Plan:
    items: list[PlanItem]
    total_credit: int = 0
    unknown_cost_items: int = 0
    estimated_credit: int = 0
    images: int = 0
    llm_calls: int = 0
    credit_cap: int | None = None
    spent_credit: int = 0
    over_budget: bool = False
    needs_confirm: bool = False
    runnable: int = 0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d


class Engine:
    def __init__(self, store: ArtifactStore, prompts: PromptLibrary):
        self.store = store
        self.prompts = prompts

    # ── truy cập dữ liệu ─────────────────────────────────────────────────────
    def get_params(self, s: Session, cid: str, step_key: str, element_key: str = "") -> dict[str, Any]:
        base_row = self.store.step_row(s, cid, step_key, "")
        params = json.loads(base_row.params_json) if base_row else {}
        if element_key:
            row = self.store.step_row(s, cid, step_key, element_key)
            if row:
                params = {**params, **json.loads(row.params_json or "{}")}
        return params

    def _selected(self, s: Session, cid: str, step_key: str, element_key: str = "") -> Artifact | None:
        return self.store.selected(s, cid, step_key, element_key)

    def _gate_row(self, s: Session, cid: str, step_key: str, element_key: str = "") -> Gate | None:
        return s.scalars(select(Gate).where(Gate.campaign_id == cid, Gate.step_key == step_key,
                                            Gate.element_key == (element_key or ""))).first()

    def items_of(self, s: Session, cid: str, sd: StepDef) -> dict[str, dict[str, Any]] | None:
        """Phần tử của bước map: {element_key: item}. None nếu artifact nguồn chưa có."""
        if not sd.map_from:
            return {"": {}}
        return self.map_items(s, cid, sd.map_from)

    def map_items(self, s: Session, cid: str, source_key: str) -> dict[str, dict[str, Any]] | None:
        """Phần tử của một bước NGUỒN: artifact JSON {"items":[...]} của bước compute, hoặc params["items"] của bước input_params
        (vd. danh sách cảnh người dùng nhập). None = nguồn chưa có."""
        src = graph.get_step(source_key)
        if src.kind == "input_params":
            raw = self.get_params(s, cid, source_key).get("items")
        else:
            art = self._selected(s, cid, source_key)
            if art is None:
                return None
            data = self.store.load_json(art)
            raw = data.get("items") if isinstance(data, dict) else None
        if not isinstance(raw, list):
            return {}
        prefix = "scene" if src.kind == "input_params" else "item"
        out: dict[str, dict[str, Any]] = {}
        for i, item in enumerate(raw):
            item = item if isinstance(item, dict) else {"value": item}
            out[str(item.get("key") or f"{prefix}:{i + 1}")] = item
        return out

    def dep_targets(self, s: Session, cid: str, sd: StepDef, element_key: str) -> dict[str, str | None]:
        """{dep: phần tử đích} cho các dep khai báo `dep_element` (None = phần tử hiện tại không ghi trường đó)."""
        if not sd.dep_element or not element_key:
            return {}
        items = self.items_of(s, cid, sd) or {}
        item = items.get(element_key) or {}
        return {dep: (str(item.get(field)) if item.get(field) not in (None, "") else None) for dep, field in sd.dep_element}

    def elements(self, s: Session, cid: str, sd: StepDef) -> list[str] | None:
        items = self.items_of(s, cid, sd)
        return None if items is None else list(items)

    def _resolve_dep(self, s: Session, cid: str, dd: StepDef, element_key: str) -> tuple[Artifact | None, str]:
        """Artifact mà bước sau được phép dùng. Bước gate -> chỉ bản đã duyệt."""
        if dd.gate:
            g = self._gate_row(s, cid, dd.key, element_key)
            if g is None or g.state != "approved" or not g.artifact_id:
                return None, "chưa duyệt"
            art = s.get(Artifact, g.artifact_id)
            return (art, "") if art else (None, "artifact đã duyệt không còn")
        art = self._selected(s, cid, dd.key, element_key)
        return (art, "") if art else (None, "chưa có kết quả")

    def awaiting_approval(self, s: Session, cid: str, sd: StepDef, element_key: str) -> list[str]:
        """Các bước gate phía trên đang có kết quả MỚI chưa duyệt. Bước sau KHÔNG chạy cho tới khi duyệt, để không tốn
        công (hoặc credit) dựng trên bản đã duyệt cũ rồi phải làm lại."""
        out: list[str] = []
        for dep in sd.deps:
            dd = graph.get_step(dep)
            if not dd.gate:
                continue
            targets = self.dep_targets(s, cid, sd, element_key)
            if dd.map_from and dep in targets:
                elems = [targets[dep]] if targets[dep] else []
            elif dd.map_from:
                elems = [element_key] if (sd.map_from == dd.map_from and element_key) else (self.elements(s, cid, dd) or [])
            else:
                elems = [""]
            for e in elems:
                selected = self._selected(s, cid, dep, e)
                if selected is None:
                    continue
                g = self._gate_row(s, cid, dep, e)
                if g is None or g.state != "approved" or g.artifact_id != selected.id:
                    out.append(dep)
                    break
        return out

    # ── vân tay hiện tại ────────────────────────────────────────────────────
    def current_parts(self, s: Session, cid: str, sd: StepDef, element_key: str, tier: str
                      ) -> tuple[dict[str, Any], list[dict[str, str]], dict[str, list[dict[str, Any]]]]:
        """Trả (parts, blockers, refs). refs[dep] = danh sách đầu vào thật để đưa cho executor."""
        params = self.get_params(s, cid, sd.key, element_key)
        blockers: list[dict[str, str]] = []
        refs: dict[str, list[dict[str, Any]]] = {}
        inputs: dict[str, str] = {}

        def block(dep: str, why: str) -> None:
            blockers.append({"dep": dep, "reason": why})

        def ref(art: Artifact, element: str = "") -> dict[str, Any]:
            return {"artifact_id": art.id, "element_key": element, "content_hash": art.content_hash,
                    "kind": art.kind, "path": str(self.store.abs_path(art)), "meta": ArtifactStore.meta(art)}

        targets = self.dep_targets(s, cid, sd, element_key)
        for dep in sd.deps:
            dd = graph.get_step(dep)
            if dep in targets:
                # Bước map dùng ĐÚNG MỘT phần tử của bước map/danh sách khác (vd. clip -> khung chốt của cảnh mà shot dùng).
                target = targets[dep]
                if not target:
                    block(dep, f"phần tử chưa ghi trường '{sd.dep_elements[dep]}'")
                    continue
                if dd.kind == "input_params":
                    scene_items = self.map_items(s, cid, dep) or {}
                    if target not in scene_items:
                        block(dep, f"không có phần tử '{target}' trong danh sách")
                        continue
                    inputs[f"{dep}[{target}]"] = sha(canonical(scene_items[target]))
                    refs[dep] = [{"item": scene_items[target], "element_key": target}]
                else:
                    art, why = self._resolve_dep(s, cid, dd, target)
                    if art is None:
                        block(dep, f"{target}: {why}")
                        continue
                    inputs[f"{dep}[{target}]"] = art.content_hash
                    refs[dep] = self._expand(s, art, lambda a, _e=target: ref(a, _e))
            elif sd.map_from and dep == sd.map_from:
                items = self.items_of(s, cid, sd)
                if items is None or element_key not in items:
                    block(dep, "chưa có phần tử trong danh sách")
                    continue
                item = items[element_key]
                hashed = item if sd.item_fields is None else {k: item.get(k) for k in sd.item_fields}
                inputs[f"{dep}[{element_key}]"] = sha(canonical(hashed))
                refs[dep] = [{"item": item, "element_key": element_key}]
            elif dd.kind == "input_params":
                inputs[dep] = sha(canonical(self.get_params(s, cid, dep)))
                refs[dep] = [{"params": self.get_params(s, cid, dep)}]
            elif dd.map_from:
                if sd.map_from == dd.map_from and element_key:
                    art, why = self._resolve_dep(s, cid, dd, element_key)
                    if art is None:
                        block(dep, why)
                        continue
                    inputs[f"{dep}[{element_key}]"] = art.content_hash
                    refs[dep] = self._expand(s, art, lambda a, _e=element_key: ref(a, _e))
                else:  # gom toàn bộ phần tử của bước map
                    keys = self.elements(s, cid, dd)
                    if keys is None:
                        block(dep, "chưa có danh sách phần tử")
                        continue
                    pairs: list[tuple[str, str]] = []
                    collected: list[dict[str, Any]] = []
                    ok = True
                    for k in keys:
                        art, why = self._resolve_dep(s, cid, dd, k)
                        if art is None:
                            block(dep, f"{k}: {why}")
                            ok = False
                            continue
                        pairs.append((k, art.content_hash))
                        collected.append(ref(art, k))
                    if ok and not keys:
                        block(dep, "danh sách phần tử trống")
                        ok = False
                    if ok:
                        inputs[dep] = sha(canonical(sorted(pairs)))
                        refs[dep] = collected
            else:
                art, why = self._resolve_dep(s, cid, dd, "")
                if art is None:
                    block(dep, why)
                    continue
                inputs[dep] = art.content_hash
                refs[dep] = self._expand(s, art, ref)

        parts: dict[str, Any] = {
            "step": sd.key,
            "logic": sd.logic,
            "params": {k: params[k] for k in sd.param_keys if k in params and k != "prompt"},
            "tier": tier if sd.uses_tier else None,
            "inputs": inputs,
        }
        if "_nonce" in params:
            parts["params"]["_nonce"] = params["_nonce"]
        if "prompt" in sd.param_keys:
            pref = params.get("prompt") or ({"template_id": sd.default_template} if sd.default_template else None)
            if pref and pref.get("template_id"):
                t = self.prompts.resolve(pref["template_id"], pref.get("version"))
                if t is None:
                    block("prompt", "mẫu prompt không tồn tại")
                else:
                    parts["prompt"] = {"id": t.template_id, "version": t.version, "hash": t.body_hash,
                                       "changes": str(pref.get("changes") or "").strip()}
        return parts, blockers, refs

    def _expand(self, s: Session, art: Artifact, ref: Any) -> list[dict[str, Any]]:
        """Bundle (nhiều ảnh theo thứ tự + vai trò) -> danh sách đầu vào thật; artifact khác -> chính nó."""
        if art.kind != "bundle":
            return [ref(art)]
        out: list[dict[str, Any]] = []
        for m in ArtifactStore.meta(art).get("members", []):
            member = s.get(Artifact, m.get("artifact_id"))
            if member is not None:
                r = ref(member)
                r["role"] = m.get("role", "")
                out.append(r)
        return out

    # ── trạng thái ───────────────────────────────────────────────────────────
    def state_of(self, s: Session, cid: str, sd: StepDef, element_key: str, tier: str) -> StepState:
        row = self.store.step_row(s, cid, sd.key, element_key)
        pinned = bool(row and row.pinned)
        selected = self._selected(s, cid, sd.key, element_key)
        st = StepState(sd.key, element_key, "fresh", pinned=pinned,
                       selected_artifact_id=selected.id if selected else None)
        st.active_run, st.last_run = self._run_info(s, cid, sd.key, element_key)
        if element_key:
            row_params = self.store.step_row(s, cid, sd.key, element_key)
            st.params = json.loads(row_params.params_json or "{}") if row_params else {}

        if sd.kind == "input_params":
            return st
        if sd.kind == "input_files":
            if selected is None:
                st.state = "missing"
            return st

        parts, blockers, _ = self.current_parts(s, cid, sd, element_key, tier)
        st.blockers = blockers
        if blockers:
            st.state = "blocked"
            if pinned and selected:
                st.state = "pinned"
            self._apply_gate(s, cid, sd, element_key, selected, st)
            return st

        fp = make_fingerprint(parts)
        st.fingerprint = fp
        if selected is None:
            st.state = "missing"
        elif selected.fingerprint == fp:
            st.state = "fresh"
        else:
            st.state = "stale"
            st.stale = True
            st.reasons = diff_parts(ArtifactStore.parts(selected), parts)
        if st.state in ("missing", "stale"):
            cached = self.store.find_by_fingerprint(s, cid, fp)
            if cached is not None and (selected is None or cached.id != selected.id):
                st.cached_artifact_id = cached.id
            # Lần chạy trước không rõ kết quả (có thể đã gửi tốn tiền) -> chặn, không bao giờ tự gửi lại.
            unknown = s.scalars(select(Run.id).where(Run.campaign_id == cid, Run.step_key == sd.key,
                                                    Run.element_key == element_key, Run.fingerprint == fp,
                                                    Run.state == "unknown")).first()
            if unknown and not st.cached_artifact_id:
                st.blockers.append({"dep": "run", "reason": "lần chạy trước chưa rõ kết quả (có thể đã gửi); "
                                                           "kiểm tra rồi xác nhận trước khi chạy lại"})
                st.state = "blocked"
        if pinned and selected:
            st.state = "pinned"
        self._apply_gate(s, cid, sd, element_key, selected, st)
        return st

    def _apply_gate(self, s: Session, cid: str, sd: StepDef, element_key: str, selected: Artifact | None,
                    st: StepState) -> None:
        if not sd.gate or selected is None:
            return
        g = self._gate_row(s, cid, sd.key, element_key)
        if g is not None and g.artifact_id == selected.id and g.state in ("approved", "rejected"):
            st.gate = g.state
        else:
            st.gate = "need_approval"

    def _run_info(self, s: Session, cid: str, step_key: str, element_key: str) -> tuple[str | None, dict[str, Any] | None]:
        runs = s.scalars(select(Run).where(Run.campaign_id == cid, Run.step_key == step_key,
                                           Run.element_key == element_key).order_by(Run.created_at.desc()).limit(5)).all()
        active = next((r.id for r in runs if r.state in ACTIVE_RUN_STATES), None)
        last = None
        if runs:
            r = runs[0]
            last = {"id": r.id, "state": r.state, "error": r.error, "attempt": r.attempt,
                    "credit_actual": r.credit_actual, "external_ref": r.external_ref}
        return active, last

    def campaign_state(self, s: Session, cid: str, tier: str = "draft") -> dict[str, Any]:
        campaign = s.get(Campaign, cid)
        blocks: list[dict[str, Any]] = []
        for number, title in graph.BLOCKS.items():
            steps = []
            for sd in (x for x in graph.STEPS if x.block == number):
                elems = self.elements(s, cid, sd) if sd.map_from else [""]
                if elems is None:
                    states = [StepState(sd.key, "", "blocked", blockers=[{"dep": sd.map_from or "", "reason": "chưa có danh sách phần tử"}])]
                else:
                    states = [self.state_of(s, cid, sd, e, tier) for e in elems]
                steps.append({"key": sd.key, "title": sd.title, "kind": sd.kind, "lane": sd.lane, "paid": sd.paid,
                              "gate": sd.gate, "advisory": sd.advisory, "map": bool(sd.map_from),
                              "params": self.get_params(s, cid, sd.key),
                              "elements": [x.to_dict() for x in states]})
            blocks.append({"block": number, "title": title, "state": self._block_state(steps), "steps": steps})
        return {
            "campaign": {"id": campaign.id, "name": campaign.name, "niche": campaign.niche,
                         "platform": campaign.platform, "credit_cap": campaign.credit_cap} if campaign else None,
            "tier": tier, "spent_credit": self.spent_credit(s, cid), "blocks": blocks,
        }

    @staticmethod
    def _block_state(steps: list[dict[str, Any]]) -> str:
        elements = [e for st in steps for e in st["elements"]]
        if any(e["active_run"] for e in elements):
            return "running"
        for wanted in ("blocked", "missing", "stale"):
            if any(e["state"] == wanted for e in elements):
                return wanted
        if any(e["gate"] == "need_approval" for e in elements):
            return "need_approval"
        return "fresh"

    def spent_credit(self, s: Session, cid: str) -> int:
        total = 0
        for r in s.scalars(select(Run).where(Run.campaign_id == cid, Run.state.in_(("done", "unknown")))).all():
            total += int(r.credit_actual if r.credit_actual is not None else (r.credit_est or 0))
        return total

    # ── kế hoạch (dry-run) ──────────────────────────────────────────────────
    def plan(self, s: Session, cid: str, target: str | None = None, tier: str = "draft",
             only_approved: bool | None = None, elements: list[str] | None = None) -> Plan:
        if tier not in graph.TIERS:
            raise ValueError(f"tier phải là một trong {graph.TIERS}")
        # 360p/720p chỉ là độ phân giải user chọn, không phải "nháp rồi chốt": mặc định không bắt duyệt bản 360p trước.
        # Vẫn có thể truyền only_approved=True để chỉ chạy lại các clip đã duyệt.
        only_approved = bool(only_approved)
        if target:
            graph.get_step(target)
        needed = graph.needed_for(target)
        # (step_key, element_key) -> "run" | "approval": trạng thái sau khi kế hoạch được thực hiện
        pending: dict[tuple[str, str], str] = {}
        items: list[PlanItem] = []

        for sd in graph.STEPS:
            if sd.key not in needed:
                continue
            if sd.kind != "compute":
                st = self.state_of(s, cid, sd, "", tier)
                if st.state == "missing":
                    items.append(PlanItem(sd.key, "", "input_missing", "chưa có dữ liệu đầu vào", lane=sd.lane))
                continue

            elems = self.elements(s, cid, sd) if sd.map_from else [""]
            if elems is not None and elements is not None and sd.key == target:
                elems = [e for e in elems if e in elements]       # chỉ chạy các phần tử được chọn của bước đích
            step_items: list[PlanItem] = []
            if elems is None:
                if self._pending_for(pending, sd, sd.map_from or "", ""):
                    expected = int(self.get_params(s, cid, sd.key).get("expected_elements") or self._expected_elements(s, cid, sd))
                    it = self._item(sd, "*", "run", "danh sách phần tử sẽ có sau khi bước trước chạy", s, cid, tier, None, estimate=True)
                    self._scale(it, expected)
                    step_items.append(it)
                else:
                    step_items.append(PlanItem(sd.key, "", "blocked", "chưa có danh sách phần tử", lane=sd.lane,
                                               blockers=[{"dep": sd.map_from or "", "reason": "chưa có danh sách phần tử"}]))
            else:
                for e in elems:
                    step_items.append(self._plan_element(s, cid, sd, e, tier, only_approved, pending))
            items.extend(step_items)

            for it in step_items:
                if it.action in ("run", "cached"):
                    pending[(sd.key, it.element_key)] = "approval" if sd.gate else "run"
                elif it.action == "approval":
                    pending[(sd.key, it.element_key)] = "approval"

        total_credit = sum(int(it.credit or 0) for it in items if it.action == "run")
        unknown = sum(1 for it in items if it.action == "run" and it.credit is None)
        estimated = sum(int(it.credit if it.credit is not None else (it.credit_estimate or 0)) for it in items if it.action == "run")
        campaign = s.get(Campaign, cid)
        cap = campaign.credit_cap if campaign else None
        spent = self.spent_credit(s, cid)
        runnable = sum(1 for it in items if it.action in ("run", "cached"))
        return Plan(
            items=items, total_credit=total_credit, unknown_cost_items=unknown, estimated_credit=estimated,
            images=sum(it.images for it in items if it.action == "run"),
            llm_calls=sum(it.llm_calls for it in items if it.action == "run"),
            credit_cap=cap, spent_credit=spent,
            over_budget=cap is not None and spent + estimated > cap,
            needs_confirm=total_credit > 0 or unknown > 0, runnable=runnable,
        )

    def _plan_element(self, s: Session, cid: str, sd: StepDef, e: str, tier: str, only_approved: bool,
                      pending: dict[tuple[str, str], str]) -> PlanItem:
        st = self.state_of(s, cid, sd, e, tier)
        if st.state == "pinned":
            return self._item(sd, e, "pinned", "đã ghim", s, cid, tier, st)
        if only_approved and sd.uses_tier and sd.gate and tier == "final":
            g = self._gate_row(s, cid, sd.key, e)
            if g is None or g.state != "approved":
                return self._item(sd, e, "skip_not_approved", "chưa duyệt bản nháp nên không chạy final", s, cid, tier, st)

        mapped = {k: v for k, v in self.dep_targets(s, cid, sd, e).items() if v}
        if st.blockers:
            unresolved = [b for b in st.blockers if self._pending_for(pending, sd, b["dep"], e, mapped) is None]
            if unresolved:
                return self._item(sd, e, "blocked", "; ".join(f"{b['dep']}: {b['reason']}" for b in unresolved),
                                  s, cid, tier, st)
            if any(self._pending_for(pending, sd, b["dep"], e, mapped) == "approval" for b in st.blockers):
                return self._item(sd, e, "waiting", "chờ duyệt bước trước", s, cid, tier, st)
            return self._item(sd, e, "run", "chạy sau bước trước", s, cid, tier, st, estimate=True)

        dep_runs = [d for d in sd.deps if self._pending_for(pending, sd, d, e, mapped) == "run"]
        if st.state in ("missing", "stale"):
            waiting = self.awaiting_approval(s, cid, sd, e) or [
                d for d in sd.deps if self._pending_for(pending, sd, d, e, mapped) == "approval"]
            if waiting:
                return self._item(sd, e, "waiting", "chờ duyệt: " + ", ".join(waiting), s, cid, tier, st)
            if st.cached_artifact_id and not dep_runs:
                return self._item(sd, e, "cached", "đã có kết quả cùng vân tay", s, cid, tier, st)
            return self._item(sd, e, "run", ("chưa có kết quả" if st.state == "missing" else "đầu vào đổi: " + ", ".join(st.reasons)),
                              s, cid, tier, st, estimate=bool(dep_runs))
        if dep_runs:
            return self._item(sd, e, "run", "đầu vào sẽ chạy lại (cận trên)", s, cid, tier, st, estimate=True)
        if sd.gate and st.gate == "need_approval":
            return self._item(sd, e, "approval", "cần duyệt", s, cid, tier, st)
        return self._item(sd, e, "fresh", "", s, cid, tier, st)

    @staticmethod
    def _pending_for(pending: dict[tuple[str, str], str], sd: StepDef, dep: str, element_key: str,
                     mapped: dict[str, str] | None = None) -> str | None:
        """Bước `dep` có đang chờ chạy/duyệt trong kế hoạch không, xét đúng phần tử mà `sd` phụ thuộc."""
        dd = graph.STEP_BY_KEY.get(dep)
        if dd is None:                                  # blocker không phải bước (prompt, run...)
            return None
        if mapped and dep in mapped:
            return pending.get((dep, mapped[dep]))      # phụ thuộc đúng một phần tử của danh sách khác (dep_element)
        if dd.map_from and sd.map_from == dd.map_from and element_key:
            return pending.get((dep, element_key))      # phụ thuộc theo từng phần tử
        values = [v for (k, _), v in pending.items() if k == dep]
        if "approval" in values:
            return "approval"
        return "run" if "run" in values else None

    def _item(self, sd: StepDef, e: str, action: str, reason: str, s: Session, cid: str, tier: str,
              st: StepState | None, estimate: bool = False) -> PlanItem:
        it = PlanItem(sd.key, e, action, reason, fingerprint=st.fingerprint if st else None, lane=sd.lane,
                      estimate=estimate, blockers=list(st.blockers) if st else [])
        if action == "run":
            params = self.get_params(s, cid, sd.key, e if e != "*" else "")
            cost_params = dict(params)
            if sd.map_from and e not in ("", "*"):      # thời lượng lấy từ chính shot (trừ khi người dùng ghi đè)
                shot = (self.items_of(s, cid, sd) or {}).get(e) or {}
                cost_params.setdefault("duration", shot.get("duration"))
            it.credit = (sd.cost(cost_params, tier) if sd.cost else 0) if sd.paid else 0
            it.credit_estimate = sd.cost_estimate(cost_params, tier) if sd.paid and sd.cost_estimate else it.credit
            if sd.lane == "chatgpt-image":
                it.images = sd.images_fixed or int(params.get("count") or 1)
            if sd.lane == "llm":
                it.llm_calls = 1
        else:
            it.credit = 0
        return it

    def _expected_elements(self, s: Session, cid: str, sd: StepDef) -> int:
        """Số phần tử dự kiến của bước map khi nguồn chưa chạy: số shot của format đã chọn, không thì 3."""
        if sd.map_from == "script":
            try:
                from .formats import resolve
                return len(resolve(self.get_params(s, cid, "format"))["shots"])
            except Exception:  # noqa: BLE001
                return 3
        return 3

    @staticmethod
    def _scale(it: PlanItem, n: int) -> None:
        if it.credit is not None:
            it.credit *= n
        if it.credit_estimate is not None:
            it.credit_estimate *= n
        it.images *= n
        it.llm_calls *= n
