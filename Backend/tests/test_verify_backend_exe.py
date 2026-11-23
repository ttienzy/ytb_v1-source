"""scripts/verify_backend_exe.py phải chạy được trên runner Windows của CI (stdout cp1252, không PYTHONUTF8).

Lỗi thật (release v2.3.1, 2026-11-24): dòng báo thành công in tiếng Việt ra stdout → UnicodeEncodeError → job "Backend
executable" đỏ dù bản exe đủ tài nguyên. Lúc thử trên máy dev có sẵn PYTHONIOENCODING=utf-8 nên không thấy.
(stderr của Python luôn dùng backslashreplace nên không chết — phải thử đúng nhánh in ra stdout.)
"""
import os
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_backend_exe.py"

# Chạy main() trong tiến trình con có stdout cp1252 (strict), với archive giả có đủ tài nguyên → đi nhánh "đủ … tài nguyên".
_RUNNER = r"""
import runpy, sys, types
fake = types.ModuleType("PyInstaller.archive.readers")
class CArchiveReader:
    def __init__(self, path):
        mod = sys.modules["__verify__"]
        self.toc = {name.replace("/", "\\"): None for name in mod.REQUIRED}
fake.CArchiveReader = CArchiveReader
sys.modules["PyInstaller"] = types.ModuleType("PyInstaller")
sys.modules["PyInstaller.archive"] = types.ModuleType("PyInstaller.archive")
sys.modules["PyInstaller.archive.readers"] = fake
script, exe = sys.argv[1], sys.argv[2]
ns = runpy.run_path(script, run_name="__verify__mod__")
sys.modules["__verify__"] = types.SimpleNamespace(REQUIRED=ns["REQUIRED"])
sys.exit(ns["main"](exe))
"""


def test_success_line_survives_cp1252_console(tmp_path):
    exe = tmp_path / "backend_server.exe"
    exe.write_bytes(b"x")
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
    env["PYTHONIOENCODING"] = "cp1252"  # giống console mặc định của runner windows-latest
    res = subprocess.run([sys.executable, "-c", _RUNNER, str(SCRIPT), str(exe)], capture_output=True, env=env, timeout=60)
    err = res.stderr.decode("utf-8", errors="replace")
    assert "UnicodeEncodeError" not in err, err
    assert res.returncode == 0, err
    assert "backend_server.exe" in res.stdout.decode("utf-8", errors="replace")
