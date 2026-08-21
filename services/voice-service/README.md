# Voice Service (VieNeu-TTS)

Service TTS tiếng Việt độc lập cho **Google Search Tools**. Chạy CPU-ONNX torch-free (v3 Turbo
int8, 48kHz). Backend chính gọi qua HTTP (`http://127.0.0.1:8001`).

> Plan đầy đủ: [`docs/VOICE_SERVICE_PLAN.md`](../../docs/VOICE_SERVICE_PLAN.md)
> Lưu trữ: voice-service có `data/` riêng (ref audio + `voices.json`). **KHÔNG** dùng `Data/app.db`
> (của main backend) hay `Backend/Data/` (nội bộ). Xem [`memory/data-dirs-convention`](../../).

## Chạy (Phase 1 — skeleton)

```bash
cd services/voice-service
uv sync                 # tạo .venv + cài deps (vieneu torch-free)
uv run uvicorn app.main:app --port 8001
```

Lần đầu `uv sync`/start sẽ tải weights ONNX từ HuggingFace (`pnnbao-ump/VieNeu-TTS-v3-Turbo`)
về cache — khá nặng, một lần thôi. Offline: đặt weights vào `models/` + `ONNX_DIR=models/onnx_int8`
trong `.env` (Phase 5).

Verify:
```bash
curl http://127.0.0.1:8001/health
# {"status":"ok","model_loaded":true,"backend":"onnx","device":"cpu","precision":"int8","voices_count":20,"error":null}
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

## API (Phase 1 chỉ có /health)

| Method | Path | Trả về |
| --- | --- | --- |
| GET | `/health` | `{status, model_loaded, backend, device, precision, voices_count, error}` |

Phase 2+ sẽ thêm: `POST/DELETE /internal/voices/{id}`, `POST /tts`, `POST /tts/batch`, `POST /preview`.
