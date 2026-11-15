"""Muse Canvas (Canvas AI → tab "Muse Canvas"): cấu hình + đồ thị canvas.

Giai đoạn này mới có cấu hình và nơi lưu canvas; các node sẽ thêm sau. Khi chạy, node sẽ
gọi Muse qua `app/ai/muse` (HTTP/Noise, nhiều tài khoản) — không dùng trình duyệt.

- Cấu hình: config.json, khóa `muse_canvas` (nhỏ, sửa thường xuyên).
- Đồ thị:   DATA_DIR/muse_canvas.json  {nodes, edges, viewport, updated_at} (có thể lớn).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.core.config import DATA_DIR
from app.core.storage import read_config, write_config

CONFIG_KEY = "muse_canvas"
GRAPH_FILE = DATA_DIR / "muse_canvas.json"

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
}
PROMPT_OVERRIDE_DIR = DATA_DIR / "muse_prompts"
MAX_PROMPT_CHARS = 20000

# Thời lượng Muse đã kiểm chứng ra video đúng (5 s và 10 s, 2026-11-15).
DURATIONS = (5, 10)
MIN_TIMEOUT = 600
MAX_PARALLEL = 4
MAX_GRAPH_BYTES = 5 * 1024 * 1024


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

    @field_validator("duration_seconds")
    @classmethod
    def _duration(cls, v: int) -> int:
        return v if v in DURATIONS else DURATIONS[0]

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
    if not GRAPH_FILE.exists():
        return MuseCanvasGraph()
    try:
        return MuseCanvasGraph(**json.loads(GRAPH_FILE.read_text(encoding="utf-8")))
    except Exception:
        return MuseCanvasGraph()


def save_graph(graph: MuseCanvasGraph) -> MuseCanvasGraph:
    graph.updated_at = time.time()
    blob = json.dumps(graph.model_dump(mode="json"), ensure_ascii=False)
    if len(blob.encode("utf-8")) > MAX_GRAPH_BYTES:
        raise ValueError("Canvas quá lớn (> 5 MB). Đừng nhúng ảnh/video base64 vào node — lưu đường dẫn file.")
    GRAPH_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = GRAPH_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(blob)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, GRAPH_FILE)
    return graph


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
