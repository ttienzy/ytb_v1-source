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
2. Kiểm tra theo `input_mode` (`text_to_video`, `frames`, `ingredients`, `video_edit`): số ảnh tham chiếu (Ingredients 1–3), Frames cần Start Frame, `video_edit` cần `reference_video_id` và đoạn mẫu ≤ 10 giây.
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
| `video_edit` (Motion Control) | `macaron_cookie_edit` | 720p, video mẫu đã có media id, đoạn ≤ 10 s, ảnh tham chiếu hợp lệ |

Hậu quả khi thêm model/thời lượng mới: cần HAR của chế độ đó, cập nhật `_DEFAULT_MODELS`, `_build_verified_flow_request` và cả hai hàm eligibility, kèm test trong `Backend/tests/veo/` và `Extensions/FlowsVeo-Clean/tests/`.

**Khôi phục thay vì gửi lại.** Nếu hết timeout hoặc Flow báo lỗi, `_try_recover_completed_scene` nhờ extension đọc thẻ media đã hoàn tất trong project (`bridge.request_flow_recovery`, chờ 45 s) rồi tải. Hai lớp chống nhận nhầm: từ chối `media_id` đã thuộc job `done` khác, và từ chối file trùng SHA-256 với video cũ. Người dùng cũng có thể gọi tay `POST /api/veo/jobs/{id}/recover-current`.

Một chi tiết giúp phân biệt: nếu extension trả `result.submitted == false` thì **chưa gửi lệnh tạo video**, nên không mất credit.

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
- File: `veo_outputs/`, `veo_images/`, `veo_uploads/` dưới `media/`. **Lưu ý đường dẫn**: các thư mục này tính từ `__file__` (`Backend/Data/...`), không dùng `DATA_DIR`; xem [data-and-paths.md](data-and-paths.md).

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
