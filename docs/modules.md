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
- **Muse Canvas** (tab thứ 3, đang xây, không dùng Flow): `components/MuseCanvasWorkspace.tsx` (ReactFlowProvider riêng) + panel cấu hình; logic thuần có test ở `services/museCanvasConfig.ts` (cấu hình, `buildMuseInstruction`, `museGenerateOptions`, cảnh báo) và `services/museCanvasNodes.ts` (loại node, handle, quy tắc nối dây). Loại node khai báo trong `INPUT_SPECS` / `JOB_SPECS` (`services/museCanvasNodes.ts`); component dùng chung `nodes/muse/MuseInputNode` (ảnh vào), `MuseJobNode` (chạy Muse), `MuseOutputNode` (“Ảnh kết quả”, tạo bằng “Ra node”, nhớ `origin`). Họ nhân vật: `museCharacterImage` → `museCharacterSheet` (prompt `character_sheet` = `Backend/prompts/workflow/muse_character_sheet_prompt.txt`); cổng phụ `outfits` nhận node Ảnh kết quả có `origin.jobType = museOutfitPrompt`, mỗi cặp nhân vật × trang phục là 1 dòng (khóa `"<id nhân vật>|<id ảnh kết quả>"`, `rowFingerprint` gồm cả ảnh phụ), ảnh gửi theo thứ tự nhân vật → trang phục, prompt `character_outfit` (`muse_character_outfit_prompt.txt`) ghép sau prompt chính. `onConnect` phải giữ `sourceHandle/targetHandle` của dây kéo tay. Node `museVideoScript` = “Kịch bản video” (`nodes/muse/MuseScriptNode.tsx`, logic `SCRIPT_SPEC`/`buildScriptRequest`/`scriptState` trong `museCanvasNodes.ts`): một cổng `boards` (`MUSE_HANDLE.refsIn`, nhiều dây từ Ảnh kết quả / Nhân vật tham chiếu / Trang phục; vai trò ảnh suy từ nguồn, `SCRIPT_REF_KINDS`; thứ tự lưu ở `data.order`; dây cổng `identity` cũ được `normalizeMuseEdges` chuyển sang) — mọi ảnh gửi chung 1 tin, không ép 1 ảnh = 1 bộ; 1 lần Muse với `output_kind=text` — backend chờ câu trả lời chữ (`wait_for_result(want=set())`, chốt sau `TEXT_SETTLE_SECONDS` im lặng), ghép mọi tin trả lời (`ChatResult.reply_texts`) và lưu `.md` ở `DATA_DIR/media/muse_texts`; prompt `video_script` = `muse_video_script_prompt.txt`, app tự ghép sau prompt đoạn mô tả ảnh (`buildScriptContext`). Lượt đang chờ giữ trên `globalThis.__museScriptInflight` để đổi tab / HMR không mất. Nút “Ra node” (`planScriptTextNode`) tạo node `museScriptText` = “Kịch bản” (`nodes/muse/MuseScriptTextNode.tsx`) nối từ cổng `script`: giữ `text` (sửa được) + `originalText` + `origin {scriptNodeId, updatedAt}`; mỗi lần viết (`result.updatedAt`) tối đa 1 node, `newerScriptFor` báo khi nguồn viết lại. Node Kịch bản còn có cổng `boards` (ảnh tham chiếu, `data.order`) và “Tạo video” (`buildScriptVideoRequest`: `output_kind=video`, `collect_all=true`, `settle_seconds=SCRIPT_VIDEO_SETTLE_SECONDS` — backend tải mọi video Muse trả, `local_paths`, phát qua `/api/ai/muse/stream?path=`); lượt chờ giữ ở `globalThis.__museScriptVideoInflight`. Cả hai node có cờ `data.collapsed` (thu gọn). Nút “Ra node” ở phần video (`planVideoOutputNode`) tạo node `museVideoOutput` = “Video kết quả” (`nodes/muse/MuseVideoOutputNode.tsx`) nối từ cổng `video`: giữ `paths` (cuối = bản chính) + `origin {scriptTextNodeId, updatedAt}`; mỗi lần tạo tối đa 1 node, `newerVideoFor` báo khi nguồn tạo lại. Panel “Cấu hình Muse Canvas” chỉ hiện các trường node dùng (tài khoản, hội thoại, tỉ lệ video, chờ, song song, tiền tố file; các trường cũ như outputKind / stylePreset vẫn nằm trong config nhưng không còn ô chỉnh), thu nhỏ được (localStorage `muse_canvas_panel_collapsed`). Nhạc nền chọn bằng `nodes/muse/BgmPicker.tsx` (nghe thử, 1 thẻ Audio dùng chung `globalThis.__musePreviewAudio`). Phần “Hoàn thiện video” của node này (`MuseFinishSettings` trong `data.finish`, mặc định trên máy ở localStorage `muse_finish_defaults_v1`) gọi `POST /api/workflow/muse/finish` → `app/workflow/muse_finish.py`: ghép clip (`recap.ffmpeg.concat_segments`), phủ nhãn kênh chữ / logo (`build_label_filter`, drawtext + overlay, 1 lần mã hóa lại, logo dùng kho `/api/audio/logo`), âm thanh qua `export_media.render_audio` (tắt / chỉnh tiếng gốc, nhạc từ `/api/bgm`), lưu `muse_final_*.mp4` vào `WORKFLOW_EXPORTS_DIR` + `exports_history.json` (Thư Viện Video → Hoàn chỉnh). Clip Muse thô cũng vào Thư Viện Video (`source_type=muse_clip`, tab “Muse”): `muse_library_clips` quét thư mục tải video của Muse, chỉ nhận file có sidecar `<tên>.muse.json` (MuseService ghi khi tải video) hoặc tên bắt đầu `muse`; stream / xóa / mở thư mục đi qua `find_muse_clip`. Họ trang phục (type id giữ từ bản đầu): `museOutfitImage` = “Trang phục” (đúng 1 ảnh, tải qua `/api/ai/muse/upload`, node chỉ giữ đường dẫn) → nhiều dây → `museOutfitPrompt` = “Tách áo quần”: mỗi trang phục nối vào chạy 1 lần `POST /api/ai/muse/generate` với `output_kind=image`, `apply_prefix=false` (prompt gửi nguyên văn), ảnh ra lưu `DATA_DIR/media/muse_outputs` (xem qua `/api/ai/muse/output?file=`); kết quả lưu trong node theo id node nguồn, ảnh vào đổi thì kết quả thành “cũ”. Lượt đang chạy giữ ở map cấp module để đổi tab không mất; F5/đóng app thì thành “bị gián đoạn”, không tự chạy lại. Dây `museLink` có nút X gỡ dây.
- **Thư Viện Ảnh** (nút cạnh Thư Viện Video): `components/ImageLibraryModal.tsx` (xem/quản lý, và chế độ chọn — Muse Canvas mở qua `pickLibraryImage()` trong `museCanvasContext`). Backend `app/workflow/image_library.py`, route `/api/workflow/images` (GET lọc `q`/`source`/`favorite`, `upload`, PATCH/DELETE `{id}`, `{id}/file`, `open-folder`). Ảnh Muse (`output_kind=image`) được `MuseService._register_library_image` ghi vào chỉ mục ngay khi tải về; item chỉ trỏ tới file, xóa item chỉ xóa file nằm trong thư mục app quản lý. Backend `app/workflow/muse_canvas.py`: `/api/workflow/muse/config` (config.json khóa `muse_canvas`), `/api/workflow/muse/canvas` (`DATA_DIR/muse_canvas.json`, tối đa 5 MB), `/api/workflow/muse/prompts/{name}` GET/PUT/DELETE (prompt gốc `Backend/prompts/workflow/muse_outfit_extract_prompt.txt`, tìm cả trong `_MEIPASS/prompts` khi đóng gói; bản “Lưu làm mặc định” ở `DATA_DIR/muse_prompts/`).

### Chiến dịch AI (`campaign`) — *Sâu*
Xem [campaign-engine.md](campaign-engine.md).

### Veo Studio (`veo-studio`) — *Cấu trúc*
- **Làm gì:** tạo video/ảnh trực tiếp qua Flow (text-to-video, Frames, Ingredients), thư viện clip đã tạo, project Flow.
- **Frontend:** `features/veo-studio/` (`VeoStudioPage`, `components/`, `services/veoApi.ts`, `ingredientPrompt`, `waitForFrameJob`). Test: `npm run test:veo`.
- **Backend:** `app/veo/` → [flow-integration.md](flow-integration.md).

### Muse Studio (`muse-studio`) — *Cấu trúc*
- **Làm gì:** sinh video bằng **Meta Muse AI**, kết nối thẳng tới máy ảo Muse của từng tài khoản (HTTP + WebSocket Noise), không điều khiển trình duyệt và không dùng extension Flow.
- **Backend:** `app/ai/muse/` (`router.py` không có prefix chung: `/api/settings/muse*` và `/api/ai/muse/{generate,history,stream,upload,preview,open-folder}`).
- **Nhiều tài khoản** (giống tài khoản ChatGPT): `accounts.py` `MuseAccountStore` (kế thừa `RotatingAccountStore`) lưu `muse_accounts.json`; mỗi tài khoản có profile Chrome riêng `muse-profiles/muse-<ms>` và cổng CDP cố định trong dải **9300–9399** (tách khỏi 9222–9235 của Recap/Gemini/ChatGPT). Endpoint `/api/settings/muse/accounts` (GET), `…/accounts/login` (POST, `{account_id?}` = đăng nhập lại), `…/accounts/{id}/check`, PATCH/DELETE `…/accounts/{id}`; `status` và `open-browser` nhận `?account_id=`, `generate` nhận `account_id`.
  - **Không dùng Playwright.** Chrome chỉ mở để người dùng đăng nhập Meta: app đọc cookie muse.ai bằng CDP thô (`cdp.py`: `Storage.getCookies` qua WebSocket), xác nhận bằng `POST /api/auth/check` (trả `viewer_id`), rồi đóng Chrome êm (`Browser.close`). Kiểm tra trạng thái/tài khoản chỉ gọi `auth/check` bằng cookie đã lưu; cookie bị từ chối mới mở profile ẩn để lấy cookie mới.
  - **Tạo video qua HTTP** (`gateway.py` + `noise_xx.py`, tham khảo giao thức từ muse-cli, MIT): HTTPS muse.ai bằng cookie với TLS giả Chrome (`curl_cffi`) → `auth/check` → `api/session` (vm_id, `hatch/vm/wake` nếu VM ngủ) → `hatch/token` → `wss://hatch.metaaivm.com/v1/noise` + bắt tay `Noise_XX_25519_AESGCM_SHA256` (tự viết trên `cryptography`) → request kiểu HTTP bọc protobuf (mã hóa tay, không cần descriptor; payload > 60 KB chia nhiều frame cùng `chunk_id`). Gửi `chat.stream` `{items, node_id, capabilities, session_id?}`, rồi đọc lại `chat.history` tới khi có sự kiện media (`sandbox://workspace/imagine_media/*.mp4`) và chat im 15 s, tải bằng `GET /media/raw/<path>`. Ảnh tham chiếu gửi thẳng trong `items` (`{type:"image", data_base64}`), video < 60 MB / file khác < 10 MB là `{type:"file"}`, lớn hơn thì `/fs/write` khúc 512 KB vào `workspace/user/files/…` rồi `{type:"file_ref"}`. Đã gửi prompt thì **không gửi lại** (tốn lượt): rớt mạng chỉ kết nối lại để đọc tiếp. Thử tay: `Backend/poc/muse_http/run_poc.py`.
  - Chọn profile cho job: `account_id` nếu có; không thì xoay vòng tài khoản `active` (ưu tiên tài khoản không giữ khóa, rồi `last_used` cũ nhất); tài khoản `error` không vào vòng xoay. Danh sách trống → lỗi “Chưa có tài khoản Muse” (không còn profile mặc định `ChromeProfile_Muse` / cổng 9225). Mỗi tài khoản một `threading.Lock`, nên một tài khoản chỉ chạy một job, các tài khoản khác chạy song song.
- **Lưu:** cấu hình trong `config.json` (khóa `muse`: `download_dir`, `timeout_seconds` — ép tối thiểu 600, `default_prompt_prefix`; các khóa cũ `app_url`/`cdp_port`/`auto_download`/`is_connected` bị xóa khi lưu); tài khoản trong `muse_accounts.json` (có cookie, nhạy cảm); upload ở `Backend/Data/media/muse_uploads` (tính từ `__file__`, xem [data-and-paths.md](data-and-paths.md)).

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
- **Đồng bộ lịch sử bài đăng:** `GET /api/pippit/tasks?sync=` (tab Lịch sử) và `GET /api/pippit/all-tasks` (luôn sync, trả list; PublisherPage + `publisher_monitor` dùng). `service.sync_all_tasks()` gọi `list_schedule_task` song song cho mọi tài khoản với **cả** key `"301"` (Facebook) và `"1"` (TikTok), kèm page_id lấy từ lịch sử (Pippit vẫn trả task của page đã gỡ), tự đăng nhập lại khi `ret=1017`, rồi merge (`merge_task_lists`, hàm thuần) và **ghi lại** `pippit_tasks.json` (lock + ghi nguyên tử). Pippit bỏ qua `count` và không trả cursor (đã thử 11/2026). Status: 3 = đã đăng, 4 = lỗi (có `failed_reason`), 6 = hủy; task không còn trên Pippit được gắn `missing_on_pippit`. Quy tắc hiển thị trạng thái phía FE ở `Frontend/src/shared/pippit/taskState.ts`. Test: `Backend/tests/test_pippit_task_sync.py`.
- **Đặt lịch hàng loạt (FE):** `PublisherPage` gửi `/api/pippit/bulk-schedule` **mỗi lần 1 video** (tiến trình thật, nút Dừng, không tự gửi lại mục lỗi); kiểm tra trùng kênh + tóm tắt ở `features/publisher/scheduleChecks.ts`. Backend lưu `drive_file_id`/`file_name` vào task để Drive nhận diện "đã đăng" theo id, và coi `task_id` rỗng là lỗi (không lưu bản ghi mồ côi). Tab "Lịch đã đặt" dùng chung `PippitHistoryTab` với trang Lịch sử.
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
