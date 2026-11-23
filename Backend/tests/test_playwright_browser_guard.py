from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

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

    def test_fetch_with_playwright_uses_chrome_executable(self) -> None:
        """_fetch_with_playwright phải ưu tiên truyền executable_path khi chrome_executable tồn tại."""
        from app.recap import transcript

        mock_playwright = MagicMock()
        mock_p_ctx = MagicMock()
        mock_playwright.__enter__.return_value = mock_p_ctx
        mock_browser = MagicMock()
        mock_p_ctx.chromium.launch.return_value = mock_browser

        mock_chrome = MagicMock()
        mock_chrome.exists.return_value = True
        mock_chrome.__str__.return_value = r"C:\fake\chrome.exe"

        with patch("playwright.sync_api.sync_playwright", return_value=mock_playwright), \
             patch.object(config.settings, "chrome_executable", mock_chrome), \
             patch.object(transcript, "video_id_from_url", return_value="fake123"), \
             patch.object(transcript, "_extract_transcript", return_value={"text": "hello"}), \
             patch.object(transcript, "_open_transcript"):
            try:
                transcript._fetch_with_playwright("https://www.youtube.com/watch?v=fake123", headless=True, timeout_ms=5000)
            except Exception:
                pass

            mock_p_ctx.chromium.launch.assert_called_once()
            _, kwargs = mock_p_ctx.chromium.launch.call_args
            self.assertIn("executable_path", kwargs)
            self.assertEqual(kwargs["executable_path"], r"C:\fake\chrome.exe")
