# Voice Service (VieNeu-TTS)

Service TTS tiếng Việt độc lập cho **Google Search Tools**. Chạy CPU-ONNX torch-free (v3 Turbo
int8, 48kHz). Backend chính gọi qua HTTP (`http://127.0.0.1:8001`).

> Plan đầy đủ: [`docs/VOICE_SERVICE_PLAN.md`](../../docs/VOICE_SERVICE_PLAN.md)
> Lưu trữ: voice-service có `data/` riêng (ref audio + `voices.json`). **KHÔNG** dùng `Data/app.db`
> (của main backend) hay `Backend/Data/` (nội bộ). Xem [`memory/data-dirs-convention`](../../).

## Chạy voice-service

```bash
cd services/voice-service
uv sync                 # tạo .venv + cài deps (vieneu torch-free)
uv run uvicorn app.main:app --port 8001
```

Lần đầu `uv sync`/start sẽ tải weights ONNX từ HuggingFace (`pnnbao-ump/VieNeu-TTS-v3-Turbo`)
về `MODEL_CACHE_DIR` (mặc định `data/models`, hoặc `HF_HOME` nếu đã đặt) — khá nặng,
nhưng chỉ tải một lần. Bản Electron đặt cache này trong `userData/voice_data/models` để các lần
khởi động sau dùng lại. Offline: đặt weights vào `models/` + `ONNX_DIR=models/onnx_int8`
trong `.env`.

Khi clone giọng, service tìm FFmpeg theo `FFMPEG_PATH` trước rồi mới fallback sang `PATH` để
thuận tiện khi dev. Bản Electron đóng gói `ffmpeg-static` tại `resources/bin/ffmpeg.exe` và truyền
`FFMPEG_PATH` tự động; máy người dùng không cần cài FFmpeg riêng.

Verify:
```bash
curl http://127.0.0.1:8001/health
# {"status":"ok","model_loaded":true,"backend":"onnx","ffmpeg_available":true,"voices_count":20,"error":null}
```

## Cấu trúc

```
app/
├─ main.py        # FastAPI + lifespan (load model 1 lần)
├─ config.py      # Settings (.env)
├─ engine.py       # singleton Vieneu wrapper, tolerant init
├─ routers/
│  └─ health.py    # GET /health
└─ (Phase 2+: voices.py, tts.py)
data/
├─ voices/         # ref audio bền vững (Phase 2)
└─ voices.json     # engine persistence (Phase 2)
```

## API

| Method | Path | Trả về |
| --- | --- | --- |
| GET | `/health` | `{status, model_loaded, model_cache_dir, ffmpeg_available, backend, device, precision, voices_count, error}` |
| GET | `/internal/voices/presets` | Danh sách voice preset |
| POST | `/internal/voices/{id}` | Đăng ký voice clone bằng audio mẫu |
| DELETE | `/internal/voices/{id}` | Xóa voice clone |
| POST | `/preview` | Sinh audio nghe thử |
| POST | `/tts` | Sinh audio cho một đoạn |
| POST | `/tts/batch` | Sinh nhiều đoạn, trả ZIP WAV + manifest |
