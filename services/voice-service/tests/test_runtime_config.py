import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import MODEL_CACHE_DIR, resolve_ffmpeg_path, settings


class RuntimeConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_ffmpeg_path = settings.ffmpeg_path

    def tearDown(self) -> None:
        settings.ffmpeg_path = self.original_ffmpeg_path

    def test_hugging_face_cache_is_persistent_and_exported(self) -> None:
        self.assertEqual(Path(os.environ["HF_HOME"]).resolve(), MODEL_CACHE_DIR)
        self.assertTrue(MODEL_CACHE_DIR.is_dir())

    def test_configured_ffmpeg_path_has_priority(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            executable = Path(temp_dir) / "ffmpeg.exe"
            executable.touch()
            settings.ffmpeg_path = str(executable)
            with patch("app.config.shutil.which", return_value="system-ffmpeg"):
                self.assertEqual(resolve_ffmpeg_path(), str(executable.resolve()))

    def test_missing_configured_ffmpeg_does_not_hide_the_error(self) -> None:
        settings.ffmpeg_path = "missing-bundled-ffmpeg.exe"
        with patch("app.config.shutil.which", return_value="system-ffmpeg"):
            self.assertIsNone(resolve_ffmpeg_path())

    def test_development_falls_back_to_path(self) -> None:
        settings.ffmpeg_path = None
        with patch("app.config.shutil.which", return_value="system-ffmpeg"):
            self.assertEqual(resolve_ffmpeg_path(), "system-ffmpeg")


if __name__ == "__main__":
    unittest.main()
