"""PoC: codec cho giao thức batchexecute của Google Flow (flow.google.com).

Chỉ chứa phần thuần (không I/O, không mạng): dựng request, giải mã response.
Nguồn sự thật: HAR `flow.google_2_new_credit_check_11_09.com` (ghi 2026-11-09).

Giao thức (quan sát trong HAR, KHÔNG phải API công khai của Google):
  POST https://flow.google.com/u/{n}/_/AiSandboxAngularFrontend/data/batchexecute
       ?rpcids=<RPC>&source-path=/u/{n}/project/<pid>&bl=<build>&f.sid=<sid>&hl=en&_reqid=<n>&rt=c
  body (form): f.req=[[[<RPC>, "<json payload>", null, "generic"]]]  &  at=<SNlM0e>
  Cookie: session Google (HttpOnly) -> phải gửi từ trình duyệt đang đăng nhập.

RPC dùng ở đây:
  YhhmEf  submit text-to-video
  jwpduf  poll trạng thái 1 media
  as29s   lấy chi tiết media (khi xong có URL flow-content.google đã ký)

Trạng thái media: record[5][8][0] -> 6 = vừa tạo/xếp hàng, 2 = đang render, 3 = xong.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any
from urllib.parse import urlencode

BATCH_PATH = "/_/AiSandboxAngularFrontend/data/batchexecute"

RPC_SUBMIT_T2V = "YhhmEf"
RPC_POLL = "jwpduf"
RPC_ASSET = "as29s"

STATE_QUEUED = 6
STATE_RENDERING = 2
STATE_DONE = 3

# Model id quan sát trong HAR 2026-11-09 (RPC yBhWQ trả danh sách model khả dụng).
# `macaron_cookie` là suy luận: xuất hiện cùng banner "Introducing Gemini Omni 1.2 Flash".
MODEL_OMNI_12_T2V_10S = "macaron_cookie_t2v_10s"
MODEL_OMNI_12_T2V_10S_360P = "macaron_cookie_t2v_10s_360p"  # đã chạy live 2026-11-09 (resCode 4, 10 credit)

# item[2] của request tạo video. Xác nhận: HAR UI 16:9 có item[2]=2 và telemetry aspectRatio=2; mọi request trước đó
# (UI 9:16 và PoC) có item[2]=1 và ra video dọc 720x1280 / 360x640.
ASPECT_PORTRAIT = 1   # 9:16
ASPECT_LANDSCAPE = 2  # 16:9


def _new_id() -> str:
    return str(uuid.uuid4()).upper()


def build_t2v_payload(
    prompt: str,
    model: str,
    project_id: str,
    captcha_token: str,
    *,
    aspect: int = ASPECT_PORTRAIT,
    flag_360: bool = False,
    copies: int = 1,
    id_a: str | None = None,
    id_b: str | None = None,
    scene_id: str | None = None,
) -> list[Any]:
    """Payload `YhhmEf` (text-to-video). Cấu trúc khớp 1:1 với HAR.

    aspect: item[2] = tỉ lệ (1 = 9:16 dọc, 2 = 16:9 ngang). KHÔNG phải số lượng video.
    copies: số video = số item trong payload[0].
    flag_360: UI thêm item[7] = [4] khi chọn 360p (độ phân giải thật nằm ở hậu tố `_360p` của model id).
    """
    def item() -> list[Any]:
        it: list[Any] = [
            [None, None, [[[prompt]]]],
            model,
            aspect,
            None,
            [None, None, None, None, id_a or _new_id(), id_b or _new_id()],
        ]
        if flag_360:
            it += [None, None, [4]]
        return it

    return [
        [item() for _ in range(copies)],
        [None, 22, None, None, None, project_id, None, None, None, None, [captcha_token, 1]],
        [scene_id or _new_id(), 2],
    ]


def build_poll_payload(media_id: str) -> list[Any]:
    return [None, None, [[media_id]]]


def build_asset_payload(media_id: str) -> list[Any]:
    """as29s lấy link video đã ký: payload CHỈ là [media_id] (xác nhận live 2026-11-09).

    Biến thể [media_id, None, [1]] chỉ trả thumbnail lh3.googleusercontent.com, không có URL video.
    """
    return [media_id]


def build_thumbnail_payload(media_id: str) -> list[Any]:
    return [media_id, None, [1]]


def encode_request(
    rpc_id: str,
    payload: Any,
    *,
    at: str,
    build_label: str,
    session_id: str,
    source_path: str,
    hl: str = "en",
    reqid: int = 100000,
    account_index: int = 1,
) -> tuple[str, str]:
    """Trả (url_path_with_query, form_body)."""
    query = urlencode({
        "rpcids": rpc_id,
        "source-path": source_path,
        "bl": build_label,
        "f.sid": session_id,
        "hl": hl,
        "_reqid": reqid,
        "rt": "c",
    })
    f_req = json.dumps([[[rpc_id, json.dumps(payload, ensure_ascii=False, separators=(",", ":")), None, "generic"]]],
                       ensure_ascii=False, separators=(",", ":"))
    body = urlencode({"f.req": f_req, "at": at})
    return f"/u/{account_index}{BATCH_PATH}?{query}", body


def decode_request_payload(form_body: str) -> tuple[str, Any]:
    """Ngược lại encode_request: (rpc_id, payload) từ body form (dùng để so với HAR)."""
    from urllib.parse import parse_qs

    f_req = json.loads(parse_qs(form_body, keep_blank_values=True)["f.req"][0])
    rpc_id, inner = f_req[0][0][0], f_req[0][0][1]
    return rpc_id, json.loads(inner)


def parse_response(text: str) -> dict[str, Any]:
    """Giải mã response batchexecute -> {rpc_id: payload}. Bỏ qua dòng độ dài/`)]}'`."""
    out: dict[str, Any] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("["):
            continue
        try:
            frames = json.loads(line)
        except ValueError:
            continue
        for item in frames:
            if isinstance(item, list) and len(item) > 2 and item[0] == "wrb.fr" and isinstance(item[2], str):
                out[item[1]] = json.loads(item[2])
    return out


def media_record(rpc_id: str, payload: Any) -> list[Any]:
    """Lấy record media từ payload của từng RPC."""
    if rpc_id == RPC_SUBMIT_T2V:
        return payload[3][0]
    if rpc_id == RPC_POLL:
        return payload[2][0]
    if rpc_id == RPC_ASSET:
        return payload
    raise ValueError(f"unsupported rpc {rpc_id}")


def media_state(record: list[Any]) -> int | None:
    try:
        return record[5][8][0]
    except (IndexError, TypeError):
        return None


def media_id(record: list[Any]) -> str:
    return record[0]


def submit_balance(payload: Any) -> int | None:
    """payload[1] của submit: giảm 1000->980->950 theo từng lần tạo => số dư credit (suy luận)."""
    try:
        return int(payload[1])
    except (IndexError, TypeError, ValueError):
        return None


_VIDEO_URL = re.compile(r"https://flow-content\.google/video/[0-9a-f-]{36}\?[^\"\\\s]+")


def find_video_url(payload: Any) -> str | None:
    """URL mp4 đã ký nằm đâu đó trong payload `as29s` khi media xong."""
    m = _VIDEO_URL.search(json.dumps(payload, ensure_ascii=False).replace("\\u0026", "&").replace("\\u003d", "="))
    return m.group(0) if m else None


# ── Frames (khung đầu + khung cuối, i2v_fl) ─────────────────────────────────────────────────────────────────────
# Nguồn: HAR flow.google_2_test_gd_7.com (6s) và flow.google_2_new_credit_check_11_09_v2.com (10s, 10s_360p).
RPC_SUBMIT_FRAMES = "nprQif"
MODEL_OMNI_12_I2V_FL_RE = re.compile(r"^macaron_cookie_i2v_fl_(\d+)s(_360p)?$")
VERIFIED_I2V_FL_DURATIONS = (6, 10)   # 6s: HAR gd_7 (18 credit @720p); 10s: HAR v2 (30 @720p, 10 @360p)


def center_crop(width: int, height: int, target_aspect: float = 9 / 16) -> list[Any]:
    """Hình chữ nhật cắt ảnh về đúng tỉ lệ video, dạng Flow dùng: [trên, trái, dưới, phải] (0–1), None = 0.

    Quan sát trong HAR: ảnh 16:9 -> 9:16 gửi [None, 0.3418, 1, 0.6582] (giữ giữa theo chiều ngang);
    ảnh gần 9:16 gửi [0.0012, None, 0.9988, 1] (cắt rất ít theo chiều dọc); không cắt = [None, None, 1, 1].
    """
    ratio = width / height
    if abs(ratio - target_aspect) < 1e-9:
        return [None, None, 1, 1]
    if ratio > target_aspect:                      # ảnh rộng hơn video -> cắt hai bên
        frac = target_aspect / ratio
        left = (1 - frac) / 2
        return [None, left, 1, left + frac]
    frac = ratio / target_aspect                   # ảnh cao hơn video -> cắt trên/dưới
    top = (1 - frac) / 2
    return [top, None, top + frac, 1]


def build_frames_payload(
    prompt: str,
    model: str,
    project_id: str,
    captcha_token: str,
    start_media_id: str,
    end_media_id: str,
    *,
    aspect: int = ASPECT_PORTRAIT,
    start_crop: list[Any] | None = None,
    end_crop: list[Any] | None = None,
    id_a: str | None = None,
    id_b: str | None = None,
    scene_id: str | None = None,
) -> list[Any]:
    """Payload `nprQif` (frames đầu–cuối). 360p KHÔNG có cờ phụ: độ phân giải nằm ở hậu tố `_360p` của model id."""
    def slot(media_id: str, crop: list[Any] | None) -> list[Any]:
        return [None, media_id, None, None, None, crop if crop is not None else [None, None, 1, 1]]

    item = [
        [None, None, [[[prompt]]]],
        model,
        aspect,
        None,
        slot(start_media_id, start_crop),
        slot(end_media_id, end_crop),
        [None, None, None, None, id_a or _new_id(), id_b or _new_id()],
    ]
    return [
        [item],
        [None, 22, None, None, None, project_id, None, None, None, None, [captcha_token, 1]],
        [scene_id or _new_id(), 2],
    ]
