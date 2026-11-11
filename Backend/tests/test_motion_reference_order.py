import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.veo import service


class MotionReferenceOrderTests(unittest.TestCase):
    def test_cached_and_local_images_keep_the_original_order(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            first = Path(temp_dir) / "first.png"
            second = Path(temp_dir) / "second.png"
            first.write_bytes(b"first")
            second.write_bytes(b"second")

            def cached_id(_project_id, file_hash):
                return "cached-first" if file_hash == "first.png" else None

            def encode(path):
                if not path:
                    return None
                return {
                    "local_path": str(Path(path).resolve()),
                    "filename": Path(path).name,
                    "base64": "encoded",
                    "mime": "image/png",
                }

            job = {
                "prompt": "Follow the reference movement",
                "model_display_name": "Omni 1.2 Flash",
                "input_mode": "video_edit",
                "flow_project_id": "project-motion",
                "project_id": "project-motion",
                "duration_seconds": 8,
                "aspect_ratio": "16:9",
                "resolution": "720p",
                "num_outputs": 1,
                "ingredient_image_paths": [str(first), str(second)],
                "reference_video_id": "video-reference",
                "reference_video_start_seconds": 0,
                "reference_video_end_seconds": 8,
                "force_fresh_assets": False,
            }

            with patch("app.veo.media_registry.compute_file_sha256", side_effect=lambda path: Path(path).name), \
                 patch("app.veo.media_registry.get_cached_media_id", side_effect=cached_id), \
                 patch("app.veo.service._encode_image_file", side_effect=encode):
                request = service._build_verified_flow_request(job)

            self.assertEqual(request["ingredient_inputs"], [
                {"media_id": "cached-first"},
                {"local_path": str(second.resolve()), "filename": "second.png"},
            ])
            self.assertEqual(request["ingredient_media_ids"], ["cached-first"])


if __name__ == "__main__":
    unittest.main()
