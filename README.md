# ytb_v1 — YouTube Recap Tools

Bộ công cụ desktop để tạo **video recap tiếng Việt** từ YouTube: phân tích transcript bằng Gemini,
cắt video theo đoạn, lồng tiếng Việt (TTS), ghép lại thành video cuối.

> Trạng thái: recap pipeline **R1–R4 đã chạy end-to-end** (generate → cut → voice+sync → merge),
> có REST API, rehydrate job sau restart + resume từ UI. Voice-service (VieNeu-TTS, ONNX/CPU) đã chạy
> port 8001. Còn chế lại / đánh bóng — xem [docs/](docs/).

## Kiến trúc

```
Frontend/   Electron + Vite + React + Tailwind v4 (desktop app, port dev 5173)
Backend/    FastAPI + SQLAlchemy + SQLite (Python, port 8000)
services/   voice-service — VieNeu-TTS độc lập (ONNX/CPU, port 8001)
Desktop/    package.json gốc (concurrently) — `npm start` chạy cả 3 service
docs/       Plan + implementation notes pipeline
```

- **Frontend** (Electron): sidebar Dashboard / Studio / Voices / Thư viện nhạc / Xóa Watermark / Lịch sử / Cài đặt. Studio chạy
  recap 4 bước + nghe thử từng VO / xem final, có **resume** (dựng lại job sau restart server). Tab Xóa Watermark hỗ trợ xử lý hàng loạt video bằng AI Inpainting.
- **Backend** (FastAPI, `http://127.0.0.1:8000`):
  - `app/recap/` — orchestration R1–R4 (router, service, schemas, state, ffmpeg, paths, ytdlp).
  - `app/watermark/` — xóa Gemini SynthID ✦ watermark (Hybrid: path-based cho Desktop + upload cho Web, tải toàn bộ ZIP).
  - `app/ai/gemini/` — gọi **Gemini web qua HTTP thuần** (cookie + token, không automation/Playwright).
  - `app/voices/` — voice_client gọi voice-service `/tts`.
  - `app/routers/health.py` — health check.
- **Voice-service** (`services/voice-service`, port 8001): VieNeu-TTS (CPU-ONNX), API HTTP:
  `/tts`, `/tts/batch`, `/voices`, `/health`. Load model 1 lần trong lifespan (dung sai lỗi).

## Pipeline recap (4 bước, user-triggered)

```
link YouTube + raw.txt  ──R1 Gemini (HTTP)──▶  recap.json
recap.json  ──R2 yt-dlp + FFmpeg stream-cut [start,end]──▶  clip_i.mp4
clip_i + vietnamese_vo  ──R3 voice-service /tts/batch + atempo sync──▶  voice_i.wav
clip_i + voice_i  ──R4 FFmpeg mux + concat copy──▶  final_recap.mp4
```

Mỗi job 1 thư mục riêng `Backend/Data/Downloads/{job_id}/` chia subfolder `source/` `clips/`
`voice/` `merge/` + `recap.json` + `final_recap.mp4`. File nguồn (video gốc) được giữ để
re-cut / re-merge khỏi phải tải lại. State in-memory + persist `recap.json` → rehydrate sau restart.

Chi tiết: [docs/RECAP_PIPELINE_PLAN.md](docs/RECAP_PIPELINE_PLAN.md) ·
[docs/RECAP_IMPLEMENTATION_PLAN.md](docs/RECAP_IMPLEMENTATION_PLAN.md) ·
[docs/VOICE_SERVICE_PLAN.md](docs/VOICE_SERVICE_PLAN.md).

### REST API (`/api/recap`)

| Endpoint | Pha | Tác dụng |
|---|---|---|
| `POST /api/recap/generate` | R1 | multipart `youtube_url` + `raw_file` → `recap_done` |
| `POST /api/recap/cut` | R2 | json `{job_id}` → tải + cut từng segment → `cut_done` |
| `POST /api/recap/voice` | R3 | json `{job_id, voice_id}` → TTS batch + atempo sync → `voice_done` |
| `POST /api/recap/merge` | R4 | json `{job_id}` → mux + concat → `merged`, `final` |
| `GET  /api/recap/jobs/{id}` | — | doc state (tự rehydrate nếu server restart) |
| `GET  /api/recap/jobs/{id}/voice/{i}` | — | `audio/wav` VO đoạn i (UI nghe thử) |
| `GET  /api/recap/jobs/{id}/final` | — | `video/mp4` final (range request, seek) |
| `GET  /api/recap/jobs` | — | list job (gộp memory + disk) |

Mỗi bước chạy trong threadpool (httpx/yt-dlp/ffmpeg blocking) để không block event loop.
Có gate: mỗi pha yêu cầu status của pha trước.

## Yêu cầu

- Node.js ≥ 20, npm
- Python ≥ 3.12, [uv](https://github.com/astral-sh/uv) (hoặc pip + venv)
- `ffmpeg` + `yt-dlp` trong PATH (cho pipeline recap)
- Tài khoản Google (cookie Gemini) — cấu hình ở `Backend/Data/config.json` (không commit)

## Khởi động nhanh (dev — tất cả service)

```bash
# Lần đầu: cài deps
cd Frontend && npm install && cd ..
cd services/voice-service && uv sync && cd ../..     # voice-service env riêng (torch-free)

# Chạy cả 3 cùng lúc: backend :8000 + voice-service :8001 + frontend (electron)
npm start
```

`npm start` (qua [Desktop/package.json](Desktop/package.json)) dùng `concurrently` khởi động
song song **BACKEND + VOICE + FRONTEND**; Ctrl+C sẽ tắt hết. Muốn chạy không cần voice
(nhẹ hơn): `npm run start:core --prefix Desktop` (chỉ backend + frontend).

Verify từng service:
```bash
curl http://127.0.0.1:8000/api/ping     # backend (DB ping)
curl http://127.0.0.1:8001/health      # voice-service → {model_loaded:true, backend:"onnx", voices_count:20}
```

## Chạy từng phần (thủ công)

### Backend

```bash
cd Backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd Frontend
npm install
npm run dev                     # electron-vite dev
```

### Voice-service

```bash
cd services/voice-service
uv sync
uv run uvicorn app.main:app --reload --port 8001
```

## Cấu hình (bắt buộc trước khi chạy recap)

Copy template rồi điền cookie Gemini:

```bash
cp Backend/Data/config.example.json Backend/Data/config.json
```

Sửa `config.json`:
- `gemini.cookies`: dán cookie từ `gemini.google.com` (DevTools → Application → Cookies → copy tất cả).
- `gemini.client_context_token`: chỉ cần khi **upload file** qua Gemini (lấy từ DevTools network).

## Cấu trúc

```
.
├─ Frontend/               # Electron app
│  ├─ src/                 # React (main.tsx — recap UI + resume)
│  └─ electron/            # main/preload
├─ Backend/                # FastAPI
│  ├─ app/
│  │  ├─ ai/gemini/        # Gemini HTTP (router, service, schemas, recap, capture)
│  │  ├─ recap/            # R1–R4 (router, service, schemas, state, ffmpeg, paths, ytdlp)
│  │  ├─ voices/           # voice_client → voice-service
│  │  ├─ routers/          # health
│  │  ├─ config.py, db.py, main.py
│  ├─ prompts/             # system prompt recap
│  ├─ tests/recap/         # test_cut / test_merge / test_voice
│  ├─ Data/                # config.json (gitignored), Downloads/{job}/, recap.json, ChromeProfile
│  └─ requirements.txt
├─ services/voice-service/ # VieNeu-TTS (app/routers: health, tts, voices) + data/
├─ Desktop/                # package.json gốc (concurrently)
├─ docs/                   # RECAP_PIPELINE_PLAN, RECAP_IMPLEMENTATION_PLAN, VOICE_SERVICE_PLAN
└─ package.json
```

## .gitignore — đã loại bỏ

- **Mật**: `Backend/Data/config.json` (cookie Gemini), `*.har` (capture chứa cookie),
  `Backend/Data/ChromeProfile/`, `.env`.
- **Runtime**: `Backend/Data/*.txt`, `Backend/Data/recap.json`, `Backend/Data/Downloads/`,
  `Data/app.db`, `Data/jobs/`.
- **Build/deps**: `node_modules/`, `Frontend/out/`, `.venv/`, `__pycache__/`.

Dùng `Backend/Data/config.example.json` làm mẫu cấu hình (không có secret).

## License

Internal use only — chưa công bố. Recap video YouTube + lồng tiếng: cân nhắc chính sách bản quyền / fair-use nội bộ.
