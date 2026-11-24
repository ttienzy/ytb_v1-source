# Tích hợp Google Flow / Veo (backend)

> **Hiện hành**, đối chiếu với code ngày 2026-11-12 (`Backend/app/veo/`). Đọc trước khi sửa bất cứ thứ gì liên quan tới tạo video, upload ảnh/video lên Flow, hay extension.
> Phần extension: [Extensions/FlowsVeo-Clean/docs/](../Extensions/FlowsVeo-Clean/docs/). Giao thức RPC quan sát từ HAR: [PLAN_flow_http_submit.md](PLAN_flow_http_submit.md).

## 1. Điều cần biết trước tiên

- **Không có API chính thức.** App điều khiển một tab Google Flow thật, đã đăng nhập, thông qua Chrome extension. Backend không bao giờ nói chuyện trực tiếp với Google.
- **Mỗi job tốn credit thật.** Vì vậy các quy tắc ở [mục 6](#6-quy-tắc-không-được-phá) là bắt buộc, không phải gợi ý.
- Flow có thể **hủy request nhưng vẫn tạo video**. Khi thấy lỗi, đừng gửi lại: dò video đã tạo (mục 5).
- Mọi thứ tới extension đi qua **bridge**: một HTTP server loopback chạy *trong một thread của Backend*, extension poll nó.

## 2. Các thành phần

```
Frontend (veo-studio / workflow / campaign)
        │  HTTP /api/veo/*
        ▼
veo/router.py ──► veo/service.py ──► veo/bridge.py  (ThreadingHTTPServer, 127.0.0.1:60526)
   (REST)        (job, project,        ▲   hàng đợi việc + kho kết quả + credential + heartbeat
                  history, ảnh)        │ poll (extension chủ động hỏi)
                                       │
              Chrome extension FlowsVeo-Clean ──► tab labs.google/fx/tools/flow (đã đăng nhập)
                                                  ├─ HTTP: fetch batchexecute trong trang (MAIN world)
                                                  └─ UI: điều khiển giao diện Flow
```

| File | Vai trò |
|---|---|
| `veo/router.py` | REST `/api/veo/*`: projects, jobs, history, upload ảnh/video, tạo ảnh, trạng thái bridge, nạp lại credits |
| `veo/service.py` (~2.5k dòng) | Hàng đợi job, cổng FIFO, dựng request đã xác minh, tải video, khôi phục, lịch sử, ảnh |
| `veo/bridge.py` | Server bridge: secret, hàng đợi việc, kho kết quả theo `request_id`, pool credential, heartbeat |
| `veo/schemas.py`, `veo/models.py` | Pydantic (`JobStatus`, `InputMode`…) và bảng SQLite `veo_projects`, `veo_images` |
| `veo/media_registry.py` | Sổ đăng ký media dùng chung (ảnh/video đã upload lên Flow) |

Vòng đời Backend: `lifespan` ở `app/main.py` gọi `veo_service.startup()` (khởi tạo DB, nạp `veo_jobs.json`, **bật bridge cổng 60526**, dự phòng 56526 → 46526 → 36526 → 26526, ép bằng `VEO_BRIDGE_PORT`) và `shutdown()` khi tắt.

## 3. Vòng đời một job video

`POST /api/veo/jobs` → `service.submit_job()`:

1. Chọn project (theo `project_id` hoặc project đang active). **Không có project thì từ chối.**
2. Kiểm tra theo `input_mode` (`text_to_video`, `frames`, `ingredients`, `video_edit`): số ảnh tham chiếu (Ingredients 1–3), Frames cần Start Frame, `video_edit` cần `reference_video_id` và đoạn mẫu ≤ 15 giây (`MOTION_REF_MAX_SECONDS`, trước là 10; extension `page/video-http.js` kiểm cùng giới hạn). **Bắt tay năng lực extension**: heartbeat của extension báo `capabilities.motion_ref_max_seconds` (hằng `MOTION_REF_MAX_SECONDS` trong `page/video-http.js`); backend lưu ở `bridge.apply_heartbeat` (ghi đè mỗi lần: bản cũ không báo trường này thì năng lực cũ bị xóa) và `_require_extension_motion_limit` chặn `submit_job` TRƯỚC khi tạo job nếu đoạn mẫu dài hơn giới hạn của extension đang chạy (không báo gì = bản cũ = 10 giây, `LEGACY_EXTENSION_MOTION_REF_SECONDS`). Lý do: bản extension cũ và mới đều có số phiên bản `2.2.0` nên không phân biệt được bằng `version`; extension cũ gặp đoạn dài hơn giới hạn của nó thì `canUseHttpVideo()` = false và LẶNG LẼ rơi sang điều khiển giao diện Flow (`generateMotionVideoThroughUi`, lỗi `FLOW_UI_CONTROL_MISSING` “requested asset in picker”). `GET /api/veo/status` → `extension.capabilities` cho thấy extension đang chạy bản nào (rỗng = cũ, cần Reload ở chrome://extensions). Đổi giới hạn thì đổi cả hai nơi (có test canh).
2b. **Chống trùng theo nội dung**: `_find_duplicate_job` trả lại job ĐANG CHẠY có cùng `request_fingerprint` (fingerprint loại `idempotency_key`, nên khóa khác không giúp được). Muốn tạo nhiều video giống hệt nhau (biến thể của node Ingredients) phải đổi một trường nằm trong fingerprint: `VeoJobRequest.variant` (1–4, KHÔNG gửi lên Flow). Thiếu nó thì biến thể 2–4 bị gộp vào job của biến thể 1 (đã xảy ra 2026-11-23: chọn 2 biến thể ra 1 job). Hàng chờ Flow là FIFO một-việc-một-lúc (`_FifoGate`): job `pending` ghi “Đang xếp hàng chờ Flow (N việc phía trước — đang chạy: <loại> · job <id>, đã X phút)”.
3. `_build_verified_flow_request(job)` chạy **trước khi lưu**: lỗi (file thiếu, tổ hợp model/thời lượng không có) thì dừng trước khi gửi bất cứ gì tốn tiền. Worker chạy lại bước này để file bị xóa không biến thành video chỉ-có-chữ.
4. Chống trùng, trong **cùng một lock** với bước ghi (`_jobs_lock`): theo `idempotency_key` và `request_fingerprint`. Trùng thì trả job cũ với `deduplicated=true`, không tạo render mới.
5. Tạo thread daemon `veo-job-<id>` chạy `_process_job`.

`_process_job` / `_process_job_in_slot`:

| Bước | `JobStatus` | Ghi chú |
|---|---|---|
| Chờ jitter 2–6 s | `pending` | Tránh nhiều job cùng bắn (giảm nguy cơ `PUBLIC_ERROR_UNUSUAL_ACTIVITY`) |
| Kiểm tra bridge chạy, extension đã kết nối | `error` ngay nếu không | Báo lỗi sớm, không bắt người dùng chờ lượt |
| Xếp hàng **cổng FIFO** `flow_ui_slot` | `pending` ("n việc phía trước") | Mục 4 |
| Có credential trong pool | | Không có tài khoản Labs thì lỗi |
| `bridge.request_captcha(action="VIDEO_GENERATION", flow_request=…)` | `captcha` → `generating` | Thử lại tối đa 25 s nếu extension tạm bận |
| Chờ kết quả: `bridge.wait_flow_result` | `generating` | Timeout 630 s (text), 780 s (frames), 1080 s (ingredients, video_edit) |
| Tải MP4: `_download_flow_video` | `downloading` | Chỉ nhận HTTPS `flow-content.google`, ≤ 250 MB, kiểm Content-Type, ghi `.part` rồi đổi tên nguyên tử |
| Xong | `done` | Ghi `provider_media_id`, tăng đếm video của project |

Với nhánh HTTP, `flow_request.http_no_captcha = true` nên backend **không chờ token reCAPTCHA thừa**; extension tự lấy token trong trang. Với text-to-video không phải HTTP, backend chờ token tối đa 30 s; với `frames/ingredients/video_edit` đi đường UI, nó không chờ token.

## 4. Cổng FIFO: một việc UI Flow mỗi lần

Extension chỉ điều khiển được **một tab Flow, một việc UI mỗi lúc**, và sẽ từ chối việc đến sau nếu bận. `_FifoGate` ở `service.py` xếp hàng ngay ở backend (FIFO, nghỉ tối thiểu 3 s giữa hai việc) và chỉ đẩy việc vào bridge khi tới lượt. Cả tạo video lẫn tạo ảnh đều đi qua `flow_ui_slot(owner)`. `FlowBusyError` nghĩa là *chưa gửi gì lên Flow*, an toàn để thử lại.

**Khởi động lại backend giữa chừng.** Mỗi job chạy trong một thread `veo-job-<id>` nên thread mất theo backend. `_load_jobs` (lúc `startup`) đánh lỗi mọi job còn dở: job đã qua bước gửi (`captcha`/`submitting`/`generating`/`downloading`) → `JOB_INTERRUPTED` (Flow có thể đã nhận lệnh: tìm lại bằng `recover-current` trước khi tạo lại); job còn `pending` (đang xếp hàng) → `NOT_SUBMITTED` (chưa lên Flow, chưa mất credit). Trước đây job `pending` bị bỏ nguyên trạng thái nên kẹt vô hạn. `dev.js` tự khởi động lại backend khi sửa file `.py` — đừng sửa khi đang có job chạy (`npm run start:stable --prefix Desktop`).

`GET /api/veo/status` cho thấy trạng thái bridge, extension (tab, heartbeat), credits từng tài khoản, hàng đợi captcha.

## 5. HTTP hay UI? Và khi mọi thứ lỗi

**Transport mặc định là HTTP** (`transport=http`; đặt biến `FLOW_TRANSPORT=ui` trong terminal chạy `dev.js` để ép đường UI). Một job chỉ thực sự đi HTTP khi **cả hai** đúng:

- Backend: `_http_video_eligible(req)` (`service.py`).
- Extension: `canUseHttpVideo()` (`src/providers/google-flow/page/video-http.js`).

Hai hàm này **phản chiếu nhau**; nếu lệch thì extension rơi về luồng cũ (giải captcha rồi dispatch). Khi sửa một hàm, sửa hàm kia. Tổ hợp đã chứng minh live, tất cả Omni 1.2, 720p hoặc 360p, 9:16 hoặc 16:9, 1 đầu ra:

| `input_mode` | Model id | Điều kiện thêm |
|---|---|---|
| `text_to_video` | `macaron_cookie_t2v_10s` (+`_360p`) | chỉ 10 s |
| `frames` | `macaron_cookie_i2v_fl_{6\|10}s` (+`_360p`) | cần ảnh đầu **và** cuối kèm kích thước; thời lượng khớp model |
| `ingredients` | `macaron_cookie_r2v_{3..15}s` (+`_360p`) | 1–3 ảnh (base64) và/hoặc media id có sẵn |
| `video_edit` (Motion Control) | `macaron_cookie_edit` (+`_360p`) | video mẫu đã có media id, đoạn ≤ 15 s, **1–5 ảnh tham chiếu** (`MOTION_MAX_IMAGES`; HAR có 1–3, người dùng xác nhận 5 trên giao diện Flow 2026-11-23 — mỗi ảnh một phần tử `[null, mediaId]` ở `item[8]`); **1–4 đầu ra** (`MOTION_MAX_OUTPUTS`) |

**Nhiều video trong một lệnh (chỉnh video)** — HAR `flow.google_video_2311.com` (2026-11-23, giao diện Flow x3, 360p): MỘT request `jIps6` chứa N item giống hệt nhau, chỉ khác cặp uuid ở `item[4]`; `item[3]` vẫn là 1. Response `payload[3]` có N record (N media id); `jwpduf` hỏi cả N id một lần; mỗi id có kết cục riêng (HAR: 2 xong, 1 bị `PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED`). 360p = model `macaron_cookie_edit_360p` + cờ `[4]` ở `item[12]`. Giá: 16 credit/video cho đoạn 13,63 s ở 360p (Flow tính theo số giây nguyên). 5–16 giây đầu `jwpduf` trả state 4 “Media not found.” cho id vừa tạo — extension coi là chưa xong (tối đa 120 s), không phải lỗi. Extension trả `outputs: [{index, ok, media_id, video_url | error}]`; backend `_finish_multi_output_job` tải từng video (`<job>.mp4`, `<job>_v2.mp4`, …), ghi `job.outputs` (kết cục từng video, có `error_code`), job `done` nếu có ít nhất một video. Không dùng khôi phục scene cho lệnh nhiều video (chỉ lấy được một video bất kỳ). Bản extension cũ: `_require_extension_motion_features` chặn khi `capabilities.motion_max_outputs` / `motion_360p` / `motion_max_images` thiếu (không báo `motion_max_images` = 3 ảnh). `VeoJobRequest.ingredient_image_paths` / `ingredient_media_ids` có trần chung 5; Ingredients r2v vẫn kiểm 1–3 trong service. Nhiều video / 360p mà yêu cầu không đủ điều kiện HTTP thì `_build_verified_flow_request` chặn (đường giao diện không làm được).

Hậu quả khi thêm model/thời lượng mới: cần HAR của chế độ đó, cập nhật `_DEFAULT_MODELS`, `_build_verified_flow_request` và cả hai hàm eligibility, kèm test trong `Backend/tests/veo/` và `Extensions/FlowsVeo-Clean/tests/`.

**Chạy tiếp thay vì khôi phục (đường HTTP).** Hàm trong trang `runFlowHttpVideoInPage` chạy MỘT `executeScript` từ lúc gửi tới lúc video xong (vài phút). Nếu trang Flow tải lại / chuyển trang giữa chừng, lời gọi đó mất kết quả. Trước 2026-11-23 extension khi đó luôn “khôi phục scene” = lấy video đang mở trên màn hình: với 1 video thường trúng, với lệnh nhiều video chỉ được 1 video (hoặc nhầm ảnh JPEG — lỗi `DOWNLOAD_FAILED` “Content-Type image/jpeg”). Dấu hiệu trong dữ liệu: metadata `<job>.json` có `generation_diagnostics` RỖNG (đường HTTP trực tiếp luôn ghi `adapter: motion-http-v1`). Nay: `generation.js` sinh `nonce` cho mỗi lượt HTTP; gửi xong, hàm trong trang ghi `{mediaIds, credit, projectId, …}` vào `sessionStorage` khóa `_vf_http_gen:<nonce>` (còn qua lần tải lại cùng tab; xóa khi xong, tự dọn bản ghi > 1 ngày). Mất kết quả → `handleLost` chạy lại chính hàm đó với `{nonce, resume: true}`: không gửi gì, chỉ hỏi trạng thái / lấy URL đúng các media id đã ghi (thử lại tới 15 phút nếu trang lại đổi). Chỉ khi tab không còn dấu vết (`resume_missing`) mới dùng khôi phục scene, và KHÔNG dùng cho lệnh nhiều video.

**Khôi phục thay vì gửi lại.** Nếu hết timeout hoặc Flow báo lỗi, `_try_recover_completed_scene` nhờ extension đọc thẻ media đã hoàn tất trong project (`bridge.request_flow_recovery`, chờ 45 s) rồi tải. Hai lớp chống nhận nhầm: từ chối `media_id` đã thuộc job `done` khác, và từ chối file trùng SHA-256 với video cũ. Người dùng cũng có thể gọi tay `POST /api/veo/jobs/{id}/recover-current`.

Một chi tiết giúp phân biệt: nếu extension trả `result.submitted == false` thì **chưa gửi lệnh tạo video**, nên không mất credit. Khi thất bại, `postFlowResponse` vẫn gửi `result: null` như cũ nhưng **thêm** `failure: {submitted, media_id, media_ids}` (bridge lưu vào envelope). `submitted == false` → job lỗi “Chưa gửi lên Flow (không mất credit)” (`NOT_SUBMITTED`), không đi khôi phục. Trước 2026-11-23 cờ này bị mất trên đường về nên mọi lỗi (vd. “Failed to fetch” trước khi gửi) đều bị báo “có thể đã trừ credit”.

## 6. Quy tắc không được phá

1. **Không retry mù cho POST tạo video/ảnh**, ở bất kỳ tầng nào (backend, extension, frontend). Flow có thể đã tạo rồi.
2. Lỗi thì **khôi phục theo `media_id`/prompt + thời điểm**, không submit lại.
3. Mọi kiểm tra đầu vào phải xảy ra **trước** khi gửi; thà từ chối sớm còn hơn tốn credit.
4. Check-and-insert chống trùng phải nằm trong **một lock**.
5. Không thêm hàng đợi chung/retry vào transport của extension (xem `architecture.md` của extension).
6. Chiến dịch AI: bước `clip` **không bao giờ tự retry** và bảng giá chỉ chứa điểm đã đo thật.

## 7. Trạng thái và lưu trữ

- Job nằm **trong bộ nhớ** (`_jobs`), được ghi ra `Data/veo_jobs.json` mỗi lần đổi trạng thái (ghi nguyên tử).
- Khởi động lại: job đang `captcha/submitting/generating/downloading` bị đánh dấu `error` ("Job interrupted by server restart"). Video đã tạo trên Flow vẫn có thể khôi phục bằng `recover-current`. Đây là lý do `npm start` (tự restart backend khi sửa `.py`) có thể cắt job dài: dùng `npm run start:stable`.
- SQLite: `veo_projects` (project Flow + đếm video), `veo_images` (ảnh đã tạo/upload).
- File: `media/veo_outputs/`, `media/veo_images/`, `media/veo_uploads/` và `veo_jobs.json` dùng `DATA_DIR` ở cả dev và bản đóng gói. Xem [data-and-paths.md](data-and-paths.md).
- Hàng đợi Veo Studio lưu trong `DATA_DIR/veo_studio_batches.json`. Client gửi `POST /api/veo/studio-batches` với `batch_id` (UUID), `project_id` và `items` theo thứ tự. Mỗi mục có `image` (`source: upload` với `file_id` từ `/upload-image`, hoặc `source: library` với ID ảnh Veo, đặt trong trường `id`), `prompt`, `references` và `settings` (`aspect_ratio`, `resolution`, `duration_seconds`). Backend dùng Omni 1.2 Ingredients, ảnh chính đứng đầu danh sách ảnh. Gửi lại cùng `batch_id` và nội dung trả về lô cũ. `GET /api/veo/studio-batches?project_id=…` đọc tiến độ. `POST /api/veo/studio-batches/{batch_id}/pause` hoặc `/resume` điều khiển các mục đang chờ. Khi một mục lỗi hoặc backend khởi động lại, các mục còn chờ cần được tiếp tục chủ động.

## 8. Debug nhanh

| Triệu chứng | Kiểm tra |
|---|---|
| Job báo "Extension chưa kết nối" | `GET /api/veo/status` → `extension.connected`; extension đã nạp? tab labs.google đã đăng nhập? chỉ một phiên bản extension bật? |
| Job kẹt `pending` "xếp hàng chờ Flow" | Cổng FIFO đang có việc khác (`flow_ui_slot`); xem log `Flow UI bận (…)` |
| `Giải reCAPTCHA thất bại` | Tab đang ở trang chủ chứ không phải project (reCAPTCHA chỉ có trong project); backend gọi `_ensure_flow_project_tab` |
| Hết hạn "extension không nhận việc kịp" | Việc nằm trong hàng đợi > 90 s (`PICKUP_TTL_SECONDS`): service worker của extension đang ngủ hoặc chưa kết nối |
| Video đã có trên Flow nhưng job `error` | `POST /api/veo/jobs/{id}/recover-current` |
| Credits hiển thị sai | `POST /api/veo/refresh-credits` hoặc nhập tay ở Cài đặt → Google Veo |

## 9. Việc chưa rõ / giới hạn bằng chứng

- `macaron_cookie` = Omni 1.2 là **suy luận** từ banner và HAR, chưa có nhãn chính thức.
- Model 360p/3–15 s của Omni 1.2 chỉ có HAR cho một số điểm; phần còn lại là mã theo mẫu, đã chạy thử thật cho một số thời lượng.
- Bridge: `/bridge/secret` không xác thực, CORS rộng, extension lưu token/cookie. Pairing/HMAC là một đợt thiết kế riêng, chưa làm (xem `docs/bridge-protocol.md` của extension).
