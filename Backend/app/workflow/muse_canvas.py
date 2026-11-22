"""Muse Canvas (Canvas AI → tab "Muse Canvas"): cấu hình dùng chung + prompt mặc định của node.

- Cấu hình: config.json, khóa `muse_canvas` (nhỏ, sửa thường xuyên). Các trường Flow / tiền tố file ở đây chỉ là
  giá trị gốc cho project mới — project nào cũng có cài đặt riêng (`muse_projects.MuseProjectSettings`).
- Đồ thị:   mỗi project 1 file, xem `app/workflow/muse_projects.py`. `get_graph` / `save_graph` ở đây làm việc với
  project đang mở (giữ cho bản frontend cũ). GRAPH_FILE (DATA_DIR/muse_canvas.json) là bản trước khi có project,
  chỉ còn được đọc 1 lần để chuyển thành project "Canvas mặc định".
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.core.config import DATA_DIR
from app.core.storage import read_config, write_config

CONFIG_KEY = "muse_canvas"
GRAPH_FILE = DATA_DIR / "muse_canvas.json"  # chỉ còn là nguồn chuyển dữ liệu cũ (xem muse_projects.ensure_store)

# Prompt mặc định của các node: bản gốc đóng kèm app (Backend/prompts/workflow/…),
# bản người dùng "Lưu làm mặc định" nằm ở DATA_DIR/muse_prompts/ (ghi được cả khi app đã đóng gói).
PROMPT_FILES = {
    "outfit_extract": "muse_outfit_extract_prompt.txt",  # node "Tách áo quần"
    "character_sheet": "muse_character_sheet_prompt.txt",  # node "Bảng thiết kế nhân vật"
    # node "Bảng thiết kế nhân vật" khi gạt sang GPT: tự gọi tên ảnh 1 (nhân vật) / ảnh 2 (trang phục), không ghép prompt kết hợp
    "character_sheet_gpt": "muse_character_sheet_gpt_prompt.txt",
    # ghép thêm khi dòng của bảng nhân vật có ảnh trang phục nối vào (cổng "Trang phục")
    "character_outfit": "muse_character_outfit_prompt.txt",
    "video_script": "muse_video_script_prompt.txt",  # node "Kịch bản video" (Muse trả lời chữ)
    "clip_script": "gpt_clip_script_prompt.txt",  # node "Kịch bản tạo video" (ChatGPT: mỗi tham chiếu 1 clip, có mối nối)
    # node "Nhân vật trong bối cảnh": ảnh 1 = nhân vật (bảng thiết kế / ảnh nhân vật), ảnh 2 = Tham chiếu bối cảnh
    "scene_place": "muse_scene_place_prompt.txt",
    # node "Ingredients (video + ảnh)": Omni 1.2 video_edit — video tham chiếu + 1–3 ảnh tham chiếu theo thứ tự
    "video_ingredients": "muse_video_ingredients_prompt.txt",
}
PROMPT_OVERRIDE_DIR = DATA_DIR / "muse_prompts"
MAX_PROMPT_CHARS = 20000

# Thời lượng Muse đã kiểm chứng ra video đúng (5 s và 10 s, 2026-11-15).
DURATIONS = (5, 10)
MIN_TIMEOUT = 600
MAX_PARALLEL = 4
MAX_GRAPH_BYTES = 5 * 1024 * 1024
# Omni 1.2 trên Flow: Ingredients 3–15 giây, chỉnh video cắt 3–15 giây (Frames chỉ 6/10, text→video chỉ 10)
FLOW_MIN_SECONDS = 3
FLOW_MAX_SECONDS = 15
FLOW_MAX_VARIANTS = 4


class MuseCanvasConfig(BaseModel):
    """Cấu hình dùng chung cho mọi node của Muse Canvas."""

    # Tài khoản
    account_mode: Literal["auto", "fixed"] = Field(default="auto", description="auto = xoay vòng tài khoản sẵn sàng")
    account_id: str = Field(default="", description="Tài khoản cố định khi account_mode = fixed")

    # Hội thoại trên Muse
    chat_mode: Literal["new_per_run", "continue", "main"] = Field(
        default="new_per_run",
        description="new_per_run = mỗi lần chạy một chat phụ mới; continue = nối tiếp chat của lần chạy trước; main = chat chính",
    )
    chat_title_prefix: str = Field(default="Muse Canvas", max_length=60)

    # Đầu ra
    output_kind: Literal["video", "image"] = "video"
    aspect_ratio: Literal["9:16", "16:9", "1:1"] = "9:16"
    duration_seconds: int = Field(default=5, description="Chỉ dùng cho video: 5 hoặc 10")
    audio_mode: Literal["auto", "silent", "voiceover"] = "auto"
    language: Literal["vi", "en"] = Field(default="vi", description="Ngôn ngữ lời thoại / chữ trong video")

    # Prompt
    style_preset: str = Field(default="none", max_length=40)
    prompt_prefix: str = Field(default="", max_length=1000)
    prompt_suffix: str = Field(default="", max_length=1000)
    avoid: str = Field(default="", max_length=1000, description="Những thứ cần tránh")

    # Chạy
    timeout_seconds: int = Field(default=MIN_TIMEOUT)
    max_parallel: int = Field(default=1, description="Số job Muse chạy song song (giới hạn bởi số tài khoản)")
    file_prefix: str = Field(default="muse_canvas", max_length=40)

    # Google Flow (Omni 1.2) cho nút "Tạo video" của node Clip. Project gắn với 1 tài khoản Google: đổi tài khoản Flow
    # (hết credit) thì project cũ không mở được -> chọn / tạo project của tài khoản đang dùng.
    flow_project_id: str = Field(default="", max_length=64, description="VeoProject.id dùng cho node Clip")
    flow_aspect: Literal["9:16", "16:9"] = "9:16"
    flow_resolution: Literal["720p", "360p"] = "720p"
    # Thời lượng (giây) cho video Flow: 0 = Tự động (theo kịch bản / video tham chiếu), 3–15 = cố định
    flow_seconds: int = Field(default=0, description="0 = Tự động; 3–15 giây")
    # Số biến thể mỗi lần bấm Tạo video (node Ingredients): 1–4, mỗi biến thể 1 job Flow riêng
    flow_variants: int = Field(default=1, description="1–4 biến thể")

    @field_validator("duration_seconds")
    @classmethod
    def _duration(cls, v: int) -> int:
        return v if v in DURATIONS else DURATIONS[0]

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

    @field_validator("timeout_seconds")
    @classmethod
    def _timeout(cls, v: int) -> int:
        return max(int(v or 0), MIN_TIMEOUT)

    @field_validator("max_parallel")
    @classmethod
    def _parallel(cls, v: int) -> int:
        return max(1, min(MAX_PARALLEL, int(v or 1)))

    @field_validator("file_prefix")
    @classmethod
    def _file_prefix(cls, v: str) -> str:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (v or "").strip())
        return safe or "muse_canvas"

    @field_validator("chat_title_prefix", "style_preset", "prompt_prefix", "prompt_suffix", "avoid", "account_id", "flow_project_id")
    @classmethod
    def _strip(cls, v: str) -> str:
        return (v or "").strip()


class MuseCanvasGraph(BaseModel):
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    viewport: Optional[dict[str, float]] = None
    updated_at: float = 0


def get_config() -> MuseCanvasConfig:
    raw = (read_config() or {}).get(CONFIG_KEY) or {}
    try:
        return MuseCanvasConfig(**raw)
    except Exception:
        # bản lưu hỏng / khác phiên bản: giữ những trường hợp lệ
        good = {}
        for k, v in raw.items():
            try:
                MuseCanvasConfig(**{k: v})
                good[k] = v
            except Exception:
                continue
        return MuseCanvasConfig(**good)


def save_config(cfg: MuseCanvasConfig) -> MuseCanvasConfig:
    data = read_config() or {}
    data[CONFIG_KEY] = cfg.model_dump(mode="json")
    write_config(data)
    return cfg


def get_graph() -> MuseCanvasGraph:
    """Đồ thị của project đang mở."""
    from app.workflow import muse_projects

    return muse_projects.get_graph(muse_projects.active_id())


def save_graph(graph: MuseCanvasGraph) -> MuseCanvasGraph:
    """Lưu đồ thị vào project đang mở."""
    from app.workflow import muse_projects

    return muse_projects.save_graph(muse_projects.active_id(), graph)


# ---------------------------------------------------------------- prompt mặc định của node


def _bundled_prompt_path(name: str) -> Optional[Path]:
    fname = PROMPT_FILES.get(name)
    if not fname:
        return None
    candidates = []
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:  # PyInstaller: backend.spec gói Backend/prompts vào <bundle>/prompts
        candidates.append(Path(bundle) / "prompts" / "workflow" / fname)
    candidates.append(Path(__file__).resolve().parents[2] / "prompts" / "workflow" / fname)
    return next((c for c in candidates if c.exists()), None)


def bundled_prompt(name: str) -> str:
    path = _bundled_prompt_path(name)
    if name not in PROMPT_FILES:
        raise KeyError(name)
    if path is None:
        raise FileNotFoundError(f"Thiếu file prompt gốc {PROMPT_FILES[name]}")
    return path.read_text(encoding="utf-8").strip()


def get_prompt(name: str) -> dict[str, Any]:
    """{prompt, is_custom}: bản đã lưu làm mặc định nếu có, không thì bản gốc."""
    if name not in PROMPT_FILES:
        raise KeyError(name)
    override = PROMPT_OVERRIDE_DIR / PROMPT_FILES[name]
    if override.exists():
        text = override.read_text(encoding="utf-8").strip()
        if text:
            return {"name": name, "prompt": text, "is_custom": True}
    return {"name": name, "prompt": bundled_prompt(name), "is_custom": False}


def save_prompt(name: str, text: str) -> dict[str, Any]:
    if name not in PROMPT_FILES:
        raise KeyError(name)
    text = (text or "").strip()
    if not text:
        raise ValueError("Prompt không được để trống.")
    if len(text) > MAX_PROMPT_CHARS:
        raise ValueError(f"Prompt dài quá {MAX_PROMPT_CHARS} ký tự.")
    PROMPT_OVERRIDE_DIR.mkdir(parents=True, exist_ok=True)
    (PROMPT_OVERRIDE_DIR / PROMPT_FILES[name]).write_text(text + "\n", encoding="utf-8")
    return get_prompt(name)


def reset_prompt(name: str) -> dict[str, Any]:
    if name not in PROMPT_FILES:
        raise KeyError(name)
    (PROMPT_OVERRIDE_DIR / PROMPT_FILES[name]).unlink(missing_ok=True)
    return get_prompt(name)
