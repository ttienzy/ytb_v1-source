"""Provider rejection must stop a batch without discarding earlier images."""
from contextlib import ExitStack
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.veo import service
from app.veo.models import VeoImage, VeoProject
from app.veo.schemas import VeoImageGenerateRequest


class ImageGenerationErrorTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        VeoProject.__table__.create(engine)
        VeoImage.__table__.create(engine)
        factory = sessionmaker(bind=engine)
        with factory() as db:
            db.add(VeoProject(id="fixture", name="Fixture", flow_project_id="flow-fixture"))
            db.commit()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in (("SessionLocal", factory), ("init_db", lambda: None)):
            self.stack.enter_context(patch.object(service, name, value))
        self.stack.enter_context(patch.object(service.bridge, "is_bridge_running", return_value=True))
        self.stack.enter_context(patch.object(service.bridge, "get_extension_info", return_value={"connected": True}))
        self.stack.enter_context(patch.object(service.time, "sleep"))
        self.dispatch = self.stack.enter_context(patch.object(service.bridge, "request_generate_image", return_value="fixture-request"))
        self.wait = self.stack.enter_context(patch.object(service.bridge, "wait_image_result"))
        self.req = VeoImageGenerateRequest(prompt="fixture", project_id="fixture", count=4, seed=0)

    def test_provider_block_stops_remaining_variations(self):
        self.wait.return_value = {"error": "PUBLIC_ERROR_UNUSUAL_ACTIVITY"}
        result = service.generate_images(self.req)
        self.assertFalse(result.ok)
        self.assertIn("PUBLIC_ERROR_UNUSUAL_ACTIVITY", result.error)
        self.dispatch.assert_called_once()
        self.assertEqual(self.dispatch.call_args.args[0]["seed"], 0)

    def test_partial_success_preserves_image_and_block_reason(self):
        self.wait.side_effect = [
            {"result": {"ok": True, "images": [{"media_id": "fixture-media", "seed": 0}]}},
            {"error": "PUBLIC_ERROR_UNUSUAL_ACTIVITY"},
        ]
        result = service.generate_images(self.req)
        self.assertTrue(result.ok)
        self.assertEqual(len(result.images), 1)
        self.assertEqual(result.images[0].media_id, "fixture-media")
        self.assertIn("PUBLIC_ERROR_UNUSUAL_ACTIVITY", result.error)
        self.assertEqual(self.dispatch.call_count, 2)


if __name__ == "__main__":
    unittest.main()
