# Voice Service — VieNeu 3.8.1

Local TTS service for CreatorFlow. Backend talks to `http://127.0.0.1:8001`;
the browser uses `/api/voices` on Backend. One model process, one active inference
session at a time; GPU batch inference happens within that session.

## Run

```powershell
cd services/voice-service
uv sync --locked
uv run python run_server.py
```

The SDK and dependencies are pinned in `uv.lock`. Missing model weights download
on first **startup**, not during `uv sync`. The fp32 profile needs its own weights;
an existing int8 cache does not contain them. Default development cache is
`services/data/models`; Electron uses `userData/voice_data/models`.

Copy `.env.example` to `.env` to select a profile, then restart voice-service:

| VOICE_PROFILE | Engine | Use |
| --- | --- | --- |
| `turbo-fp32` (default) | CPU ONNX, 48 kHz | Highest CPU fidelity |
| `turbo-int8` | CPU ONNX, 48 kHz | VNNI-capable CPU; otherwise falls back to fp32 with a health warning |
| `nano` | CPU ONNX, 24 kHz | Weak machines; lower quality, particularly English; streaming per text chunk |
| `turbo-gpu` | PyTorch CUDA, 48 kHz | Batch throughput on NVIDIA GPUs |

Existing `PRECISION`, `BACKEND`, `DEVICE` settings still select the legacy profile
when `VOICE_PROFILE` is absent. An explicit profile takes precedence. `THREADS`
controls CPU threads; `MAX_BATCH_SIZE` (default 8, maximum 32) caps GPU batching.
Do not launch multiple Uvicorn workers: each would load another model.

GPU is an optional development/server environment, not part of the default CPU
desktop installer. On Windows install the CUDA runtime into this service venv:

```powershell
uv sync --extra cuda
uv pip install --python .venv/Scripts/python.exe torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
$env:VOICE_PROFILE='turbo-gpu'
.venv/Scripts/python.exe run_server.py
```

The service reports degraded status if CUDA is unavailable. It does not silently
run the GPU profile on CPU. Use `uv sync --group build` for the CPU PyInstaller
build. The spec includes Nano/Turbo modules and SDK version metadata.

## Existing voices and model updates

Application metadata remains in Backend's database. The service stores references
in `voices/` and custom embeddings in `voices.json` (Turbo) or `voices.nano.json`.
Only public SDK APIs (`encode_reference`, voice dictionaries) are used to restore
and synthesize clones; SDK factory presets remain independent and update normally.

Old snapshots containing all SDK presets are read without modifying them. On the
first successful save, only application clones are written in schema v2, using an
atomic replacement and a one-time `.json.bak` backup. Existing IDs remain valid.
When switching Turbo/Nano, a clone is encoded from its saved WAV on first use;
the two models never share incompatible reference codes. If its WAV is missing,
that model cannot recreate the clone. Deleting a clone removes it from both live
registries and removes its reference files; manually retained backups are separate.

Enrollment accepts up to 20 MB, normalizes at most 30 seconds of audio, then uses
the SDK's denoising/trimming. Use a clean 3–8 second reference for best results.
FFmpeg is resolved from `FFMPEG_PATH`, then PATH; Electron provides a bundled path.
The Voices UI records confirmation of permission in the clone's database tags.

SDK pinning does **not** pin mutable Hugging Face weights. For reproducible/offline
deployments, retain a complete model snapshot and configure `ONNX_DIR` to its
matching graph directory (`onnx_update` for fp32, `onnx_int8` for int8, root for Nano).
Codec/cloning assets must also be cached before using `HF_HUB_OFFLINE=1`.
Do not point an fp32 profile at int8 graphs. With an explicit int8 directory and
no detected VNNI, startup fails rather than using those graphs under a fp32 label.

## API

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | Readiness, SDK version, active profile, actual sample rate, batch/stream capabilities, warning/error |
| GET | `/internal/voices/presets` | SDK factory presets |
| POST/DELETE | `/internal/voices/{id}` | Register/remove application clone |
| POST | `/preview`, `/tts` | Buffered PCM16 WAV + `X-Audio-Duration` |
| POST | `/tts/batch` | ZIP WAV + versioned manifest, per-item voice IDs supported |
| GET | `/v1/voices` | Factory and loaded custom voices |
| POST | `/v1/audio/speech` | Streaming PCM/WAV; `stream:false` returns buffered audio |

The speech endpoint accepts `input`, `voice`, `model`, `response_format` (`pcm` or
`wav`), `speed` (only 1), `temperature`, `max_chars`, `stream`. `model` is a
compatibility field; the loaded profile determines the engine. MP3, SSE, arbitrary
speed, remote V4, and upstream voice-management endpoints are not implemented.
This is a subset of the OpenAI speech request format, not a full API replacement.
PCM is signed 16-bit little-endian mono; use `X-Sample-Rate`. Streaming WAV has
unknown length in its RIFF header; request `stream:false` for file-oriented tools.

The Voices page streams PCM through Backend's `/{id}/preview/stream` proxy and
plays it with Web Audio. Stop/switch/unmount aborts the request. Cues `[cười]`,
`[thở dài]`, `[hắng giọng]` are experimental; a `style` dropdown is not provided
because Turbo ignores that parameter.

Batch groups texts by voice, calls SDK `infer_batch`, and restores scene order.
Manifest v2 includes `duration_sec` plus legacy `duration`, `sample_rate`, voice ID,
text SHA-256, SDK version and active profile. Recap and Workflow keep working.
Blank/oversized inputs fail before synthesis. Concurrent requests wait at most
`INFERENCE_WAIT_SECONDS` (30 by default), then receive 429 + Retry-After.
There is no persistent background job queue or automatic retry of partial batches.

## Verification

```powershell
uv sync --group test
.venv/Scripts/python.exe -m unittest discover -s tests -v
# Optional: loads/downloads real weights, isolated clone registry, outputs metrics.
.venv/Scripts/python.exe -m tests.smoke_vieneu
```

From Frontend: `npm run test:voices`, `npm run build`.
GPU/Nano quality and desktop installer checks require their target environments.
