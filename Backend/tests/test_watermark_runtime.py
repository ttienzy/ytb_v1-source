from __future__ import annotations

import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.watermark import service


class WatermarkRuntimeTests(unittest.TestCase):
    def _runtime_files(self, root: Path, *, with_browser: bool = True) -> dict[str, str]:
        node = root / "Google Search App.exe"
        script = root / "node_modules" / "@pilio" / "gemini-watermark-remover" / "bin" / "gwr.mjs"
        browsers = root / "node_modules" / "playwright-core" / ".local-browsers"
        script.parent.mkdir(parents=True)
        browsers.mkdir(parents=True)
        node.touch()
        script.touch()
        if with_browser:
            (browsers / "chromium-1234").mkdir()
        return {
            "WATERMARK_NODE_PATH": str(node),
            "WATERMARK_NODE_IS_ELECTRON": "1",
            "WATERMARK_GWR_SCRIPT": str(script),
            "WATERMARK_PLAYWRIGHT_BROWSERS_PATH": str(browsers),
        }

    def test_resolves_bundled_electron_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env = self._runtime_files(Path(tmp))
            with patch.dict(os.environ, env, clear=True):
                runtime = service._resolve_gwr_runtime()

            self.assertIsNotNone(runtime)
            assert runtime is not None
            self.assertEqual(runtime.source, "bundled")
            self.assertTrue(runtime.video_available)
            self.assertEqual(runtime.command[0], env["WATERMARK_NODE_PATH"])
            self.assertEqual(runtime.command[1], env["WATERMARK_GWR_SCRIPT"])
            self.assertEqual(runtime.env_overrides["ELECTRON_RUN_AS_NODE"], "1")
            self.assertEqual(
                runtime.env_overrides["PLAYWRIGHT_BROWSERS_PATH"],
                env["WATERMARK_PLAYWRIGHT_BROWSERS_PATH"],
            )

    def test_reports_missing_video_browser(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env = self._runtime_files(Path(tmp), with_browser=False)
            with patch.dict(os.environ, env, clear=True):
                status = service.get_gwr_runtime_status()

            self.assertTrue(status["gwr_available"])
            self.assertFalse(status["video_available"])
            self.assertEqual(status["runtime"], "bundled")

    def test_rejects_incomplete_packaged_configuration(self) -> None:
        with patch.dict(
            os.environ,
            {"WATERMARK_NODE_PATH": "missing-node.exe"},
            clear=True,
        ):
            self.assertIsNone(service._resolve_gwr_runtime())

    def test_parses_video_frame_progress(self) -> None:
        self.assertEqual(
            service._parse_frame_progress("[video] 63% 140/240 frames (AI 81, reused 59)"),
            (140, 240),
        )

    def test_remove_image_watermark_publishes_output_atomically(self) -> None:
        class FakeProcess:
            returncode = 0
            stderr = io.StringIO("")

            def wait(self) -> None:
                return None

        runtime = service.GwrRuntime(
            command=("node", "gwr.mjs"),
            source="test",
            env_overrides={},
            video_available=False,
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.jpg"
            destination = root / "clean.jpg"
            source.write_bytes(b"source-image")

            def fake_popen(command: list[str], **_: object) -> FakeProcess:
                output = Path(command[command.index("--output") + 1])
                output.write_bytes(b"clean-image")
                return FakeProcess()

            with (
                patch.object(service, "_resolve_gwr_runtime", return_value=runtime),
                patch.object(service.subprocess, "Popen", side_effect=fake_popen),
            ):
                result = service.remove_image_watermark_sync(source, destination)

            self.assertEqual(result, destination)
            self.assertEqual(destination.read_bytes(), b"clean-image")
            self.assertEqual(list(root.glob(".clean.*.jpg")), [])

    def test_remove_image_watermark_keeps_previous_cache_on_failure(self) -> None:
        class FakeProcess:
            returncode = 1
            stderr = io.StringIO("processing failed\n")

            def wait(self) -> None:
                return None

        runtime = service.GwrRuntime(
            command=("node", "gwr.mjs"),
            source="test",
            env_overrides={},
            video_available=False,
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.jpg"
            destination = root / "clean.jpg"
            source.write_bytes(b"source-image")
            destination.write_bytes(b"previous-clean-image")

            def fake_popen(command: list[str], **_: object) -> FakeProcess:
                output = Path(command[command.index("--output") + 1])
                output.write_bytes(b"partial")
                return FakeProcess()

            with (
                patch.object(service, "_resolve_gwr_runtime", return_value=runtime),
                patch.object(service.subprocess, "Popen", side_effect=fake_popen),
            ):
                with self.assertRaisesRegex(RuntimeError, "processing failed"):
                    service.remove_image_watermark_sync(source, destination)

            self.assertEqual(destination.read_bytes(), b"previous-clean-image")
            self.assertEqual(list(root.glob(".clean.*.jpg")), [])


if __name__ == "__main__":
    unittest.main()
