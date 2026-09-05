"""Config handshake regression tests; isolated loopback server, no Google calls."""

import base64
import importlib.util
import json
from pathlib import Path
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class BridgeConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / 'app/veo/bridge.py'
        spec = importlib.util.spec_from_file_location('isolated_veo_bridge', path)
        cls.bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.bridge)
        cls.bridge._bridge_secret = 'test-only-secret'
        cls.server = cls.bridge.ThreadingHTTPServer(
            ('127.0.0.1', 0), cls.bridge.BridgeHandler
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_config_available_for_new_and_legacy_clients(self):
        for method in ('POST', 'GET'):
            with self.subTest(method=method):
                req = Request(self.base + '/api/v1/config/init', method=method,
                              headers={'X-Bridge-Key': 'test-only-secret'})
                with urlopen(req, timeout=2) as response:
                    envelope = json.load(response)
                config = json.loads(base64.b64decode(envelope['payload']))
                self.assertTrue(envelope['v'])
                self.assertEqual(config['c']['m'], 'grecaptcha')
                self.assertEqual(config['c']['s'], 'enterprise')

    def test_both_config_methods_require_secret(self):
        for method in ('POST', 'GET'):
            with self.subTest(method=method):
                req = Request(self.base + '/api/v1/config/init', method=method)
                with self.assertRaises(HTTPError) as result:
                    urlopen(req, timeout=2)
                self.assertEqual(result.exception.code, 403)
                result.exception.close()

    def test_unknown_route_does_not_masquerade_as_success(self):
        with self.assertRaises(HTTPError) as result:
            urlopen(self.base + '/not-a-real-endpoint', timeout=2)
        self.assertEqual(result.exception.code, 404)
        result.exception.close()

    def test_flow_result_round_trip_is_authenticated(self):
        request_id = 'flow-round-trip-test'
        body = json.dumps({
            'request_id': request_id,
            'result': {'ok': True, 'media_id': 'media-test', 'video_url': 'https://flow-content.google/test'},
            'error': None,
        }).encode('utf-8')
        req = Request(
            self.base + '/flow/response', method='POST', data=body,
            headers={'X-Bridge-Key': 'test-only-secret', 'Content-Type': 'application/json'},
        )
        with urlopen(req, timeout=2) as response:
            self.assertTrue(json.load(response)['ok'])
        envelope = self.bridge.wait_flow_result(request_id, timeout=0.1)
        self.assertEqual(envelope['result']['media_id'], 'media-test')
        self.assertIsNone(envelope['error'])

    def test_captcha_job_carries_flow_request(self):
        flow_request = {'prompt': 'Cat', 'duration_seconds': 6}
        request_id = self.bridge.request_captcha(flow_request=flow_request)
        queued = self.bridge._captcha_pending.get_nowait()
        self.assertEqual(queued['request_id'], request_id)
        self.assertEqual(queued['flow_request'], flow_request)


if __name__ == '__main__':
    unittest.main()
