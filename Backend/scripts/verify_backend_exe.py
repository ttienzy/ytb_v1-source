"""Kiểm tra backend_server.exe (PyInstaller) có đủ tài nguyên mà máy cài mới cần; thiếu → exit 1.

Chạy sau `pyinstaller --noconfirm backend.spec` (CI release, job backend-exe) hoặc tay:
    cd Backend; python scripts/verify_backend_exe.py dist/backend_server.exe

Lý do (2026-11-24): bản phát hành trên máy khác hỏng Gemini vì thiếu template request — thứ chỉ có trong config.json của
máy dev. Template giờ nằm trong resources/ (app.ai.gemini.template); script này chặn việc lỡ bỏ nó khỏi bản đóng gói.
"""
import sys
from pathlib import Path

from PyInstaller.archive.readers import CArchiveReader

REQUIRED = {
    "resources/gemini/inner_template.json": "template request Gemini (Phân tích Gemini, Recap trên máy cài mới)",
    "playwright/driver/node.exe": "driver Playwright (đăng nhập Gemini/ChatGPT/YouTube qua Chrome)",
    "prompts/workflow/motion_prompt_presets.json": "preset Motion Control",
}


def main(exe: str) -> int:
    path = Path(exe)
    if not path.is_file():
        print(f"Không thấy {path}", file=sys.stderr)
        return 1
    names = {n.replace("\\", "/") for n in CArchiveReader(str(path)).toc}
    missing = [f"  - {rel}: {why}" for rel, why in REQUIRED.items() if rel not in names]
    if missing:
        print(f"{path.name} thiếu tài nguyên (kiểm tra datas trong backend.spec):\n" + "\n".join(missing), file=sys.stderr)
        return 1
    print(f"{path.name}: đủ {len(REQUIRED)} tài nguyên bắt buộc.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "dist/backend_server.exe"))
