"""Requesting 3 images: Flow only offers x1/x2/x4, so it returns 4 and the app keeps exactly 3."""
from contextlib import ExitStack
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.veo import service
from app.veo.models import VeoImage, VeoProject
from app.veo.schemas import VeoImageGenerateRequest


class ImageVariantCountTests(unittest.TestCase):
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
        self.stack.enter_context(patch.object(service, "_download_image_to_local", return_value=None))
        self.dispatch = self.stack.enter_context(patch.object(service.bridge, "request_generate_image", return_value="req"))
        self.wait = self.stack.enter_context(patch.object(service.bridge, "wait_image_result"))

    def _images(self, n):
        return [{"media_id": f"m{i}", "image_url": "", "seed": i} for i in range(n)]

    def test_three_requested_keeps_three_of_four(self):
        self.wait.return_value = {"result": {"ok": True, "images": self._images(4)}}
        result = service.generate_images(VeoImageGenerateRequest(prompt="x", project_id="fixture", count=3))
        self.assertTrue(result.ok)
        self.assertEqual([i.media_id for i in result.images], ["m0", "m1", "m2"])
        self.dispatch.assert_called_once()
        self.assertEqual(self.dispatch.call_args.args[0]["count"], 3)


if __name__ == "__main__":
    unittest.main()
