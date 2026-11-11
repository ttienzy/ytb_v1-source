"""Flow UI gate + bridge queue hygiene (TTL, cancel, orphan results). No Google calls."""
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from app.veo import bridge, service


def _drain():
    while True:
        try:
            bridge._captcha_pending.get_nowait()
        except Exception:
            return


class FifoGateTests(unittest.TestCase):
    def test_holders_never_overlap_and_run_in_arrival_order(self):
        gate = service._FifoGate(min_gap_seconds=0)
        order, active, overlap = [], [0], [False]

        def worker(name):
            assert gate.acquire(name, timeout=5)
            active[0] += 1
            overlap[0] = overlap[0] or active[0] > 1
            order.append(name)
            time.sleep(0.05)
            active[0] -= 1
            gate.release()

        threads = []
        for name in ("a", "b", "c"):
            t = threading.Thread(target=worker, args=(name,))
            t.start()
            threads.append(t)
            time.sleep(0.02)  # fix arrival order
        for t in threads:
            t.join(5)
        self.assertEqual(order, ["a", "b", "c"])
        self.assertFalse(overlap[0])

    def test_timeout_leaves_gate_usable(self):
        gate = service._FifoGate(min_gap_seconds=0)
        self.assertTrue(gate.acquire("holder", 1))
        self.assertFalse(gate.acquire("late", 0.05))
        gate.release()
        self.assertTrue(gate.acquire("next", 1))


class BridgeQueueTests(unittest.TestCase):
    def setUp(self):
        _drain()
        bridge._cancelled.clear()

    def tearDown(self):
        _drain()

    def test_expired_job_is_dropped_and_waiter_fails_fast(self):
        rid = bridge.request_generate_image({"prompt": "x"})
        bridge._captcha_pending.queue[0]["expires_at"] = time.time() - 1  # extension never picked it up
        self.assertIsNone(bridge._pop_next_job())
        self.assertIn("không nhận việc", bridge.wait_image_result(rid, timeout=0.2)["error"])

    def test_cancel_removes_queued_job_so_it_never_runs(self):
        keep = bridge.request_generate_image({"prompt": "keep"})
        drop = bridge.request_generate_image({"prompt": "drop"})
        self.assertTrue(bridge.cancel_request(drop))
        self.assertEqual(bridge._pop_next_job()["request_id"], keep)
        self.assertIsNone(bridge._pop_next_job())

    def test_cancel_after_pickup_discards_late_result(self):
        rid = bridge.request_generate_image({"prompt": "x"})
        bridge._pop_next_job()  # extension already took it
        self.assertFalse(bridge.cancel_request(rid))
        self.assertTrue(bridge._discard_if_cancelled(rid))

    def test_purge_removes_only_stale_results(self):
        now = time.time()
        bridge._flow_results["old-1"] = {"received_at": now - bridge.RESULT_TTL_SECONDS - 5}
        bridge._flow_results["fresh-1"] = {"received_at": now}
        try:
            bridge.purge_stale(now)
            self.assertNotIn("old-1", bridge._flow_results)
            self.assertIn("fresh-1", bridge._flow_results)
        finally:
            bridge._flow_results.pop("fresh-1", None)


class JobStoreConcurrencyTests(unittest.TestCase):
    def test_concurrent_updates_and_saves_keep_file_valid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "veo_jobs.json"
            jobs = {f"j{i}": {"job_id": f"j{i}", "status": "pending"} for i in range(20)}
            errors = []

            def hammer(job):
                try:
                    for n in range(40):
                        service._update_job(job, service.JobStatus.GENERATING, f"step {n}")
                except Exception as exc:  # pragma: no cover - failure path
                    errors.append(exc)

            with patch.object(service, "_VEO_JOBS_FILE", target), patch.object(service, "_jobs", jobs):
                threads = [threading.Thread(target=hammer, args=(j,)) for j in jobs.values()]
                for t in threads:
                    t.start()
                for t in threads:
                    t.join(30)
                saved = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(errors, [])
            self.assertEqual(len(saved), 20)
            self.assertEqual(list(Path(tmp).glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
