"""Vendored từ github.com/lamvbg/reverse-gpt (MIT) — ChatGPT Plus reverse client (cookie + sentinel).

Patch nội bộ (khác source):
- Bỏ phụ thuộc `.env`/python-dotenv: `GPTPlus(session=dict)` nhận session trực tiếp (cookies/ua/oai-*).
- Import tương đối (đóng gói thành package).
- THÊM ref-upload: `upload_file()` + message multimodal → gen ảnh có ảnh tham chiếu (ngang Leonardo).
"""
from .gpt_plus import GPTPlus, PlusError

__all__ = ["GPTPlus", "PlusError"]
