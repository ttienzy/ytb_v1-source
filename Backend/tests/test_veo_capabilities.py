"""Unit tests cho Veo capabilities và dynamic model resolution."""

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.veo import service


class VeoCapabilitiesTests(unittest.TestCase):
    def test_get_capabilities_returns_profiles_and_models(self):
        caps = service.get_capabilities()
        self.assertGreater(len(caps.models), 0)
        self.assertGreater(len(caps.profiles), 100)
        self.assertIn("16:9", caps.aspect_ratios)
        self.assertIn("9:16", caps.aspect_ratios)

    def test_resolve_provider_model_id_omni_durations(self):
        cases = [
            (4, "abra_t2v_4s"),
            (6, "abra_t2v_6s"),
            (8, "abra_t2v_8s"),
            (10, "abra_t2v_10s"),
        ]
        for dur, expected_id in cases:
            with self.subTest(dur=dur):
                job = {
                    "model_display_name": "Omni 1.1 Flash",
                    "duration_seconds": dur,
                    "aspect_ratio": "9:16",
                }
                self.assertEqual(service._resolve_provider_model_id(job), expected_id)

    def test_resolve_provider_model_id_veo_models(self):
        cases = [
            ("Veo 3.1 - Fast", "9:16", "veo_3_1_t2v_fast_portrait"),
            ("Veo 3.1 - Fast", "16:9", "veo_3_1_t2v_fast"),
            ("Veo 3.1 - Quality", "9:16", "veo_3_1_t2v_quality_portrait"),
            ("Veo 3.1 - Quality", "16:9", "veo_3_1_t2v_quality"),
            ("Veo 3.1 - Lite", "9:16", "veo_3_1_t2v_lite"),
            ("Veo 3.1 - Lite", "16:9", "veo_3_1_t2v_lite"),
        ]
        for model, aspect, expected_id in cases:
            with self.subTest(model=model, aspect=aspect):
                job = {
                    "model_display_name": model,
                    "duration_seconds": 8,
                    "aspect_ratio": aspect,
                }
                self.assertEqual(service._resolve_provider_model_id(job), expected_id)

    def test_build_verified_flow_request_keeps_dynamic_parameters(self):
        job = {
            "prompt": "king kong",
            "model_display_name": "Omni 1.1 Flash",
            "duration_seconds": 4,
            "aspect_ratio": "9:16",
            "resolution": "720p",
            "input_mode": "text_to_video",
            "flow_project_id": "proj-xyz",
            "num_outputs": 1,
        }
        req = service._build_verified_flow_request(job)
        self.assertEqual(req["prompt"], "king kong")
        self.assertEqual(req["duration_seconds"], 4)
        self.assertEqual(req["aspect_ratio"], "9:16")
        self.assertEqual(req["provider_model_id"], "abra_t2v_4s")
        self.assertEqual(req["project_id"], "proj-xyz")


    def test_resolve_provider_model_id_frames_mode(self):
        job = {
            "model_display_name": "Omni 1.1 Flash",
            "duration_seconds": 10,
            "aspect_ratio": "9:16",
            "input_mode": "frames",
        }
        self.assertEqual(service._resolve_provider_model_id(job), "omni_flash_i2v_10s_first")

    def test_build_verified_flow_request_frames_encoding(self):
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"FAKE_PNG_IMAGE_BYTES_12345")
            tmp_path = f.name

        try:
            job = {
                "prompt": "cá chép hóa rồng",
                "model_display_name": "Omni 1.1 Flash",
                "duration_seconds": 10,
                "aspect_ratio": "9:16",
                "resolution": "720p",
                "input_mode": "frames",
                "flow_project_id": "proj-xyz",
                "num_outputs": 1,
                "image_path": tmp_path,
                "end_image_path": None,
            }
            req = service._build_verified_flow_request(job)
            self.assertEqual(req["input_mode"], "frames")
            self.assertEqual(req["provider_model_id"], "omni_flash_i2v_10s_first")
            self.assertIsNotNone(req["image_base64"])
            self.assertEqual(req["image_mime"], "image/png")
            self.assertIsNone(req["end_image_base64"])
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def test_resolve_provider_model_id_ingredients_mode(self):
        job = {
            "model_display_name": "Omni 1.1 Flash",
            "duration_seconds": 10,
            "aspect_ratio": "9:16",
            "input_mode": "ingredients",
        }
        self.assertEqual(service._resolve_provider_model_id(job), "abra_r2v_10s")

    def test_build_verified_flow_request_ingredients_encoding(self):
        import tempfile
        tmp_files = []
        for i in range(3):
            with tempfile.NamedTemporaryFile(suffix=f"_{i}.png", delete=False) as f:
                f.write(f"FAKE_INGREDIENT_BYTES_{i}".encode("utf-8"))
                tmp_files.append(f.name)

        try:
            job = {
                "prompt": "cá chép bơi trong hồ nước",
                "model_display_name": "Omni 1.1 Flash",
                "duration_seconds": 10,
                "aspect_ratio": "9:16",
                "resolution": "720p",
                "input_mode": "ingredients",
                "flow_project_id": "proj-xyz",
                "num_outputs": 1,
                "ingredient_image_paths": tmp_files,
            }
            req = service._build_verified_flow_request(job)
            self.assertEqual(req["input_mode"], "ingredients")
            self.assertEqual(req["provider_model_id"], "abra_r2v_10s")
            self.assertEqual(len(req["ingredient_images"]), 3)
            self.assertTrue(all("base64" in item for item in req["ingredient_images"]))
        finally:
            for p in tmp_files:
                Path(p).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
