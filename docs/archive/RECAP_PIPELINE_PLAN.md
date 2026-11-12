# Plan: YouTube Recap Pipeline (Gemini + VieNeu-TTS + FFmpeg)

> **ĐÃ LƯU TRỮ (2026-11-12), chỉ để tham khảo lịch sử.** Plan phân tích ban đầu; pipeline R1–R4 đã được cài đặt, dòng "chưa code" trong file không còn đúng. Hiện hành: code `Backend/app/recap/` và mục 10 của [README](../../README.md). Đường dẫn file và số dòng trong tài liệu phản ánh thời điểm viết.


> Trạng thái: **phân tích nghiệp vụ / kiến trúc** — chưa code.
> Cập nhật: 2026-08-21 (rev 2 — đã chốt quyết định mục 6)

## 0. Mục tiêu & phạm vi

Xây dựng tính năng trên **Studio**: đầu vào là **link YouTube + raw file (transcript JSON)**,
đầu ra là **video recap lồng tiếng Việt**, gồm:
1. Gemini phân tích → `recap.json` (đã chạy OK qua HTTP).
2. Cắt video thành từng đoạn theo `[start_time_sec, end_time_sec]` trong `recap.json`.
3. Mỗi đoạn → TTS voice Việt từ `vietnamese_vo` của segment đó.
4. Ghép các đoạn lại → video cuối.

Phần **voice** tách thành **service độc lập** (VieNeu-TTS), môi trường riêng, HTTP API cho app chính,
lưu voice clone bền vững, cấu trúc đủ triển khai nội bộ. Tham khảo: https://github.com/pnnbao97/VieNeu-TTS

---

## 1. Flow tổng quan (từng bước, user-driven)

> **Quyết định (mục 6.5):** giai đoạn đầu làm **từng bước**, user nhấn nút để kích hoạt từng
> bước trong Studio (chưa tự động hoá pipeline end-to-end). Mỗi bước là 1 endpoint riêng,
> Studio gọi theo thứ tự. Về sau có thể gộp thành 1 job tự động.

```
[Studio UI]   (user nhấn nút từng bước)
   │  Bước 1 — "Tạo recap":  link YouTube + raw.txt
   ▼
[Backend] ── Gemini recap (HTTP, đã OK) ──▶ recap.json
   │   { video_url, scenes[].segments[]{ start_time_sec, end_time_sec, duration_sec,
   │                                     original_text, vietnamese_vo } }
   ▼
   │  Bước 2 — "Cắt video":  yt-dlp tải video → FFmpeg cut [start,end] mỗi segment
   │                          → clip_0.mp4, clip_1.mp4, ...  (concat chỉ đoạn giữ = gap A)
   ▼
   │  Bước 3 — "Tạo voice" (nhấn từng đoạn / batch):  với mỗi segment
   │            POST voice-service /tts {vietnamese_vo, voice_id} → vo_i.wav
   │            (sync: atempo vo_i cho khớp duration_sec)
   ▼
   │  Bước 4 — "Ghép":  FFmpeg concat (clip_i + vo_i) theo thứ tự scene → final_recap.mp4
   ▼
[Studio]  trả link video kết quả + recap.json
```

> **Bỏ qua subtitle** (mục 6.3): không làm sub tiếng Việt ở giai đoạn này.

---

## 2. Phân tích từng bước & nghiệp vụ

### 2.1 Recap (Gemini) — ĐÃ CHẠY
- Input: link YouTube + `raw.txt` + system prompt tại
  `Backend/prompts/System Prompt Food Review Recap.txt`.
- Cơ chế đã chốt (HTTP thuần, không automation):
  - GET trang → 3 token fresh: `at` (SNlM0e), `bl` (cfb2h), `f.sid` (FdrFJe).
  - Upload file (resumable `push.clients6.google.com/upload/`): header cố định
    `Push-ID: feeds/mcudyrk2a4khkz` + `X-Client-Pctx: CgcSBWjK7pYx` + `X-Tenant-Id: bard-storage`
    + cookies → trả `/contrib_service/ttl_1d/{id}_{token}`.
  - `f.req` với `inner[0] = [PROMPT, 0, null, [attachments], null, null, 0]`,
    **encode 1 LẦN** `urllib.parse.quote(safe="")` (encode double → 400).
  - POST `StreamGenerate?bl=&f.sid=&hl=vi&_reqid=&rt=c`, header `X-Same-Domain:1`.
  - Parse streaming frames `wrb.fr` bằng `json.loads` → khối ` ```json...``` ` → `json.loads` lại.
- Script tham chiếu: `Backend/test_files.py`, `Backend/gemini_http.py`.
- Schema JSON đầu ra:
  ```json
  { "video_url": "...", "scenes": [
    { "scene_title": "...", "segments": [
      { "start_time_sec": float, "end_time_sec": float, "duration_sec": float,
        "original_text": "...", "vietnamese_vo": "..." } ] } ] }
  ```
- Lưu ý nhỏ:
  - Prompt đề cập "TTS (Minimax)" — thực tế dùng **VieNeu-TTS** → nên sửa chữ trong prompt (không ảnh hưởng JSON).
  - Prompt yêu cầu "không trả ```json" nhưng Gemini vẫn thêm fence → extractor xử lý, giữ.
  - **Pacing cốt lõi**: prompt ép `vietnamese_vo ≈ duration_sec × 3 từ/giây`
    → TTS **phải có độ dài ≈ duration_sec**. Ràng buộc điều khiển bước sync.

### 2.2 Voice (TTS)
- Gọi voice-service HTTP: `{text: vietnamese_vo, voice_id}` → `vo.wav` (48kHz).
- **Tối ưu quan trọng**: gom **toàn bộ** `vietnamese_vo` các segment → 1 lệnh `/tts/batch`
  (VieNeu có `infer_batch`, lợi thế lớn trên GPU). Trả N audio cùng lúc.
- Cảm xúc (tuỳ chọn): chèn cue `[cười]`, `[thở dài]`, `[hắng giọng]` vào text (VieNeu hỗ trợ).
- Sinh file `vo_i.wav` ứng mỗi segment, đặt tên/kết nối bằng index.

### 2.3 Cắt video theo đoạn
- Tải video 1 lần bằng `yt-dlp` (giữ chất lượng gốc, mp4).
- Đọc `recap.json`, với mỗi segment: `ffmpeg -ss {start_time_sec} -to {end_time_sec} -i video.mp4 -c copy clip_i.mp4` (stream-copy nhanh).
- **Gap = A (đã chốt)**: concatenate chỉ các đoạn giữ (bỏ đoạn nhàm chán) → video cuối ngắn hơn.
- Mỗi clip `clip_i.mp4` ứng 1 segment, đánh index theo thứ tự scene→segment để ghép đúng thứ tự.

### 2.4 Subtitle — BỎ QUA (đã chốt mục 6.3)
Không làm sub tiếng Việt giai đoạn này. Bỏ hẳn khỏi pipeline.

### 2.5 Sync voice ↔ video ⚠️
TTS sinh `vo_duration` ≠ `duration_sec`. Chính sách (đã chốt mục 6.2):
- Đo `vo_duration` sau TTS.
- Lệch nhỏ (±15%): **time-stretch `vo_i.wav` bằng FFmpeg `atempo`** (0.5–2.0, chain được) cho khớp `duration_sec`.
- Lệch lớn: **voice làm "đồng hồ"** — cắt video theo `vo_duration` (video co giãn theo voice).
- `vo_duration` >> `duration_sec` (Gemini viết quá dài): atempo tăng tốc (cap 1.2x); vượt → flag + re-gen.

### 2.6 Merge
- Concat `clip_i.mp4` (đã replace audio bằng `vo_i.wav` đã sync) theo thứ tự scene/segment.
- Đồng nhất codec (h264/aac/48k) để concat sạch.
- Output: `final_recap.mp4`.

---

## 3. Orchestration (từng bước, user-triggered)
> **Đã chốt (mục 6.5):** giai đoạn đầu làm **stepwise** — user nhấn nút trong Studio để chạy
> từng bước, KHÔNG phải 1 job tự động end-to-end. Mỗi bước = 1 endpoint riêng.

API đề xuất (mỗi bước độc lập, Studio gọi theo thứ tự):
- `POST /api/recap/generate` {youtube_url, raw_file} → trả `recap.json` (đã có cơ chế HTTP).
- `POST /api/recap/cut` {job_id | recap_json} → tải video (yt-dlp) + cắt từng segment → trả danh sách `clip_i.mp4`.
- `POST /api/recap/voice` {segment_index, voice_id} (hoặc `/voice/batch`) → TTS 1/nhều segment → `vo_i.wav` (qua voice-service).
- `POST /api/recap/merge` {job_id} → concat clip_i+vo_i đã sync → `final_recap.mp4`.
- `GET  /api/recap/jobs/{id}` → trạng thái + danh sách clip/vo đã tạo (để UI hiển thị + cho user nhấn tiếp).

Lưu trạng thái trung gian vào thư mục `Data/jobs/{job_id}/`: `video.mp4`, `recap.json`,
`clips/clip_i.mp4`, `voice/vo_i.wav`, `final.mp4`.

Về sau (nếu cần): gộp 4 bước thành 1 worker tự động chạy nền (BackgroundTasks/thread đơn → RQ/Celery).

---

## 4. Voice service — kiến trúc độc lập

### 4.1 Vai trò
Tách VieNeu-TTS thành service riêng vì: môi trường GPU/ONNX nặng, model weights lớn,
lifecycle khác app chính. App chính (CPU, FastAPI) chỉ gọi HTTP.

### 4.2 Năng lực VieNeu-TTS (từ README)
- v3 Turbo, 48kHz, 20 preset voices (Bắc/Trung/Nam), zero-shot clone từ ref 3–8s.
- `infer(text, voice=, ref_audio=, denoise=True)`; `infer_batch`; `infer_stream` (realtime).
- `add_voice(name, ref)` + `save_voices()` (persist) + `remove_voice`.
- Emotion cues inline: `[cười]`, `[thở dài]`, `[hắng giọng]`.
- CPU: ONNX Runtime torch-free (int8, 48kHz). GPU: PyTorch, batch.
- FastAPI streaming demo: `apps/web_stream.py` (port 8001). Có docker-compose.

### 4.3 Cấu trúc project đề xuất
```
services/voice-service/                (repo/service độc lập)
├─ pyproject.toml                      (uv; dep: vieneu, fastapi, uvicorn)
├─ .env                                (VOICE_PORT, MODEL_DIR, DEVICE, VOICES_DIR, ...)
├─ app/
│  ├─ main.py                          (FastAPI app + lifespan load models/voices)
│  ├─ config.py                        (Settings: backend onnx/gpu, precision, paths)
│  ├─ engine.py                        (bọc Vieneu(): 1 instance, quản lý lifecycle)
│  ├─ routers/
│  │  ├─ health.py                     GET  /health
│  │  ├─ voices.py                      POST/GET/DELETE /voices
│  │  └─ tts.py                         POST /tts, /tts/batch
│  ├─ storage.py                       (metadata: SQLite voice_id,name,ref_path,tags,created_at)
│  └─ schemas.py                        (pydantic: TTSRequest, VoiceCreate, ...)
├─ data/
│  ├─ voices/                          (ref audio bền vững)
│  ├─ voices.json                      (vieneu.save_voices() persist)
│  └─ voice_meta.db                    (SQLite metadata)
├─ models/                             (pre-download weights offline, volume mount)
└─ docker/
   ├─ Dockerfile                       (CPU-ONNX hoặc GPU image)
   └─ docker-compose.yml               (volume models+data; GPU passthrough tuỳ chọn)
```

### 4.4 API HTTP (cho app chính)
| Method | Path | Body | Trả về |
|---|---|---|---|
| GET | `/health` | – | `{status, device, voices_count}` |
| POST | `/voices` | `{name, ref_audio(multipart)}` | `{voice_id, name}` |
| GET | `/voices` | – | `[{voice_id, name, tags, created_at}]` |
| DELETE | `/voices/{voice_id}` | – | `{ok}` |
| POST | `/tts` | `{text, voice_id?, ref_audio?, speed?, emotion?}` | `audio/wav` |
| POST | `/tts/batch` | `{items:[{text, voice_id}, ...]}` | `[{voice_id, audio_url}]` hoặc zip |

### 4.5 Lưu voice clone bền vững
- `POST /voices` → lưu ref audio vào `data/voices/{voice_id}.wav` + `engine.add_voice(name, ref)`
  + `engine.save_voices()` + ghi row SQLite.
- Khởi động: lifespan load `voices.json` + re-register từ metadata → tồn tại qua restart.
- Tách metadata (SQLite) khỏi weights persistence (voices.json) → truy vấn nhanh, backup rõ.

### 4.6 Triển khai nội bộ
- **Mode: CPU-ONNX (torch-free, int8, 48kHz)** (đã chốt mục 6.4). Không cần GPU.
- Docker compose: service `voice-service`; volume `./models` (weights pre-download từ
  HuggingFace `pnnbao-ump/VieNeu-TTS-v3-Turbo` để offline); volume `./data` (voices).
- App chính gọi `http://voice-service:8001`.
- Lưu ý: CPU-ONNX nhanh với text ngắn (từng segment `vietnamese_vo` ≈ vài chục từ) → đủ dùng
  cho recap. `infer_batch` trên CPU vẫn chạy (tuần tự, không gain batch) — OK cho giai đoạn đầu.

---

## 5. Cấu trúc project chính (sau khi thêm)
```
Backend/
├─ app/
│  ├─ ai/gemini/            (đã có: recap via HTTP)  ← gộp test_files.py thành service sạch
│  ├─ recap/                (MỚI: orchestration từng bước)
│  │  ├─ service.py         (các hàm: generate_recap, cut_segments, voice_segment, merge)
│  │  ├─ ffmpeg.py          (cut theo [start,end], atempo sync, concat, replace audio)
│  │  ├─ ytdlp.py           (download youtube)
│  │  ├─ voice_client.py    (HTTP client → voice-service: tts, voices CRUD)
│  │  └─ router.py          (POST /api/recap/{generate,cut,voice,merge}, GET jobs/{id})
│  └─ prompts/              (system prompt, đã có)
├─ Data/jobs/{job_id}/      (recap.json, video.mp4, clips/clip_i.mp4, voice/vo_i.wav, final.mp4)
services/voice-service/     (MỚI, độc lập — xem mục 4.3)
docs/                       (plan này)
```

### 5.1 Studio (Frontend) — thay đổi
- Thêm **sidebar "Voices"**: list voices (từ `GET /voices`), nút **clone voice mới** (upload ref audio →
  `POST /voices`), chọn voice_id để dùng cho recap. Nằm cạnh các tab Dashboard/Studio/Lịch sử/Cài đặt.
- **Studio screen** cho recap: workflow từng bước (4 nút theo mục 3), hiển thị `recap.json`,
  danh sách clip/vo đã tạo, cho user nhấn "Tạo voice" từng đoạn.

---

## 6. Quyết định — ĐÃ CHỐT
1. **Gap handling**: **A — concat chỉ đoạn giữ** (video ngắn). Cắt theo `[start_time_sec, end_time_sec]` trong `recap.json`.
2. **Sync chuẩn**: **voice chuẩn + atempo cap 1.2x**. Lệch lớn → video co giãn theo `vo_duration`.
3. **Subtitle**: **BỎ QUA** giai đoạn này.
4. **Voice mode triển khai**: **CPU-ONNX (torch-free, int8, 48kHz)**.
5. **Worker/flow**: **stepwise, user-triggered** — user nhấn nút từng bước trong Studio (chưa auto pipeline). Mỗi bước 1 endpoint. Về sau mới gộp auto.
6. **Voice mặc định**: **không dùng preset cố định** — thêm **sidebar "Voices"** trong Studio để clone + chọn voice. Voice service có endpoint quản lý (CRUD) + chọn voice_id khi TTS.

---

## 7. Open risks / tech notes
- **Token refresh**: `at`/`bl`/`f.sid` lấy fresh mỗi lần GET trang — OK; cookies có thể hết hạn
  → cần cơ chế re-login (đã có `login_and_save_cookie` qua Chrome).
- **TTL file upload**: gcs path `/contrib_service/ttl_1d/...` sống 1 ngày — upload rồi phải gửi ngay.
- **yt-dlp + FFmpeg** phải cài trên máy chạy worker (Windows). Kiểm tra `ffmpeg` trong PATH.
- **Chất lượng concat**: nếu codec các clip lệch do cut stream-copy → re-encode đồng nhất.
- **License/ToS**: recap video YouTube + lồng tiếng — cân nhắc chính sách bản quyền / fair-use nội bộ.
