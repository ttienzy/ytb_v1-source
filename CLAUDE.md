# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"CreatorFlow AI" / "Google Search Studio" (repo `ytb_v1`): a **Windows-first Electron desktop app** for automating AI video production. Docs, comments and UI strings are mostly **Vietnamese**. Features: AI Workflow / Campaign (product images → ad video via Google Flow/Veo), Veo Studio, Motion Control, YouTube Recap pipeline (R1–R4), Vietnamese TTS (VieNeu), watermark removal, publishing schedulers (Pippit/YouTube/Drive).

Four cooperating processes + one browser extension:

| Part | Dir | Stack | Port |
|---|---|---|---|
| Backend | `Backend/` | FastAPI + SQLAlchemy/SQLite, Python 3.11 | 8000 |
| Voice service | `services/voice-service/` | FastAPI + VieNeu-TTS (uv-managed, separate venv) | 8001 |
| Frontend | `Frontend/` | Electron + React 19 + Vite (electron-vite) + Tailwind 4 + `@xyflow/react` | – |
| Chrome extension | `Extensions/FlowsVeo-Clean/` | MV3, esbuild-built | talks to Backend **Veo bridge** on 60526 |
| Launcher | `Desktop/dev.js` | Node | orchestrates all of the above |

The root dir also contains lots of untracked scratch (`*.har`, `*.com` captures, `raw.txt`, `1.txt`, …) — ignore them; they are Flow/Muse network captures used for reverse-engineering.

## Commands

**Run everything (dev)** — from repo root or `Desktop/`:
```powershell
npm start                    # node Desktop/dev.js: kills stale processes on 8000/8001, starts backend(--reload)+voice+Electron
npm run start:stable --prefix Desktop   # backend without --reload (use during long jobs; reload kills running jobs)
npm run stop --prefix Desktop           # clean up leftover dev processes
npm test --prefix Desktop               # tests for dev.js process-kill logic
```
`dev.js` flags: `--reuse`, `--keep-services`, `--no-reload`, `--force`, `--only=backend,voice,frontend`. Every `npm start` boots a *fresh* backend (orphaned uvicorn `--reload` workers on Windows otherwise keep serving old code).

**Backend** (`Backend/`, venv at `Backend/.venv`):
```powershell
pip install -r requirements.txt
python run_server.py                          # uvicorn app.main:app on :8000 (reload=True)
python -m pytest tests/veo/test_flow_queue.py # single file; add ::test_name for one test
python -m pytest tests/campaign               # a directory
python -m unittest tests.test_watermark_runtime   # CI runs this one with unittest before pyinstaller
pyinstaller --noconfirm backend.spec          # → dist/backend_server.exe
```
Files named `manual_test_*.py` are NOT automated tests (they hit real services). DB migrations: `alembic` (`Backend/alembic/versions`, only 0001–0006 exist; most tables are created at startup via `ensure_*_tables()` / `Base.metadata.create_all`, not alembic).

**Frontend** (`Frontend/`):
```powershell
npm run dev            # electron-vite dev (spawns/reuses backend itself too)
npm run typecheck      # tsc --noEmit  — the only "lint"; there is no eslint
npm run build          # electron-vite build → out/
npm test               # node --experimental-strip-types --test src/features/workflow/__tests__/*.test.{ts,mjs}
npm run test:campaign | test:voices | test:veo   # other feature test sets (same node:test runner)
node --experimental-strip-types --test path/to/file.test.ts   # single test file
npm run package        # build + electron-builder (needs Backend/dist/backend_server.exe, voice dist exe, ffmpeg-static)
```
Watermark runtime (one-time): `cd Frontend/watermark-runtime && npm install && npx playwright install chromium`.

**Voice service**: `cd services/voice-service && uv sync --locked && uv run python run_server.py`; tests in `services/voice-service/tests`. Profile chosen by `VOICE_PROFILE` env (`turbo-fp32` default, `turbo-int8`, `nano`, `turbo-gpu`).

**Extension** (`Extensions/FlowsVeo-Clean/`, Node ≥ 22):
```powershell
npm ci; npm run build; npm test; npm run test:minify
node --test tests/frames_ui.test.cjs   # single test
npm run verify                         # full: build, tests normal+minified, release build, headless Chromium smoke, zip
```
**Do not edit** the root-level `background.js`, `content.js`, `popup.js`, `popup.html`, `manifest.json` — they are generated from `src/` + `public/` by `npm run build` (this keeps "Load unpacked" on the repo folder working). Rebuild after changing `src/`, and don't reload the extension while a job is running.

**Release**: pushing a `v*` tag runs `.github/workflows/release.yml` (Windows). It requires the same version in `Frontend/package.json`, `Frontend/package-lock.json`, the extension's `package.json`/`package-lock.json`/`public/manifest.json`, and a `docs/releases/<version>.md` file.

## Architecture

### Backend (`Backend/app/`)
- `main.py` mounts one router per feature package (`ai/{gemini,chatgpt,muse,image_gen}`, `workflow`, `campaign`, `veo`, `recap`, `voices`, `media`, `watermark`, `discover`, `stories`, `publisher_monitor`, `externals/{gdrive,mailtm,pippit,youtube}`). Each package follows `router.py` / `schemas.py` / `service.py` (/ `models.py`). `lifespan` starts the Veo bridge and calls the `ensure_*_table(s)` functions; failures there are swallowed, so check logs.
- `app/db.py` just re-exports `app/core/database.py`. Settings in `app/core/config.py`; user config (Gemini cookies, 9router key, Chrome paths, Muse…) is a JSON file via `app/core/storage.py` (`read_config`), not the DB.
- **Data location** is decided in `core/config.py`: env `APP_DATA_DIR` → else, when PyInstaller-frozen, `%APPDATA%/GoogleSearchApp/Data` → else dev `Backend/Data/` (SQLite `app.db`, `config.json`, `media/`, Chrome profiles). Some modules (e.g. `veo/service.py`) compute `Backend/Data/...` themselves from `__file__`, so path changes must be checked across them.
- The packaged build is the same code frozen by PyInstaller (`backend.spec`); anything that reads bundled files (`prompts/`, `resources/`) must work in both modes.

**Veo / Google Flow integration (the hardest part to understand)** — there is no official API. Flow is driven by the Chrome extension:
`Frontend/Backend caller → veo/service.py (job queue, history, media registry) → veo/bridge.py (ThreadingHTTPServer on loopback :60526, own thread) ⇄ extension polls it`. The bridge holds the shared secret, harvested credentials pool (cookies/tokens from the labs.google tab), the reCAPTCHA solve queue, and extension heartbeat. The extension performs generation inside the logged-in Flow tab (UI automation + page-context fetch) and posts results back. Consequences: jobs cost real credits, so **never add blind retries of POSTs**; Flow sometimes aborts the HTTP request yet still creates the video (recover by polling/matching `mediaId`, don't resubmit). See `docs/PLAN_flow_http_submit.md`, `docs/FLOW_CAPTCHA_DIAGNOSIS.md`, `Extensions/FlowsVeo-Clean/docs/{architecture,bridge-protocol}.md`.

**Extension internals**: single mutable state object in `src/background/runtime/state.js` (don't destructure mutable values); listeners are registered only from `src/background/index.js`; functions in `src/providers/google-flow/page/` run in the page MAIN world via serialization and must be self-contained (no imports/closures). Storage keys are `_vf_*` and the wire protocol is frozen for compatibility.

**Campaign engine (`app/campaign/`, "AI Workflow v2", fashion-ad)** — a DAG of steps (`graph.py`, topologically sorted, validated at import; 8 user-visible blocks) producing **immutable artifacts** (`store.py`). `fingerprint.py`/`engine.py` compute state (`fresh|stale|missing|blocked|pinned` + approval gates) from input fingerprints rather than storing flags; changing inputs never deletes artifacts, it only marks downstream stale. `runner.py` executes with per-resource lane limits (`LANE_LIMITS`: llm/chatgpt-image/flow/local) and `draft`/`final` tiers; `executors/` implement individual steps; `engine` also produces dry-run plans with Flow credit cost (`FLOW_CREDIT` tables hold only verified prices). Design: `docs/PLAN_ai_workflow_campaign.md`, `docs/AI_WORKFLOW_FASHION_DESIGN.md`. Pipeline (STEPS order): garment_source → fact_sheet, cast, style, brief → **look** (gated) → angle → hook → **shot_plan** (sees the approved look image + chosen hook; proposes shot count, `board_type`, duration 3–15 s and ordered `panels`) → script → **anchor_frame** (gated, one image per campaign, locks face/outfit/location) → **storyboard** (gated, per shot: one ChatGPT image with 2–4 frames) → **clip** (paid, Flow Omni 1.2 Ingredients with refs anchor + storyboard + real garment photo; panels become `[0-3s]` timeline lines; never auto-retried) → voice (voice-service TTS) → **assemble** (ffmpeg: captions, voice, BGM, concat → final mp4). Map steps hash only `StepDef.item_fields` of a shot, so editing a voiceover never stales storyboards/clips; a step only goes stale once its upstream *artifact* is regenerated/approved. `StepDef.isolated` steps (voice, assemble) run only themselves on approved/existing results and never pull stale paid steps (clip) back into a run. `style.master_scene` is the single location. Assemble defaults to `edit_style=shots` (whole clips); `micro` is the optional beat-cut mode (`executors/edit_plan.py`). Prices: `graph.FLOW_CREDIT_R2V` holds only measured points, `clip_cost_estimate` is a labelled formula for the rest and also feeds the budget cap. See `docs/PLAN_campaign_v24_storyboard_ingredients.md`. The older `app/workflow/` (canvas + Motion Control) and frontend `features/workflow/` coexist with it.

**Recap (`app/recap/`)**: R1 YouTube transcript → Gemini script, R2 yt-dlp download + ffmpeg cut, R3 Vietnamese TTS via voice-service (atempo-fit per scene), R4 mux + concat into final. Relies on ffmpeg on PATH and the Gemini web cookie (Gemini is accessed via cookie-based web client in `ai/gemini`, not the public API). Plans/issue notes in `docs/RECAP_*.md`.

### Frontend (`Frontend/`)
- `electron/main.ts` (main) + `preload.ts`; renderer in `src/`. Dev: spawns `python run_server.py` if backend isn't up; packaged: spawns `resources/bin/backend_server.exe` and `voice_server.exe`, plus ffmpeg from `ffmpeg-static`.
- `src/App.tsx` is the sidebar router; each sidebar page lives in `src/features/<name>/` (campaign, workflow, veo-studio, studio, video, watermark, voices, bgm, discover, stories, publisher, youtube-publisher, monitor, muse-studio, settings, dashboard, history, help). Features talk to the Backend over HTTP at `127.0.0.1:8000`; shared helpers in `src/shared/`.
- Tests are plain `node:test` on `.ts` files via `--experimental-strip-types`, so tested modules must be pure TS (no React/DOM imports, no path aliases).

### Voice service
Standalone process so the heavy model isn't loaded in Backend; Backend reaches it through `app/voices/voice_client.py` (`voice_service_url` setting) and the browser only ever calls Backend's `/api/voices`. One inference session at a time.

## Conventions & gotchas
- Windows paths and PowerShell are the norm. ffmpeg `drawtext` with `fontfile=`/`textfile=` breaks on drive-letter colons/spaces: use relative paths with `cwd` set to the temp dir.
- yt-dlp must be kept current (YouTube blocks); working flags use nightly + node + `ejs:github`, not cookies.
- Recap video encoding: prefer hardware encoder selection (`_pick_video_encoder`) over libx264 `medium`; final merge uses `-shortest` mux + concat demuxer with stream copy.
- Manual raw text/file input to the Gemini script step is sent as-is (no normalization); `raw.txt` is persisted for inspection.
- Each new phase of AI Workflow v2 is expected to ship with a clickable UI and a Playwright e2e, not just backend code.
- README.md (Vietnamese) has per-sidebar setup instructions and still describes some older structure; prefer the code when they disagree.
