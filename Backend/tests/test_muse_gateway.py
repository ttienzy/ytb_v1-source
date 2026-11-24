"""Gateway Muse (HTTP + Noise): phần thuần, không gọi mạng."""
from __future__ import annotations

import base64
import json

import pytest

from app.ai.muse import gateway as g
from app.ai.muse.noise_xx import NoiseError, NoiseXX
from app.ai.muse.schemas import MuseGenerateRequest


# --------------------------------------------------------------------------- Noise


def _handshake():
    i, r = NoiseXX(True), NoiseXX(False)
    r.read_message(i.write_message())
    i.read_message(r.write_message())
    m3 = i.write_message()
    r.read_message(m3)
    return i, r, m3


def test_noise_xx_roundtrip_and_sizes():
    i, r, m3 = _handshake()
    assert len(m3) == 64  # khớp kích thước bản tin 3 trong HAR của trình duyệt
    assert i.remote_static == r.s.pub and r.remote_static == i.s.pub
    for k in range(5):
        assert r.decrypt(i.encrypt(b"x%d" % k)) == b"x%d" % k
        assert i.decrypt(r.encrypt(b"y%d" % k)) == b"y%d" % k


def test_noise_rejects_tampering_and_wrong_turn():
    i, r, _ = _handshake()
    c = bytearray(i.encrypt(b"hello"))
    c[0] ^= 1
    with pytest.raises(NoiseError):
        r.decrypt(bytes(c))
    with pytest.raises(NoiseError):
        NoiseXX(True).read_message(b"\x00" * 32)


# --------------------------------------------------------------------------- protobuf


def test_request_encoding_parses_back():
    raw = g.encode_request(0, 7, "POST", "/chat/stream", {"x-request-id": "abc"}, b'{"a":1}')
    sr = g._parse(raw)
    assert 1 not in sr  # service 0 (daemon) là giá trị mặc định, không ghi
    sf = g._parse(sr[2][0])
    assert sf[1] == [7]
    app = g._parse(sf[2][0])
    assert app[1] == [b"POST"] and app[2] == [b"/chat/stream"] and app[4] == [b'{"a":1}'] and app[5] == [1]
    hdr = g._parse(app[3][0])
    assert hdr[1] == [b"x-request-id"] and hdr[2] == [b"abc"]


def test_transport_negative_chunk_id_roundtrip():
    t = g._parse(g.encode_transport(-5, 2, 3, b"xyz"))
    assert g._signed64(t[1][0]) == -5 and t[2] == [2] and t[3] == [3] and t[4] == [b"xyz"]


def _response_bytes(stream_id, status, body, end):
    app = g._f_varint(1, status) + g._f_bytes(3, body) + g._f_varint(4, 1 if end else 0)
    app += g._f_bytes(2, g._f_bytes(1, b"Content-Type") + g._f_bytes(2, b"application/json"))
    frame = g._f_varint(1, stream_id) + g._f_bytes(3, app)
    return g._f_bytes(1, frame)


def test_decode_response_and_reset():
    fr = g.decode_frame(_response_bytes(3, 404, b"nope", True))
    assert (fr.stream_id, fr.kind, fr.status, fr.data, fr.end_body) == (3, "response", 404, b"nope", True)
    assert fr.headers == {"content-type": "application/json"}
    reset = g._f_bytes(1, g._f_varint(1, 9) + g._f_bytes(5, g._f_varint(1, 2) + g._f_bytes(2, b"timeout")))
    fr = g.decode_frame(reset)
    assert (fr.kind, fr.reset_code, fr.reset_reason) == ("reset", 2, "timeout")


# --------------------------------------------------------------------------- gửi chia khúc


class _FakeWS:
    def __init__(self):
        self.sent = []

    def send_bytes(self, data, timeout=None):
        self.sent.append(data)


def _bare_gateway():
    gw = g.MuseGateway.__new__(g.MuseGateway)
    i, r, _ = _handshake()
    gw.noise, gw.ws = i, _FakeWS()
    import threading

    gw._lock_send, gw._lock_recv, gw._chunks, gw._stream = threading.Lock(), threading.Lock(), {}, 1
    return gw, r


def test_large_request_is_split_into_frames_sharing_chunk_id():
    gw, peer = _bare_gateway()
    payload = bytes(range(256)) * 700  # ~179 KB, như một ảnh đính kèm
    gw._send(0, payload)
    frames = [g._parse(peer.decrypt(c)) for c in gw.ws.sent]
    assert len(frames) == -(-len(payload) // g.FRAME_CHUNK)
    assert len({f[1][0] for f in frames}) == 1
    assert [f[2][0] for f in frames] == list(range(len(frames)))
    assert all(f[3][0] == len(frames) for f in frames)
    assert b"".join(f[4][0] for f in frames) == payload
    assert all(len(c) <= 65535 for c in gw.ws.sent)


# --------------------------------------------------------------------------- đính kèm & upload


def test_attachment_items_follow_web_client_rules(tmp_path, monkeypatch):
    img = tmp_path / "a.png"
    img.write_bytes(b"\x89PNG" + b"0" * 100)
    small_vid = tmp_path / "s.mp4"
    small_vid.write_bytes(b"v" * 10)
    big_pdf = tmp_path / "doc.pdf"
    big_pdf.write_bytes(b"p" * 10)
    monkeypatch.setattr(g, "INLINE_FILE_MAX", 5)  # coi pdf 10 byte là "lớn"
    uploaded = []
    gw = g.MuseGateway.__new__(g.MuseGateway)
    gw.upload_file = lambda local, remote: uploaded.append((local, remote))
    items = gw.attachment_items([str(img), str(small_vid), str(big_pdf)])
    assert items[0]["type"] == "image" and items[0]["mime_type"] == "image/png"
    assert base64.b64decode(items[0]["data_base64"]) == img.read_bytes()
    assert items[1] == {"type": "file", "mime_type": "video/mp4", "data_base64": base64.b64encode(b"v" * 10).decode(), "filename": "s.mp4"}
    assert items[2]["type"] == "file_ref" and items[2]["path"].startswith("workspace/user/files/doc_")
    assert uploaded == [(str(big_pdf), items[2]["path"])]


def test_upload_file_stages_multi_chunk_then_renames(tmp_path, monkeypatch):
    monkeypatch.setattr(g, "UPLOAD_CHUNK", 4)
    f = tmp_path / "v.mp4"
    f.write_bytes(b"0123456789")  # 3 khúc
    calls = []

    def call_json(method, body=None, query=None, timeout=30):
        calls.append((method, body))
        if method == "fs.stat":
            return {"kind": "file", "size": 10}
        return {}

    gw = g.MuseGateway.__new__(g.MuseGateway)
    gw.call_json = call_json
    gw.upload_file(str(f), "workspace/user/files/v_1_abcd.mp4")
    writes = [b for m, b in calls if m == "fs.write"]
    assert len(writes) == 3
    assert writes[0]["path"].startswith("workspace/user/files/.upload-") and writes[0]["path"].endswith(".part")
    assert [w["overwrite"] for w in writes] == [True, False, False]
    assert [w["append"] for w in writes] == [False, True, True]
    assert b"".join(base64.b64decode(w["data_base64"]) for w in writes) == b"0123456789"
    assert calls[-1] == ("fs.rename", {"source": writes[0]["path"], "destination": "workspace/user/files/v_1_abcd.mp4",
                                       "create_parent": True, "overwrite": True})


def test_upload_path_is_sanitized():
    p = g.upload_path_for("ảnh mẫu (1).PNG")
    assert p.startswith("workspace/user/files/") and p.endswith(".PNG") and " " not in p and "(" not in p


# --------------------------------------------------------------------------- đọc sự kiện


def _ev(seq, name="message.assistant", text="", status="completed", data=None, reply_to=None):
    return {"seq": seq, "event_name": name,
            "payload": {"display_text": text, "status": status, "data": data or {}, "reply_to_message_id": reply_to}}


def test_event_resources_and_reply_detection():
    vid = {"path": "sandbox://workspace/imagine_media/x.mp4", "mime": "video/mp4"}
    ev = _ev(24, "delta.presentation", "Video", status=None, data={"videos": [vid]})
    res = g.event_resources(ev)
    assert res == [{"path": vid["path"], "kind": "video", "mime": "video/mp4"}]
    assert g.guess_media_kind(res[0]) == "video"
    assert g.is_reply(_ev(23, text="xong"), 22)
    assert not g.is_reply(_ev(23, text="xong", reply_to="m1"), 22)  # tin chủ động
    assert not g.is_reply(_ev(23, text="đang viết", status=None), 22)
    assert not g.is_reply(_ev(20, text="cũ"), 22)
    assert g.media_path(vid) == "/media/raw/workspace/imagine_media/x.mp4"
    with pytest.raises(ValueError):
        g.media_path("sandbox://workspace/../etc/passwd")


class _FakeHistoryGW:
    def __init__(self, timeline):
        self.timeline = timeline  # list các danh sách sự kiện, mỗi lần gọi history trả phần tử kế tiếp
        self.calls = 0

    def history(self, session_id=None, limit=20):
        evs = self.timeline[min(self.calls, len(self.timeline) - 1)]
        self.calls += 1
        return evs


def test_wait_for_result_waits_for_media_then_settles(monkeypatch):
    monkeypatch.setattr(g.time, "sleep", lambda s: None)
    vid = {"path": "sandbox://workspace/a.mp4", "mime": "video/mp4"}
    timeline = [
        [_ev(11, "message.user", "prompt", status=None)],
        [_ev(11, "message.user", "prompt", status=None), _ev(12, text="Video của bạn đã sẵn sàng.")],
        [_ev(11, "message.user", "prompt", status=None), _ev(12, text="Video của bạn đã sẵn sàng."),
         _ev(13, "delta.presentation", status=None, data={"videos": [vid]})],
    ]
    gw = _FakeHistoryGW(timeline)
    res = g.wait_for_result(gw, None, 10, want={"video"}, timeout=60, settle=0)
    assert not res.timed_out and [r["path"] for r in res.resources] == [vid["path"]]
    assert res.reply_text == "Video của bạn đã sẵn sàng."


def test_wait_for_result_reply_grace_without_media(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(g.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + s))
    monkeypatch.setattr(g.time, "time", lambda: clock[0])
    gw = _FakeHistoryGW([[_ev(12, text="Bạn muốn video dài bao nhiêu giây?")]])
    res = g.wait_for_result(gw, None, 10, want={"video"}, timeout=600, poll=10, reply_grace=60)
    assert not res.timed_out and res.resources == [] and "bao nhiêu" in res.reply_text
    assert clock[0] - 1000 < 120


# --------------------------------------------------------------------------- service: không gửi lại


class _FakeGW:
    instances = []

    def __init__(self, fail_waits=0):
        self.cookies, self.viewer_id = "hatch_sess=x", "111"
        self.sent = []
        self.fail_waits = fail_waits
        _FakeGW.instances.append(self)

    def start_session(self, title=None):
        return "sess-1"

    def history(self, session_id=None, limit=20):
        return [{"seq": 5}]

    def attachment_items(self, paths):
        return [{"type": "image", "path": p} for p in paths]

    def send_items(self, items, node_id, session_id=None):
        self.sent.append((items, session_id))
        return 1

    def download(self, ref, dest, timeout=600):
        with open(dest, "wb") as fh:
            fh.write(b"mp4")
        return 3

    def close(self):
        pass


def test_generate_http_never_resends_after_connection_drop(tmp_path, monkeypatch):
    from app.ai.muse import service as svc_mod
    from app.ai.muse.accounts import MuseAccountStore

    store = MuseAccountStore(tmp_path)
    acc = store.add_account(viewer_id="111", cookies="hatch_sess=x", ua="UA", partition=str(tmp_path / "p"), cdp_port=9300)
    svc = svc_mod.MuseService()
    monkeypatch.setattr(svc_mod.MuseService, "get_store", staticmethod(lambda: store))
    monkeypatch.setattr(svc, "get_config", lambda: {"timeout_seconds": 120})
    monkeypatch.setattr(svc, "get_download_dir", lambda: tmp_path)
    monkeypatch.setattr(svc_mod.time, "sleep", lambda s: None)
    _FakeGW.instances = []
    monkeypatch.setattr(svc, "_connect", lambda a: _FakeGW())

    waits = {"n": 0}

    def fake_wait(gw, session_id, baseline, **kw):
        waits["n"] += 1
        if waits["n"] == 1:
            raise ConnectionError("ws closed")  # rớt mạng lúc đang chờ
        r = g.ChatResult(session_id=session_id, baseline_seq=baseline, reply_text="Xong")
        r.resources = [{"path": "sandbox://workspace/v.mp4", "mime": "video/mp4"}]
        return r

    monkeypatch.setattr(svc_mod, "wait_for_result", fake_wait)
    ref = tmp_path / "ref.png"
    ref.write_bytes(b"x")
    res = svc.generate_video(MuseGenerateRequest(prompt="mèo chạy", use_side_chat=True, reference_images=[str(ref)]))

    assert res.ok, res.error
    assert res.local_path and res.local_path.endswith(".mp4") and res.session_id == "sess-1"
    sent = [s for gw in _FakeGW.instances for s in gw.sent]
    assert len(sent) == 1  # chỉ gửi đúng 1 lần dù đã kết nối lại
    assert sent[0][0][0] == {"type": "text", "text": "mèo chạy"} and sent[0][1] == "sess-1"
    assert len(_FakeGW.instances) == 2  # kết nối lại để đọc tiếp
    assert store.get_account(acc["id"])["last_session_id"] == "sess-1"


def test_generate_without_accounts_asks_to_add_one(tmp_path, monkeypatch):
    from app.ai.muse import service as svc_mod
    from app.ai.muse.accounts import MuseAccountStore

    store = MuseAccountStore(tmp_path)
    svc = svc_mod.MuseService()
    monkeypatch.setattr(svc_mod.MuseService, "get_store", staticmethod(lambda: store))
    monkeypatch.setattr(svc, "get_config", lambda: {})
    res = svc.generate_video(MuseGenerateRequest(prompt="x"))
    assert not res.ok and "Thêm tài khoản Muse" in res.error


def test_generate_http_image_output(tmp_path, monkeypatch):
    from app.ai.muse import service as svc_mod
    from app.ai.muse.accounts import MuseAccountStore

    store = MuseAccountStore(tmp_path)
    store.add_account(viewer_id="111", cookies="hatch_sess=x", ua="UA", partition=str(tmp_path / "p"), cdp_port=9300)
    svc = svc_mod.MuseService()
    monkeypatch.setattr(svc_mod.MuseService, "get_store", staticmethod(lambda: store))
    monkeypatch.setattr(svc, "get_config", lambda: {"default_prompt_prefix": "cinematic 8k"})
    monkeypatch.setattr(svc, "get_download_dir", lambda: tmp_path)
    monkeypatch.setattr(svc_mod, "MUSE_OUTPUT_DIR", tmp_path / "outputs")
    from app.workflow import image_library
    monkeypatch.setattr(image_library, "INDEX_FILE", tmp_path / "image_library.json")
    monkeypatch.setattr(image_library, "MUSE_OUTPUT_DIR", tmp_path / "outputs")
    _FakeGW.instances = []
    titles = []

    class GW(_FakeGW):
        def start_session(self, title=None):
            titles.append(title)
            return "sess-img"

    monkeypatch.setattr(svc, "_connect", lambda a: GW())
    seen = {}

    def fake_wait(gw, session_id, baseline, **kw):
        seen["want"] = kw.get("want")
        r = g.ChatResult(session_id=session_id, baseline_seq=baseline, reply_text="Here it is")
        r.resources = [{"path": "sandbox://workspace/imagine_media/x.png", "mime": "image/png"}]
        return r

    monkeypatch.setattr(svc_mod, "wait_for_result", fake_wait)
    ref = tmp_path / "outfit.jpg"
    ref.write_bytes(b"x")
    res = svc.generate_video(MuseGenerateRequest(
        prompt="Extract ONLY the outfit", output_kind="image", apply_prefix=False, use_side_chat=True,
        chat_title="Muse Canvas · Tách áo quần", file_prefix="outfit extract", reference_images=[str(ref)]))
    assert res.ok, res.error
    assert seen["want"] == {"image"} and res.output_kind == "image"
    assert res.local_path.startswith(str(tmp_path / "outputs")) and res.local_path.endswith(".png")
    assert res.preview_url.startswith("/api/ai/muse/output?file=outfit_extract_")
    sent = [s for gw in _FakeGW.instances for s in gw.sent]
    assert sent[0][0][0] == {"type": "text", "text": "Extract ONLY the outfit"}  # không chèn tiền tố chung
    assert titles == ["Muse Canvas · Tách áo quần"]
    lib_items = image_library.list_images()
    assert [i["path"] for i in lib_items] == [res.local_path]
    assert lib_items[0]["source"] == "muse" and lib_items[0]["label"] == "Tách áo quần"
    assert lib_items[0]["meta"]["prompt"] == "Extract ONLY the outfit" and lib_items[0]["meta"]["session_id"] == "sess-img"


def test_wait_for_result_text_mode_collects_all_replies(monkeypatch):
    monkeypatch.setattr(g.time, "sleep", lambda s: None)
    # lịch sử trả mới nhất trước: vẫn ghép đúng thứ tự seq
    gw = _FakeHistoryGW([[_ev(13, text="Phần 2"), _ev(12, text="Phần 1"), _ev(11, "message.user", "prompt", status=None)]])
    res = g.wait_for_result(gw, None, 10, want=set(), timeout=60, settle=0)
    assert not res.timed_out and res.reply_texts == ["Phần 1", "Phần 2"] and res.reply_text == "Phần 2"


def test_generate_http_text_output_saves_markdown(tmp_path, monkeypatch):
    from app.ai.muse import service as svc_mod
    from app.ai.muse.accounts import MuseAccountStore

    store = MuseAccountStore(tmp_path)
    store.add_account(viewer_id="111", cookies="hatch_sess=x", ua="UA", partition=str(tmp_path / "p"), cdp_port=9300)
    svc = svc_mod.MuseService()
    monkeypatch.setattr(svc_mod.MuseService, "get_store", staticmethod(lambda: store))
    monkeypatch.setattr(svc, "get_config", lambda: {})
    monkeypatch.setattr(svc, "get_download_dir", lambda: tmp_path)
    monkeypatch.setattr(svc_mod, "MUSE_TEXT_DIR", tmp_path / "texts")
    _FakeGW.instances = []
    monkeypatch.setattr(svc, "_connect", lambda a: _FakeGW())
    seen = {}

    def fake_wait(gw, session_id, baseline, **kw):
        seen.update(kw)
        r = g.ChatResult(session_id=session_id, baseline_seq=baseline, reply_text="## Segment 2")
        r.reply_texts = ["## Concept", "## Segment 2"]
        return r

    monkeypatch.setattr(svc_mod, "wait_for_result", fake_wait)
    ref = tmp_path / "board.webp"
    ref.write_bytes(b"x")
    res = svc.generate_video(MuseGenerateRequest(
        prompt="Write the script", output_kind="text", apply_prefix=False, file_prefix="mc_script",
        reference_images=[str(ref)]))
    assert res.ok, res.error
    assert seen["want"] == set() and seen["settle"] == svc_mod.TEXT_SETTLE_SECONDS
    assert res.output_kind == "text" and res.reply_text == "## Concept\n\n## Segment 2"
    assert res.local_path.endswith(".md") and res.local_path.startswith(str(tmp_path / "texts"))
    assert open(res.local_path, encoding="utf-8").read().startswith("## Concept")
    assert res.preview_url is None


def test_generate_http_text_output_empty_reply_fails_without_resend(tmp_path, monkeypatch):
    from app.ai.muse import service as svc_mod
    from app.ai.muse.accounts import MuseAccountStore

    store = MuseAccountStore(tmp_path)
    store.add_account(viewer_id="111", cookies="hatch_sess=x", ua="UA", partition=str(tmp_path / "p"), cdp_port=9300)
    svc = svc_mod.MuseService()
    monkeypatch.setattr(svc_mod.MuseService, "get_store", staticmethod(lambda: store))
    monkeypatch.setattr(svc, "get_config", lambda: {"timeout_seconds": 600})
    monkeypatch.setattr(svc_mod, "MUSE_TEXT_DIR", tmp_path / "texts")
    _FakeGW.instances = []
    monkeypatch.setattr(svc, "_connect", lambda a: _FakeGW())

    def fake_wait(gw, session_id, baseline, **kw):
        r = g.ChatResult(session_id=session_id, baseline_seq=baseline)
        r.timed_out = True
        return r

    monkeypatch.setattr(svc_mod, "wait_for_result", fake_wait)
    res = svc.generate_video(MuseGenerateRequest(prompt="x", output_kind="text", apply_prefix=False))
    assert not res.ok and "đừng gửi lại" in res.error
    assert len([s for gw in _FakeGW.instances for s in gw.sent]) == 1


def test_generate_http_video_collect_all_downloads_every_clip(tmp_path, monkeypatch):
    from app.ai.muse import service as svc_mod
    from app.ai.muse.accounts import MuseAccountStore

    store = MuseAccountStore(tmp_path)
    store.add_account(viewer_id="111", cookies="hatch_sess=x", ua="UA", partition=str(tmp_path / "p"), cdp_port=9300)
    svc = svc_mod.MuseService()
    monkeypatch.setattr(svc_mod.MuseService, "get_store", staticmethod(lambda: store))
    monkeypatch.setattr(svc, "get_config", lambda: {})
    monkeypatch.setattr(svc, "get_download_dir", lambda: tmp_path)
    _FakeGW.instances = []
    monkeypatch.setattr(svc, "_connect", lambda a: _FakeGW())
    seen = {}

    def fake_wait(gw, session_id, baseline, **kw):
        seen.update(kw)
        r = g.ChatResult(session_id=session_id, baseline_seq=baseline, reply_text="Done")
        r.resources = [{"path": f"sandbox://workspace/seg{i}.mp4", "mime": "video/mp4"} for i in (1, 2, 3)]
        return r

    monkeypatch.setattr(svc_mod, "wait_for_result", fake_wait)
    res = svc.generate_video(MuseGenerateRequest(
        prompt="Make the video", output_kind="video", apply_prefix=False, file_prefix="mc_video",
        settle_seconds=90, collect_all=True))
    assert res.ok, res.error
    assert seen["settle"] == 90 and seen["want"] == {"video"}
    assert [p.rsplit("_", 1)[-1] for p in res.local_paths] == ["01.mp4", "02.mp4", "03.mp4"]
    assert res.local_path == res.local_paths[-1] and res.video_url == "sandbox://workspace/seg3.mp4"
    # mặc định: chỉ file cuối, chờ im lặng 15 s
    res2 = svc.generate_video(MuseGenerateRequest(prompt="x", output_kind="video", apply_prefix=False))
    assert seen["settle"] == 15 and len(res2.local_paths) == 1 and res2.local_paths[0] == res2.local_path


def test_clean_error_text():
    html = "<html><body>AsyncSocketException: Network error, type = Network error, errno = 104 (Connection reset by peer)</body></html>"
    cleaned = g._clean_error_text(html, 503)
    assert "<" not in cleaned and ">" not in cleaned
    assert "Connection reset by peer" in cleaned

    generic_html = "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1><p>server down</p></body></html>"
    assert "server down" in g._clean_error_text(generic_html, 502)


def test_resolve_vm_retries_transient_503(monkeypatch):
    calls = []

    def fake_session_info(cookies, ua):
        calls.append(len(calls))
        if len(calls) == 1:
            raise g.MuseGatewayError(503, "socket reset")
        return {"vm_id": "vm-123", "vm_state": "RUNNING"}

    monkeypatch.setattr(g, "session_info", fake_session_info)
    monkeypatch.setattr("time.sleep", lambda s: None)
    vm_id = g.resolve_vm("cookies", "ua", "token", wait_seconds=10)
    assert vm_id == "vm-123"
    assert len(calls) == 2
