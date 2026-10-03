import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
from app.veo import service


class WorkflowVideoChainTests(unittest.TestCase):
    @patch("app.veo.service._encode_image_file")
    def test_provider_switches_from_ingredients_to_single_start_frame(self, encode):
        encode.side_effect = lambda path: dict(local_path="C:/images/" + path, filename=path, base64="fake", mime="image/jpeg") if path else None
        common = dict(prompt="Continue the scene", model_display_name="Omni 1.1 Flash", flow_project_id="project-test",
                      aspect_ratio="9:16", resolution="720p", num_outputs=1)
        for duration in (4, 6, 8, 10):
            first = service._build_verified_flow_request(dict(common, input_mode="ingredients", duration_seconds=duration,
                                                               ingredient_image_paths=["product.jpg", "model.jpg"]))
            next_clip = service._build_verified_flow_request(dict(common, input_mode="frames", duration_seconds=duration,
                                                                   image_path="last-frame.jpg", end_image_path=None))
            self.assertEqual(first["provider_model_id"], f"abra_r2v_{duration}s")
            self.assertEqual(next_clip["provider_model_id"], f"abra_i2v_{duration}s")
            self.assertEqual(next_clip["image_local_path"], "C:/images/last-frame.jpg")
            self.assertIsNone(next_clip["end_image_local_path"])
            self.assertEqual(next_clip["ingredient_images"], [])

    def test_extracts_actual_final_decoded_frame_and_reuses_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "clip.mp4"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=24:duration=2",
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video)], check=True, capture_output=True)
            video.with_suffix(".json").write_text(json.dumps({"project_id": "test-project", "duration_seconds": 10}))
            expected = root / "expected.jpg"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vf", "select=eq(n\\,47)",
                            "-frames:v", "1", "-q:v", "2", str(expected)], check=True, capture_output=True)
            session = MagicMock()
            with patch.object(service, "get_video_path", return_value=video), patch.object(service, "_BASE_DIR", root), \
                 patch.object(service, "_VEO_IMAGES_DIR", root / "images"), patch.object(service, "SessionLocal", return_value=session):
                result = service.extract_last_frame("clip")
                output = Path(result["file_path"])
                self.assertEqual(output.read_bytes(), expected.read_bytes())
                with patch.object(service.subprocess, "run", side_effect=AssertionError("cache should be reused")):
                    self.assertEqual(service.extract_last_frame("clip")["file_path"], str(output))


if __name__ == "__main__":
    unittest.main()
