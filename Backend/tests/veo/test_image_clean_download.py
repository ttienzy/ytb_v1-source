from __future__ import annotations

import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from app.veo import router as veo_router
from app.veo import service as veo_service


class _FakeImageResponse:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks

    def __enter__(self) -> "_FakeImageResponse":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_content(self, chunk_size: int) -> list[bytes]:
        assert chunk_size > 0
        return self._chunks


class VeoImageCleanDownloadTests(unittest.TestCase):
    def test_cdn_image_is_downloaded_once_and_published_atomically(self) -> None:
        image_id = f"test-{uuid.uuid4().hex}"
        with tempfile.TemporaryDirectory() as tmp:
            image_dir = Path(tmp)
            response = _FakeImageResponse([b"image-", b"content"])
            with (
                patch.object(veo_service, "_VEO_IMAGES_DIR", image_dir),
                patch.object(veo_service.requests, "get", return_value=response) as get_mock,
            ):
                first = veo_service._download_image_to_local(
                    image_id,
                    "https://flow-content.google/image/test",
                )
                second = veo_service._download_image_to_local(
                    image_id,
                    "https://flow-content.google/image/test",
                )

            expected = image_dir / f"{image_id}.jpg"
            self.assertEqual(first, expected)
            self.assertEqual(second, expected)
            self.assertEqual(expected.read_bytes(), b"image-content")
            get_mock.assert_called_once()
            self.assertEqual(list(image_dir.glob(f".{image_id}.jpg.*.tmp")), [])

    def test_clean_cache_avoids_duplicate_watermark_processing(self) -> None:
        image_id = f"test-{uuid.uuid4().hex}"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.jpg"
            clean_dir = root / "clean"
            source.write_bytes(b"source-image")

            def fake_remove(_: Path, destination: Path) -> Path:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b"clean-image")
                return destination

            with (
                patch.object(veo_router, "_VEO_IMAGES_CLEAN_DIR", clean_dir),
                patch.object(
                    veo_router.watermark_service,
                    "remove_image_watermark_sync",
                    side_effect=fake_remove,
                ) as remove_mock,
            ):
                first = veo_router._prepare_clean_image_sync(image_id, source)
                second = veo_router._prepare_clean_image_sync(image_id, source)

            self.assertEqual(first, clean_dir / f"{image_id}_clean.jpg")
            self.assertEqual(second, first)
            self.assertEqual(first.read_bytes(), b"clean-image")
            remove_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()
