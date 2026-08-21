# ytb_v1 — YouTube Recap Tools

Bộ công cụ desktop để tạo **video recap tiếng Việt** từ YouTube: phân tích transcript bằng Gemini,
cắt video theo đoạn, lồng tiếng Việt (TTS), ghép lại thành video cuối.

> Trạng thái: đang phát triển — phần recap (Gemini HTTP) đã chạy OK; voice service + pipeline đang ở
> giai đoạn lập plan (xem [docs/](docs/)).

## Kiến trúc

```
Frontend/   Electron + Vite + React + Tailwind v4 (desktop app)
Backend/    FastAPI + SQLAlchemy + SQLite (Python, venv)
services/   (sắp có) voice-service — VieNeu-TTS độc lập
docs/       Plan pipeline + voice service
```

- **Frontend** (Electron): sidebar Dashboard / Studio / Voices / Lịch sử / Cài đặt.
- **Backend** (FastAPI, `http://127.0.0.1:8000`):
  - `app/ai/gemini/` — gọi **Gemini web qua HTTP thuần** (cookie + token, không automation/Playwright).
  - `app/routers/health.py` — health check.
- **Voice** (sắp có): service riêng (VieNeu-TTS, CPU-ONNX), API HTTP cho backend gọi.

## Pipeline recap (từng bước, user-triggered)

```
link YouTube + raw.txt  ──Gemini (HTTP)──▶  recap.json
recap.json  ──yt-dlp + FFmpeg cut [start,end]──▶  clip_i.mp4
clip_i + vietnamese_vo  ──voice-service /tts──▶  vo_i.wav  (atempo sync)
clip_i + vo_i  ──FFmpeg concat──▶  final_recap.mp4
```

Chi tiết: [docs/RECAP_PIPELINE_PLAN.md](docs/RECAP_PIPELINE_PLAN.md) · [docs/VOICE_SERVICE_PLAN.md](docs/VOICE_SERVICE_PLAN.md).

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
│  ├─ src/                 # React (main.tsx, styles.css)
│  └─ electron/            # main/preload
├─ Backend/                # FastAPI
│  ├─ app/
│  │  ├─ ai/gemini/        # Gemini HTTP (router, service, schemas)
│  │  ├─ routers/          # health
│  │  ├─ config.py, db.py, main.py
│  ├─ prompts/             # system prompt recap
│  ├─ Data/                # config.json (gitignored), recap.json, ChromeProfile
│  └─ requirements.txt
├─ docs/                   # RECAP_PIPELINE_PLAN.md, VOICE_SERVICE_PLAN.md
└─ package.json
```

## .gitignore — đã loại bỏ

- **Mật**: `Backend/Data/config.json` (cookie Gemini), `*.har` (capture chứa cookie),
  `Backend/Data/ChromeProfile/`, `.env`.
- **Runtime**: `Backend/Data/*.txt`, `Backend/Data/recap.json`, `Data/app.db`, `Data/jobs/`.
- **Build/deps**: `node_modules/`, `Frontend/out/`, `.venv/`, `__pycache__/`.

Dùng `Backend/Data/config.example.json` làm mẫu cấu hình (không có secret).

## License

Internal use only — chưa công bố. Recap video YouTube + lồng tiếng: cân nhắc chính sách bản quyền / fair-use nội bộ.
