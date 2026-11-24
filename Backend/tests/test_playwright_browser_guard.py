from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core import config


class PlaywrightBrowserGuardTests(unittest.TestCase):
    """Guardrail ngăn lỗi:
    Executable doesn't exist at AppData\\Local\\Temp\\_MEI...\\playwright\\driver\\package\\.local-browsers\\...
    """

    def test_ensure_playwright_browsers_path_overrides_zero_with_watermark(self) -> None:
        """Khi PLAYWRIGHT_BROWSERS_PATH='0' (mặc định của Playwright trên PyInstaller),
        phải được thay thế bằng WATERMARK_PLAYWRIGHT_BROWSERS_PATH nếu có."""
        with patch.dict(os.environ, {
            "PLAYWRIGHT_BROWSERS_PATH": "0",
            "WATERMARK_PLAYWRIGHT_BROWSERS_PATH": r"C:\fake\bundled\playwright-core\.local-browsers",
        }):
            with patch.object(Path, "is_dir", return_value=True):
                config._ensure_playwright_browsers_path()
                self.assertEqual(
                    os.environ["PLAYWRIGHT_BROWSERS_PATH"],
                    r"C:\fake\bundled\playwright-core\.local-browsers",
                )

    def test_ensure_playwright_browsers_path_overrides_zero_with_localappdata(self) -> None:
        """Nếu không có watermark path, phải trỏ về %LOCALAPPDATA%\\ms-playwright."""
        with patch.dict(os.environ, {
            "PLAYWRIGHT_BROWSERS_PATH": "0",
            "WATERMARK_PLAYWRIGHT_BROWSERS_PATH": "",
            "LOCALAPPDATA": r"C:\Users\Tester\AppData\Local",
        }):
            with patch.object(Path, "is_dir", return_value=True):
                config._ensure_playwright_browsers_path()
                self.assertEqual(
                    os.environ["PLAYWRIGHT_BROWSERS_PATH"],
                    r"C:\Users\Tester\AppData\Local\ms-playwright",
                )
