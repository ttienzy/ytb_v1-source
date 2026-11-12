import json
from unittest import mock

from app.ai.gemini import recap
from app.discover import scout


def _stream(text: str) -> str:
    payload = [None, None, None, None, [["rc_1", [text]]]]
    return json.dumps([["wrb.fr", None, json.dumps(payload)]])


def test_scout_calls_gemini_with_real_signature(monkeypatch):
    """Hồi quy: scout từng truyền `query_url=` trong khi hàm đã đổi tên tham số thành `query_text` → TypeError bị nuốt,
    tìm kênh bằng Gemini luôn rơi về tìm cục bộ mà không báo lỗi. autospec ép đúng chữ ký thật."""
    channels = [{"name": "Chan A", "handle": "@a"}]
    fake = mock.create_autospec(recap._call_gemini_stream, return_value=_stream("```json\n" + json.dumps(channels) + "\n```"))
    monkeypatch.setattr(recap, "_call_gemini_stream", fake)

    assert scout.scout_channels_with_gemini("street food") == channels
    assert fake.call_count == 1
    assert "street food" in fake.call_args.kwargs["query_text"]
