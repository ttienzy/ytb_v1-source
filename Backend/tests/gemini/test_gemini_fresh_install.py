"""Gemini trên máy cài mới (2026-11-24): bản phát hành báo "Chưa có inner_template — chạy app.ai.gemini.capture trước".

Nguyên nhân: `inner_template` chỉ được ghi bởi script chạy tay `capture.py`; app không có đường nào tạo ra nó, config mặc định
không có, nên mọi máy ngoài máy dev đều hỏng Phân tích Gemini + Recap. Node lại gợi ý "Làm mới Cookie" — làm mãi không hết.
"""
import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.ai.gemini import recap, template
from app.core import storage

BACKEND = Path(__file__).resolve().parents[2]


def _fresh_install_config(monkeypatch, tmp_path, **gemini):
    monkeypatch.setattr(storage.settings, "config_file", tmp_path / "config.json")
    cfg = storage.default_config()
    cfg["gemini"].update(gemini)
    storage.write_config(cfg)


def test_fresh_install_with_cookie_uses_bundled_template(monkeypatch, tmp_path):
    _fresh_install_config(monkeypatch, tmp_path, cookies="SID=x; __Secure-1PSID=y")
    cfg = recap._gemini_config()
    assert cfg["inner_template"] == template.load_bundled_inner_template()
    assert cfg["template_source"] == "bundled"


def test_captured_template_wins_over_bundled(monkeypatch, tmp_path):
    _fresh_install_config(monkeypatch, tmp_path, cookies="SID=x", inner_template=[["captured"]])
    cfg = recap._gemini_config()
    assert cfg["inner_template"] == [["captured"]]
    assert cfg["template_source"] == "captured"


def test_missing_cookie_is_a_login_problem_with_instructions(monkeypatch, tmp_path):
    _fresh_install_config(monkeypatch, tmp_path)
    with pytest.raises(recap.GeminiNotLoggedInError) as err:
        recap._gemini_config()
    assert "Cài đặt" in str(err.value)
    assert issubclass(recap.GeminiNotLoggedInError, recap.RecapConfigError)  # code cũ bắt RecapConfigError vẫn bắt được


def test_bundled_template_is_shipped_and_account_agnostic():
    path = BACKEND / "resources" / "gemini" / "inner_template.json"
    assert path.is_file(), "thiếu template Gemini đóng gói sẵn — máy cài mới sẽ không gọi được Gemini"
    inner = json.loads(path.read_text(encoding="utf-8"))
    assert inner == template.load_bundled_inner_template()
    assert len(inner) == 97
    for idx in template.SANITIZE_INDICES:
        assert inner[idx] is None, f"idx {idx} gắn hội thoại/tài khoản phải là null (chạy capture để lấy bản mới)"
    # backend.spec phải đóng gói cả thư mục resources (template nằm trong đó)
    spec = (BACKEND / "backend.spec").read_text(encoding="utf-8")
    assert "backend_dir / 'resources'), 'resources')" in spec


def test_sanitize_drops_conversation_fields():
    inner = [f"v{i}" for i in range(97)]
    clean = template.sanitize_inner(inner)
    assert all(clean[i] is None for i in template.SANITIZE_INDICES)
    assert clean[0] == "v0" and inner[3] == "v3"  # không sửa list gốc


@pytest.mark.parametrize("exc", [
    recap.GeminiNotLoggedInError("Chưa đăng nhập Gemini"),
    recap.GeminiAuthError("Cookie Gemini hết hạn"),
])
def test_analyze_maps_cookie_problems_to_401(monkeypatch, exc):
    """401 = lỗi đăng nhập/cookie → giao diện mới gợi ý "Làm mới Cookie"; lỗi khác không gợi ý sai chỗ."""
    import asyncio

    from app.workflow import router as wf_router
    from app.workflow.schemas import GeminiAnalysisRequest

    def boom(**_):
        raise exc

    monkeypatch.setattr(wf_router, "execute_gemini_analysis", boom)
    with pytest.raises(HTTPException) as err:
        asyncio.run(wf_router.analyze_product(GeminiAnalysisRequest(images=["data:image/png;base64,AA"], provider="gemini")))
    assert err.value.status_code == 401


def test_analyze_other_errors_stay_500(monkeypatch):
    import asyncio

    from app.workflow import router as wf_router
    from app.workflow.schemas import GeminiAnalysisRequest

    def boom(**_):
        raise RuntimeError("Gemini Web API error: HTTP 500")

    monkeypatch.setattr(wf_router, "execute_gemini_analysis", boom)
    with pytest.raises(HTTPException) as err:
        asyncio.run(wf_router.analyze_product(GeminiAnalysisRequest(images=["data:image/png;base64,AA"], provider="gemini")))
    assert err.value.status_code == 500
