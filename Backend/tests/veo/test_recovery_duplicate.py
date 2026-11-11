"""Scene recovery must not accept an old project video that is byte-identical to an existing output."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.veo import service


class RecoveryDuplicateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        patcher = patch.object(service, "_VEO_DATA_DIR", self.dir)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _write(self, name, data):
        path = self.dir / name
        path.write_bytes(data)
        return path

    def test_identical_bytes_are_detected_even_with_different_names(self):
        old = self._write("old.mp4", b"A" * 4096)
        new = self._write("new.mp4", b"A" * 4096)
        self.assertEqual(service._find_duplicate_output(new), old)

    def test_same_size_but_different_content_is_not_a_duplicate(self):
        self._write("old.mp4", b"A" * 4096)
        new = self._write("new.mp4", b"B" * 4096)
        self.assertIsNone(service._find_duplicate_output(new))

    def test_reject_removes_duplicate_file_and_sidecar(self):
        self._write("old.mp4", b"A" * 2048)
        new = self._write("new.mp4", b"A" * 2048)
        side = self._write("new.json", b"{}")
        self.assertTrue(service._reject_duplicate_recovery({"job_id": "j"}, new))
        self.assertFalse(new.exists())
        self.assertFalse(side.exists())
        self.assertTrue((self.dir / "old.mp4").exists())


if __name__ == "__main__":
    unittest.main()
