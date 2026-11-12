# Plan: Voice Service (VieNeu-TTS độc lập) + quản lý Voices

> **ĐÃ LƯU TRỮ (2026-11-12), chỉ để tham khảo lịch sử.** Voice service đã được cài đặt (VieNeu SDK 3.8.1); dòng "chưa code" và một số đường dẫn trong file không còn đúng. Hiện hành: [services/voice-service/README.md](../../services/voice-service/README.md). Đường dẫn file và số dòng trong tài liệu phản ánh thời điểm viết.


> Trạng thái: **plan — chưa code BE.**
> Cập nhật: 2026-08-21
> Tham khảo: https://github.com/pnnbao97/VieNeu-TTS
> Liên kết: [[RECAP_PIPELINE_PLAN]] (mục 4 & 6.4, 6.6 của pipeline tổng)

## 0. Mục tiêu & phạm vi

Tách phần voice (TTS tiếng Việt) ra khỏi app chính thành **một service HTTP độc lập**, có:

- Môi trường riêng (CPU-ONNX torch-free, không kéo torch/cuda vào app chính).
- API HTTP cho app chính (FastAPI backend) gọi khi tạo voice cho từng đoạn recap.
- **Lưu voice clone bền vững** — clone 1 lần, dùng lại nhiều lần, tồn tại qua restart.
- Cấu trúc đủ để **triển khai nội bộ** (docker-compose, model weights pre-download offline).

Phạm vi **giai đoạn này (plan)**: chỉ định nghĩa kiến trúc, API contract, lưu trữ, và cách FE
"Voices" (đã thêm ở [main.tsx](../../Frontend/src/main.tsx)) sẽ gọi. **Chưa code BE.**

---

## 1. Năng lực VieNeu-TTS (tóm tắt từ README)

- v3 Turbo, 48kHz, zero-shot voice cloning từ ref audio **3-8 giây**.
- 20 preset voices (Bắc/Trung/Nam) — dùng được ngay, không cần clone.
- `infer(text, voice=<name|id>, ref_audio=, denoise=True)` → sinh audio.
- `infer_batch(items)` — gom nhiều text, lợi thế lớn (đặc biệt GPU; CPU vẫn chạy tuần tự).
- `infer_stream` — realtime (chưa cần giai đoạn đầu).
- `add_voice(name, ref)` + `save_voices()` (persist ra `voices.json`) + `remove_voice`.
- Emotion cues inline trong text: `[cười]`, `[thở dài]`, `[hắng giọng]`.
- Backend: **CPU = ONNX Runtime torch-free (int8, 48kHz)**; GPU = PyTorch + batch.
- Có sẵn demo FastAPI `apps/web_stream.py` (port 8001) + docker-compose → tham khảo.

---

## 2. Kiến trúc voice service (độc lập)

```
services/voice-service/                  # repo/service độc lập, chạy port 8001
├─ pyproject.toml                        # uv; dep: vieneu, fastapi, uvicorn, python-multipart
├─ .env                                  # VOICE_PORT=8001, DEVICE=cpu, VOICES_DIR, MODEL_DIR, ...
├─ app/
│  ├─ main.py                            # FastAPI app + lifespan: load model 1 lần, load voices
│  ├─ config.py                          # Settings: device onnx/gpu, precision int8, paths
│  ├─ engine.py                          # bọc Vieneu(): singleton, lifecycle, re-register voices
│  ├─ routers/
│  │  ├─ health.py                       # GET  /health
│  │  ├─ voices.py                       # POST/DELETE /internal/voices/{id} (register/remove engine)
│  │  └─ tts.py                          # POST /tts, POST /tts/batch  (+ /preview)
│  ├─ storage.py                         # ref audio + voices.json (KHÔNG có SQLite ở đây)
│  └─ schemas.py                         # pydantic: VoiceRegister, TTSRequest, TTSItem
├─ data/
│  ├─ voices/                            # ref audio bền vững (file wav)
│  └─ voices.json                        # vieneu.save_voices() persist (engine tự quản)
├─ models/                               # weights pre-download (HuggingFace pnnbao-ump/VieNeu-TTS-v3-Turbo)
└─ docker/
   ├─ Dockerfile                         # image CPU-ONNX (torch-free)
   └─ docker-compose.yml                 # volume models + data; GPU passthrough tuỳ chọn
```

> **Lưu trữ chung = `Data/app.db`** (DB duy nhất, do **main backend** quản lý): mọi metadata
> (gemini settings, jobs, **voices**) đều ở đây. Voice-service **không có DB riêng** — chỉ giữ
> `voices.json` (engine ViNeu persistence) + file ref audio. Metadata voice (`voice_id, name,
> ref_path, tags, created_at`) nằm ở **bảng `voices` trong `app.db`** (main backend CRUD).

**Tại sao tách**: model weights lớn, ONNX/torch phụ thuộc nặng, lifecycle (load model chậm, warm-up)
khác hoàn toàn app chính (FastAPI CPU nhẹ). App chính chỉ `httpx.post('http://voice-service:8001/tts')`.

---

## 3. API contract

Hai lớp: **FE → main backend** (`/api/*`, DB = `app.db`) và **main backend → voice-service** (internal + /tts).

### 3.1 FE → main backend (prefix `/api`, DB = `app.db`)

| Method | Path | Body | Trả về | Lưu ý |
| --- | --- | --- | --- | --- |
| GET | `/api/voices` | – | `[{voice_id, name, tags, created_at}, ...]` | đọc `app.db.voices` (không load engine) |
| POST | `/api/voices` | multipart`{name, ref_audio}` | `{voice_id, name, created_at}` | ghi app.db + forward register → voice-service |
| DELETE | `/api/voices/{id}` | – | `{ok}` | xoá app.db + forward remove → voice-service |
| POST | `/api/voices/{id}/preview` | `{text?}` | `audio/wav` | forward → voice-service `/preview` |
| POST | `/api/recap/voice` | `{segment..., voice_id}` | `{vo_url, duration}` | forward → voice-service `/tts` |

### 3.2 Main backend → voice-service (port 8001, nội bộ)

| Method | Path | Body | Trả về |
| --- | --- | --- | --- |
| GET | `/health` | – | `{status, device, voices_count, model_loaded}` |
| POST | `/internal/voices/{voice_id}` | multipart`{ref_audio, name?}` | `{ok}` (engine `add_voice` + `save_voices`) |
| DELETE | `/internal/voices/{voice_id}` | – | `{ok}` (engine `remove_voice` + `save_voices`) |
| POST | `/preview` | `{text, voice_id}` | `audio/wav` |
| POST | `/tts` | `{text, voice_id?, ref_audio?, speed?, emotion?}` | `audio/wav` (48kHz) + header `X-Audio-Duration` |
| POST | `/tts/batch` | `{items:[{text, voice_id}, ...], speed?}` | `[{index, audio_b64 \| url, duration}]` hoặc `zip` |

> Voice-service **không expose ra trình duyệt** — chỉ main backend gọi qua httpx. FE chỉ biết
> 1 origin (backend :8000) → CORS đơn giản, có thể cache/throttle. Metadata `app.db` là nguồn sự thật;
> voice-service chỉ là "engine tính toán" dùng `voices.json`.

### 3.3 Ràng buộc pacing (kết nối với pipeline)

- Prompt recap ép `vietnamese_vo ≈ duration_sec × 3 từ/giây` → TTS **phải có độ dài ≈ duration_sec**.
- `/tts` trả kèm header `X-Audio-Duration` (s) → main backend đo lệch → atempo sync (xem
  [[RECAP_PIPELINE_PLAN]] §2.5). Nếu thiếu header, main backend tự đo bằng `ffprobe`.
- `speed` (0.85-1.2): co giãn nhẹ tốc độ đọc tại engine (thay vì chỉ atempo sau). Cap 1.2x theo chốt.

### 3.4 Mapping FE "Voices" → main backend

FE [main.tsx VoicesPage](../../Frontend/src/main.tsx) gọi `/api/voices` (đã sẵn trong code). Mọi CRUD
đều qua main backend — main backend tự xử metadata (app.db) và chỉ forward phần engine khi cần:

| FE gọi | Main backend làm |
| --- | --- |
| `GET /api/voices` | đọc `app.db.voices` (KHÔNG gọi voice-service) |
| `POST /api/voices` | ghi `app.db.voices` + `POST /internal/voices/{id}` → voice-service |
| `DELETE /api/voices/{id}` | xoá `app.db.voices` + `DELETE /internal/voices/{id}` → voice-service |

---

## 4. Lưu voice clone bền vững

> **Một DB chung `Data/app.db`** (main backend). Bảng `voices`: `voice_id, name, ref_path, tags, created_at`.
> Voice-service không có DB — chỉ `voices.json` (engine) + ref audio.

**Luồng tạo voice (FE → `POST /api/voices` ở main backend):**

1. Main backend nhận `name` + `ref_audio` (multipart, 3-8s), sinh `voice_id`.
2. (Tuỳ chọn) `ffmpeg` chuẩn hoá ref: mono, 48kHz, cắt ≤8s, khử ồn nhẹ.
3. Ghi row `app.db.voices`: `voice_id, name, ref_path, tags, created_at`.
4. Forward ref audio → voice-service `POST /internal/voices/{voice_id}` (register engine):
   `engine.add_voice(voice_id, ref_path)` + `engine.save_voices()` → ghi `data/voices.json`.
5. Trả `{voice_id, name, created_at}` cho FE.

**List voice (`GET /api/voices` ở main backend):** đọc `app.db.voices` → nhanh, **không load engine**.

**Khởi động voice-service (lifespan):**

1. Load model 1 lần (chậm, ~vài giây) → giữ singleton `engine`.
2. Đọc `voices.json` (vieneu persistence) → re-register voices vào engine.
3. Warm-up: chạy 1 `infer` rác để ONNX session khởi tạo graph (lần TTS đầu không chậm).

> Voice-service **không cần đọc `app.db`** để TTS: request `/tts` mang `voice_id`, engine dùng
> `voices.json` đã load. Metadata (name/tags) chỉ main backend cần (cho UI). Hai bên tách rõ:
> main backend = nguồn sự thật metadata, voice-service = engine + audio.

**Xoá voice (`DELETE /api/voices/{id}` ở main backend):** xoá row `app.db.voices` + forward
`DELETE /internal/voices/{id}` → voice-service `engine.remove_voice(id)` + `save_voices()` + xoá ref.

---

## 5. Tích hợp vào recap pipeline

(Giai đoạn recap — xem chi tiết [[RECAP_PIPELINE_PLAN]] §2.2 & §3.)

- Bước "Tạo voice" trong Studio: với mỗi segment, gửi `{text: vietnamese_vo, voice_id}` → `/tts` (hoặc
  gom tất cả segment → `/tts/batch` 1 lần, lợi thế `infer_batch`).
- `voice_id` do user chọn ở FE Voices (hoặc default 1 preset nếu chưa clone).
- Output `vo_i.wav` (48kHz), lưu vào `Data/jobs/{job_id}/voice/vo_i.wav`.
- Sync: đo `vo_duration` → lệch nhỏ atempo, lệch lớn video co giãn theo voice (RECAP §2.5).
- Emotion (tuỳ chọn): chèn cue `[cười]`... vào text trước khi gửi (VieNeu hỗ trợ).

---

## 6. Triển khai nội bộ

- **Mode: CPU-ONNX (torch-free, int8, 48kHz)** — đã chốt (RECAP §6.4). Không cần GPU.
- Docker compose service `voice-service`:
  - Volume `./models` (weights pre-download từ HuggingFace `pnnbao-ump/VieNeu-TTS-v3-Turbo` → offline).
  - Volume `./data` (chỉ ref audio `voices/` + `voices.json` — **không có SQLite**, metadata ở `app.db` main backend).
  - Port `8001` nội bộ.
- App chính (FastAPI :8000) gọi `http://voice-service:8001` qua httpx.
- **Hiệu năng CPU**: text ngắn (từng segment `vietnamese_vo` ≈ vài chục từ) → ONNX đủ nhanh.
  `infer_batch` trên CPU chạy tuần tự (không gain batch như GPU) — OK cho giai đoạn đầu recap.

---

## 7. Triển khai theo từng bước (task list — chưa code)

> Làm tuần tự, mỗi bước chạy được/verify được rồi mới tiếp.

### Phase 1 — Voice service skeleton (BE, voice-service)

1. Tạo `services/voice-service/` + `pyproject.toml` (uv, dep: vieneu, fastapi, uvicorn, python-multipart).
2. `app/main.py` + `config.py` + `engine.py` (singleton Vieneu, lifespan load model + voices).
3. `routers/health.py` → `GET /health` trả `{status, device, voices_count}`.
4. Chạy local: `uvicorn app.main:app --port 8001`, curl `/health` → model load OK.

### Phase 2 — Voice engine register/remove (voice-service, KHÔNG có DB)

5. `app/storage.py` (chỉ ref audio + `voices.json`) + `schemas.py` (VoiceRegister, TTSRequest).
6. `routers/voices.py`: `POST/DELETE /internal/voices/{id}` → `engine.add_voice`/`remove_voice` + `save_voices`.
7. Restart test: register 1 voice → restart service → voice vẫn còn trong engine (qua `voices.json`).

### Phase 3 — TTS endpoints (voice-service)

8. `routers/tts.py`: `POST /tts` (single) → `audio/wav` + header `X-Audio-Duration`.
9. `POST /tts/batch` → list audio (b64 hoặc file URL) + duration mỗi item.
10. `POST /preview` — sinh thử 1 câu, trả wav.
11. Test: gửi `vietnamese_vo` của 1 segment trong `Backend/Data/recap.json` → nghe, đo duration.

### Phase 4 — Main backend: voices table (app.db) + voice_client + FE wire-up

12. Main backend: thêm model `Voice` + migration alembic → bảng `voices` trong `app.db`.
13. `Backend/app/recap/voice_client.py` — httpx client → voice-service (`/internal/voices`, `/tts`, `/preview`).
14. `Backend` router `/api/voices`: GET (đọc app.db) / POST (ghi app.db + forward register) / DELETE (xoá + forward remove) + `/preview`.
15. Chạy FE VoicesPage → clone voice → hiện trong list → xoá → OK end-to-end.

### Phase 5 — Docker nội bộ

16. `docker/Dockerfile` (CPU-ONNX image) + `docker-compose.yml` (volume models + data; KHÔNG mount app.db).
17. Pre-download weights vào `models/` (offline), `docker compose up` → `/health` OK.

### Phase 6 — Recap integration

18. Bước "Tạo voice" trong Studio gọi `/tts/batch` cho tất cả segment, lưu `vo_i.wav`.
19. atempo sync + merge (RECAP §2.5, §2.6) → `final_recap.mp4`.

---

## 8. Quyết định (đã chốt — từ RECAP_PIPELINE_PLAN §6)

- **Voice mode**: CPU-ONNX (torch-free, int8, 48kHz) — RECAP §6.4.
- **Voice mặc định**: không dùng preset cố định — sidebar "Voices" để clone + chọn — RECAP §6.6.
- **Sync**: voice chuẩn + atempo cap 1.2x; lệch lớn video co giãn theo vo_duration — RECAP §6.2.
- **Lưu trữ**: DB chung `Data/app.db` (bảng `voices`), voice-service không có DB riêng — chỉ `voices.json`.

---

## 9. Open risks / tech notes

- **ONNX vs PyTorch interface**: README liệt kê cả 2 backend — cần xác nhận API `infer/add_voice`
  giống nhau trên nhánh CPU-ONNX (có thể có khác biệt nhỏ) → verify ở Phase 1.
- **Ref audio chất lượng**: clone zero-shot nhạy với ồn/tiếng nền → bước chuẩn hoá ref (§4.2) quan trọng.
- **Warm-up lạnh**: lần `infer` đầu sau start có thể chậm (ONNX build graph) → lifespan warm-up (§4).
- **Đồng bộ app.db ↔ voices.json**: metadata ở app.db (main backend), engine state ở voices.json
  (voice-service). Nếu tạo voice mà voice-service chết → app.db có row nhưng engine thiếu → cần reconcile
  khi start (main backend check voice-service `/health` + re-register voice còn thiếu).
- **License VieNeu**: kiểm tra giấy phép repo + weights HuggingFace trước khi triển khai nội bộ.
- **Tiếng Việt dài**: text segment có thể dài → xem có giới hạn độ dài input của engine không.
