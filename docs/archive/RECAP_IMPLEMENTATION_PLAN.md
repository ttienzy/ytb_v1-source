# Plan triển khai: Recap Pipeline chính (Backend + Studio UI)

> **ĐÃ LƯU TRỮ (2026-11-12), chỉ để tham khảo lịch sử.** Plan triển khai R1–R5; đã cài đặt, dòng "chưa code BE" không còn đúng và một số đường dẫn file đã không còn. Hiện hành: code `Backend/app/recap/` và mục 10 của [README](../../README.md). Đường dẫn file và số dòng trong tài liệu phản ánh thời điểm viết.


> Trạng thái: **plan — chưa code BE. Cấu trúc thư mục + cơ chế Gemini đã dọn + validate xong.**
> Cập nhật: 2026-08-22
> Tham khảo: [[RECAP_PIPELINE_PLAN]] (flow tổng quan, quyết định mục 6) + [[VOICE_SERVICE_PLAN]] (Phase 3 đã xong)
> Phạm vi: **phần chính** — 4 bước recap (generate → cut → voice → merge) + Studio UI.
> **KHÔNG gồm** Phase 4 (voices table FE wire-up — đã xong) & Phase 5 (Docker voice-service) — gác lại theo yêu cầu.
>
> **Thay đổi lớn so với bản đầu:**
> - **Bỏ phụ thuộc HAR** (`gemini.google.com.har` 14MB đã xoá). Inner template 97-pt giờ capture tươi từ
>   session Gemini đã login (qua Chromium) → sanitize idx 3/4/59 → lưu vào `config.json` (`gemini.inner_template`).
> - **Cơ chế HTTP đã validate end-to-end** (`tests/gemini/test_gemini_config.py` gửi prompt thật → HTTP 200,
>   trả lời đúng) — chỉ dùng config.json (cookies + inner_template + user_agent), không HAR.
> - **Cấu trúc Backend/ đã dọn**: script test → `tests/gemini/`, CLI capture → `app/ai/gemini/capture.py`,
>   xoá 3 script chết/hỏng (`gemini_http.py`, `inspect_har.py`, `extract_gemini_response.py`).

---

## 0. Mục tiêu

Trong **Studio** (tab hiện đang trống), dựng workflow **stepwise, user-triggered** (quyết định 6.5):
đầu vào = **link YouTube + raw.txt (transcript)** → đầu ra = **video recap lồng tiếng Việt**.

4 bước, mỗi bước 1 endpoint, user nhấn nút trong UI rồi mới chạy bước kế:

```
Bước 1 generate  → recap.json          (Gemini HTTP — port test_files.py)
Bước 2 cut       → clip_i.mp4          (yt-dlp tải + ffmpeg cut [start,end])
Bước 3 voice     → vo_i.wav (sync)     (voice-service /tts/batch + atempo)
Bước 4 merge     → final_recap.mp4     (ffmpeg concat clip_i+vo_i)
```

---

## 1. Hàng tồn (đã có — grounding)

| Thứ | Vị trí | Dùng cho |
| --- | --- | --- |
| Cơ chế Gemini HTTP (token fresh, f.req, StreamGenerate) | `tests/gemini/test_gemini_config.py` (đã validate HTTP 200) | Bước 1 (recap) — reference HTTP |
| Recap thật (upload 2 file + attachments, `extract_recap_json`) | `tests/gemini/test_files.py` | Bước 1 — **port thành service** |
| System prompt | `Backend/prompts/System Prompt Food Review Recap.txt` | Bước 1 (upload kèm) |
| Inner template 97-pt + cookies (đã sanitize idx 3/4/59) | `Backend/Data/config.json` (`gemini.inner_template` + `cookies` + `user_agent`) | Bước 1 — **capture bởi `app/ai/gemini/capture.py`, không cần HAR** |
| Settings/login + capture template Gemini | `app/ai/gemini/{router,service,schemas}.py` (login→cookies) + `app/ai/gemini/capture.py` (capture→inner_template) | Bước 1 — đọc/ghi `config.json` |
| Voice-service (TTS) | `services/voice-service/` — `/tts`, `/tts/batch`, `/preview`, `/internal/voices/*` (Phase 1–3 đã xong) | Bước 3 |
| Voice client (backend) | `app/voices/voice_client.py` — `register/remove/preview/list_presets` | Bước 3 — **thêm `tts`/`tts_batch`** |
| DB + config + storage | `app/core/{config,database,storage}.py`, `app/db.py` (`Base`, `get_db`) | jobs table, paths |
| FFmpeg / ffprobe / yt-dlp | PATH (8.1.1 / 8.1.1 / 2026.07) | Bước 2,3,4 — đã cài ✓ |
| `Data/app.db` | root — bảng `voices` + `alembic_version` | **thêm bảng `jobs`** |

### Quyết định kiến trúc (lệch / làm rõ so với RECAP_PIPELINE_PLAN §5)

1. **Một voice_client, không tách `app/recap/voice_client.py`**: thêm `tts()` + `tts_batch()` vào
   `app/voices/voice_client.py` hiện có → `app/recap/service.py` import lại. Tránh 2 client song song.
2. **Gemini recap ở `app/ai/gemini/recap.py`** (port `tests/gemini/test_files.py` thành service sạch), orchestration ở
   `app/recap/`. Tách rõ: gemini = "cơ chế AI", recap = "orchestration pipeline".
3. **Background execution + status polling**: mỗi bước chạy trong worker thread (không block event loop
   FastAPI), endpoint trả ngay `job_id` + `status`, FE poll `GET /api/recap/jobs/{id}`. Khớp quyết định 6.5
   (stepwise) + §3 (`GET jobs/{id}`).
4. **DB = nguồn sự thật metadata** (`Data/app.db` bảng `jobs`), file trung gian ở filesystem `Data/jobs/{job_id}/`.
   Nhất quán với convention Data dirs (DB queryable, Backend/Data internal).
5. **Template Gemini = từ config, không HAR**: `app/ai/gemini/recap.py` đọc `gemini.inner_template`
   (97-pt đã sanitize idx 3/4/59 → account-agnostic) + `cookies` + `user_agent` từ `config.json`.
   Token fresh (`at`/`bl`/`f.sid`) lấy runtime qua `GET /app` (regex `SNlM0e`/`cfb2h`/`FdrFJe`).
   Capture/làm mới template: chạy `app/ai/gemini/capture.py` (Chromium đã login → chặn StreamGenerate →
   sanitize → ghi config). **Không còn phụ thuộc `*.har` ở runtime** — HAR đã xoá, đổi account chỉ cần
   re-login + re-capture. Đã validate end-to-end (`tests/gemini/test_gemini_config.py` → HTTP 200).

---

## 2. Cấu trúc code sẽ thêm

```
Backend/app/
├─ ai/gemini/
│  ├─ capture.py            # CÓ SẴN — CLI capture template+cookies từ Chromium đã login → config.json
│  └─ recap.py              # MỚI — port tests/gemini/test_files.py: generate_recap(youtube_url, raw_path, prompt_path) -> recap dict
│                           #        đọc inner_template+cookies+user_agent từ config (KHÔNG HAR); fresh at/bl/f.sid runtime
├─ recap/                   # MỚI — orchestration
│  ├─ __init__.py
│  ├─ models.py             # Job model (bảng jobs trong app.db)
│  ├─ schemas.py            # GenerateReq, JobOut, SegmentOut, ...
│  ├─ service.py            # generate(), cut(), voice(), merge() — gọi gemini/ffmpeg/voice_client
│  ├─ ffmpeg.py             # cut_segment, atempo_sync, replace_audio, concat
│  ├─ ytdlp.py              # download_video(youtube_url, dest)
│  ├─ jobs.py               # job_dir(job_id), load_recap(job_id), list_clips, list_vo, paths
│  └─ router.py             # POST /api/recap/{generate,cut,voice,merge}, GET /api/recap/jobs/{id}
└─ voices/voice_client.py   # THÊM tts(), tts_batch()
Data/jobs/{job_id}/
├─ recap.json
├─ video.mp4
├─ clips/clip_0.mp4, clip_1.mp4, ...
├─ voice/vo_0.wav, vo_1.wav, ...
└─ final.mp4
```

> Quy ước path: job dir ở `Data/jobs/{job_id}/` (root Data — queryable-ish, nhưng đây là file trung gian
> nặng nên cũng OK; hoặc chuyển sang `Backend/Data/jobs/` để gọn root. **Chọn `Backend/Data/jobs/{job_id}/`**
> vì nó là dữ liệu nội bộ nặng (video/audio), đúng convention `Backend/Data/` = internal).

---

## 3. Data model

`Data/app.db` — migration `0003_jobs`:

```python
class Job(Base):
    __tablename__ = "jobs"
    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)      # uuid hex[:12]
    youtube_url: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="created")
    # status: created → recap_done → cut_done → voice_done → merged | error
    voice_id: Mapped[str | None] = mapped_column(String(64), nullable=True) # chọn khi voice
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at / updated_at: Mapped[datetime]
```

State chi tiết (số segment, clip/vo đã có) đọc từ filesystem (`jobs.py`) — không lưu DB để tránh lệch.

---

## 4. Các bước triển khai (phase, mỗi phase chạy/verify được rồi mới tiếp)

### Phase R1 — Recap (generate) + job skeleton

**Files:**
- `app/recap/__init__.py`, `models.py` (Job), `schemas.py` (`GenerateReq{youtube_url, raw_file: UploadFile}`,
  `JobOut`), `jobs.py` (job_dir, create_job_dir, save_recap, load_recap).
- `app/ai/gemini/recap.py` — port `tests/gemini/test_files.py`:
  - `load_template_from_config() -> list`: đọc `gemini.inner_template` (97-pt đã sanitize idx 3/4/59)
    từ `read_config()["gemini"]` (HTTPException 400 nếu thiếu — yêu cầu chạy `capture.py` trước).
    Cùng lúc lấy `cookies` + `user_agent`. **Không động tới HAR.**
  - `upload_file(client, path) -> (gcs, name)`: resumable start + finalize (giữ nguyên logic).
  - `extract_recap_json(raw) -> dict | None`: parse stream frames → tìm khối ```json``` (giữ nguyên logic).
  - `generate_recap(youtube_url: str, raw_path: Path, prompt_path: Path) -> dict`:
    đọc `cookies`+`inner_template`+`user_agent` từ config → `GET /app` regex fresh `at`/`bl`/`f.sid` →
    upload raw + prompt → attachments → clone inner_template, đè `inner[0]=[youtube_url,0,None,attachments,None,None,0]`
    → encode `f.req` (1 lần) → POST StreamGenerate → `extract_recap_json` → recap dict.
- `app/recap/service.py` — `generate(db, youtube_url, raw_file) -> Job`: sinh job_id, tạo dir, lưu raw,
  chạy `generate_recap` trong threadpool, ghi `recap.json`, set status `recap_done` (hoặc `error`).
- `app/recap/router.py` — `POST /api/recap/generate` (multipart: youtube_url + raw_file) → `JobOut`.
- `alembic/versions/0003_jobs.py` + `env.py` import `app.recap.models`.
- `app/core/config.py` — thêm `jobs_dir: Path = TOOLS_DIR / "Backend" / "Data" / "jobs"`.
  (Không cần `har_template_path` — inner_template đã nằm sẵn trong `config.json` do `app/ai/gemini/capture.py`
  ghi; `Settings` chỉ thêm `jobs_dir`.)

**Verify:**
```
alembic upgrade head            # → bảng jobs
curl -X POST :8000/api/recap/generate -F youtube_url=<yt> -F raw_file=@raw.txt
# → {"job_id":"...", "status":"recap_done", ...}
cat Backend/Data/jobs/<id>/recap.json   # có scenes[].segments[]{start_time_sec,end_time_sec,duration_sec,vietnamese_vo}
```

### Phase R2 — Download + cut

**Files:**
- `app/recap/ytdlp.py` — `download_video(youtube_url, dest) -> Path` (subprocess `yt-dlp -f mp4 -o dest`,
  giữ chất lượng gốc; nếu đã có `video.mp4` thì skip — idempotent).
- `app/recap/ffmpeg.py` — `cut_segment(video, start, end, out) -> Path`
  (`ffmpeg -ss {start} -to {end} -i {video} -c copy {out}` — stream-copy nhanh; nếu codec lệch sau concat
  thì Phase R4 re-encode đồng nhất).
- `service.cut(db, job_id) -> Job`: load recap → đếm segment → đảm bảo `video.mp4` (download nếu thiếu)
  → loop cut → `clips/clip_{i}.mp4` → status `cut_done`.
- `router` — `POST /api/recap/cut` body `{job_id}` → `JobOut`.
- `jobs.py` — `list_clips(job_id)`, `list_segments(job_id)` (đọc recap.json).

**Verify:**
```
curl -X POST :8000/api/recap/cut -H "Content-Type: application/json" -d '{"job_id":"..."}'
ls Backend/Data/jobs/<id>/clips/    # clip_0.mp4 ...
```

### Phase R3 — Voice + sync

**Files:**
- `app/voices/voice_client.py` — THÊM:
  - `tts(text, voice_id) -> (wav_bytes, duration_str)`: POST `/tts` → audio/wav + header `X-Audio-Duration`.
  - `tts_batch(items: list[dict], voice_id) -> (zip_bytes, count)`: POST `/tts/batch` → zip.
- `app/recap/service.voice(db, job_id, voice_id) -> Job`:
  - load recap → gom `vietnamese_vo` tất cả segment → 1 lệnh `tts_batch` (lợi thế `infer_batch`).
  - giải nén zip → `voice/vo_{i}.wav` + `manifest.json` (duration mỗi item).
  - **sync** (§2.5, quyết định 6.2) cho mỗi `vo_i` vs `duration_sec`:
    - `vo_dur = manifest[i].duration`.
    - lệch ≤15%: `ffmpeg.atempo_sync(vo_i, target=duration_sec) -> vo_i_sync.wav` (atempo chain, cap 0.5–2.0).
    - lệch lớn: **giữ vo nguyên, đánh dấu `clip_i` sẽ cắt theo `vo_dur` ở Phase R4** (video co giãn theo voice).
    - `vo_dur >> duration_sec` quá cap 1.2x: atempo 1.2x + flag `overspeed` (sau này re-gen; MVP chỉ flag).
  - status `voice_done`, lưu `voice_id`.
- `router` — `POST /api/recap/voice` body `{job_id, voice_id}` → `JobOut` (+ list `overspeed` segments nếu có).

**Verify:**
```
curl -X POST :8000/api/recap/voice -d '{"job_id":"...","voice_id":"Adam"}'
ls Backend/Data/jobs/<id>/voice/    # vo_0.wav ... + manifest.json
# nghe 1 vo: ffprobe vo_0.wav → duration ≈ duration_sec (±15%)
```

### Phase R4 — Merge

**Files:**
- `ffmpeg.py` — `replace_audio(clip, vo, out) -> Path` (`ffmpeg -i clip -i vo -c:v copy -c:a aac
  -map 0:v -map 1:a -shortest out`); nếu segment "video co giãn theo voice": cut clip theo `vo_dur`
  (`-t {vo_dur}`) trước. `concat(list_file, out) -> Path` (`-f concat -safe 0 -i list.txt -c copy`
  hoặc re-encode đồng nhất h264/aac/48k nếu codec lệch).
- `service.merge(db, job_id) -> Job`: build `merged/clip_{i}_vo.mp4` (replace audio) → concat theo thứ tự
  scene→segment → `final.mp4` → status `merged`.
- `router` — `POST /api/recap/merge` body `{job_id}` → `JobOut` (+ `final_url`/path).
- `router` — `GET /api/recap/jobs/{id}` → `JobOut` + `recap` (scenes/segments) + `clips[]` + `vo[]` + `final_url`.

**Verify:**
```
curl -X POST :8000/api/recap/merge -d '{"job_id":"..."}'
# play Backend/Data/jobs/<id>/final.mp4 → có tiếng Việt, độ dài hợp lý
curl :8000/api/recap/jobs/<id>   # status=merged, final_url
```

### Phase R5 — Studio UI

**Files:** `Frontend/src/main.tsx` (thay block "Studio" rỗng bằng `StudioPage`):
- Form bước 1: nhập YouTube URL + chọn file raw.txt → `POST /api/recap/generate` → hiện `job_id` + recap
  (scenes/segments table: index, start–end, duration, vietnamese_vo).
- 3 nút tiếp theo (Cut / Voice / Merge) — mỗi nút disabled cho đến khi bước trước `status` xong; gọi endpoint
  tương ứng; poll `GET /api/recap/jobs/{id}` để cập nhật trạng thái + danh sách clip/vo.
- Bước Voice: chọn `voice_id` (dropdown từ `GET /api/voices` đã clone + `GET /api/voices/presets`).
- Bước Merge xong: hiện link/nút play `final.mp4` (serve qua backend `GET /api/recap/jobs/{id}/final` hoặc
  static file route).
- Caching trạng thái per job (localStorage) để reload không mất.

**Backend thêm (serve media):** `GET /api/recap/jobs/{id}/final` → `FileResponse(final.mp4, media_type="video/mp4")`
(+ cho phép range header để `<video>` seek). Có thể thêm `GET /api/recap/jobs/{id}/clip/{i}` cho preview từng đoạn.

**Verify:** mở app → Studio → chạy 4 bước → nghe/nhìn final.

---

## 5. Background execution & lỗi

- Mỗi bước chạy `await run_in_threadpool(...)` (ffmpeg/yt-dlp/gemini đều blocking). Endpoint trả `job_id` +
  `status="running"` ngay? **MVP chọn: chờ đồng bộ với timeout dài** (gemini ~180s, cut/voice/merge tuỳ độ dài).
  Nếu trễ →Phase sau chuyển sang BackgroundTasks + poll. (Ghi rõ: MVP sync, stepwise nên user biết đang chờ.)
- Lỗi bước: set `status="error"` + `error` field; FE hiện lỗi; có thể nhấn lại (idempotent: cut/voice skip file đã có).
- Idempotent: `download_video` skip nếu `video.mp4` tồn tại; `cut` skip clip đã có; `voice` skip vo đã có (trừ khi đổi voice_id).

---

## 6. Ràng buộc pacing (kết nối pipeline)

- Prompt ép `vietnamese_vo ≈ duration_sec × 3 từ/giây` (§2.1) → TTS **phải ≈ duration_sec**.
- voice-service `/tts` đã trả `X-Audio-Duration` (Phase 3) → backend đo lệch → atempo (R3).
- Cap atempo 1.2x (quyết định 6.2); vượt → flag, MVP không re-gen.

---

## 7. Open risks / tech notes

- **Template stale**: `generate_recap` đọc `inner_template` từ `config.json` (do `app/ai/gemini/capture.py`
  ghi). Nếu Gemini đổi giao thức → request 400. **Mitig**: chạy lại `capture.py` (1 cửa sổ Chromium ~15s,
  `route.abort()` nên không sinh history thừa) → template tươi. Phát hiện qua response `"er"` → trả lỗi
  rõ "cần re-capture template". Đổi account Gemini cũng chỉ cần re-login + re-capture. (Đã validate
  cơ chế: `tests/gemini/test_gemini_config.py` → HTTP 200.)
- **Cookie hết hạn**: `generate_recap` đọc cookies từ config; nếu 401/400 `"er"` → trả lỗi rõ để user
  re-login (đã có `/api/settings/gemini/login`).
- **TTL upload**: gcs path sống 1 ngày → upload rồi gửi StreamGenerate ngay trong cùng session (test_files
  đã làm vậy) — giữ nguyên.
- **Codec lệch concat**: cut stream-copy có thể ra codec lệch → concat lỗi. **Mitig**: Phase R4 phát hiện
  qua ffprobe; nếu lệch → re-encode đồng nhất (`-c:v libx264 -c:a aac -ar 48000`).
- **Video dài**: yt-dlp + cut nhiều segment có thể nặng; MVP OK cho video ngắn (<30p). Dài → cần chunking.
- **License/ToS**: recap YouTube + lồng tiếng — fair-use nội bộ (ghi chú, không chặn).

---

## 8. Thứ tự ưu tiên & định nghĩa "xong"

| Phase | Deliverable | "Xong" khi |
| --- | --- | --- |
| R1 | recap generate + jobs table | `POST /generate` → recap.json hợp lệ |
| R2 | download + cut | `POST /cut` → clips/ có đủ |
| R3 | voice + sync | `POST /voice` → vo_*.wav ≈ duration_sec |
| R4 | merge + serve | `POST /merge` → final.mp4 chơi được |
| R5 | Studio UI | 4 nút end-to-end trong app |

Làm tuần tự R1→R5. Mỗi phase verify bằng curl trước, UI ở R5.
