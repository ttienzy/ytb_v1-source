"""Guardrail: Chrome mở với profile riêng (--user-data-dir + --remote-debugging-port) phải được đóng ÊM trước khi giết.

Chrome chỉ ghi cookie mới xuống `Default/Network/Cookies` định kỳ (~30 s) hoặc khi tắt bình thường. `proc.terminate()`
trên Windows là TerminateProcess → cookie vừa đăng nhập / vừa xoay vòng bị mất, profile "ấm" thực ra đã đăng xuất, lần
làm mới sau hỏng. Đã gặp ở ChatGPT (2026-11-22), Gemini và YouTube (2026-11-24).

Quy tắc kiểm bằng AST: trong khối `finally` của file mở Chrome kiểu này, `.terminate()` / `.kill()` chỉ được xuất hiện
SAU một lời gọi đóng êm (`close_chrome_gracefully(...)` của app.core.chrome, hoặc `cdp.close_browser(...)` của Muse).
"""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
GRACEFUL = {"close_chrome_gracefully", "close_browser"}
HARD = {"terminate", "kill"}


def _call_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Call):
        f = node.func
        if isinstance(f, ast.Attribute):
            return f.attr
        if isinstance(f, ast.Name):
            return f.id
    return None


def _violations(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try) or not node.finalbody:
            continue
        graceful_seen = False
        for stmt in node.finalbody:
            for sub in ast.walk(stmt):
                name = _call_name(sub)
                if name in GRACEFUL:
                    graceful_seen = True
                elif name in HARD and not graceful_seen:
                    out.append(f"{path.relative_to(APP.parent)}:{sub.lineno} .{name}() trong finally trước khi đóng Chrome êm")
    return out


def test_chrome_profiles_are_closed_gracefully_before_kill():
    launchers = [p for p in APP.rglob("*.py")
                 if "--remote-debugging-port" in (text := p.read_text(encoding="utf-8")) and "--user-data-dir" in text]
    assert launchers, "không tìm thấy file nào mở Chrome — guardrail đang quét sai thư mục?"
    problems = [v for p in launchers for v in _violations(p)]
    assert not problems, (
        "Chrome profile bị giết cứng → cookie vừa lấy không được ghi xuống profile. "
        "Gọi app.core.chrome.close_chrome_gracefully(browser, proc) trong finally:\n" + "\n".join(problems)
    )
