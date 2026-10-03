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
            "image_path": "fake_start.png",
        }
        self.assertEqual(service._resolve_provider_model_id(job), "abra_i2v_10s")

        job_both = {
            "model_display_name": "Omni 1.1 Flash",
            "duration_seconds": 6,
            "aspect_ratio": "16:9",
            "input_mode": "frames",
            "image_path": "fake_start.png",
            "end_image_path": "fake_end.png",
        }
        self.assertEqual(service._resolve_provider_model_id(job_both), "omni_flash_i2v_6s_first_last")
        job_both_8s = dict(job_both, duration_seconds=8)
        self.assertEqual(service._resolve_provider_model_id(job_both_8s), "omni_flash_i2v_8s_first_last")
        job_both_10s = dict(job_both, duration_seconds=10)
        self.assertEqual(service._resolve_provider_model_id(job_both_10s), "omni_flash_i2v_10s_first_last")

        job_only_end = {
            "model_display_name": "Omni 1.1 Flash",
            "duration_seconds": 6,
            "aspect_ratio": "16:9",
            "input_mode": "frames",
            "image_path": None,
            "end_image_path": "fake_end.png",
        }
        self.assertEqual(service._resolve_provider_model_id(job_only_end), "abra_i2v_6s")

    def test_submit_job_frames_mode_validations(self):
        from app.veo.schemas import VeoJobRequest, InputMode, AspectRatio
        from app.veo.models import VeoProject

        # Mock active project
        fake_proj = VeoProject(id="p-1", name="Test Proj", flow_project_id="f-1")
        orig_get_active = service.get_active_project
        service.get_active_project = lambda: fake_proj

        try:
            # 1. End frame without start frame -> raises ValueError
            req_invalid = VeoJobRequest(
                prompt="test prompt",
                model_display_name="Omni 1.1 Flash",
                input_mode=InputMode.FRAMES,
                aspect_ratio=AspectRatio.PORTRAIT,
                duration_seconds=6,
                resolution="720p",
                image_path=None,
                end_image_path="fake_end.png",
            )
            with self.assertRaises(ValueError) as ctx:
                service.submit_job(req_invalid)
            self.assertIn("End Frame", str(ctx.exception))

            # 2. Neither frame provided -> raises ValueError
            req_empty = VeoJobRequest(
                prompt="test prompt",
                model_display_name="Omni 1.1 Flash",
                input_mode=InputMode.FRAMES,
                aspect_ratio=AspectRatio.PORTRAIT,
                duration_seconds=6,
                resolution="720p",
                image_path=None,
                end_image_path=None,
            )
            with self.assertRaises(ValueError) as ctx2:
                service.submit_job(req_empty)
            self.assertIn("Start Frame", str(ctx2.exception))
        finally:
            service.get_active_project = orig_get_active

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
            self.assertEqual(req["provider_model_id"], "abra_i2v_10s")
            self.assertIsNotNone(req["image_base64"])
            self.assertEqual(req["image_local_path"], str(Path(tmp_path).resolve()))
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

        job_8s = {
            "model_display_name": "Omni 1.1 Flash",
            "duration_seconds": 8,
            "aspect_ratio": "9:16",
            "input_mode": "ingredients",
        }
        self.assertEqual(service._resolve_provider_model_id(job_8s), "abra_r2v_8s")

    def test_resolve_provider_model_id_video_edit_mode(self):
        job = {
            "model_display_name": "Omni 1.1 Flash",
            "duration_seconds": 10,
            "aspect_ratio": "9:16",
            "resolution": "360p",
            "input_mode": "video_edit",
        }
        self.assertEqual(service._resolve_provider_model_id(job), "abra_edit_360p")

    def test_video_edit_profiles_are_exposed_to_frontend(self):
        profiles = [p for p in service.get_capabilities().profiles if p.input_mode.value == "video_edit"]
        self.assertEqual(len(profiles), 4)
        self.assertEqual({p.credit_cost for p in profiles}, {40})
        self.assertEqual({p.resolution for p in profiles}, {"360p", "720p"})
        self.assertEqual({p.aspect_ratio.value for p in profiles}, {"9:16", "16:9"})
        verified = [p for p in profiles if p.runtime_verified]
        self.assertEqual(len(verified), 1)
        self.assertEqual(verified[0].aspect_ratio.value, "9:16")
        self.assertEqual(verified[0].resolution, "360p")

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
            self.assertTrue(all("local_path" in item for item in req["ingredient_images"]))
            self.assertTrue(all("base64" not in item for item in req["ingredient_images"]))
        finally:
            for p in tmp_files:
                Path(p).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
