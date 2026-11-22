"""Muse Canvas: nhiều project (mỗi project 1 đồ thị canvas + vài cài đặt riêng).

Lưu trữ (DATA_DIR/muse_canvas_projects/):
- index.json      {active_id, projects: [MuseProject]}   — danh sách nhỏ, ghi mỗi lần lưu canvas;
- <id>.json       {nodes, edges, viewport, updated_at}  — đồ thị của project (tối đa MAX_GRAPH_BYTES);
- trash/<id>_<thời điểm>.json                            — project đã xóa (không xóa hẳn: đồ thị nhớ đường dẫn
  các ảnh / video đã tốn lượt tạo; file media dùng chung thư mục của app và KHÔNG bị xóa theo project).

Lần đầu chạy bản có project: DATA_DIR/muse_canvas.json cũ thành project "Canvas mặc định" (file cũ đổi tên
thành muse_canvas.json.migrated để còn bản sao). Luôn có ít nhất 1 project.

Cài đặt riêng của project (MuseProjectSettings): project Google Flow, khung hình, chất lượng và tiền tố tên file —
mỗi chiến dịch thường dùng project Flow riêng. Tài khoản Muse / chat / thời gian chờ / song song vẫn dùng chung
(`muse_canvas.MuseCanvasConfig`).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.core.config import DATA_DIR
from app.workflow import muse_canvas
from app.workflow.muse_canvas import FLOW_MAX_SECONDS, FLOW_MAX_VARIANTS, FLOW_MIN_SECONDS, MuseCanvasGraph

PROJECTS_DIR = DATA_DIR / "muse_canvas_projects"
INDEX_NAME = "index.json"
TRASH_NAME = "trash"
DEFAULT_NAME = "Canvas mặc định"
MAX_PROJECTS = 200
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
_LOCK = threading.RLock()


class MuseProjectSettings(BaseModel):
    flow_project_id: str = Field(default="", max_length=64, description="VeoProject.id cho nút Tạo video của node Clip")
    flow_aspect: Literal["9:16", "16:9"] = "9:16"
    flow_resolution: Literal["720p", "360p"] = "720p"
    # 0 = Tự động (theo kịch bản / video tham chiếu); 3–15 = mỗi clip / đoạn video dài đúng chừng ấy giây
    flow_seconds: int = 0
    # 1–4: số biến thể mỗi lần bấm Tạo video (mỗi biến thể là một job Flow riêng, tốn credit riêng)
    flow_variants: int = 1
    file_prefix: str = Field(default="muse_canvas", max_length=40)

    @field_validator("flow_project_id")
    @classmethod
    def _strip(cls, v: str) -> str:
        return (v or "").strip()

    @field_validator("file_prefix")
    @classmethod
    def _file_prefix(cls, v: str) -> str:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (v or "").strip())
        return safe or "muse_canvas"

    @field_validator("flow_seconds", mode="before")
    @classmethod
    def _flow_seconds(cls, v) -> int:
        """0 = Tự động; còn lại 3–15 giây (Omni 1.2 Ingredients / chỉnh video). Giá trị lạ -> Tự động."""
        try:
            n = int(round(float(v or 0)))
        except (TypeError, ValueError):
            return 0
        return n if FLOW_MIN_SECONDS <= n <= FLOW_MAX_SECONDS else 0


    @field_validator("flow_variants", mode="before")
    @classmethod
    def _flow_variants(cls, v) -> int:
        """Số biến thể mỗi lần bấm Tạo video: 1–4 (mỗi biến thể là một job Flow riêng, tốn credit riêng). Lạ -> 1."""
        try:
            n = int(round(float(v or 1)))
        except (TypeError, ValueError):
            return 1
        return n if 1 <= n <= FLOW_MAX_VARIANTS else 1


class MuseProject(BaseModel):
    id: str
    name: str = Field(..., min_length=1, max_length=80)
    created_at: float = 0
    updated_at: float = 0
    node_count: int = 0
    edge_count: int = 0
    settings: MuseProjectSettings = Field(default_factory=MuseProjectSettings)


class MuseProjectIndex(BaseModel):
    active_id: str = ""
    projects: list[MuseProject] = Field(default_factory=list)


def _clean_name(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    name = " ".join(v.split())
    if not name:
        raise ValueError("Tên project không được để trống.")
    return name[:80]


class MuseProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    #  Đồ thị ban đầu (nhân bản / làm mẫu: frontend tự chuẩn bị); bỏ trống = canvas trống
    graph: Optional[MuseCanvasGraph] = None
    #  Bỏ trống = lấy cài đặt của project đang mở (thường cùng project Flow)
    settings: Optional[MuseProjectSettings] = None
    activate: bool = True

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_name(v)


class MuseProjectPatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    settings: Optional[MuseProjectSettings] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:
        return _clean_name(v)


# ---------------------------------------------------------------- file


def _index_path() -> Path:
    return PROJECTS_DIR / INDEX_NAME


def _graph_path(pid: str) -> Path:
    if not _ID_RE.match(pid or ""):
        raise KeyError(pid)
    return PROJECTS_DIR / f"{pid}.json"


def _write_atomic(path: Path, blob: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(blob)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _graph_blob(graph: MuseCanvasGraph) -> str:
    blob = json.dumps(graph.model_dump(mode="json"), ensure_ascii=False)
    if len(blob.encode("utf-8")) > muse_canvas.MAX_GRAPH_BYTES:
        raise ValueError("Canvas quá lớn (> 5 MB). Đừng nhúng ảnh/video base64 vào node — lưu đường dẫn file.")
    return blob


def _save_index(idx: MuseProjectIndex) -> None:
    _write_atomic(_index_path(), json.dumps(idx.model_dump(mode="json"), ensure_ascii=False, indent=1))


def _read_index() -> Optional[MuseProjectIndex]:
    p = _index_path()
    if not p.exists():
        return None
    try:
        return MuseProjectIndex(**json.loads(p.read_text(encoding="utf-8")))
    except Exception:
        return None


def _new_id() -> str:
    return f"p-{int(time.time() * 1000):x}-{uuid.uuid4().hex[:4]}"


def _settings_from_config() -> MuseProjectSettings:
    c = muse_canvas.get_config()
    return MuseProjectSettings(flow_project_id=c.flow_project_id, flow_aspect=c.flow_aspect,
                               flow_resolution=c.flow_resolution, flow_seconds=c.flow_seconds,
                               flow_variants=c.flow_variants, file_prefix=c.file_prefix)


def _read_legacy_graph() -> Optional[MuseCanvasGraph]:
    legacy = muse_canvas.GRAPH_FILE
    if not legacy.exists():
        return None
    try:
        return MuseCanvasGraph(**json.loads(legacy.read_text(encoding="utf-8")))
    except Exception:
        return None


def _fresh_project(name: str, graph: MuseCanvasGraph, settings: MuseProjectSettings) -> MuseProject:
    now = time.time()
    pid = _new_id()
    graph.updated_at = now
    _write_atomic(_graph_path(pid), _graph_blob(graph))
    return MuseProject(id=pid, name=name, created_at=now, updated_at=now, node_count=len(graph.nodes),
                       edge_count=len(graph.edges), settings=settings)


def ensure_store() -> MuseProjectIndex:
    """Index hợp lệ, có ít nhất 1 project và active_id trỏ vào project có thật (chuyển dữ liệu cũ nếu cần)."""
    with _LOCK:
        idx = _read_index()
        if idx is None:
            idx = MuseProjectIndex()
            legacy = _read_legacy_graph()
            if legacy is not None:
                proj = _fresh_project(DEFAULT_NAME, legacy, _settings_from_config())
                idx.projects.append(proj)
                idx.active_id = proj.id
                _save_index(idx)
                try:
                    os.replace(muse_canvas.GRAPH_FILE, muse_canvas.GRAPH_FILE.with_suffix(".json.migrated"))
                except OSError:
                    pass  # để lại file cũ cũng không sao: index đã có, lần sau không chuyển lại
                return idx
        changed = False
        if not idx.projects:
            proj = _fresh_project(DEFAULT_NAME, MuseCanvasGraph(), _settings_from_config())
            idx.projects.append(proj)
            changed = True
        if not any(p.id == idx.active_id for p in idx.projects):
            idx.active_id = max(idx.projects, key=lambda p: p.updated_at).id
            changed = True
        if changed:
            _save_index(idx)
        return idx


def _find(idx: MuseProjectIndex, pid: str) -> MuseProject:
    for p in idx.projects:
        if p.id == pid:
            return p
    raise KeyError(pid)


# ---------------------------------------------------------------- thao tác


def list_projects() -> MuseProjectIndex:
    return ensure_store()


def get_project(pid: str) -> MuseProject:
    return _find(ensure_store(), pid)


def create_project(req: MuseProjectCreate) -> MuseProject:
    with _LOCK:
        idx = ensure_store()
        if len(idx.projects) >= MAX_PROJECTS:
            raise ValueError(f"Đã có {MAX_PROJECTS} project — xóa bớt project cũ trước.")
        settings = req.settings
        if settings is None:
            active = next((p for p in idx.projects if p.id == idx.active_id), None)
            settings = active.settings.model_copy() if active else _settings_from_config()
        graph = req.graph.model_copy(deep=True) if req.graph else MuseCanvasGraph()
        proj = _fresh_project(req.name, graph, settings)
        idx.projects.append(proj)
        if req.activate:
            idx.active_id = proj.id
        _save_index(idx)
        return proj


def update_project(pid: str, patch: MuseProjectPatch) -> MuseProject:
    with _LOCK:
        idx = ensure_store()
        proj = _find(idx, pid)
        if patch.name is not None:
            proj.name = patch.name
        if patch.settings is not None:
            proj.settings = patch.settings
        _save_index(idx)
        return proj


def delete_project(pid: str) -> MuseProjectIndex:
    """Bỏ project vào thùng rác (DATA_DIR/muse_canvas_projects/trash). Không xóa project cuối cùng."""
    with _LOCK:
        idx = ensure_store()
        _find(idx, pid)
        if len(idx.projects) <= 1:
            raise ValueError("Không xóa được project cuối cùng — tạo project khác trước.")
        src = _graph_path(pid)
        if src.exists():
            trash = PROJECTS_DIR / TRASH_NAME
            trash.mkdir(parents=True, exist_ok=True)
            os.replace(src, trash / f"{pid}_{int(time.time())}.json")
        idx.projects = [p for p in idx.projects if p.id != pid]
        if idx.active_id == pid:
            idx.active_id = max(idx.projects, key=lambda p: p.updated_at).id
        _save_index(idx)
        return idx


def open_project(pid: str) -> MuseProjectIndex:
    """Đánh dấu project đang mở (mở lại app sẽ vào project này)."""
    with _LOCK:
        idx = ensure_store()
        _find(idx, pid)
        if idx.active_id != pid:
            idx.active_id = pid
            _save_index(idx)
        return idx


def get_graph(pid: str) -> MuseCanvasGraph:
    with _LOCK:
        _find(ensure_store(), pid)
        path = _graph_path(pid)
    if not path.exists():
        return MuseCanvasGraph()
    try:
        return MuseCanvasGraph(**json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return MuseCanvasGraph()


def save_graph(pid: str, graph: MuseCanvasGraph) -> MuseCanvasGraph:
    with _LOCK:
        idx = ensure_store()
        proj = _find(idx, pid)
        graph.updated_at = time.time()
        _write_atomic(_graph_path(pid), _graph_blob(graph))
        proj.updated_at = graph.updated_at
        proj.node_count = len(graph.nodes)
        proj.edge_count = len(graph.edges)
        _save_index(idx)
        return graph


def active_id() -> str:
    return ensure_store().active_id
