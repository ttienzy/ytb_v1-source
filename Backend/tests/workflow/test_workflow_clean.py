from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import app
from app.workflow import router as workflow_router


class WorkflowCleanTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_clean_status_nonexistent_file(self):
        res = self.client.get("/api/workflow/exports/non_existent_video_123.mp4/clean-status")
        self.assertEqual(res.status_code, 404)

    def test_clean_status_existing_export(self):
        # Tạo file export giả lập để kiểm tra status
        exports_dir = workflow_router.WORKFLOW_EXPORTS_DIR
        exports_dir.mkdir(parents=True, exist_ok=True)
        test_file = exports_dir / "test_dummy_export_video.mp4"
        test_file.write_bytes(b"dummy video content")

        try:
            res = self.client.get("/api/workflow/exports/test_dummy_export_video.mp4/clean-status")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["filename"], "test_dummy_export_video.mp4")
            self.assertFalse(data["cached"])
            self.assertFalse(data["is_processing"])
            self.assertEqual(data["status"], "idle")
        finally:
            if test_file.exists():
                test_file.unlink()

    def test_get_exported_video_uncleaned_returns_404(self):
        exports_dir = workflow_router.WORKFLOW_EXPORTS_DIR
        exports_dir.mkdir(parents=True, exist_ok=True)
        test_file = exports_dir / "test_dummy_export_unclean.mp4"
        test_file.write_bytes(b"dummy video content")

        try:
            res = self.client.get("/api/workflow/exports/test_dummy_export_unclean.mp4?clean=true")
            self.assertEqual(res.status_code, 404)
            self.assertIn("chưa được xóa watermark", res.json()["detail"])
        finally:
            if test_file.exists():
                test_file.unlink()


if __name__ == "__main__":
    unittest.main()
