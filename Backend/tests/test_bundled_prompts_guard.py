"""Guardrail tests: đảm bảo PROMPTS_DIR, RESOURCES_DIR và mọi file prompt bắt buộc luôn tồn tại,
kể cả khi APP_DATA_DIR được truyền từ Electron (môi trường đóng gói / máy người dùng).

Ngăn chặn hồi quy lỗi (2026-11-24):
Khi đóng gói app, Electron truyền APP_DATA_DIR trỏ tới %APPDATA%/creatorflow-ai.
Nếu code Backend dùng TOOLS_DIR / "Backend" / "prompts" / ... thì sẽ tìm trong AppData
(nơi không có source code), gây FileNotFoundError: "Không tìm thấy chunk prompt template:
C:\\Users\\...\\AppData\\Roaming\\creatorflow-ai\\Backend\\prompts\\recap\\food_review_chunk.prompt.txt".
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core.config import PROMPTS_DIR, RESOURCES_DIR, _resolve_bundled_dir


class BundledPromptsGuardTests(unittest.TestCase):
    def test_prompts_and_resources_dir_exist_in_source(self):
        """Trong môi trường dev/test, PROMPTS_DIR và RESOURCES_DIR phải tồn tại."""
        self.assertTrue(PROMPTS_DIR.is_dir(), f"PROMPTS_DIR không tồn tại: {PROMPTS_DIR}")
        self.assertTrue(RESOURCES_DIR.is_dir(), f"RESOURCES_DIR không tồn tại: {RESOURCES_DIR}")

    def test_all_required_prompt_files_exist(self):
        """Mọi prompt template mà các module phụ thuộc bắt buộc phải có mặt."""
        required = [
            PROMPTS_DIR / "recap" / "food_review_chunk.prompt.txt",
            PROMPTS_DIR / "recap" / "social_caption.prompt.txt",
            PROMPTS_DIR / "discover" / "recommend_channels.prompt.txt",
            PROMPTS_DIR / "workflow" / "gemini_product_analysis.txt",
            PROMPTS_DIR / "workflow" / "gpt_sales_script.txt",
            PROMPTS_DIR / "workflow" / "motion_control_prompt.txt",
            PROMPTS_DIR / "workflow" / "motion_prompt_presets.json",
            PROMPTS_DIR / "workflow" / "workflow_prompt_presets.json",
            RESOURCES_DIR / "gemini" / "inner_template.json",
        ]
        for path in required:
            with self.subTest(path=str(path)):
                self.assertTrue(path.is_file(), f"File bắt buộc bị thiếu: {path}")

    def test_imported_module_prompts_exist(self):
        """Các hằng số prompt trong từng service module phải trỏ đúng file tồn tại."""
        from app.ai.gemini.recap import DEFAULT_CAPTION_PROMPT_PATH, DEFAULT_CHUNK_PROMPT_PATH
        from app.discover.scout import RECOMMEND_PROMPT_PATH
        from app.recap.service import PROMPT_PATH
        from app.workflow.service import (
            GPT_PROMPT_FILE,
            MOTION_PRESETS_FILE,
            MOTION_PROMPT_FILE,
            PROMPT_FILE,
            PROMPT_PRESETS_SYSTEM_FILE,
        )

        for name, p in [
            ("recap.service.PROMPT_PATH", PROMPT_PATH),
            ("ai.gemini.recap.DEFAULT_CHUNK_PROMPT_PATH", DEFAULT_CHUNK_PROMPT_PATH),
            ("ai.gemini.recap.DEFAULT_CAPTION_PROMPT_PATH", DEFAULT_CAPTION_PROMPT_PATH),
            ("discover.scout.RECOMMEND_PROMPT_PATH", RECOMMEND_PROMPT_PATH),
            ("workflow.service.PROMPT_FILE", PROMPT_FILE),
            ("workflow.service.GPT_PROMPT_FILE", GPT_PROMPT_FILE),
            ("workflow.service.PROMPT_PRESETS_SYSTEM_FILE", PROMPT_PRESETS_SYSTEM_FILE),
            ("workflow.service.MOTION_PROMPT_FILE", MOTION_PROMPT_FILE),
            ("workflow.service.MOTION_PRESETS_FILE", MOTION_PRESETS_FILE),
        ]:
            with self.subTest(name=name):
                self.assertTrue(p.is_file(), f"{name} trỏ tới file không tồn tại: {p}")
                self.assertNotIn("creatorflow-ai", str(p), f"{name} không được trỏ vào AppData user: {p}")

    def test_resolve_bundled_dir_prioritizes_meipass(self):
        """Khi chạy trong PyInstaller (sys._MEIPASS được gán), _resolve_bundled_dir phải ưu tiên _MEIPASS."""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_bundle = Path(tmpdir)
            mock_prompts = mock_bundle / "prompts"
            mock_prompts.mkdir()
            mock_file = mock_prompts / "test.txt"
            mock_file.write_text("hello", encoding="utf-8")

            with patch.object(sys, "_MEIPASS", str(mock_bundle), create=True):
                resolved = _resolve_bundled_dir("prompts")
                self.assertEqual(resolved, mock_prompts)
                self.assertTrue((resolved / "test.txt").is_file())


if __name__ == "__main__":
    unittest.main()
