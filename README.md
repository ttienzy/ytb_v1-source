# YouTube Studio Recap & Video Tools (`ytb_v1`)

[![Build and Release Desktop App](https://github.com/ttienzy/ytb_v1/actions/workflows/release.yml/badge.svg)](https://github.com/ttienzy/ytb_v1/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/ttienzy/ytb_v1?color=blue&logo=github)](https://github.com/ttienzy/ytb_v1/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-blue.svg)](https://github.com/ttienzy/ytb_v1/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A powerful, all-in-one desktop application designed for automated **YouTube Video Recap Creation**, **Vietnamese AI Voiceover Dubbing**, and **Batch Watermark Inpainting**. Built with Electron, React, FastAPI, and VieNeu-TTS.

---

## 🌟 Key Features

- 🎬 **Automated 4-Stage Recap Pipeline (R1–R4):**
  - **R1 (AI Script Generation):** Dynamic 10+ minute transcript chunking with context chaining using Gemini Web API. Generates high-retention, witty, storytelling Vietnamese reviewer scripts with mandatory Intro Hook and Outro CTA.
  - **R2 (Lossless Video Stream-Cut):** Downloads source video via `yt-dlp` (with multi-tiered anti-bot fallbacks) and performs frame-accurate segment extraction using `FFmpeg`.
  - **R3 (Voiceover Synthesis & Pacing Sync):** High-speed batch Vietnamese TTS generation (VieNeu-TTS ONNX engine) with automated `atempo` time-stretching to match exact clip duration.
  - **R4 (Muxing & Seamless Concatenation):** Muxes synthesized voiceover with video clips, normalizes audio levels, and produces the final merged MP4 recap.
- 🧹 **AI Watermark & SynthID Remover:** Batch video inpainting to remove watermarks and platform stamps with zero quality loss.
- 🎙️ **Voice Studio & Music Library:** Comprehensive voice previewing, audio adjustments, and background audio ducking.
- 🔄 **Fault-Tolerant Job State & Rehydration:** Automatic job state persistence (`recap.json` + SQLite) allowing instant resume and replay across app restarts.
- 📦 **Standalone Windows Installer:** Self-contained executable (`.exe`) packaged with PyInstaller and Electron-Builder. No Docker or local Python setup required for end users.

---

## 🏗️ Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Desktop Application (Electron)                  │
│  React UI + Vite + Tailwind CSS (Port 5173 / Main Process)             │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ IPC / HTTP
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
┌───────────────────────────────┐     ┌──────────────────────────────────┐
│   Backend Service (FastAPI)   │     │   Voice Service (VieNeu-TTS)     │
│   Port: 8000                  │     │   Port: 8001                     │
│   - R1-R4 Recap Engine        │────▶│   - CPU-Optimized ONNX Engine    │
│   - Gemini Web API Client     │     │   - Batch TTS Synthesis          │
│   - yt-dlp & FFmpeg Handler   │     │   - 20+ Vietnamese Voice Models  │
│   - Watermark Inpainting      │     └──────────────────────────────────┘
└───────────────────────────────┘
```

---

## ⚡ Recap Pipeline Workflow

```
1. YouTube URL ──▶ [Transcript Fetcher (Mức 0-3)] ──▶ Clean Subtitles (.vtt)
2. Subtitles ──▶ [Dynamic Chunker (10min+)] ──▶ Gemini LLM ──▶ recap.json
3. recap.json ──▶ [yt-dlp + FFmpeg Stream-Cut] ──▶ Segment Clips (clip_0.mp4 ... clip_n.mp4)
4. Segments ──▶ [VieNeu-TTS Batch + atempo Sync] ──▶ Voice Tracks (voice_0.wav ... voice_n.wav)
5. Clips + Voice ──▶ [FFmpeg Mux & Lossless Concat] ──▶ final_recap.mp4
```

---

## 🚀 Getting Started

### Option 1: Download Prebuilt Desktop App (Recommended for Users)

1. Go to the [Releases Page](https://github.com/ttienzy/ytb_v1/releases).
2. Download the latest `Google Search App Setup <version>.exe`.
3. Run the installer and launch the app directly from your Desktop shortcut.

---

### Option 2: Development Environment Setup (For Developers)

#### Prerequisites
- **Node.js:** $\ge 22.12.0$ (LTS recommended)
- **Python:** $\ge 3.11$
- **FFmpeg:** Installed and added to system `PATH`
- **uv (Optional):** Recommended for managing Python environments ([Install uv](https://github.com/astral-sh/uv))

#### 1. Clone the Repository
```bash
git clone https://github.com/ttienzy/ytb_v1.git
cd ytb_v1
```

#### 2. Install Dependencies
```bash
# Install Frontend dependencies
cd Frontend
npm install
cd ..

# Install Backend dependencies
cd Backend
python -m venv .venv
.\.venv\Scripts\activate      # On Windows
pip install -r requirements.txt
cd ..

# Install Voice Service dependencies
cd services/voice-service
uv sync                       # or pip install -r requirements.txt
cd ../..
```

#### 3. Configure Credentials (Gemini Web API)
Create your local configuration file:
```bash
cp Backend/Data/config.example.json Backend/Data/config.json
```
Edit `Backend/Data/config.json` and provide your Gemini cookies or use the built-in Chrome profile login in the Settings tab.

#### 4. Launch All Services Simultaneously
```bash
# Starts Backend (:8000), Voice Service (:8001), and Electron Frontend
npm start --prefix Desktop
```

---

## 📡 REST API Reference

The backend exposes a full suite of endpoints at `http://127.0.0.1:8000`:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/recap/generate` | Initiates R1: Transcript fetch & AI script generation |
| `POST` | `/api/recap/cut` | Initiates R2: Video stream-cutting via FFmpeg |
| `POST` | `/api/recap/voice` | Initiates R3: Batch TTS voice synthesis & atempo synchronization |
| `POST` | `/api/recap/merge` | Initiates R4: Final audio-video muxing and concatenation |
| `GET` | `/api/recap/jobs/{id}` | Retrieves job status and execution progress |
| `GET` | `/api/recap/jobs/{id}/voice/{i}` | Streams audio preview for segment `i` |
| `GET` | `/api/recap/jobs/{id}/final` | Streams the final completed recap video (`.mp4`) |
| `POST` | `/api/watermark/clean` | Submits batch video watermark removal job |
| `GET` | `/api/health` | Service health check and database connectivity status |

---

## 🏷️ Automated Releases (CI/CD)

This repository includes a GitHub Actions workflow (`.github/workflows/release.yml`) that automatically builds and publishes Windows standalone installers.

To publish a new version:
```bash
# 1. Update version in Frontend/package.json
# 2. Commit changes
git commit -am "chore(release): bump version to 1.0.0"

# 3. Create and push tag
git tag v1.0.0
git push origin v1.0.0
```
GitHub Actions will automatically compile the Python backend into a standalone binary (`backend_server.exe`), package the Electron frontend via `electron-builder`, and publish the installer on the GitHub Releases tab.

---

## 📁 Repository Structure

```
.
├── .github/workflows/         # CI/CD Release Workflows
├── Backend/                   # FastAPI Backend (Python)
│   ├── app/
│   │   ├── ai/gemini/         # Gemini Web API Client & Recap Script Engine
│   │   ├── recap/             # Chunker, Merger, Subtitle Downloader, FFmpeg
│   │   ├── watermark/         # AI Inpainting Watermark Cleaner
│   │   └── core/              # Configuration, Database & Storage
│   ├── prompts/recap/         # Production Prompt Templates
│   ├── backend.spec           # PyInstaller Executable Specification
│   └── run_server.py          # Standalone Server Entrypoint
├── Frontend/                  # Electron + React + Vite + Tailwind CSS
│   ├── electron/              # Electron Main Process & Process Lifecycle Manager
│   └── src/                   # React Components (Studio, Watermark, Settings)
├── services/voice-service/    # Independent VieNeu-TTS Engine (ONNX Runtime)
├── Desktop/                   # Multi-process Development Runner (dev.js)
└── docs/                      # Architecture & Implementation Notes
```

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
