"""Pippit.ai (CapCut Commerce) - Đăng video lên Facebook Page qua Pippit (platform_type=301).

Pure HTTP REST API, KHÔNG cần browser.
Reverse-Engineered từ hệ thống ByteDance Passport & CapCut Commerce API:
  1. Login & Auth: Passport email/password XOR 0x05 obfuscation qua /passport/web/email/login/.
  2. Header sign: MD5 sign(path, device_time, appvr).
  3. Workspace ID: Trích xuất trực tiếp từ bootstrap HTML /schedule-publish.
  4. Lấy Real Facebook Pages: Gọi /api/account/v1/get_bind_account_list (platform_type=[301]).
  5. VOD Upload: Chuẩn AWS SigV4 ký với STS credentials + TOS Chunk Multipart Upload CRC32.
  6. Lên lịch đăng Facebook Page: /api/biz/v1/publish/batchcreate_schedule_task (platform_type=301).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import random
import re
import string
import time
import zlib

import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
)
SPACE_NAME = "jianying_vcloud_upload_sg"

PROFILES = {
    "asset": {"appvr": "5.8.0", "app_sdk": "48.0.0"},  # /lv/v1/asset/*
    "publish": {"appvr": "15.4.0", "app_sdk": "127.0.0"},  # /api/biz/v1/publish/*
}

SOON_OFFSET_MS = 60 * 1000  # Hẹn giờ tối thiểu +1 phút
PIPPIT_STATUS_PUBLISHED = 3  # status task đã đăng thành công lên Facebook

GUEST_COOKIES = {
    "x-web-secsdk-uid": "754e5488-b206-4fb1-904e-1cd05ea701ee",
    "passport_csrf_token": "b723293a0dfbc80545ece035597a3e5d",
    "passport_csrf_token_default": "b723293a0dfbc80545ece035597a3e5d",
    "s_v_web_id": "verify_mqsxg0y6_HbbIbwyg_IcWz_4n0E_9fDK_KCxBq7o48HOU",
}


class PippitError(Exception):
    """Lỗi chung khi gọi Pippit."""


class PippitAuthError(PippitError):
    """Cookie Pippit hết hạn / thông tin đăng nhập sai."""


class PippitSetupError(PippitError):
    """Lỗi cấu hình tài khoản hoặc Fanpage."""


def as_proxies(proxy: str | None) -> dict | None:
    """Chuyển chuỗi proxy thành dict cho requests. Rỗng = đi thẳng."""
    raw = (proxy or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        bits = raw.split(":")
        if len(bits) == 4:  # host:port:user:pass
            host, port, user, pw = bits
            raw = f"http://{user}:{pw}@{host}:{port}"
        else:  # host:port
            raw = f"http://{raw}"
    return {"http": raw, "https": raw}


def make_sign(path: str, device_time: str, appvr: str) -> str:
    """Tạo chữ ký MD5 cho header sign của Pippit/CapCut API."""
    return hashlib.md5(
        f"9e2c|{path[-7:]}|7|{appvr}|{device_time}||11ac".encode()
    ).hexdigest()


def _enc_cred(s: str) -> str:
    """Passport email/password obfuscation: XOR mỗi byte với 0x05, hex-encode."""
    return "".join(f"{b ^ 5:02x}" for b in s.encode())


def login(email: str, password: str, proxy: str = "") -> dict:
    """Đăng nhập email + password bằng HTTP thuần túy -> trả về full cookies + workspace_id.
    Không cần mở browser."""
    s = requests.Session()
    s.proxies = as_proxies(proxy) or {}
    for k, v in GUEST_COOKIES.items():
        s.cookies.set(k, v, domain="www.pippit.ai")

    params = {
        "aid": "573081",
        "account_sdk_source": "web",
        "sdk_version": "2.1.10-tiktok",
        "language": "en",
        "verifyFp": GUEST_COOKIES["s_v_web_id"],
    }
    headers = {
        "accept": "application/json, text/javascript",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": UA,
        "origin": "https://www.pippit.ai",
        "referer": "https://www.pippit.ai/login?iframe=1",
        "x-tt-passport-csrf-token": GUEST_COOKIES["passport_csrf_token"],
    }
    body = {
        "mix_mode": "1",
        "email": _enc_cred(email),
        "password": _enc_cred(password),
        "fixed_mix_mode": "1",
    }
    r = s.post(
        "https://www.pippit.ai/passport/web/email/login/",
        params=params,
        headers=headers,
        data=body,
        timeout=30,
    )
    j = r.json()
    if not j.get("data", {}).get("user_id"):
        desc = j.get("data", {}).get("description") or j.get("message") or "Đăng nhập thất bại"
        raise PippitAuthError(f"Đăng nhập Pippit thất bại: {desc}")

    cookies = {**GUEST_COOKIES, **{c.name: c.value for c in s.cookies}}
    cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
    user_id = str(j.get("data", {}).get("user_id", ""))

    # Lấy workspace_id
    workspace_id = fetch_workspace_id(cookie_str, proxy)

    return {
        "cookies": cookie_str,
        "user_id": user_id,
        "workspace_id": workspace_id,
    }


def fetch_workspace_id(cookies: str, proxy: str = "") -> str:
    """Đọc workspace_id của account thẳng từ HTML bootstrap của trang /schedule-publish."""
    r = requests.get(
        "https://www.pippit.ai/schedule-publish",
        headers={"cookie": cookies, "user-agent": UA},
        timeout=30,
        proxies=as_proxies(proxy),
    )
    txt = r.text.replace('\\"', '"')
    m = re.search(r'"workspace_infos":\[\{"workspace_id":"(\d+)"', txt) or re.search(
        r'"workspace_id":"(\d+)"', txt
    )
    if not m:
        # Dự phòng: tìm bất kỳ workspace_id nào trong nội dung
        m2 = re.search(r'workspace_id["\']?\s*[:=]\s*["\']?(\d+)', txt)
        if m2:
            return m2.group(1)
        return "0"
    return m.group(1)


# ===========================================================================
# Helper AWS SigV4 & TOS Upload
# ===========================================================================
def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _amz_date() -> str:
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def _rand_s(n=11) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _crc32(data: bytes) -> str:
    return format(zlib.crc32(data) & 0xFFFFFFFF, "08x")


def aws4_sign(
    method, host, query, sts, amz_date, signed_headers, payload_hash, region="i18n", service="vod"
):
    ak, sk = sts["access_key_id"], sts["secret_access_key"]
    datestamp = amz_date[:8]
    canonical_qs = "&".join(f"{k}={query[k]}" for k in sorted(query))
    canonical_headers = "".join(f"{k}:{signed_headers[k]}\n" for k in sorted(signed_headers))
    signed_headers_str = ";".join(sorted(signed_headers))
    canonical_request = "\n".join(
        [
            method,
            "/",
            canonical_qs,
            canonical_headers,
            signed_headers_str,
            payload_hash,
        ]
    )
    scope = f"{datestamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            _sha256_hex(canonical_request.encode()),
        ]
    )
    k = _hmac(("AWS4" + sk).encode(), datestamp)
    k = _hmac(k, region)
    k = _hmac(k, service)
    k = _hmac(k, "aws4_request")
    signature = hmac.new(k, string_to_sign.encode(), hashlib.sha256).hexdigest()
    return (
        f"AWS4-HMAC-SHA256 Credential={ak}/{scope}, "
        f"SignedHeaders={signed_headers_str}, Signature={signature}"
    )


def apply_upload_inner(sts, upload_domain, file_size):
    """Step 2: ApplyUploadInner -> upload node (StoreUri/Auth/Host/SessionKey)."""
    amz_date = _amz_date()
    query = {
        "Action": "ApplyUploadInner",
        "Version": "2020-11-19",
        "SpaceName": SPACE_NAME,
        "FileType": "video",
        "IsInner": "1",
        "FileSize": str(file_size),
        "s": _rand_s(),
        "device_platform": "web",
    }
    signed = {"x-amz-date": amz_date, "x-amz-security-token": sts["session_token"]}
    auth = aws4_sign("GET", upload_domain, query, sts, amz_date, signed, _sha256_hex(b""))
    headers = {
        "Accept": "*/*",
        "Authorization": auth,
        "Origin": "https://www.pippit.ai",
        "Referer": "https://www.pippit.ai/",
        "User-Agent": UA,
        "X-Amz-Date": amz_date,
        "x-amz-security-token": sts["session_token"],
    }
    r = requests.get(f"https://{upload_domain}/", params=query, headers=headers, timeout=30)
    j = r.json()
    if "Result" not in j:
        raise PippitError(f"ApplyUploadInner thất bại: {j}")
    nodes = ((j.get("Result") or {}).get("InnerUploadAddress") or {}).get("UploadNodes") or []
    if not nodes:
        raise PippitError(f"ApplyUploadInner không trả node upload nào: {str(j)[:300]}")
    return nodes[0]


def tos_upload(node, file_path, storage_u):
    """Step 3: TOS chunk multipart upload kèm CRC32."""
    store_uri = node["StoreInfos"][0]["StoreUri"]
    auth = node["StoreInfos"][0]["Auth"]
    base = f"https://{node['UploadHost']}/upload/v1/{store_uri}"
    common = {
        "authorization": auth,
        "user-agent": UA,
        "origin": "https://www.pippit.ai",
        "referer": "https://www.pippit.ai/",
        "x-storage-u": str(storage_u),
    }
    boundary = "----WebKitFormBoundary" + _rand_s(16)
    r = requests.post(
        base,
        params={"uploadmode": "part", "phase": "init"},
        headers={**common, "content-type": f"multipart/form-data; boundary={boundary}"},
        data=f"--{boundary}--\r\n".encode(),
        timeout=30,
    )
    upload_id = r.json()["data"]["uploadid"]

    with open(file_path, "rb") as f:
        data = f.read()
    crc = _crc32(data)
    requests.post(
        base,
        params={"uploadid": upload_id, "part_number": "1", "phase": "transfer"},
        headers={**common, "content-type": "application/octet-stream", "content-crc32": crc},
        data=data,
        timeout=300,
    )
    requests.post(
        base,
        params={"uploadid": upload_id, "phase": "finish"},
        headers={**common, "content-type": "text/plain;charset=UTF-8"},
        data=f"1:{crc}".encode(),
        timeout=60,
    )
    return upload_id


def commit_upload_inner(sts, upload_domain, session_key):
    """Step 4: CommitUploadInner -> Vid + VideoMeta."""
    amz_date = _amz_date()
    query = {"Action": "CommitUploadInner", "Version": "2020-11-19", "SpaceName": SPACE_NAME}
    body = json.dumps({"SessionKey": session_key, "Functions": []}, separators=(",", ":")).encode()
    payload_hash = _sha256_hex(body)
    signed = {
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "x-amz-security-token": sts["session_token"],
    }
    auth = aws4_sign("POST", upload_domain, query, sts, amz_date, signed, payload_hash)
    headers = {
        "Accept": "*/*",
        "Authorization": auth,
        "Content-Type": "text/plain;charset=UTF-8",
        "Origin": "https://www.pippit.ai",
        "Referer": "https://www.pippit.ai/",
        "User-Agent": UA,
        "X-Amz-Content-Sha256": payload_hash,
        "X-Amz-Date": amz_date,
        "x-amz-security-token": sts["session_token"],
    }
    r = requests.post(
        f"https://{upload_domain}/", params=query, headers=headers, data=body, timeout=30
    )
    j = r.json()
    if "Result" not in j:
        raise PippitError(f"CommitUploadInner thất bại: {j}")
    ket_qua = (j.get("Result") or {}).get("Results") or []
    if not ket_qua:
        raise PippitError(f"CommitUploadInner không trả kết quả nào: {str(j)[:300]}")
    return ket_qua[0]


def post_id_from_link(link: str) -> str:
    """Trích xuất post_id từ link bài đăng Facebook."""
    if not link:
        return ""
    m = re.search(r"[?&](?:story_fbid|fbid|v)=(\d+)", link)
    if m:
        return m.group(1)
    tail = link.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
    return tail if tail.isdigit() else ""


# ===========================================================================
# PippitClient Class
# ===========================================================================
class PippitClient:
    def __init__(self, cookies: str, workspace_id: str = "", proxy: str = "", user_id: str = ""):
        self.cookies = cookies
        self._workspace_id = workspace_id
        self.proxy = proxy
        self._proxies = as_proxies(proxy)
        self.user_id = str(user_id) if user_id else ""

    @property
    def workspace_id(self) -> str:
        if not self._workspace_id:
            self._workspace_id = fetch_workspace_id(self.cookies, self.proxy)
        return self._workspace_id

    def _headers(self, path: str, profile: str = "asset") -> dict:
        p = PROFILES[profile]
        dt = str(int(time.time()))
        return {
            "accept": "application/json, text/plain, */*",
            "app-sdk-version": p["app_sdk"],
            "appid": "573081",
            "appvr": p["appvr"],
            "ccweb-dispatcher-set-upstream-target": "1",
            "content-type": "application/json",
            "device-time": dt,
            "lan": "en",
            "loc": "sg",
            "origin": "https://www.pippit.ai",
            "pf": "7",
            "referer": "https://www.pippit.ai/schedule-publish",
            "sign": make_sign(path, dt, p["appvr"]),
            "sign-ver": "1",
            "user-agent": UA,
            "x-capcut-channel": "release-commerce@1.1850.6-1.0.3.5815",
            "x-idc-region": "sg1",
            "x-subject-appid": "578071",
            "cookie": self.cookies,
        }

    def post(self, path: str, body: dict, profile: str = "asset") -> dict:
        r = requests.post(
            "https://www.pippit.ai" + path,
            headers=self._headers(path, profile),
            data=json.dumps(body, separators=(",", ":")),
            timeout=30,
            proxies=self._proxies,
        )
        return r.json()

    # -- Kéo Real Accounts (Facebook 301 & TikTok 1) ----------------------
    def bound_accounts(self) -> dict[str, list[dict]]:
        """Lấy danh sách các tài khoản liên kết (Facebook Pages, TikTok Channels) từ Pippit."""
        body = {"platform_type": [1, 101, 201, 301, 401, 1001], "tt_creator": True}
        j = self.post("/api/account/v1/get_bind_account_list", body)
        if j.get("ret") != "0":
            if str(j.get("ret")) == "1017":
                raise PippitAuthError("Cookie Pippit đã hết hạn - Cần đăng nhập lại.")
            raise PippitError(f"get_bind_account_list thất bại: {j}")
        p_info = (j.get("data") or {}).get("platform_user_info") or {}
        
        fb = p_info.get("301", []) or []
        tt = (p_info.get("1", []) or []) + (p_info.get("101", []) or []) + (p_info.get("1001", []) or [])
        return {"facebook": fb, "tiktok": tt}

    def facebook_accounts(self) -> list[dict]:
        """Lấy danh sách các Facebook Pages thật đã liên kết với tài khoản Pippit."""
        return self.bound_accounts().get("facebook", [])

    def tiktok_accounts(self) -> list[dict]:
        """Lấy danh sách các TikTok Channels thật đã liên kết với tài khoản Pippit."""
        return self.bound_accounts().get("tiktok", [])

    # -- Upload Video Pipeline --------------------------------------------
    def prepare_upload_cloud(self, md5: str, size: int, file_type: str = "video") -> dict:
        body = {
            "workspace_id": self.workspace_id,
            "space_id": "0",
            "md5": md5,
            "size": size,
            "file_type": file_type,
            "is_web_user": True,
        }
        j = self.post("/lv/v1/asset/prepare_upload_cloud", body)
        if j.get("ret") != "0":
            raise PippitError(f"prepare_upload_cloud thất bại: {j}")
        return j["data"]

    def create_cloud_asset(
        self,
        owner: str,
        vid: str,
        meta: dict,
        filename: str,
        upload_id: str,
        file_md5: str = "",
        file_size: int = 0,
    ) -> str:
        asset_meta = json.dumps(
            {
                "uploadSource": {
                    "owner": owner,
                    "platform": "browser",
                    "systemVersion": UA,
                    "appVersion": "1.0.0",
                },
                "vid": vid,
            },
            separators=(",", ":"),
        )
        uri = meta.get("Uri") or meta.get("uri") or ""
        size = meta.get("Size") or meta.get("size") or file_size
        md5 = meta.get("Md5") or meta.get("MD5") or meta.get("md5") or file_md5
        body = {
            "everphoto_id": owner,
            "asset": {
                "uri": uri,
                "size": size,
                "workspace_id": self.workspace_id,
                "filename": filename,
                "upload_id": upload_id,
                "if_image_async_resize": True,
                "permission": 0,
                "space_id": "0",
                "file_type": "video",
                "folder_id": "-1",
                "meta": asset_meta,
                "md5": md5,
            },
            "is_web_user": True,
        }
        j = self.post("/lv/v1/asset/create_cloud_asset", body)
        if j.get("ret") != "0":
            raise PippitError(f"create_cloud_asset thất bại: {j}")
        asset_id = ((j.get("data") or {}).get("cloud_asset") or {}).get("asset_id")
        if not asset_id:
            raise PippitError(f"create_cloud_asset không trả asset_id: {str(j)[:300]}")
        return asset_id

    def upload(self, file_path: str) -> dict:
        """Thực hiện trọn gói quy trình 5 bước upload file video lên Pippit Cloud."""
        file_size = os.path.getsize(file_path)
        with open(file_path, "rb") as f:
            data = f.read()
        md5 = hashlib.md5(data).hexdigest()
        prep = self.prepare_upload_cloud(md5, file_size)
        sts, domain = prep["security_token"], prep["upload_domain"]
        owner = prep["everphoto_user_id"]
        node = apply_upload_inner(sts, domain, file_size)
        tos_upload(node, file_path, owner)
        res = commit_upload_inner(sts, domain, node["SessionKey"])
        vid, meta = res.get("Vid"), res.get("VideoMeta") or {}
        if not vid:
            raise PippitError(f"Pippit nhận file nhưng không trả thông tin vid: {str(res)[:300]}")
        asset_id = self.create_cloud_asset(
            owner, vid, meta, os.path.basename(file_path), prep["upload_id"], file_md5=md5, file_size=file_size
        )
        return {"asset_id": asset_id, "vid": vid, "meta": meta}

    # -- Lên lịch đăng Facebook Page (platform_type = 301) -----------------
    def schedule_facebook(
        self,
        asset_id: str,
        platform_user_id: str,
        schedule_time_ms: int,
        description: str = "",
        title: str = "",
    ) -> str:
        fb_param = {
            "title": "",
            "description": description,
            "media_type": 1,
        }
        extra_dict = {
            "item_type": "video",
            "enter_from": "calendar",
            "tab_name": "publishing",
            "video_unique_id": asset_id,
        }
        if self.user_id:
            extra_dict["consumer_uid"] = str(self.user_id)

        extra = json.dumps(extra_dict, separators=(",", ":"))
        media_param = {
            "extra": extra,
            "platform_type": 301,
            "publish_type": 2,
            "platform_user_ids": [platform_user_id],
            "file_type": 1,
            "schedule_time": schedule_time_ms,
            "action_type": 2,
            "asset_id_list": [asset_id],
            "action_from": 0,
            "publish_facebook_page_param": fb_param,
        }
        body = {"requests": [{"id": "", "task_type": 1, "publish_media_param": media_param}]}
        j = self.post("/api/biz/v1/publish/batchcreate_schedule_task", body, "publish")
        if j.get("ret") != "0":
            raise PippitError(f"schedule_facebook thất bại: {j}")

        data = j.get("data") or {}
        # Parse theo chuẩn responses của Pippit API
        responses = data.get("responses") or []
        if responses:
            first = responses[0]
            if first.get("ret") != "0" and first.get("errmsg"):
                raise PippitError(f"Lỗi tạo schedule task: {first.get('errmsg')}")
            return str((first.get("data") or {}).get("id") or first.get("id") or "")

        results = data.get("results") or []
        if results:
            first = results[0]
            if first.get("error_code") and first.get("error_code") != 0:
                raise PippitError(f"Lỗi tạo schedule task: {first.get('error_message')}")
            return str(first.get("id") or "")

        return ""

    # -- Lên lịch đăng TikTok (platform_type = 1) -------------------------
    def schedule_tiktok(
        self,
        asset_id: str,
        platform_user_id: str,
        schedule_time_ms: int,
        description: str = "",
        title: str = "",
        privacy_level: int = 1,
        allow_comment: bool = True,
        allow_duet: bool = True,
        allow_stitch: bool = True,
    ) -> str:
        tt_param = {
            "title": title or description[:100],
            "description": description,
            "media_type": 1,
            "privacy_level": privacy_level,
            "allow_comment": allow_comment,
            "allow_duet": allow_duet,
            "allow_stitch": allow_stitch,
        }
        extra_dict = {
            "item_type": "video",
            "enter_from": "calendar",
            "tab_name": "publishing",
            "video_unique_id": asset_id,
        }
        if self.user_id:
            extra_dict["consumer_uid"] = str(self.user_id)

        extra = json.dumps(extra_dict, separators=(",", ":"))
        media_param = {
            "extra": extra,
            "platform_type": 1,
            "publish_type": 2,
            "platform_user_ids": [platform_user_id],
            "file_type": 1,
            "schedule_time": schedule_time_ms,
            "action_type": 2,
            "asset_id_list": [asset_id],
            "action_from": 0,
            "publish_tiktok_param": tt_param,
        }
        body = {"requests": [{"id": "", "task_type": 1, "publish_media_param": media_param}]}
        j = self.post("/api/biz/v1/publish/batchcreate_schedule_task", body, "publish")
        if j.get("ret") != "0":
            raise PippitError(f"schedule_tiktok thất bại: {j}")

        data = j.get("data") or {}
        responses = data.get("responses") or []
        if responses:
            first = responses[0]
            if first.get("ret") != "0" and first.get("errmsg"):
                raise PippitError(f"Lỗi tạo schedule task TikTok: {first.get('errmsg')}")
            return str((first.get("data") or {}).get("id") or first.get("id") or "")

        results = data.get("results") or []
        if results:
            first = results[0]
            if first.get("error_code") and first.get("error_code") != 0:
                raise PippitError(f"Lỗi tạo schedule task TikTok: {first.get('error_message')}")
            return str(first.get("id") or "")

        return ""

    # -- Tra cứu lịch bài đăng --------------------------------------------
    def list_schedule_tasks(self, page_ids: list[str] | None = None, limit: int = 100) -> list[dict]:
        now_ms = int(time.time() * 1000)
        p_ids = page_ids or []
        if not p_ids:
            try:
                accs = self.facebook_accounts()
                p_ids = [str(a.get("platform_user_id")) for a in accs if a.get("platform_user_id")]
            except Exception:
                p_ids = []

        # Quét lịch trong khoảng 180 ngày trước và 180 ngày tới
        body = {
            "cursor": "0",
            "count": limit,
            "start_time": now_ms - (180 * 86400 * 1000),
            "end_time": now_ms + (180 * 86400 * 1000),
            "status_list": [1, 2, 3, 4, 6],
            "platform_user_ids": {"301": p_ids},
        }
        j = self.post("/api/biz/v1/publish/list_schedule_task", body, "publish")
        if j.get("ret") != "0":
            raise PippitError(f"list_schedule_task thất bại: {j}")

        out = []
        for t in j.get("data") or []:
            param = t.get("facebook_page_publish_param") or {}
            link = t.get("platform_item_link") or ""
            out.append(
                {
                    "task_id": str(t.get("id") or ""),
                    "status": t.get("status"),
                    "published": t.get("status") == PIPPIT_STATUS_PUBLISHED,
                    "post_id": post_id_from_link(link),
                    "post_url": link,
                    "page_id": str(t.get("platform_user_id") or ""),
                    "page_name": ((t.get("platform_user") or {}).get("nick_name") or ""),
                    "schedule_time_ms": t.get("schedule_time") or 0,
                    "title": param.get("title") or "",
                    "description": param.get("description") or "",
                    "failed_reason": t.get("failed_reason") or "",
                }
            )
        return out
