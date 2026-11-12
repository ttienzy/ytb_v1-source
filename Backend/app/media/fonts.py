"""Tìm font cho ffmpeg `drawtext`.

`drawtext` KHÔNG có `fontfile=` sẽ đi qua Fontconfig; bản ffmpeg Windows (gyan/winget) không có file cấu hình
Fontconfig nên crash ngay (exit 0xC0000005, "Fontconfig error: Cannot load default config file").
Luôn truyền `fontfile=` tường minh.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

FONT_FILE = "BeVietnamPro-ExtraBold.ttf"  # OFL, kèm trong Backend/resources/fonts; đủ dấu tiếng Việt
SYSTEM_FONTS = (
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)


def find_font() -> Path | None:
    """Font kèm ứng dụng (cả cây mã nguồn lẫn bundle PyInstaller), rồi tới font hệ thống."""
    roots = [Path(__file__).resolve().parents[2] / "resources" / "fonts"]
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        roots.insert(0, Path(bundle) / "resources" / "fonts")
    bundled = next((r / FONT_FILE for r in roots if (r / FONT_FILE).is_file()), None)
    return bundled or next((Path(f) for f in SYSTEM_FONTS if Path(f).is_file()), None)


def stage_font(work: Path, name: str = "font.ttf") -> bool:
    """Chép font vào thư mục làm việc để filter dùng `fontfile=font.ttf` (đường dẫn tương đối + cwd=work).

    Tránh lỗi parser ffmpeg với dấu `:` của ổ đĩa và dấu cách trong đường dẫn tuyệt đối."""
    font = find_font()
    if font is None:
        return False
    work.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(font, work / name)
    return True


def filter_path(path: Path) -> str:
    """Đường dẫn tuyệt đối dùng được trong giá trị filter (bọc nháy đơn, escape dấu `:`)."""
    return "'" + path.as_posix().replace(":", r"\:").replace("'", r"\'") + "'"
