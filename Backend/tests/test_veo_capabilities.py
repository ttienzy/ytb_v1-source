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


if __name__ == "__main__":
    unittest.main()
