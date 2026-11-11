"""Omni 1.2 Flash (macaron_cookie_*): ánh xạ model id, giới hạn tổ hợp đã xác minh, công tắc transport."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.veo import service  # noqa: E402


def job(**kw):
    base = {
        "job_id": "t1", "prompt": "dragon", "project_id": "p1", "flow_project_id": "p1",
        "model_display_name": "Omni 1.2 Flash", "input_mode": "text_to_video",
        "duration_seconds": 10, "resolution": "720p", "aspect_ratio": "9:16", "num_outputs": 1,
    }
    base.update(kw)
    return base


class Omni12Tests(unittest.TestCase):
    def test_maps_to_macaron_model_id(self):
        self.assertEqual(service._resolve_provider_model_id(job()), "macaron_cookie_t2v_10s")
        self.assertEqual(service._build_verified_flow_request(job())["provider_model_id"], "macaron_cookie_t2v_10s")

    def test_360p_uses_suffixed_model_id(self):
        r = service._build_verified_flow_request(job(resolution="360p"))
        self.assertEqual(r["provider_model_id"], "macaron_cookie_t2v_10s_360p")
        self.assertEqual(r["resolution"], "360p")

    def test_omni_11_still_uses_abra(self):
        self.assertEqual(service._resolve_provider_model_id(job(model_display_name="Omni 1.1 Flash", duration_seconds=8)), "abra_t2v_8s")

    def test_transport_defaults_to_http_and_can_be_forced_to_ui(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("FLOW_TRANSPORT", None)
            self.assertEqual(service._build_verified_flow_request(job())["transport"], "http")
        with mock.patch.dict(os.environ, {"FLOW_TRANSPORT": "ui"}):
            self.assertEqual(service._build_verified_flow_request(job())["transport"], "ui")
        self.assertEqual(service._build_verified_flow_request(job(transport="UI"))["transport"], "ui")

    def test_rejects_unverified_combinations(self):
        for bad in (dict(duration_seconds=8), dict(duration_seconds=15), dict(resolution="1080p"), dict(num_outputs=2)):
            with self.assertRaises(ValueError, msg=str(bad)):
                service._build_verified_flow_request(job(**bad))
        for mode in ("frames", "ingredients", "video_edit"):
            with self.assertRaises(ValueError, msg=mode):
                service._build_verified_flow_request(job(input_mode=mode))

    def test_model_listed_with_credit_profiles(self):
        self.assertIn("Omni 1.2 Flash", [m["display_name"] for m in service._DEFAULT_MODELS])
        # Tạo-từ-chữ của Omni 1.2 chỉ có 10 giây; Ingredients/Frames được kiểm ở Omni12CatalogTests.
        rows = [r for r in service._build_profiles() if r["model_display_name"] == "Omni 1.2 Flash" and r["input_mode"] == "text_to_video"]
        self.assertEqual({(r["aspect_ratio"], r["duration_seconds"], r["resolution"], r["credit_cost"]) for r in rows},
                         {("16:9", 10, "720p", 30), ("9:16", 10, "720p", 30), ("16:9", 10, "360p", 10), ("9:16", 10, "360p", 10)})
        self.assertTrue(all(r["provider_model_id"].startswith("macaron_cookie_t2v_10s") for r in rows))
        self.assertTrue(all(r["provider_model_id"].endswith("_360p") == (r["resolution"] == "360p") for r in rows))


if __name__ == "__main__":
    unittest.main()


class HttpNoCaptchaAndProviderIdTests(unittest.TestCase):
    def test_flag_true_only_for_proven_http_combinations(self):
        for kw in (dict(), dict(resolution="360p"), dict(aspect_ratio="9:16"), dict(aspect_ratio="16:9", resolution="360p")):
            self.assertTrue(service._build_verified_flow_request(job(**kw))["http_no_captcha"], kw)

    def test_flag_false_when_transport_ui_or_other_model(self):
        self.assertFalse(service._build_verified_flow_request(job(transport="ui"))["http_no_captcha"])
        omni11 = service._build_verified_flow_request(job(model_display_name="Omni 1.1 Flash", duration_seconds=8))
        self.assertFalse(omni11["http_no_captcha"])

    def test_eligibility_mirrors_extension_rules(self):
        base = {"transport": "http", "input_mode": "text_to_video", "provider_model_id": "macaron_cookie_t2v_10s",
                "resolution": "720p", "aspect_ratio": "9:16", "num_outputs": 1}
        self.assertTrue(service._http_video_eligible(base))
        for change in (dict(transport="ui"), dict(input_mode="frames"), dict(provider_model_id="abra_t2v_6s"),
                       dict(resolution="360p"), dict(aspect_ratio="1:1"), dict(aspect_ratio=None), dict(num_outputs=2),
                       dict(provider_model_id="macaron_cookie_t2v_10s_360p")):
            self.assertFalse(service._http_video_eligible({**base, **change}), change)
        self.assertTrue(service._http_video_eligible({**base, "provider_model_id": "macaron_cookie_t2v_10s_360p", "resolution": "360p"}))

    def test_job_provider_model_id_never_falls_back_to_legacy_abra_6s(self):
        # Job chưa có provider_model_id (như job 046cd005): phải suy ra từ cấu hình, không phải 'abra_t2v_6s'
        self.assertEqual(service._job_provider_model_id(job()), "macaron_cookie_t2v_10s")
        self.assertEqual(service._job_provider_model_id(job(resolution="360p")), "macaron_cookie_t2v_10s_360p")
        self.assertEqual(service._job_provider_model_id(job(provider_model_id="custom")), "custom")
        self.assertEqual(service._job_provider_model_id(job(model_display_name="Omni 1.1 Flash", duration_seconds=8)), "abra_t2v_8s")


# ── Frames đầu–cuối (i2v_fl) ─────────────────────────────────────────────────────────────────────────────────
import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402

from PIL import Image  # noqa: E402


class Omni12FramesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.start = cls.tmp / "start.png"
        cls.end = cls.tmp / "end.png"
        Image.new("RGB", (540, 960), (200, 10, 10)).save(cls.start)
        Image.new("RGB", (540, 960), (10, 10, 200)).save(cls.end)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def fjob(self, **kw):
        base = dict(input_mode="frames", duration_seconds=6, image_path=str(self.start), end_image_path=str(self.end))
        base.update(kw)
        return job(**base)

    def test_resolves_i2v_fl_model_ids(self):
        self.assertEqual(service._resolve_provider_model_id(self.fjob()), "macaron_cookie_i2v_fl_6s")
        self.assertEqual(service._resolve_provider_model_id(self.fjob(duration_seconds=10)), "macaron_cookie_i2v_fl_10s")
        self.assertEqual(service._resolve_provider_model_id(self.fjob(duration_seconds=10, resolution="360p")), "macaron_cookie_i2v_fl_10s_360p")

    def test_builds_request_with_both_frames_and_http_flag(self):
        r = service._build_verified_flow_request(self.fjob())
        self.assertEqual(r["provider_model_id"], "macaron_cookie_i2v_fl_6s")
        self.assertEqual((r["duration_seconds"], r["resolution"], r["aspect_ratio"]), (6, "720p", "9:16"))
        self.assertTrue(r["image_base64"] and r["end_image_base64"])
        self.assertEqual((r["image_width"], r["image_height"], r["end_image_width"], r["end_image_height"]), (540, 960, 540, 960))
        self.assertTrue(r["http_no_captcha"], "frames Omni 1.2 đi đường HTTP, không giải captcha thừa")

    def test_http_flag_off_when_transport_is_ui(self):
        self.assertFalse(service._build_verified_flow_request(self.fjob(transport="ui"))["http_no_captcha"])

    def test_rejects_unverified_frames_combinations(self):
        no_end = job(input_mode="frames", duration_seconds=6, image_path=str(self.start))
        with self.assertRaisesRegex(ValueError, "CẢ khung hình đầu và khung hình cuối"):
            service._build_verified_flow_request(no_end)
        for bad in (dict(duration_seconds=8), dict(duration_seconds=4), dict(resolution="1080p"), dict(num_outputs=2)):
            with self.assertRaises(ValueError, msg=str(bad)):
                service._build_verified_flow_request(self.fjob(**bad))
        for mode in ("ingredients", "video_edit"):
            with self.assertRaises(ValueError, msg=mode):
                service._build_verified_flow_request(job(input_mode=mode))

    def test_omni_11_frames_unchanged(self):
        with self.assertRaisesRegex(ValueError, "Omni 1.1 Flash, 720p"):
            service._build_verified_flow_request(self.fjob(model_display_name="Omni 1.1 Flash", resolution="360p"))

    @unittest.skipUnless(shutil.which("node"), "cần node để so khớp với extension")
    def test_http_eligibility_matches_extension_canUseHttpVideo(self):
        """Backend và extension PHẢI cùng quyết định (nếu lệch, backend sẽ chờ token reCAPTCHA không bao giờ tới)."""
        b64, dims = "QUJD", dict(image_width=540, image_height=960, end_image_width=540, end_image_height=960)
        base = dict(transport="http", num_outputs=1, aspect_ratio="9:16", resolution="720p", **dims)
        frames = dict(base, input_mode="frames", provider_model_id="macaron_cookie_i2v_fl_6s", duration_seconds=6,
                      image_base64=b64, end_image_base64=b64)
        t2v = dict(base, input_mode="text_to_video", provider_model_id="macaron_cookie_t2v_10s", duration_seconds=10)
        img = {"base64": b64, "mime": "image/png", "filename": "a.png"}
        r2v = dict(base, input_mode="ingredients", provider_model_id="macaron_cookie_r2v_15s", duration_seconds=15, ingredient_images=[img])
        r2v_cases = [
            r2v, {**r2v, "ingredient_images": [img, img, img]}, {**r2v, "ingredient_images": [img] * 4}, {**r2v, "ingredient_images": []},
            {**r2v, "ingredient_images": [{"filename": "a.png"}]},                                           # thiếu base64
            {**r2v, "provider_model_id": "macaron_cookie_r2v_13s", "duration_seconds": 13},
            {**r2v, "provider_model_id": "macaron_cookie_r2v_15s_360p", "resolution": "360p"},
            {**r2v, "provider_model_id": "macaron_cookie_r2v_15s_360p"},                                     # 360p lệch resolution
            {**r2v, "duration_seconds": 10}, {**r2v, "provider_model_id": "macaron_cookie_r2v_10s", "duration_seconds": 10},
            {**r2v, "transport": "ui"}, {**r2v, "num_outputs": 2}, {**r2v, "ingredient_images": None},
            {**r2v, "ingredient_images": [], "ingredient_media_ids": ["fc102da0-ae54-4e5c-a482-a0fe916911a7"]},          # chỉ mã có sẵn trong project
            {**r2v, "ingredient_media_ids": ["fc102da0-ae54-4e5c-a482-a0fe916911a7"]},                                   # 1 ảnh + 1 mã
            {**r2v, "ingredient_images": [img, img], "ingredient_media_ids": ["fc102da0-ae54-4e5c-a482-a0fe916911a7"] * 2},   # 4 > 3
            {**r2v, "ingredient_images": [], "ingredient_media_ids": ["not-a-uuid"]},
            {**r2v, "ingredient_images": [], "ingredient_media_ids": []},
        ]
        vid, char = "6b600f7b-b779-4c7d-86c8-87e0187d93ec", "0e462dd0-b83c-4414-b0ec-1f8fbb5d158d"
        edit = dict(base, input_mode="video_edit", provider_model_id="macaron_cookie_edit", duration_seconds=10,
                    reference_video_id=vid, reference_video_start_seconds=0, reference_video_end_seconds=8,
                    ingredient_inputs=[{"media_id": char}], ingredient_media_ids=[char], ingredient_images=[])
        local = {"local_path": "C:/a.png", "filename": "a.png"}
        edit_cases = [
            edit, {**edit, "aspect_ratio": "16:9"},
            {**edit, "ingredient_inputs": [local, {"media_id": char}], "ingredient_images": [img]},              # ảnh cục bộ + mã có sẵn
            {**edit, "ingredient_inputs": [local], "ingredient_media_ids": [], "ingredient_images": [{"filename": "a.png"}]},  # thiếu base64
            {**edit, "ingredient_inputs": [local], "ingredient_media_ids": [], "ingredient_images": [img, img]},  # thừa ảnh
            {**edit, "ingredient_inputs": [], "ingredient_media_ids": [], "ingredient_images": []},               # không ảnh -> UI
            {**edit, "ingredient_inputs": [{"media_id": char}] * 4},
            {**edit, "ingredient_inputs": None, "ingredient_media_ids": [char], "ingredient_images": [img]},      # không có ingredient_inputs
            {**edit, "resolution": "360p"}, {**edit, "provider_model_id": "abra_edit"}, {**edit, "transport": "ui"},
            {**edit, "reference_video_id": "not-a-uuid"}, {**edit, "reference_video_id": None},
            {**edit, "reference_video_end_seconds": 10}, {**edit, "reference_video_end_seconds": 10.5},
            {**edit, "reference_video_start_seconds": 4, "reference_video_end_seconds": 4},
            {**edit, "reference_video_start_seconds": -1}, {**edit, "num_outputs": 2},
        ]
        cases = [
            frames, t2v,
            {**frames, "transport": "ui"}, {**frames, "end_image_base64": ""}, {**frames, "image_base64": None},
            {**frames, "image_width": 0}, {**frames, "duration_seconds": 10}, {**frames, "provider_model_id": "macaron_cookie_i2v_fl_8s", "duration_seconds": 8},
            {**frames, "provider_model_id": "macaron_cookie_i2v_fl_10s", "duration_seconds": 10},
            {**frames, "provider_model_id": "macaron_cookie_i2v_fl_10s_360p", "duration_seconds": 10, "resolution": "360p"},
            {**frames, "provider_model_id": "macaron_cookie_i2v_fl_10s_360p", "duration_seconds": 10},       # 360p lệch resolution
            {**frames, "aspect_ratio": "1:1"}, {**frames, "num_outputs": 2},
            {**frames, "provider_model_id": "omni_flash_i2v_10s_first_last", "duration_seconds": 10},
            {**frames, "input_mode": "ingredients"}, {**t2v, "resolution": "360p"},
            {**t2v, "provider_model_id": "macaron_cookie_t2v_10s_360p", "resolution": "360p"},
            *r2v_cases,
            *edit_cases,
        ]
        ext = Path(__file__).resolve().parents[2] / "Extensions" / "FlowsVeo-Clean" / "src" / "providers" / "google-flow" / "page" / "video-http.js"
        script = (
            "import(process.argv[1]).then(m => { const cases = JSON.parse(process.argv[2]);"
            " console.log(JSON.stringify(cases.map(c => m.canUseHttpVideo(c)))); });"
        )
        out = subprocess.run(["node", "-e", script, ext.as_uri(), json.dumps(cases)], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        js = json.loads(out.stdout.strip().splitlines()[-1])
        py = [service._http_video_eligible(c) for c in cases]
        mismatches = [(i, py[i], js[i]) for i in range(len(cases)) if py[i] != js[i]]
        self.assertEqual(mismatches, [], f"lệch giữa backend và extension: {mismatches}")
        self.assertTrue(py[0] and py[1] and not py[2])
        start = len(cases) - len(edit_cases)
        self.assertEqual(py[start:start + 6], [True, True, True, False, False, False], "Motion Control: chỉ đi HTTP khi có 1–3 ảnh hợp lệ")


class Omni12IngredientsTests(unittest.TestCase):
    """Chế độ Thành phần (r2v): HAR gd_7 (13s 720p) + credit_check v2 (15s 360p); 15s 720p theo cùng mẫu model id."""

    @staticmethod
    def ijob(tmp, **kw):
        return job(**{"input_mode": "ingredients", "duration_seconds": 15, "ingredient_image_paths": [str(tmp)], **kw})

    def setUp(self):
        import tempfile
        from PIL import Image
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.img = Path(self.dir.name) / "sheet.png"
        Image.new("RGB", (160, 90), (200, 200, 200)).save(self.img)

    def test_model_ids_follow_the_har_pattern(self):
        self.assertEqual(service._resolve_provider_model_id(self.ijob(self.img)), "macaron_cookie_r2v_15s")
        self.assertEqual(service._resolve_provider_model_id(self.ijob(self.img, resolution="360p")), "macaron_cookie_r2v_15s_360p")
        self.assertEqual(service._resolve_provider_model_id(self.ijob(self.img, duration_seconds=13)), "macaron_cookie_r2v_13s")

    def test_request_carries_base64_for_the_http_path(self):
        r = service._build_verified_flow_request(self.ijob(self.img))
        self.assertEqual((r["provider_model_id"], r["duration_seconds"], r["resolution"]), ("macaron_cookie_r2v_15s", 15, "720p"))
        self.assertEqual(len(r["ingredient_images"]), 1)
        self.assertTrue(r["ingredient_images"][0]["base64"])
        self.assertTrue(r["http_no_captcha"])

    def test_unverified_durations_and_counts_are_rejected(self):
        # Ingredients Omni 1.2 nhận 3–15 giây (v2.4); ngoài khoảng đó, 1080p hay nhiều video mỗi lượt bị chặn.
        for bad in (dict(duration_seconds=2), dict(duration_seconds=16), dict(resolution="1080p"), dict(num_outputs=2)):
            with self.assertRaises(ValueError, msg=str(bad)):
                service._build_verified_flow_request(self.ijob(self.img, **bad))
        with self.assertRaises(ValueError):
            service._build_verified_flow_request({**self.ijob(self.img), "ingredient_image_paths": [str(self.img)] * 4})

    def test_existing_project_media_ids_need_no_file_or_upload(self):
        mid = "fc102da0-ae54-4e5c-a482-a0fe916911a7"
        r = service._build_verified_flow_request(job(input_mode="ingredients", duration_seconds=15, ingredient_media_ids=[mid]))
        self.assertEqual((r["provider_model_id"], r["ingredient_media_ids"], r["ingredient_images"]), ("macaron_cookie_r2v_15s", [mid], []))
        self.assertTrue(r["http_no_captcha"])
        with self.assertRaises(ValueError):          # không có ảnh nào
            service._build_verified_flow_request(job(input_mode="ingredients", duration_seconds=15))
        with self.assertRaises(ValueError):          # quá 3 ảnh tổng cộng
            service._build_verified_flow_request(job(input_mode="ingredients", duration_seconds=15, ingredient_media_ids=[mid] * 4))

    def test_omni_11_ingredients_still_strip_base64(self):
        r = service._build_verified_flow_request(job(model_display_name="Omni 1.1 Flash", input_mode="ingredients",
                                                     duration_seconds=8, ingredient_image_paths=[str(self.img)]))
        self.assertTrue(all("base64" not in i for i in r["ingredient_images"]))
        self.assertFalse(r["http_no_captcha"])

    def test_schema_accepts_15_seconds(self):
        from app.veo.schemas import VeoJobRequest
        self.assertEqual(VeoJobRequest(prompt="x", duration_seconds=15).duration_seconds, 15)
        with self.assertRaises(Exception):
            VeoJobRequest(prompt="x", duration_seconds=16)


class Omni12CatalogTests(unittest.TestCase):
    """Catalog Veo (Veo Studio + AI Workflow đọc chung): Omni 1.2 có Ingredients 3–15s và Frames đầu–cuối 6/10s."""

    def setUp(self):
        self.caps = service.get_capabilities()
        self.rows = [p for p in self.caps.profiles if p.model_display_name == "Omni 1.2 Flash"]

    def test_model_lists_all_three_modes_and_3_to_15_seconds(self):
        m = next(m for m in self.caps.models if m.display_name == "Omni 1.2 Flash")
        self.assertEqual(sorted(str(getattr(x, "value", x)) for x in m.supported_modes), ["frames", "ingredients", "text_to_video"])
        self.assertEqual(list(m.supported_durations), list(range(3, 16)))

    def test_ingredient_prices_use_measured_points_then_the_formula(self):
        ingr = {(p.resolution, p.duration_seconds, p.aspect_ratio): p for p in self.rows if str(getattr(p.input_mode, "value", p.input_mode)) == "ingredients"}
        self.assertEqual(ingr[("720p", 13, "9:16")].credit_cost, 48)          # đã đo
        self.assertEqual(ingr[("360p", 15, "9:16")].credit_cost, 20)          # đã đo
        self.assertEqual(ingr[("720p", 8, "9:16")].credit_cost, 24)           # công thức 3/giây
        self.assertEqual(ingr[("720p", 12, "16:9")].credit_cost, 42)          # gấp đôi từ giây 11
        self.assertTrue(ingr[("720p", 6, "9:16")].runtime_verified)           # clip thật của Chiến dịch AI
        self.assertFalse(ingr[("360p", 4, "9:16")].runtime_verified)
        self.assertEqual(len(ingr), 13 * 2 * 2)

    def test_every_catalog_row_is_accepted_by_the_request_builder(self):
        with tempfile.TemporaryDirectory() as d:
            img = Path(d) / "a.png"
            from PIL import Image
            Image.new("RGB", (64, 96), "white").save(img)
            for p in self.rows:
                mode = str(getattr(p.input_mode, "value", p.input_mode))
                extra = {}
                if mode == "ingredients":
                    extra = {"ingredient_image_paths": [str(img)]}
                elif mode == "frames":
                    extra = {"image_path": str(img), "end_image_path": str(img)}
                elif mode == "video_edit":
                    extra = {"reference_video_id": "vid", "ingredient_image_paths": [str(img)]}
                r = service._build_verified_flow_request(job(input_mode=mode, duration_seconds=p.duration_seconds,
                                                              resolution=p.resolution, aspect_ratio=p.aspect_ratio, **extra))
                self.assertEqual(r["provider_model_id"], p.provider_model_id, p.id)
