"""Motion dài: chia đoạn, chọn điểm cắt, ghép (ffmpeg thật trên video tổng hợp), hàng đợi không tự gửi lại."""
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.motion_long import merge, plan  # noqa: E402

FFMPEG = shutil.which("ffmpeg") and shutil.which("ffprobe")


class PlanTests(unittest.TestCase):
    def check(self, segs, total):
        self.assertAlmostEqual(segs[0]["start"], 0.0)
        self.assertAlmostEqual(segs[-1]["end"], total, places=2)
        for a, b in zip(segs, segs[1:]):
            self.assertLessEqual(b["start"], a["end"] + 1e-6, "hở một khoảng video giữa hai đoạn")
        for s in segs:
            self.assertGreaterEqual(s["length"], plan.MIN_SEGMENT - 1e-6)
            self.assertLessEqual(s["length"], plan.MAX_SEGMENT + 1e-6)
            self.assertAlmostEqual(s["length"], s["end"] - s["start"], places=4)
            for v in (s["start"], s["end"]):
                self.assertAlmostEqual(v * plan.FPS, round(v * plan.FPS), places=6, msg="mốc không theo khung hình 30fps")

    def test_video_of_test_motion_21_5s(self):
        segs = plan.plan_segments(21.5, 1.0)
        self.assertEqual(len(segs), 3)
        self.check(segs, 21.5)
        self.assertEqual([round(o, 2) for o in plan.overlaps(segs)], [1.0, 1.0])
        self.assertEqual(plan.estimate_credits(segs), 90)

    def test_55_seconds_six_segments(self):
        segs = plan.plan_segments(55, 1.0)
        self.assertEqual(len(segs), 6)
        self.check(segs, 55)

    def test_no_overlap_chains_exactly(self):
        segs = plan.plan_segments(21.5, 0.0)
        self.assertEqual(len(segs), 3)
        self.check(segs, 21.5)
        self.assertEqual(plan.overlaps(segs), [0.0, 0.0])

    def test_short_video_is_single_segment_and_tiny_ones_rejected(self):
        self.assertEqual(len(plan.plan_segments(9.5)), 1)
        self.assertEqual(len(plan.plan_segments(10.0)), 1)
        with self.assertRaises(plan.PlanError):
            plan.plan_segments(2.0)
        with self.assertRaises(plan.PlanError):
            plan.plan_segments(plan.MAX_TOTAL_SECONDS + 1)

    def test_many_durations_stay_valid(self):
        for d in [10.05, 10.5, 11, 12.34, 19.99, 20, 20.01, 29.7, 33.3, 47, 58.9, 120, 299]:
            for ov in (0.0, 0.5, 1.0, 2.0, 3.0):
                self.check(plan.plan_segments(d, ov), round(d * 30) / 30)


class CutTests(unittest.TestCase):
    def test_best_cut_picks_matching_frames_and_keeps_margin(self):
        size = merge.SAMPLE_W * merge.SAMPLE_H
        same = bytes([100]) * size
        other = bytes([200]) * size
        b = [same] * 10
        a = [other] * 10
        for i in (5, 6, 7):
            a[i] = same                   # các cặp khung 5–7 giống nhau; chọn khung giữa vì cả hai bên đều khớp
        idx, scores = merge.best_cut(a, b, half_window=2)
        self.assertEqual(idx, 6)
        self.assertEqual(scores[6], 0.0)
        # Điểm giống nhất nằm sát đầu thì phải lùi vào để còn chỗ chuyển cảnh mờ
        a = [other] * 10
        a[0] = same
        idx, _ = merge.best_cut(a, b, half_window=2)
        self.assertGreaterEqual(idx, 2)

    def test_pieces_and_filter_timeline_length(self):
        segs = [{"start": 0.0, "end": 10.0}, {"start": 9.0, "end": 19.0}, {"start": 18.0, "end": 21.5}]
        joints = [{"cut": 9.5, "fade": 0.25}, {"cut": 18.5, "fade": 0.25}]
        pieces = merge.build_pieces(segs, joints)
        self.assertAlmostEqual(pieces[0]["to"], 9.625)
        self.assertAlmostEqual(pieces[1]["from"], 9.5 - 0.125 - 9.0)
        graph, total = merge.build_filter(pieces, joints, (720, 1280))
        self.assertAlmostEqual(total, 21.5, places=3)          # các mảnh khớp trục thời gian gốc
        self.assertEqual(graph.count("xfade"), 2)
        hard = [{"cut": 10.0, "fade": 0.0}, {"cut": 19.0, "fade": 0.0}]
        segs2 = [{"start": 0.0, "end": 10.0}, {"start": 10.0, "end": 19.0}, {"start": 19.0, "end": 21.5}]
        graph2, total2 = merge.build_filter(merge.build_pieces(segs2, hard), hard, (720, 1280))
        self.assertAlmostEqual(total2, 21.5, places=3)
        self.assertEqual(graph2.count("concat"), 2)


@unittest.skipUnless(FFMPEG, "cần ffmpeg")
class RealMergeTests(unittest.TestCase):
    """Video tổng hợp: một đồng hồ đếm khung chạy 21.5s; mỗi đoạn là một lát của nó. Ghép xong phải liền mạch, đủ độ dài."""

    def setUp(self):
        import tempfile
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.src = self.dir / "src.mp4"
        run = lambda cmd: subprocess.run(cmd, check=True, capture_output=True)
        run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=144x256:rate=24:duration=21.5",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=21.5", "-shortest", "-pix_fmt", "yuv420p", str(self.src)])
        self.segs = plan.plan_segments(21.5, 1.0)
        self.files = []
        for s in self.segs:
            f = self.dir / f"seg{s['index']}.mp4"
            run(["ffmpeg", "-y", "-v", "error", "-ss", f"{s['start']}", "-i", str(self.src), "-t", f"{s['length']}",
                 "-pix_fmt", "yuv420p", str(f)])
            self.files.append(f)

    def test_merge_overlapping_segments_gives_full_length_with_source_audio(self):
        out = self.dir / "final.mp4"
        report = merge.merge_segments(self.segs, self.files, out, audio_mode="original", source_audio=self.src)
        info = merge.probe(out)
        self.assertAlmostEqual(info["duration"], 21.5, delta=0.15)
        self.assertTrue(info["has_audio"])
        self.assertEqual(len(report["joints"]), 2)
        for j in report["joints"]:
            self.assertGreater(j["fade"], 0)
            self.assertLess(j["distance"], 8.0, "cùng nội dung nên điểm cắt phải gần như giống hệt")

    def test_merge_without_overlap_and_without_audio(self):
        segs = plan.plan_segments(21.5, 0.0)
        files = []
        for s in segs:
            f = self.dir / f"n{s['index']}.mp4"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{s['start']}", "-i", str(self.src), "-t", f"{s['length']}",
                            "-pix_fmt", "yuv420p", str(f)], check=True, capture_output=True)
            files.append(f)
        out = self.dir / "n.mp4"
        merge.merge_segments(segs, files, out, audio_mode="none")
        info = merge.probe(out)
        self.assertAlmostEqual(info["duration"], 21.5, delta=0.15)
        self.assertFalse(info["has_audio"])

    def test_merge_with_music_loops_to_full_length(self):
        music = self.dir / "m.mp3"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", str(music)], check=True, capture_output=True)
        out = self.dir / "b.mp4"
        merge.merge_segments(self.segs, self.files, out, audio_mode="bgm", music=music)
        info = merge.probe(out)
        self.assertAlmostEqual(info["duration"], 21.5, delta=0.15)
        self.assertTrue(info["has_audio"])

    def test_missing_segment_file_is_reported(self):
        with self.assertRaises(merge.MergeError):
            merge.merge_segments(self.segs, [*self.files[:-1], self.dir / "none.mp4"], self.dir / "x.mp4")


if __name__ == "__main__":
    unittest.main()


class ErrorTextTests(unittest.TestCase):
    def test_known_flow_errors_get_a_plain_explanation_and_keep_the_original(self):
        from app.motion_long import service
        raw = 'Google Flow: Flow RPC jIps6 envelope error: [..."PUBLIC_ERROR_UNUSUAL_ACTIVITY"]'
        text = service.explain_error(raw)
        self.assertTrue(text.startswith(raw))
        self.assertIn("chờ vài phút", text)
        self.assertIn("RECITATION", service.explain_error("FINISH_REASON_VIDEO_RECITATION"))
        self.assertEqual(service.explain_error("lỗi lạ"), "lỗi lạ")
