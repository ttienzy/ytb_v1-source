# Bản đồ module

> **Hiện hành**, đối chiếu cấu trúc code ngày 2026-11-12. Mỗi mục trả lời: trang này làm gì, code nằm ở đâu, gọi API nào, lưu gì ở đâu, lưu ý gì. Với 3 phần lớn nhất đã có tài liệu sâu: [Chiến dịch AI](campaign-engine.md), [Flow/Veo](flow-integration.md), [Recap](recap.md).
>
> **Mức độ đã đọc:** *Sâu* = đã đọc luồng chính trong code; *Cấu trúc* = mới đọc router, docstring và cách tổ chức file, **chưa** đọc kỹ từng nhánh logic. Mục *Cấu trúc* có thể thiếu chi tiết; đọc code trước khi dựa vào nó, và bổ sung khi bạn nắm rõ hơn.

Mọi trang theo cùng một khuôn: `Frontend/src/features/<trang>/` gọi `http://127.0.0.1:8000/api/<prefix>` (hằng `API_URL` ở `shared/constants.ts`); backend ở `Backend/app/<package>/` gồm `router.py` + `service.py` (+ `schemas.py`, `models.py`). Xem [onboarding.md](onboarding.md).

---

## Nhóm Tạo Video AI

### Canvas AI (`workflow`) — *Cấu trúc*
- **Làm gì:** canvas (`@xyflow/react`) để dựng video quảng cáo từ ảnh sản phẩm: Gemini phân tích ảnh → ChatGPT viết kịch bản → từng cảnh gửi Flow (Omni 1.2) → giọng đọc, nhạc nền, ghép → xuất. Có thêm **Motion Control** (video mẫu + ảnh nhân vật → video chuyển động), node tùy chọn **Tạo Ảnh Nhân Vật Mới** (ảnh người + trang phục → ảnh tham chiếu nhân vật bằng ChatGPT, mẫu `system:look_sheet` của Chiến dịch AI; chỉ vào ô Nhân Vật khi người dùng bấm “Dùng”) và **Motion dài** (video mẫu > 10 s).
- **Frontend:** `features/workflow/` (~25k dòng, lớn nhất repo). `WorkflowPage.tsx` (~2.1k dòng), `nodes/`, `edges/`, `components/` (Motion Control, picker thư viện Veo, `LongMotionPanel`), `hooks/useWorkflowState|useWorkflowRendering`, `services/` (đa số là **hàm thuần có test**: `workflowGraph`, `workflowState`, `buildScenePlan`, `prepareChainedScene`, `renderJobService`, `pollJob`, `motionPromptBuilder`…). Test: `npm test` (thư mục `__tests__`).
- **Backend:** `app/workflow/` (`router.py` `/api/workflow`: tài sản, prompt Gemini/GPT/preset, `gemini/analyze`, `gpt/generate-script`, `extract-profiles`, `generate-voiceover`, `export`, `exports/*`, `motion/character-sheet` → `motion_character.py`); `app/motion_long/` (`/api/motion-long`: `plan`, `jobs`, `run`, `stop`, `merge`; xem [PLAN_motion_long.md](PLAN_motion_long.md)). Gửi video đi qua `/api/veo` ([flow-integration.md](flow-integration.md)).
- **Lưu:** `workflow_assets/`, `workflow_exports/`, `workflow_voiceovers/` (DATA_DIR), job Motion dài ở `motion_long/<id>/job.json`.
- **Lưu ý:**
  - Đây là bản **cũ hơn** Chiến dịch AI nhưng vẫn đang chạy song song; kế hoạch là gỡ sau khi bản mới ổn định.
  - Chuỗi video: clip đầu dùng Ingredients, các clip sau lấy **frame cuối thực tế** của clip trước làm Start Frame.
  - Theo tài liệu thiết kế cũ, đồ thị **không được lưu bền vào DB** (`useWorkflowState` không dùng `localStorage`); đây là một lý do ra đời Chiến dịch AI. Một số phần riêng (ví dụ cấu hình Motion) có lưu ở `motionStorage`.
  - Chỉ dùng **Omni 1.2**; Motion Control mặc định `macaron_cookie_edit`, 720p.

### Chiến dịch AI (`campaign`) — *Sâu*
Xem [campaign-engine.md](campaign-engine.md).

### Veo Studio (`veo-studio`) — *Cấu trúc*
- **Làm gì:** tạo video/ảnh trực tiếp qua Flow (text-to-video, Frames, Ingredients), thư viện clip đã tạo, project Flow.
- **Frontend:** `features/veo-studio/` (`VeoStudioPage`, `components/`, `services/veoApi.ts`, `ingredientPrompt`, `waitForFrameJob`). Test: `npm run test:veo`.
- **Backend:** `app/veo/` → [flow-integration.md](flow-integration.md).

### Muse Studio (`muse-studio`) — *Cấu trúc*
- **Làm gì:** sinh video bằng **Meta Muse AI** qua một Chrome thật điều khiển bằng CDP (Playwright `connect_over_cdp`), không dùng extension Flow.
- **Backend:** `app/ai/muse/` (`router.py` không có prefix chung: `/api/settings/muse*` và `/api/ai/muse/{generate,history,stream,upload,preview,open-folder}`). `MuseService` tự mở Chrome với profile riêng `ChromeProfile_Muse` và cổng CDP mặc định **9225**, chờ đăng nhập.
- **Lưu:** cấu hình trong `config.json` (khóa `muse`: `app_url`, `cdp_port`, `auto_download`, `download_dir`, `timeout_seconds`, `default_prompt_prefix`); upload ở `Backend/Data/media/muse_uploads` (tính từ `__file__`, xem [data-and-paths.md](data-and-paths.md)).

### Recap & Audio (`studio`) — *Sâu* (Recap), *Cấu trúc* (Audio)
- Recap: [recap.md](recap.md).
- **Audio Story Studio** (truyện → video audio): `app/media/audio_router.py` (`/api/audio`: `stories`, `stories/lengths`, `stories/{slug}/cover`, chapters, `run`, `preview`, `outputs`, `logo`), `story_video.py` (pipeline v2: video cả truyện/từng chương, prepare → voice → render → mix → package), `story_text.py` (làm sạch văn bản, mốc phụ đề, ASS, chia tập — hàm thuần), `narration.py` (TTS theo dòng + cache theo chương), `story_art.py` (ảnh bìa nguồn, khung bố cục ảnh bìa, thumbnail — Pillow), `audio_workflow.py` (phần dùng chung: job, lịch sử, ghép âm thanh, Drive), `audio_options.py`, `overlays.py`, `backgrounds.py` + `background_router.py` (`/api/audio/backgrounds`). Frontend: `features/studio/audio/`. Thiết kế: [PLAN_audio_story_v2.md](PLAN_audio_story_v2.md).

---

## Nhóm Nguồn Nội Dung

### Khám Phá Kênh (`discover`) — *Cấu trúc*
- **Làm gì:** tìm kênh YouTube, theo dõi và liệt kê video của kênh; gợi ý kênh bằng Gemini; đánh dấu video **mới** và **đã làm**; chuyển URL sang Recap.
- **Backend:** `app/discover/` (`/api/discover`: `preset-channels`, `saved-channels`, `recommend-channels`, `channel-videos`, `processed-history`). `scout.py` (Gemini đề xuất, prompt `prompts/discover/recommend_channels.prompt.txt`), `metadata.py` (yt-dlp, cache 24 h), `freshness.py` ("mới" = lần đầu xuất hiện ở lần quét **sau** lần quét đầu tiên của kênh; ngày chính xác lấy từ RSS), `history.py` (sổ video đã xử lý, **giữ vĩnh viễn** kể cả khi xóa file).
- **Lưu:** các file JSON `channels_cache.json`, `discover_seen.json`, `processed_history.json`, `saved_channels.json` (nhóm B trong [data-and-paths.md](data-and-paths.md)).
- **Test:** `Backend/tests/discover/`; frontend `npm run test:discover`.

### Crawl truyện (`stories`) — *Cấu trúc*
- **Làm gì:** cào truyện chữ từ API công khai của `daotruyen.me`, lưu vào DB; tóm tắt cốt truyện bằng Gemini (một lần, lưu DB); cung cấp chương cho Audio Story Studio.
- **Backend:** `app/stories/` (`/api/stories`: `categories`, `catalog`, `crawled`, `crawl-jobs`, `{slug}/crawl|metadata|saved|summary`). Bảng `crawled_stories`, `crawled_chapters`, `story_summaries`. `summary.py` gửi **cả truyện dưới dạng file đính kèm** tới Gemini web (cùng cookie với Recap), chạy nền, UI poll. Dữ liệu danh mục kèm theo: `Backend/resources/{daotruyen-categories,story-list}.json`.
- **Test:** `Backend/tests/stories/`.

### Video (`video`) — *Cấu trúc*
- **Làm gì:** nhập video (file/YouTube), chuẩn hóa khung hình (preset tỉ lệ, nền, nhãn, làm mờ), gộp clip đến độ dài mục tiêu, lưu lại cho workflow.
- **Backend:** `app/media/video_router.py` (`/api/video`: `preset(s)`, `done`, `merge`), `video_service.py` (ffmpeg). Thư viện nằm ở `DATA_DIR/media/videos`.
- **Frontend:** `features/video/` (`useVideoWorkspace`, `SourceLibrary`, `EditPanel`). Test: `npm run test:video`.

---

## Nhóm Tiện Ích Biên Tập

### Voices (`voices`) — *Sâu* (qua voice-service)
- Backend `app/voices/` (`/api/voices`) là **cổng** tới voice-service: bảng `voices` (metadata clone: tên, tag đồng ý quyền dùng giọng) trong `app.db`; âm thanh và embedding nằm ở voice-service. Trình duyệt **không bao giờ** gọi voice-service trực tiếp; preview stream qua `/api/voices/{id}/preview/stream`. Chi tiết engine/profile: [services/voice-service/README.md](../services/voice-service/README.md). Test: `npm run test:voices`.

### Thư viện nhạc (`bgm`) — *Cấu trúc*
- `app/media/router.py` + `service.py` (`/api/bgm`): CRUD + import thư mục (quét `*.mp3|*.wav`, nếu cùng thư mục có `description.txt` thì ghi nhận cần ghi công — CC BY…). Bảng `bgm_tracks` + file ở `media/bgm/` (nhóm B). Dùng cho Recap R5, Audio Studio, Canvas AI.

### Xóa Watermark (`watermark`) — *Cấu trúc*
- **Làm gì:** xóa watermark Gemini/Veo cho ảnh và video bằng `gwr` (runtime Node + Playwright Chromium, đóng kèm app). `gwr` chỉ xóa được trên **clip gốc từ Flow**; video đã ghép/crop bị từ chối (độ tin cậy thấp).
- **Backend:** `app/watermark/` (`/api/watermark`: `check`, `process` (đường dẫn), `upload`, `jobs`, `download`, `download-all`, đồng bộ Drive theo job/video). `service.py` tìm runtime theo thứ tự: biến `WATERMARK_*` (Electron đặt) → `Frontend/watermark-runtime/node_modules` (cần `node` trên PATH) → `gwr` toàn cục. Job lưu ở `DATA_DIR/watermark/jobs.json` (sống sót qua restart).
- **Chi tiết hai chế độ:** [WATERMARK_REMOVER_HYBRID.md](WATERMARK_REMOVER_HYBRID.md); cài runtime: mục 4 của [README gốc](../README.md). Test: `python -m unittest tests.test_watermark_runtime` (CI chạy trước PyInstaller).

---

## Nhóm Phân Phối & Hệ Thống

### Lên lịch Pippit (`publisher`) — *Cấu trúc*
- **Làm gì:** lên lịch đăng video TikTok/Facebook Page qua **Pippit.ai (CapCut Commerce)**. `externals/pippit/client.py` là **HTTP thuần reverse-engineered** (đăng nhập Passport, ký header MD5, upload VOD AWS SigV4 + TOS multipart), không dùng trình duyệt.
- **Backend:** `app/externals/pippit/` (`/api/pippit`: `accounts`, `accounts/login-sync`, `refresh-pages`, `tasks`, `publish`, `bulk-schedule`). Tài khoản trong `config.json` (khóa `pippit`), lịch ở `pippit_tasks.json` (nhóm B).
- **Đi kèm:** `externals/mailtm/` (`/api/mailtm`): email tạm Mail.tm để nhận OTP khi đăng ký Pippit; tab Mail.tm trong Cài đặt.
- **Rủi ro:** API không chính thức, có thể đổi bất kỳ lúc nào.

### Lên lịch Youtube (`youtube-publisher`) — *Cấu trúc*
- **Backend:** `app/externals/youtube/` (`/api/youtube`: `credentials`, `auth-url`, `exchange-code`, `login`, `publish`, `bulk-schedule`, `tasks`, `upload-file`). OAuth bằng Client ID/Secret của người dùng (hoặc `credentials.json`), YouTube Data API; lịch ở `youtube_tasks.json`, file upload tạm ở `youtube_uploads/` (nhóm B).
- Mã đặt `OAUTHLIB_RELAX_TOKEN_SCOPE=1` và `OAUTHLIB_IGNORE_TLS=1` ở đầu `service.py`/`client.py` (cho phép Google tự bổ sung scope; **tắt kiểm tra TLS của oauthlib**, nên cân nhắc khi xem xét bảo mật).

### Google Drive (cấu hình ở Cài đặt) — *Cấu trúc*
- `app/externals/gdrive/` (`/api/gdrive`): OAuth cục bộ, redirect `http://localhost:8080/`, chọn thư mục đích, `upload`. Dùng để sao lưu video Recap/Audio và đồng bộ kết quả xóa watermark. Cấu hình trong `config.json` (khóa `google_drive`); file tạm ở `temp_gdrive/` (đường dẫn tương đối theo cwd).

### Dashboard & Monitor (`dashboard`, `monitor`) — *Cấu trúc*
- `app/publisher_monitor/` (`/api/publisher-monitor`: `daily-status`, `calendar-events`): tổng hợp lịch đăng từ Pippit + YouTube (đọc các file tasks và `config.json`) để tính kênh nào hôm nay chưa đăng. `App.tsx` poll mỗi 60 s và hiện pill trạng thái + badge trên sidebar.

### Lịch sử (`history`) — *Cấu trúc*
- Trang có 4 tab: lịch đăng (`PublishingCalendarTab`, dữ liệu từ `/api/publisher-monitor/calendar-events`), Studio (lịch sử Recap qua `/api/recap/jobs`, nghe lại giọng từng đoạn, đăng; có nhánh `recap`/`media`), Pippit, YouTube. Không có API riêng cho "Lịch sử".

### Cài đặt (`settings`) — *Sâu* (cấu trúc tab)
- 9 tab (xem [README gốc](../README.md) mục 6). Gemini: cookie dán tay hoặc đăng nhập Chrome (Playwright persistent context dùng `settings.chrome_executable`, profile `ChromeProfile`). ChatGPT: `app/ai/image_gen/` (`/api/settings/image-gen`): nhiều tài khoản, tự xoay khi hết hạn mức ảnh, làm mới cookie bằng profile Chrome. Cập nhật app: `electron-updater` qua `window.desktop.*` (`preload.ts`).
- Cấu hình lưu `config.json` qua `read_config`/`write_config` (`app/core/storage.py`).

### Cẩm nang trong app (`help`)
`features/help/`; nguồn trang là `shared/navModel.ts`; test `npm run test:help`. Tiến độ: [PLAN_help_redesign.md](PLAN_help_redesign.md).
