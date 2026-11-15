"""Muse Canvas: tạo ảnh bằng tài khoản ChatGPT thay cho Muse (công tắc "Muse | GPT" trên node chạy).

Node "Tách áo quần" / "Bảng thiết kế nhân vật" mặc định gửi Muse. Khi người dùng gạt sang GPT, node gọi
POST /api/workflow/muse/gpt-image: cùng prompt + ảnh tham chiếu theo đúng thứ tự (ảnh chính trước, ảnh phụ sau),
ảnh ra lưu chung thư mục với ảnh Muse (DATA_DIR/media/muse_outputs) và vào Thư Viện Ảnh với nguồn "chatgpt",
nên xem ảnh / "Ra node" / các node sau dùng y như ảnh Muse.

Tài khoản: kho ChatGPT ở Cài đặt → Tài khoản ChatGPT (GptImageClient tự chọn tài khoản rảnh và chuyển tài khoản
khi một tài khoản đụng giới hạn; ChatGPT từ chối vì nội dung thì báo lỗi ngay, không thử tài khoản khác).
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

GPT_TIMEOUT_SECONDS = 300
MAX_REFERENCES = 6


class GptImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=20000)
    reference_images: list[str] = Field(default_factory=list, max_length=MAX_REFERENCES)
    chat_title: str = Field(default="", max_length=120)
    file_prefix: str = Field(default="", max_length=40)
    aspect: Literal["16:9", "9:16", "1:1"] = "16:9"


def _safe_prefix(raw: str, fallback: str = "muse_canvas") -> str:
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (raw or "").strip())[:40]
    return safe or fallback


def _output_dir() -> Path:
    from app.ai.muse.service import MUSE_OUTPUT_DIR

    return MUSE_OUTPUT_DIR


def _image_client():
    from app.ai.image_gen.service import get_image_client

    return get_image_client()


def generate(req: GptImageRequest) -> dict[str, Any]:
    """Tạo 1 ảnh bằng ChatGPT. Ảnh tham chiếu thiếu -> FileNotFoundError (chưa gửi gì, không tốn lượt)."""
    refs: list[str] = []
    for raw in req.reference_images:
        p = Path(raw)
        if not p.is_file():
            raise FileNotFoundError(f"Không tìm thấy ảnh tham chiếu: {p.name}")
        refs.append(str(p))

    out_dir = _output_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = out_dir / f"{_safe_prefix(req.file_prefix)}_gpt_{stamp}_{uuid.uuid4().hex[:6]}.png"

    start = time.time()
    saved = Path(_image_client().generate(
        prompt=req.prompt.strip(), dest=str(dest), ref_paths=refs or None,
        timeout=GPT_TIMEOUT_SECONDS, aspect=req.aspect,
    ))
    if not saved.is_file():
        raise RuntimeError("ChatGPT báo xong nhưng không thấy file ảnh.")

    try:
        from app.workflow import image_library

        label = (req.chat_title or "").split("·", 1)[-1].strip() or saved.stem
        image_library.add_file(saved, source="chatgpt", label=label, meta={
            "prompt": req.prompt[:4000],
            "chat_title": req.chat_title,
            "input_paths": refs,
            "provider": "chatgpt",
        })
    except Exception:
        pass  # thư viện lỗi không làm hỏng ảnh đã tạo

    import urllib.parse

    return {
        "ok": True,
        "provider": "gpt",
        "local_path": str(saved),
        "preview_url": f"/api/ai/muse/output?file={urllib.parse.quote(saved.name)}",
        "file_size": saved.stat().st_size,
        "duration_seconds": round(time.time() - start, 2),
    }


# ---------------------------------------------------------------- node "Kịch bản tạo video" (ChatGPT viết chữ)

GPT_SCRIPT_TIMEOUT_SECONDS = 600
MAX_SCRIPT_REFERENCES = 10  # giới hạn ảnh/tin của ChatGPT web chưa kiểm chứng — giữ vừa phải


class GptScriptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=40000)
    reference_images: list[str] = Field(default_factory=list, max_length=MAX_SCRIPT_REFERENCES)
    chat_title: str = Field(default="", max_length=120)
    file_prefix: str = Field(default="", max_length=40)


def _text_dir() -> Path:
    from app.ai.muse.service import MUSE_TEXT_DIR

    return MUSE_TEXT_DIR


def write_script(req: GptScriptRequest) -> dict[str, Any]:
    """1 lượt ChatGPT viết kịch bản (chữ) từ prompt + mọi ảnh tham chiếu theo thứ tự; lưu .md cạnh kịch bản Muse.

    Đã gửi thì không tự gửi lại ở tài khoản khác (failover=False): lỗi giữa chừng -> người dùng tự bấm viết lại.
    Ảnh tham chiếu thiếu -> FileNotFoundError trước khi gửi gì."""
    refs: list[str] = []
    for raw in req.reference_images:
        p = Path(raw)
        if not p.is_file():
            raise FileNotFoundError(f"Không tìm thấy ảnh tham chiếu: {p.name}")
        refs.append(str(p))

    start = time.time()
    text, account = _image_client().chat_text(
        req.prompt.strip(), ref_paths=refs or None, timeout=GPT_SCRIPT_TIMEOUT_SECONDS, failover=False,
    )
    out_dir = _text_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = out_dir / f"{_safe_prefix(req.file_prefix, 'gpt_script')}_{stamp}_{uuid.uuid4().hex[:6]}.md"
    header = f"<!-- {req.chat_title} · ChatGPT ({account}) · {len(refs)} ảnh tham chiếu -->\n\n" if req.chat_title else ""
    dest.write_text(header + text.strip() + "\n", encoding="utf-8")
    return {
        "ok": True,
        "provider": "gpt",
        "text": text.strip(),
        "local_path": str(dest),
        "account_label": account,
        "duration_seconds": round(time.time() - start, 2),
    }
