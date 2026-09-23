# VieNeu upgrade verification — 2026-09-23

Implemented SDK 3.3.0 → 3.8.1 with locked dependencies, CPU fp32 default,
VNNI-gated int8, opt-in CUDA and Nano profiles, serialized inference, grouped SDK
batching with stable output order, compatible duration metadata, public-API clone
storage with legacy import, PCM preview through Backend to Web Audio, emotion
cue buttons and clone-permission metadata. Existing buffered WAV/ZIP endpoints stay available.

Local `.env` now selects fp32; downloaded weights are in the existing model cache.
No server process was restarted and no installer was published.

## Executed checks

- Voice-service unittest suite: 16 passed (including 5 existing runtime tests).
- Backend new manifest and streaming/deletion contract tests: 4 passed.
- PCM transport boundary tests: 2 passed.
- Frontend production build: passed. Existing mixed static/dynamic import warning.
- Full renderer TypeScript check: fails on other modules (Discover, Publisher,
  Settings, Stories, Workflow, YouTube Publisher); no remaining errors in Voices.
- Existing `test_export_audio.py`: 16 failed, 2 passed. Repeated with the original
  `HEAD:Backend/app/workflow/service.py` loaded in memory: same 16 failures, 2 passes.
  These cover existing export mixing, duration/metadata and failure-handling bugs.
  This upgrade does not resolve that separate export pipeline.

## Real model smoke

`tests/smoke_vieneu.py` loaded VieNeu 3.8.1, used a built-in preset and verified
finite, nonempty generated audio plus streaming. Measurements from one short
sentence, after model loading; not a quality evaluation or sustained benchmark:

| Profile | Output duration | Synthesis wall time | First streamed chunk |
| --- | --- | --- | --- |
| Turbo int8 (cached model) | 3.12 s | 1.10 s | 162 ms |
| Turbo fp32 | 2.88 s | 1.53 s | 266 ms |

The fp32 `--clone` run also enrolled a **synthetic** reference in a temporary
directory, saved/reloaded it, and successfully synthesized using the restored voice
dictionary. User recordings and live voice registries were not changed by the smoke.

## Remaining scope

- GPU and Nano configurations are implemented but not benchmarked on target hardware.
- No packaged Windows installer test or browser audio listening session was run.
- OpenAI-shaped speech endpoint supports PCM/WAV only; no SSE/MP3 or remote V4.
- Per-item voices are supported by the service batch API; the existing Workflow UI
  still selects a single narrator. A multi-character script editor is a separate feature.
- Durable job queue, partial-batch retries and LoRA training UI are not implemented.
- SDK version is pinned; model weights remain upstream-managed unless an operator
  supplies fixed local snapshots. See the voice-service README for offline configuration.

After restarting Backend, voice-service and the desktop renderer, test preview,
an existing clone, a new clone and a short Recap/Workflow job before distribution.
