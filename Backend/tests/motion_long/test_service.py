"""Hàng đợi Motion dài với Flow giả: tuần tự, dừng khi lỗi, không tự gửi lại, theo dõi tiếp sau khi khởi động lại."""
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.motion_long import service  # noqa: E402

HAS_FFMPEG = bool(shutil.which("ffmpeg"))


def make_video(path: Path, seconds: float, rate: int = 24, audio: bool = False) -> None:
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=144x256:rate={rate}:duration={seconds}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-shortest"]
    subprocess.run([*cmd, "-pix_fmt", "yuv420p", str(path)], check=True)


@unittest.skipUnless(HAS_FFMPEG, "cần ffmpeg")
class QueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.out = self.tmp / "veo_out"
        self.out.mkdir()
        for p in (mock.patch.object(service, "DATA_DIR", self.tmp / "ml"), mock.patch.object(service, "POLL_SECONDS", 0.01)):
            p.start()
            self.addCleanup(p.stop)
        service._jobs.clear()
        service._workers.clear()
        service._stop_flags.clear()
        service._loaded = True
        self.src = self.tmp / "src.mp4"
        make_video(self.src, 21.5, rate=30, audio=True)
        self.img = self.tmp / "a.png"
        self.img.write_bytes(b"x")
        self.submitted: list[dict] = []
        self.fail_on: set[int] = set()
        self.veo_jobs: dict[str, SimpleNamespace] = {}

        def upload(req):
            return {"ok": True, "media_id": f"11111111-2222-4333-8444-{len(self.submitted):012d}"}

        def submit(req):
            jid = f"veo{len(self.submitted)}"
            self.submitted.append({"key": req.idempotency_key, "end": req.reference_video_end_seconds,
                                   "start": req.reference_video_start_seconds})
            seg = int(req.idempotency_key.split("-s")[1].split("-")[0])
            if seg in self.fail_on:
                self.veo_jobs[jid] = SimpleNamespace(status="error", current_step="", error_message="RECITATION",
                                                     error_hint="hint", output_files=[])
            else:
                f = self.out / f"{jid}.mp4"
                make_video(f, req.reference_video_end_seconds)
                self.veo_jobs[jid] = SimpleNamespace(status="done", current_step="", error_message=None,
                                                     error_hint=None, output_files=[f.name])
            return SimpleNamespace(job_id=jid)

        for target, value in [("app.veo.router.upload_video_reference", upload), ("app.veo.service.submit_job", submit),
                              ("app.veo.service.get_job", lambda jid: self.veo_jobs.get(jid)),
                              ("app.veo.service._VEO_DATA_DIR", self.out),
                              ("app.veo.service.create_project", lambda name: SimpleNamespace(id="p1", flow_project_id="f1"))]:
            p = mock.patch(target, value)
            p.start()
            self.addCleanup(p.stop)

    def new_job(self, **opts):
        return service.create_job(self.src, "t.mp4", prompt="p", image_paths=[str(self.img)], options=opts)

    def wait(self, jid):
        for _ in range(600):
            if not service._worker_alive(jid):
                return service.get_job(jid)
            time.sleep(0.05)
        self.fail("hàng đợi không dừng")

    def test_runs_segments_in_order_and_each_gets_its_own_cut(self):
        job = self.new_job()
        self.assertEqual(len(job["segments"]), 3)
        service.start_queue(job["id"])
        done = self.wait(job["id"])
        self.assertEqual([s["state"] for s in done["segments"]], ["done"] * 3)
        self.assertEqual([x["key"].split("-")[-2:] for x in self.submitted], [["s0", "a1"], ["s1", "a1"], ["s2", "a1"]])
        for sub, seg in zip(self.submitted, done["segments"]):
            self.assertEqual(sub["start"], 0.0, "mỗi đoạn đã cắt sẵn từ video gốc nên bắt đầu từ 0")
            self.assertAlmostEqual(sub["end"], seg["length"], places=3)

    def test_error_stops_queue_and_never_resubmits_automatically(self):
        self.fail_on = {1}
        job = self.new_job()
        service.start_queue(job["id"])
        done = self.wait(job["id"])
        self.assertEqual([s["state"] for s in done["segments"]], ["done", "error", "idle"])
        self.assertIn("RECITATION", done["segments"][1]["error"])
        self.assertEqual(len(self.submitted), 2, "đoạn 3 không gửi sau khi đoạn 2 lỗi; đoạn 2 không gửi lại")
        time.sleep(0.3)
        self.assertEqual(len(self.submitted), 2)

    def test_manual_run_of_one_segment_uses_a_fresh_key_and_other_segments_stay(self):
        self.fail_on = {1}
        job = self.new_job()
        service.start_queue(job["id"])
        self.wait(job["id"])
        self.fail_on = set()
        service.start_queue(job["id"], [1])
        done = self.wait(job["id"])
        self.assertEqual(done["segments"][1]["state"], "done")
        self.assertEqual(done["segments"][1]["attempts"], 2)
        self.assertEqual(done["segments"][2]["state"], "idle")
        self.assertTrue(self.submitted[-1]["key"].endswith("-s1-a2"))

    def test_merge_then_clean_export_falls_back_to_segments(self):
        job = self.new_job()
        service.start_queue(job["id"])
        self.wait(job["id"])
        service.start_merge(job["id"], {"audio": "original"})
        for _ in range(200):
            if service.get_job(job["id"])["merge"]["state"] != "running":
                break
            time.sleep(0.1)
        merged = service.get_job(job["id"])
        self.assertEqual(merged["merge"]["state"], "done", merged["merge"])
        self.assertTrue((service.job_dir(job["id"]) / "final.mp4").is_file())

        from app.watermark import service as wm
        calls = []

        def fake_remove(src, dst, on_progress=None, cancelled=None):
            calls.append(Path(src).name)
            if Path(src).name == "final.mp4":
                raise wm.WatermarkVideoError("gwr không xóa được watermark: low confidence")
            shutil.copyfile(src, dst)
            return dst

        with mock.patch.object(wm, "remove_video_watermark_sync", fake_remove):
            service.start_clean_export(job["id"])
            for _ in range(300):
                if service.get_job(job["id"])["exports"]["clean"]["state"] != "running":
                    break
                time.sleep(0.1)
        exp = service.get_job(job["id"])["exports"]["clean"]
        self.assertEqual(exp["state"], "done", exp)
        self.assertEqual(exp["method"], "segments")
        self.assertEqual(calls[0], "final.mp4", "phải thử xóa một lần trên video đã ghép trước")
        self.assertTrue((service.job_dir(job["id"]) / "final_clean.mp4").is_file())

    def test_restart_attaches_to_existing_flow_job_without_resubmitting(self):
        job = self.new_job()
        jid = job["id"]
        f = self.out / "veoX.mp4"
        make_video(f, 7.8)
        self.veo_jobs["veoX"] = SimpleNamespace(status="done", current_step="", error_message=None, error_hint=None,
                                                output_files=[f.name])
        record = service._jobs[jid]
        record["segments"][0].update(state="generating", veo_job_id="veoX")
        record["segments"][1].update(state="uploading")
        service._save(record)
        service._jobs.clear()
        service._loaded = False
        service._load_all()
        done = self.wait(jid)
        self.assertEqual(done["segments"][0]["state"], "done")
        self.assertEqual(done["segments"][1]["state"], "idle")
        self.assertEqual(self.submitted, [], "không được gửi lại đoạn nào sau khi khởi động lại")

    def test_validation_errors(self):
        with self.assertRaises(service.LongMotionError):
            service.create_job(self.src, "t.mp4", prompt="", image_paths=[str(self.img)])
        with self.assertRaises(service.LongMotionError):
            service.create_job(self.src, "t.mp4", prompt="p", image_paths=[])
        with self.assertRaises(service.LongMotionError):
            self.new_job(audio="loud")


if __name__ == "__main__":
    unittest.main()
