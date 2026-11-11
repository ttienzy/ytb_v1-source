"""
Leonardo Image Bot client — gen ảnh (nhân vật, background, storyboard) đúng như tool-film.

Port đồng bộ (requests) từ tool-film backend/app/image_bot_client.py. Server proxy Leonardo
mặc định `http://quinnpl.duckdns.org:8089`, auth header X-Auth-Key (key công khai mặc định
`HUYDEPZAI`), model `GPT Image-2`, ratio 9:16. Chạy được ngay không cần Leonardo API key riêng.

Flow: upload-ref (multipart) → POST /api/jobs {prompt, model, ref_images[]} → long-poll
GET /api/jobs/{id}/wait?timeout=N → result_urls[0] → download.
"""
from __future__ import annotations

import hashlib
import mimetypes
import time
from pathlib import Path

import requests

DEFAULT_URL = "http://quinnpl.duckdns.org:8089"
DEFAULT_API_KEY = "HUYDEPZAI"
DEFAULT_MODEL = "GPT Image-2"

_DONE = {"done", "success", "succeeded", "complete", "completed", "finished"}
_FAIL = {"failed", "error", "errored", "cancelled", "canceled", "rejected"}


class ImageBotError(RuntimeError):
    pass


class ImageBotClient:
    def __init__(self, base_url: str = DEFAULT_URL, api_key: str = DEFAULT_API_KEY,
                 model: str = DEFAULT_MODEL):
        self._base = (base_url or DEFAULT_URL).rstrip("/")
        self._key = api_key or DEFAULT_API_KEY
        self._model = model or DEFAULT_MODEL
        self._s = requests.Session()

    def _h(self) -> dict:
        return {"X-Auth-Key": self._key}

    # ── Ref upload ────────────────────────────────────────────────────────────
    def _upload_ref(self, path: str) -> str:
        p = Path(path)
        content = p.read_bytes()
        # hash-prefix để server không cache nhầm khi ảnh đổi nội dung nhưng trùng tên.
        name = f"{hashlib.sha256(content).hexdigest()[:12]}_{p.name}"
        mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        r = self._s.post(f"{self._base}/api/jobs/upload-ref",
                         files={"file": (name, content, mime)}, headers=self._h(), timeout=120)
        if not r.ok:
            raise ImageBotError(f"upload-ref HTTP {r.status_code}: {r.text[:200]}")
        d = r.json()
        if isinstance(d, dict):
            for k in ("path", "local_path", "url", "file", "name", "id"):
                v = d.get(k)
                if isinstance(v, str) and v.strip():
                    return v.strip()
        if isinstance(d, str) and d.strip():
            return d.strip()
        raise ImageBotError(f"upload-ref no path: {str(d)[:200]}")

    # ── Job create + wait ─────────────────────────────────────────────────────
    @staticmethod
    def _first_job_id(data) -> str | None:
        def jid(j):
            if isinstance(j, dict):
                for k in ("id", "jid", "job_id", "jobId", "uuid"):
                    if j.get(k):
                        return str(j[k])
            return None
        if isinstance(data, list) and data:
            return jid(data[0])
        if isinstance(data, dict):
            if isinstance(data.get("jobs"), list) and data["jobs"]:
                return jid(data["jobs"][0])
            if isinstance(data.get("ids"), list) and data["ids"]:
                return str(data["ids"][0])
            g = jid(data)
            if g:
                return g
            inner = data.get("data") or data.get("result")
            if isinstance(inner, list) and inner:
                return jid(inner[0])
            if isinstance(inner, dict):
                return jid(inner)
        return None

    @staticmethod
    def _extract_url(job: dict) -> str | None:
        for key in ("url", "image_url", "output_url", "result_url", "download_url"):
            v = job.get(key)
            if isinstance(v, str) and v.startswith(("http://", "https://", "/")):
                return v
        rus = job.get("result_urls")
        if isinstance(rus, list) and rus and isinstance(rus[0], str) and rus[0].strip():
            return rus[0]
        if isinstance(rus, str) and rus.strip().startswith("["):
            import json as _json
            try:
                arr = _json.loads(rus)
                if isinstance(arr, list) and arr and isinstance(arr[0], str):
                    return arr[0]
            except Exception:
                pass
        img = job.get("image")
        if isinstance(img, str) and img.strip():
            return img if img.startswith(("http://", "https://", "/")) else "/images/" + img.lstrip("/")
        res = job.get("result")
        if isinstance(res, dict):
            imgs = res.get("images")
            if isinstance(imgs, list) and imgs:
                first = imgs[0]
                if isinstance(first, dict):
                    for k in ("url", "image_url"):
                        if isinstance(first.get(k), str):
                            return first[k]
                elif isinstance(first, str):
                    return first
        return None

    def _wait(self, job_id: str, timeout: float) -> str:
        start = time.time()
        while True:
            remaining = timeout - (time.time() - start)
            if remaining <= 0:
                raise ImageBotError(f"Image Bot job {job_id} quá thời gian ({timeout:.0f}s)")
            slot = max(5, min(int(remaining), 30))
            try:
                r = self._s.get(f"{self._base}/api/jobs/{job_id}/wait",
                                params={"timeout": slot}, headers=self._h(), timeout=slot + 15)
            except requests.RequestException:
                time.sleep(2)
                continue
            if r.status_code == 404:
                raise ImageBotError(f"Image Bot job {job_id} not found (404)")
            if not r.ok:
                time.sleep(3)
                continue
            try:
                job = r.json()
            except ValueError:
                time.sleep(2)
                continue
            if isinstance(job, dict) and isinstance(job.get("job"), dict):
                job = job["job"]
            if not isinstance(job, dict):
                time.sleep(2)
                continue
            status = str(job.get("status") or job.get("state") or "").lower()
            if status in _DONE:
                url = self._extract_url(job)
                if not url:
                    raise ImageBotError(f"Job {job_id} done nhưng thiếu URL: {list(job.keys())}")
                return url
            if status in _FAIL:
                raise ImageBotError(f"Job {job_id} failed: {job.get('error') or status}")

    # ── Public ────────────────────────────────────────────────────────────────
    def generate(self, prompt: str, dest: str, ref_paths: list[str] | None = None,
                 ref_labels: list[str] | None = None,
                 timeout: int = 300, aspect: str = "9:16", qty: int = 1) -> str:
        """Gen 1 ảnh (kèm ref nếu có) → tải về `dest`. Trả dest.

        Body khớp server Leonardo (X-Auth-Key), model GPT Image-2. `aspect`
        9:16 (dọc) / 16:9 (ngang) / 1:1. Server KHÔNG giới hạn height. Với
        nhiều ref: nếu truyền đủ `ref_labels` (khớp 1:1) thì gắn kèm để server
        bind đúng nhân vật; không thì để server tự gán (ảnh1=CHAR-1,
        ảnh2=CHAR-2, ảnh cuối=LOCATION).
        """
        src_labels = list(ref_labels or [])
        refs: list[str] = []
        labels: list[str | None] = []
        for idx, p in enumerate(ref_paths or []):
            try:
                path = self._upload_ref(p)
            except ImageBotError:
                continue  # 1 ref lỗi không giết cả job (labels vẫn khớp refs đã upload)
            refs.append(path)
            lbl = src_labels[idx] if idx < len(src_labels) else None
            labels.append(str(lbl) if lbl else None)

        a = str(aspect).strip()
        if a == "16:9":
            w, h = 1792, 1024
        elif a == "1:1":
            w, h = 1024, 1024
        else:  # 9:16 mặc định
            w, h = 1024, 1792

        body: dict = {
            "prompt": " ".join((prompt or "").split()),
            "model": self._model,
            "width": w, "height": h, "qty": max(1, int(qty)),
            "ref_images": refs,
        }
        # Chỉ gửi ref_labels khi MỌI ref đều có label (khớp 1:1) — thiếu thì để server tự gán.
        if refs and all(labels):
            body["ref_labels"] = labels

        r = self._s.post(f"{self._base}/api/jobs", json=body, headers=self._h(), timeout=180)
        if not r.ok:
            raise ImageBotError(f"create job HTTP {r.status_code}: {r.text[:200]}")
        job_id = self._first_job_id(r.json())
        if not job_id:
            raise ImageBotError("create job: no id")
        url = self._wait(job_id, timeout)
        return self.download(url, dest)

    def download(self, url: str, dest: str) -> str:
        target = self._base + url if url.startswith("/") else url
        r = self._s.get(target, headers=self._h(), timeout=120, allow_redirects=True)
        r.raise_for_status()
        with open(dest, "wb") as f:
            f.write(r.content)
        return dest
