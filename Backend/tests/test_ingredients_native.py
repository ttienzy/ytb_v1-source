import unittest
from unittest.mock import patch
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.veo import service

class IngredientsNativeTests(unittest.TestCase):
    def job(self, count=3, duration=6):
        return dict(prompt="Combine references", model_display_name="Omni 1.1 Flash", input_mode="ingredients",
                    flow_project_id="project-test", duration_seconds=duration, aspect_ratio="16:9", resolution="720p",
                    num_outputs=1, ingredient_image_paths=[f"image-{i}.png" for i in range(count)])

    def encode(self, path):
        return dict(local_path="C:/images/"+path, filename=path, base64="fake", mime="image/png")

    @patch("app.veo.service._encode_image_file")
    @patch("app.veo.media_registry.get_cached_media_id", return_value="cached-id")
    def test_preserves_all_files_in_order_even_with_cache(self, cached, encode):
        encode.side_effect=self.encode
        for count in (1,2,3):
            req=service._build_verified_flow_request(self.job(count))
            self.assertEqual([i["filename"] for i in req["ingredient_images"]], self.job(count)["ingredient_image_paths"])
            self.assertIsNone(req["image_local_path"])
            self.assertIsNone(req["end_image_local_path"])
            self.assertEqual(req["ingredient_media_ids"], [])
            self.assertTrue(all("base64" not in image for image in req["ingredient_images"]))
        cached.assert_not_called()

    @patch("app.veo.service._encode_image_file")
    def test_eight_seconds_stays_eight(self, encode):
        encode.side_effect=self.encode
        req=service._build_verified_flow_request(self.job(duration=8))
        self.assertEqual(req["duration_seconds"],8)
        self.assertEqual(req["provider_model_id"],"abra_r2v_8s")

    def test_rejects_empty_excess_and_id_only_references(self):
        for count in (0,4):
            with self.assertRaises(ValueError):service._build_verified_flow_request(self.job(count))
        job=self.job();job["ingredient_media_ids"]=["unresolved"]
        with self.assertRaises(ValueError):service._build_verified_flow_request(job)

if __name__=="__main__":unittest.main()
