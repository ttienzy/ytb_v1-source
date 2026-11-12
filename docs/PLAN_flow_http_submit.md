# Plan: tạo video Flow bằng HTTP thay vì bấm giao diện

> **Cập nhật 2026-11-12:** backend mặc định gửi qua HTTP (`transport=http`, đặt `FLOW_TRANSPORT=ui` để ép đường UI); HTTP chỉ dùng khi `_http_video_eligible` (backend) và `canUseHttpVideo` (extension) cùng đúng, nếu không thì rơi về đường cũ. Mục "Còn thiếu để làm HTTP thành mặc định" và "Hiện trạng" là ghi chú tại 2026-11-09, chưa cập nhật. Phần giao thức quan sát từ HAR vẫn là tham chiếu chính; Google có thể đổi bất kỳ lúc nào.

Ngày: 2026-11-09. Nguồn: HAR `flow.google_2_new_credit_check_11_09.com` + code extension hiện tại.

## Hiện trạng (đã xác minh trong code)
- `page/video.js` ĐÃ có đường HTTP: `fetch` batchexecute trong tab Flow (MAIN world), token captcha lấy từ `grecaptcha.enterprise.execute`.
- Nhưng `generation.js` bỏ qua nó: text-to-video đi `generateVideoThroughUi` (bấm UI qua debugger) khi có `chrome.debugger`
  ([generation.js:58](../Extensions/FlowsVeo-Clean/src/providers/google-flow/generation.js#L58)); frames/ingredients/video_edit luôn đi UI (dòng 17–32).
- Model id trong code là `abra_*` (Omni 1.1). HAR 2026-11-09 dùng `macaron_cookie_*` (nhiều khả năng Omni 1.2).

## Giao thức quan sát được (không phải API công khai, Google có thể đổi)
| Bước | RPC | Ghi chú |
|---|---|---|
| Submit t2v | `YhhmEf` | payload có model id, projectId, **token captcha 2532 ký tự** ở `payload[1][10][0]` |
| Submit frames/ref | `nprQif` | `macaron_cookie_i2v_fl_10s`, `macaron_cookie_r2v_10s/15s` |
| Poll | `jwpduf` | mỗi 5s; state `record[5][8][0]`: 6 queued → 2 rendering → 3 done |
| Lấy URL mp4 | `as29s` | khi done có `flow-content.google/video/<id>?Expires&KeyName&Signature` |
| Tải | GET URL ký | 200 `video/mp4` |
| Danh sách model | `yBhWQ` | `abra, veo_3_1_lite/fast/quality, macaron_cookie, omni_upsampler_360p, veo_3_1_upsampler_1080p` |

Đo trong HAR: clip 10s render ~46s.

## Các tầng khả thi
- **Tầng A – HTTP bắn từ trong tab Flow, backend chỉ điều phối** (không bấm UI): khả thi, code đã có một nửa. Cần chứng minh live với model mới.
- **Tầng B – Python (httpx) tự gửi bằng cookie lấy từ trình duyệt**: chưa chứng minh. Rủi ro: cookie gắn thiết bị (DBSC), điểm reCAPTCHA thấp hơn khi UA/IP khác, 429.

## Các bước
0. **(xong)** `Backend/poc/flow_http/flow_rpc.py` + `verify_har.py`: dựng lại request submit khớp HAR từng byte, giải mã submit/poll/as29s. 13/13 PASS, không gọi mạng.
1. **Live đọc-only (0 credit)**: dán `Backend/poc/flow_http/live_probe.js` vào Console tab project Flow, chạy `await flowPoc()`.
   Đạt khi: in được danh sách model qua HTTP thuần.
2. **Live submit (tốn credit)**: `await flowPoc({ submit: true })`.
   Đạt khi: submit OK → poll ra 3 → có URL ký → tải không cookie được (quyết định tầng B có cần cookie khi tải hay không).
3. **Tầng B (chỉ khi bước 2 đạt)**: extension đẩy cookie + `at/f.sid/bl` + token cho backend; backend gọi `yBhWQ` bằng httpx. Nếu 401/redirect → dừng ở tầng A.
4. **Tích hợp**: extension chạy tầng A cho t2v/frames/ingredients, map model `macaron_cookie_*`, bỏ nhánh UI; polling có backoff; giới hạn tốc độ (code hiện tại đã có cadence 4.5s để tránh `PUBLIC_ERROR_UNUSUAL_ACTIVITY`).

## Kết quả live (2026-11-09, tài khoản thật, tab project Flow)
- `yBhWQ` qua HTTP thuần: OK (có `macaron_cookie`).
- Submit `YhhmEf` model `macaron_cookie_t2v_10s` với token captcha tạo trong trang (2510 ký tự): OK, không bị `UNUSUAL_ACTIVITY`.
- Poll `jwpduf`: 6 → 2 → 3, tổng 56s.
- `as29s` với payload `[mediaId]` (không phải `[mediaId,null,[1]]`): trả URL mp4 ký ở `[7][0][8]`.
- Tải URL ký bằng `fetch(credentials:'omit')`: 200, `video/mp4`, 6.348.983 byte => **tải không cần cookie** (mới thử trong trình duyệt, chưa thử từ Python/IP khác).
- `payload[1]` của submit = số dư credit: UI hiển thị "920 Google Flow credits" đúng bằng `creditField: 920`.
- Chạy 1 lần duy nhất; chưa kiểm tra gọi liên tiếp/đồng thời.

## Đã tích hợp (bước 3, phạm vi hẹp)
- `Extensions/FlowsVeo-Clean/src/providers/google-flow/page/video-http.js`: đường HTTP, chỉ bật khi `request.transport === 'http'` và đúng tổ hợp đã chứng minh (text-to-video, `macaron_cookie_t2v_10s`, 720p, 1 video). Test: `tests/video_http.test.cjs` (replay response HAR).
- `generation.js`: route sang HTTP; nếu HTTP lỗi TRƯỚC khi Flow nhận job (`submitted:false`) thì fallback sang UI; nếu đã submit thì KHÔNG gửi lại (tránh trừ credit hai lần).
- `video-ui.js` `parseVideoUiCreateResponse`: hiểu format mới (media id ở `payload[3][0]`). Format cũ có cờ `CAE`/`CAM` (HAR 05/09, 30/09); từ HAR 09/11 không còn.
- Backend: model "Omni 1.2 Flash" (10s/720p/text-to-video, 30 credit), `transport` mặc định `http` (extension chỉ dùng cho tổ hợp đã chứng minh, mọi tổ hợp khác tự dùng UI); ép về UI bằng `job["transport"]="ui"` hoặc `FLOW_TRANSPORT=ui` (biến phải có trong terminal chạy `Desktop/dev.js`). Lúc đầu mặc định là `ui` nên lần test e2e đầu tiên (job 046cd005, 2026-11-09 16:07) vẫn đi đường UI. Test: `Backend/tests/test_veo_omni12.py`.

## Bổ sung từ HAR v2 (`flow.google_2_new_credit_check_11_09_v2.com`, 8 lần submit)
Số dư sau mỗi lần submit (`payload[1]`) cho ra chi phí thật, khớp bảng Flow Help:

| RPC | model id | độ dài | res | credit |
|---|---|---|---|---|
| YhhmEf (t2v) | `macaron_cookie_t2v_10s` | 10s | 720p | 30 |
| nprQif (frames) | `macaron_cookie_i2v_fl_10s` | 10s | 720p | 30 |
| nprQif (frames) | `macaron_cookie_i2v_fl_10s_360p` | 10s | 360p | 10 |
| MZZa6b (ingredients/r2v) | `macaron_cookie_r2v_15s_360p` | 15s | 360p | 20 (= 10 + 5s×2) |

- **360p nằm trong model id** (hậu tố `_360p`); server echo mã độ phân giải ở `record[5][6][1][0][5]`: 1 = 720p, 4 = 360p. MZZa6b còn thêm `[4]` ở `item[11]`.
- **Độ dài nằm trong model id** (`_10s`, `_15s`); `t2v` chỉ thấy `_10s`.
- **Ingredients (r2v) dùng RPC `MZZa6b`** (đã quay lại): `item = [[null,null,[[prompt]]], [[null,mediaId],...], model, 1, null, [idA,idB], null×5, [4]]`.
- Frames: ảnh start/end là slot `[null, mediaId, null, null, null, [crop x0,y0,x1,y1]]`; crop theo tỉ lệ ảnh.
- **Tỉ lệ khung hình vẫn không xuất hiện ở bất kỳ payload nào**; cả 2 mp4 có trong HAR đều 720x1280 (HAR không có thao tác đổi tỉ lệ).
- `macaron_cookie_t2v_10s_360p`: **đã chạy live** 2026-11-09, server echo resCode 4, trừ 10 credit (800→790), render 39s. HTTP path + backend đã mở cho 360p.
- **Tỉ lệ khung hình = `item[2]` của request tạo video: 1 = 9:16 (dọc), 2 = 16:9 (ngang)** (MZZa6b: `item[3]`). Đây KHÔNG phải số lượng: số video = số item trong `payload[0]`. Bằng chứng: HAR UI 16:9 (`flow.google_2_test_19_6_.com`) có item[2]=2, server echo `[model,1,null,null,2,4]`, telemetry `WuwhI` ghi `"aspectRatio":2`; mọi request trước (UI 9:16 và PoC) là 1 và ra video dọc (720x1280, 360x640). Đổi tỉ lệ trong UI không gọi API vì nó chỉ là trạng thái client gửi kèm lúc tạo. **Đã xác minh live (2026-11-09)**: gửi item[2]=2 + `macaron_cookie_t2v_10s_360p` => video 640x360 (ngang), trừ 10 credit (770→760); gửi 1 => 360x640 / 720x1280 (dọc).
- UI 360p còn thêm `item[7] = [4]` (t2v) / `item[11] = [4]` (r2v); PoC không gửi vẫn ra resCode 4 và trừ 10 credit.
- Hệ quả: `page/video.js` (đường cũ) đặt `numOutputs` vào `item[2]` => thực chất gửi tỉ lệ (1 = dọc, 2 = ngang) chứ không phải số lượng.

## Đã xử lý sau lần test e2e đầu
- **Token captcha thừa**: job HTTP không còn giải token trước. Backend đặt `flow_request.http_no_captcha` (hàm `_http_video_eligible`, phản chiếu `canUseHttpVideo`), không chờ `wait_captcha_result`; extension (`dispatch.js`) chỉ bỏ qua `solveRecaptcha` khi CẢ cờ lẫn `canUseHttpVideo` đúng, nếu lệch thì rơi về luồng cũ để backend không treo. `generation.js` tự `warmUpRecaptcha` trước khi gửi.
- **`provider_model_id` sai (`abra_t2v_6s`)**: nguồn gốc là backend gọi khôi phục với `provider_model_id` rỗng (job chưa có id), `recovery.js` rơi về mặc định cũ. Nay backend dùng `_job_provider_model_id(job)` (suy từ cấu hình job) cho cả khôi phục, `metadata` và job record.

## Còn thiếu để làm HTTP thành mặc định
- **Tỉ lệ khung hình**: xong (item[2], đã xác minh bằng video thật cả hai chiều).
- Danh sách model (`yBhWQ`) bắt đầu có thêm id lạ `beluga_display` (2026-11-09, chưa rõ là gì).
- **Độ dài 3–15s và 360p** của Omni 1.2, `frames` (`macaron_cookie_i2v_fl_10s`), `ingredients` (`macaron_cookie_r2v_10s/15s`): cần HAR cho từng chế độ.
- Parser `page/video.js` (`findMediaAsset`) và các chỗ khác còn dùng cờ `CAE`: chưa cập nhật.

## Chưa biết / cần kiểm chứng
- `macaron_cookie` = Omni 1.2: suy luận (xuất hiện cùng banner "Introducing Gemini Omni 1.2 Flash"), chưa có nhãn chính thức.
- Mã model 360p / 3–15s của Omni 1.2: HAR chỉ có `*_10s`, `r2v_15s`.
- Vì sao nhóm đã chuyển sang UI path: lịch sử git chưa cho lý do rõ (commit `7ca549a`).
- Gọi liên tiếp/đồng thời nhiều video có bị Google chặn không (cadence, `PUBLIC_ERROR_UNUSUAL_ACTIVITY`).
- URL ký có tải được từ Python/IP khác không; thời hạn `Expires`.


---

## Cập nhật 2026-11-09 (GĐ7): frames đầu–cuối (i2v_fl) qua HTTP — phân tích HAR `flow.google_2_test_gd_7.com`

**HAR có gì:** 59 request, toàn bộ `batchexecute` của Flow. Có đúng một lần `MZZa6b` (ingredients/r2v) và một lần `nprQif` (frames). **Không có RPC upload ảnh**: UUID ảnh khung đầu/cuối là ảnh đã có sẵn trong project. Các HAR khác (10 file) cũng không có upload ảnh; chỉ `flow.google_image.har` có upload **video** theo giao thức resumable (`/upload/v1/flow/upload/video/<projectId>`: `x-goog-upload-command: start` rồi `upload, finalize`, trả `mediaId`).

**Đã chứng minh (dựng lại khớp từng tham số với 3 request `nprQif` thật: 6s 720p, 10s 720p, 10s 360p — `Backend/poc/flow_http/verify_har_frames.py`):**

```
nprQif item = [[null,null,[[[prompt]]]], model, aspect(1=9:16, 2=16:9), null,
               slotĐầu, slotCuối, [null,null,null,null,uuidA,uuidB]]
slot        = [null, mediaId, null, null, null, [trên, trái, dưới, phải]]      # 0–1, null = 0
```
- **Model id có hậu tố thời lượng tuỳ chọn:** `macaron_cookie_i2v_fl_<N>s[_360p]` (HAR có 6s và 10s) và `macaron_cookie_r2v_<N>s` (HAR có 10s, 13s, 15s). Không chỉ 10s như danh sách model mặc định.
- **360p cho frames KHÔNG có cờ phụ** (khác t2v có `item[7]=[4]`): chỉ hậu tố `_360p` của model id.
- **Hình chữ nhật cắt** = cắt ảnh về đúng tỉ lệ video, kiểu giữa-giữa: ảnh 16:9 → 9:16 gửi `[null, 0.3418, 1, 0.6582]`; ảnh vuông `[null, 0.21875, 1, 0.78125]`; ảnh gần 9:16 `[0.0012, null, 0.9988, 1]`; không cắt `[null, null, 1, 1]` (khớp `computeFlowCropCoords` cũ trong `page/video.js`).
- Response submit cùng dạng t2v: `payload[1]` = số dư, `payload[3][0][0]` = mediaId, `payload[3][0][5][8][0]` = trạng thái; poll `jwpduf` và lấy URL `as29s` y như t2v. `nzlxg` (payload rỗng) trả số dư credit.
- **Giá (chênh lệch số dư trước/sau):** t2v và i2v **720p = 3 credit/giây** (i2v 6s = 18, 10s = 30), **360p = 1 credit/giây** (i2v 10s = 10). r2v đắt hơn: 360p 15s = 20; 720p 13s = 48. Chưa có số liệu: i2v 360p 6s và mọi thời lượng khác.

**Chưa có HAR (suy từ code extension, cần xác nhận live lần đầu):** upload ảnh dùng RPC `maseQ` (payload `[[null,22,null,null,null,projectId,…], base64, mime, true, null,null,null,false, tên_file]`, response `data[0] = [mediaId, projectId]`, `data[1][3][0] = tên file`): giao diện Flow dùng đúng RPC này và `frames-ui.js`/`motion-ui.js` đọc response theo cấu trúc đó, nhưng chưa HAR nào chứa request `maseQ`. Nếu upload lỗi thì **chưa gửi lệnh tạo video, không mất credit**.

**Đã tích hợp:** `page/video-http.js` (frames: upload 2 ảnh → `nprQif` → poll → `as29s`), `generation.js`/`dispatch.js` (frames Omni 1.2 đi đường HTTP, không rơi về giao diện vì UI frames chỉ hỗ trợ Omni 1.1), backend `veo/service.py` (`macaron_cookie_i2v_fl_*`, chỉ 6s/10s, cần CẢ hai khung; cờ `http_no_captcha` có test so khớp chéo với `canUseHttpVideo` của extension; lỗi trước khi gửi → `NOT_SUBMITTED`).

## Cập nhật 2026-11-11: Motion Control (video_edit, Omni 1.2) qua HTTP — HAR `flow.google_video_motion.com`

**Tải video mẫu** (không tốn credit, không cần token reCAPTCHA; HAR `flow.google_image.har`): resumable upload hai bước trong tab project.
`POST /upload/v1/flow/upload/video/{projectId}` với `X-Goog-Upload-Command: start`, `X-Goog-Upload-Protocol: resumable`,
`X-Goog-Upload-Header-Content-Length`, `Slug: tên_file` → header `x-goog-upload-url`; rồi `POST` URL đó với
`X-Goog-Upload-Command: upload, finalize`, `X-Goog-Upload-Offset: 0`, thân = byte video → JSON `{mediaId, media:{projectId…}}`.
Video vừa tải còn đang xử lý: `jwpduf` trả `record[5][8][0] = 1`, khoảng 37 giây sau (clip 10 giây) thành `3`.
Code: `page/upload.js` (`runVideoUploadInPage`), `upload.js` (action `UPLOAD_VIDEO`, đã bỏ bước giải captcha thừa). Motion Control gửi `native_ui=false`.

**Tạo video** `jIps6` (một item):
`[[null, idVideo, khungĐầu, khungCuối], [null,null,[[[prompt]]]], "macaron_cookie_edit", sốVideo, [null,null,null,null,idA,idB], null, null, null, [[null,idẢnh]…]]`,
ngữ cảnh `[null,22,…,projectId,…,[token,1]]`, `[uuid,2]`. Khung = giây × 30 (HAR: 0–240 = 8 giây). Response giống `YhhmEf`
(`[null, sốDư, …, [[record]]]`, `record[5][8][0] = 6` lúc mới nhận). 720p, 30 credit, khoảng 75 giây.
Code: nhánh `isEdit` trong `page/video-http.js` (đợi video mẫu `state 3` rồi mới lấy token và gửi; lỗi trước đó = chưa gửi, không mất credit),
`canUseHttpVideo`/`motionImageOrder` và bản sao backend `_http_video_eligible`/`_motion_image_order` (có test so khớp chéo).
Ảnh giữ đúng thứ tự `ingredient_inputs` (nhân vật = Image 1, bối cảnh = Image 2); ảnh cục bộ tải lên bằng `maseQ`.

**Chưa có HAR, vẫn đi giao diện:** Motion Control không có ảnh tham chiếu nào; 360p. **Chưa chạy thật** đường HTTP này lần nào.
