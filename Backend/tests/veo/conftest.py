import random

import pytest

from app.veo import service


@pytest.fixture(autouse=True)
def _fast_flow_timing(monkeypatch):
    """Bỏ các khoảng chờ thật: nghỉ 3s của khóa hàng đợi Flow và độ trễ ngẫu nhiên 2–6s đầu mỗi job."""
    monkeypatch.setattr(service, "_flow_ui_gate", service._FifoGate(min_gap_seconds=0))
    monkeypatch.setattr(random, "uniform", lambda a, b: 0.0)
