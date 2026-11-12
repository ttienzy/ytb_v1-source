# Audit nghiên cứu Google Flow / Veo và kế hoạch tích hợp

> **ĐÃ LƯU TRỮ (2026-11-12), chỉ để tham khảo lịch sử.** Kết luận về hiện trạng code (chưa có router Veo, chưa có sinh video) đã sai so với code hiện tại. Hiện hành: [PLAN_flow_http_submit.md](../PLAN_flow_http_submit.md) và [Extensions/FlowsVeo-Clean/docs/](../../Extensions/FlowsVeo-Clean/docs/). Đường dẫn file và số dòng trong tài liệu phản ánh thời điểm viết.


> Khởi tạo: 2026-09-04. Đối chiếu lại: 2026-09-05.
> File thực tế: `docs/PLAN_veo-integration-audit.md`; không có `docs/PLAN/_veo-integration-audit.md` trong checkout được kiểm tra.
> Phạm vi: website Flow, tài liệu Google công khai và mã nguồn hiện tại của dự án `tools`.

## 1. Kết luận và giới hạn bằng chứng

Mục tiêu vẫn là **Veo Studio độc lập**, sidebar theo tác vụ, preview, lịch sử và chuyển video sang Video Editor/Pippit/YouTube. Đây là mục tiêu triển khai, chưa phải tính năng đã hoàn thành.

Audit đã mở website Flow và các trang Google chính thức, đọc extension, Backend và điểm điều hướng Frontend. **Chưa thao tác trong phiên Flow đã đăng nhập, chưa thu network trace/HAR, chưa gọi tạo video và chưa kiểm thử E2E.** Website công khai không xác nhận giao thức bên trong phiên đăng nhập.

| Nhãn | Ý nghĩa |
|---|---|
| **DOC** | Tài liệu Google công khai, có link; chỉ áp dụng cho đúng sản phẩm của nguồn. |
| **CODE** | Thấy trong mã nguồn; không đồng nghĩa request chạy thành công. |
| **LOCAL CHECK** | Đã chạy kiểm tra tĩnh cụ thể, có kết quả ghi dưới đây. |
| **CHƯA XÁC MINH** | Thiếu nguồn phù hợp hoặc bằng chứng runtime. |
| **ĐỀ XUẤT** | Thiết kế của dự án, không phải đặc tả Google. |

Rút lại các kết luận “100% DONE”, “đã loại bỏ toàn bộ mã độc”, “đã bẻ khóa” và “PASS toàn bộ extension” từ bản cũ: bằng chứng hiện tại không đủ chứng minh.

## 2. Kết quả nghiên cứu website và tài liệu Google

### 2.1. Flow và API lập trình là các bề mặt tích hợp riêng

Website Flow hiện giới thiệu Veo 3.1, Gemini Omni và Nano Banana. Mô tả cố định “Flow = Veo 3.1 + Imagen 3” trong bản cũ không phản ánh nội dung công khai hiện tại. [Google Flow](https://labs.google/fx/tools/flow).

| Sản phẩm | Nguồn phù hợp | Phạm vi sử dụng |
|---|---|---|
| Flow website | Flow Help và phiên Flow thực tế | Thao tác, khả năng và giao thức của website. Help không đủ xác nhận giao thức nội bộ. |
| Veo qua Gemini API | Google AI for Developers | API lập trình; không dùng payload này để suy ra Flow. |
| Veo qua Vertex AI | Tài liệu Cloud tương ứng | Chỉ nghiên cứu contract riêng nếu chọn thêm provider này. |

Audit này **không tự đổi mục tiêu Flow/extension sang Gemini API**. API lập trình được đối chiếu để tránh trộn giao thức. Không tìm được nguồn Google công khai xác nhận contract tạo video `aisandbox-pa.googleapis.com` của bản cũ trong đợt nghiên cứu này.

### 2.2. Luồng thao tác Flow trên desktop

Google hướng dẫn mở/tạo project, chọn Video, nhập prompt, thêm frames/ingredients nếu cần, chọn model, tỉ lệ, số output và thời lượng rồi tạo. Frames dùng ảnh đầu/cuối; ingredients dùng tham chiếu nội dung. UI tích hợp cần phân biệt hai chế độ. [Create videos in Google Flow](https://support.google.com/flow/answer/16353334?co=GENIE.Platform%3DDesktop&hl=en).

```text
Project → prompt + kiểu đầu vào → cấu hình được hỗ trợ
        → tạo clip → xem kết quả → lưu / chỉnh sửa / dựng cảnh
```

Luồng sản phẩm này không xác định tên endpoint, JSON hoặc cơ chế polling của website.

### 2.3. Ma trận Veo trên Flow tại thời điểm đọc

| Tính năng | Veo 3.1 Lite | Veo 3.1 Fast | Veo 3.1 Quality |
|---|---|---|---|
| Text → video | 4/6/8s | 4/6/8s | 4/6/8s |
| Frame đầu; đầu + cuối | 4/6/8s | 4/6/8s | 4/6/8s |
| Ingredients | 8s | 8s | Không |
| Model thực hiện Extend | Có | Không | Không |

Các chế độ hỗ trợ trong bảng có hai tỉ lệ. Trang tính năng ghi Extend dùng Lite cho clip Veo 3.1 8s, gồm nguồn Lite/Fast/Quality. Chưa kiểm chứng trên tài khoản. [Flow models & supported features](https://support.google.com/flow/answer/16352836?hl=en).

**Nguồn chưa thống nhất:** bảng credits vẫn liệt kê Extend ở Fast/Quality và chỉ ghi 8s cho Quality. Không lấy bảng giá làm xác nhận capability; cần kiểm tra phiên Flow trước khi chốt những tổ hợp này. [Flow credits](https://support.google.com/flow/answer/16526234?hl=en).

### 2.4. Extend, tiếp cảnh bằng frame và ghép clip

Flow hướng dẫn chọn clip, bấm Extend và mô tả diễn biến tiếp. Lưu frame làm đầu vào lần tạo sau và Scenebuilder để sắp xếp/cắt/xem/tải chuỗi clip là những thao tác riêng. [Edit videos & build scenes](https://support.google.com/flow/answer/16935718?hl=en).

**Điều chỉnh thiết kế:** không gọi pipeline `ffmpeg` trích frame cuối → tạo clip mới → ghép clip là native Extend. Tách thành:

- **Extend:** chỉ bật khi adapter xác minh hỗ trợ đúng video nguồn.
- **Tiếp cảnh từ frame:** chức năng ứng dụng tạo một clip mới.
- **Ghép cảnh:** dựng các clip đã có, lấy duration từ media thực tế.

Chưa có bằng chứng trong audit cho cam kết Flow luôn cộng đúng 8 giây. Bỏ nhãn “+8s” và timeline mặc định `8 → 16 → 24`.

### 2.5. Gemini API: đối chiếu riêng, không thay thế contract Flow

Tài liệu ghi IDs `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview`. Ví dụ REST dùng `generativelanguage.googleapis.com/v1beta/models/<model>:predictLongRunning`, GET tên operation trả về để lấy trạng thái và tải video với API key.

Riêng Gemini API: Extend thêm 7s, tối đa 20 lần, cho video Veo hợp lệ; hỗ trợ 3.1/Fast, không hỗ trợ Lite. Seed không bảo đảm tái tạo giống hệt. Không chuyển các quy tắc này sang Flow. [Veo in Gemini API](https://ai.google.dev/gemini-api/docs/veo).

Nguồn có ghi chú đầu trang về `generateContent`, trong khi ví dụ vẫn dùng `generate_videos`/`predictLongRunning`. Nếu triển khai provider Gemini, phải kiểm tra SDK và request thực tế trước khi chốt contract.

### 2.6. Credits và độ phân giải

Credits tính theo generation, không nhất thiết theo request; một request có thể có nhiều output. Google yêu cầu xem chi phí mới nhất trong settings. Bảng phân biệt tạo video với upscale 1080p/4K và điều kiện gói. Không hứa mọi output là Full HD hoặc quy đổi credits thành số lượt bằng hệ số cố định. [Manage Flow credits](https://support.google.com/flow/answer/16526234?hl=en).

**Đề xuất:** hiển thị giá trị quan sát được, cấu hình tương ứng và thời điểm cập nhật; thiếu dữ liệu thì ghi “Chưa xác định”. Không suy quyền tính năng chỉ từ nhãn `FREE/PRO/ULTRA` do extension tự phân loại.

## 3. Audit mã nguồn hiện tại

Đường dẫn dưới đây tương đối từ file này. Kết luận chỉ áp dụng cho checkout đã kiểm tra.

### 3.1. Backend và Frontend

| Hạng mục | Bằng chứng | Kết luận |
|---|---|---|
| FastAPI | [app/main.py](../../Backend/app/main.py) không import/đăng ký Veo router | **CODE:** chưa có đăng ký `/api/veo/*`. |
| Bridge Python | Tìm trong `Backend`/`services`, kể cả file bị ignore, loại môi trường ảo/build: không có `veo_bridge`, `captcha_queue`, `batchAsyncGenerate`, `ensure_started` trong Python | Chưa tìm thấy implementation Bridge trong phạm vi này; không kết luận về dịch vụ ngoài repo. |
| Lifecycle | Không có `ensure_started()` hay hook Veo startup/shutdown trong `Backend/app/main.py` | Bỏ task “chuyển ensure_started từ shutdown sang startup”: chưa có căn cứ cho lỗi đó. |
| Veo Studio | [constants.ts](../../Frontend/src/shared/constants.ts), [App.tsx](../../Frontend/src/App.tsx) | Chưa có menu/trang Veo tại các điểm điều hướng này. |
| Nơi nhận video | [video_router.py](../../Backend/app/media/video_router.py), [Pippit router](../../Backend/app/externals/pippit/router.py), [YouTube router](../../Backend/app/externals/youtube/router.py) | Có API thư viện video và lịch đăng; chưa chứng minh handover từ Veo. |

### 3.2. Extension: những gì code thực sự có

Nguồn: [background.js](../../Extensions/FlowsVeo-Clean/background.js), [content.js](../../Extensions/FlowsVeo-Clean/content.js), [popup.js](../../Extensions/FlowsVeo-Clean/popup.js), [popup.html](../../Extensions/FlowsVeo-Clean/popup.html), [manifest.json](../../Extensions/FlowsVeo-Clean/manifest.json).

| Hạng mục | Quan sát | Hệ quả cho plan |
|---|---|---|
| Bridge | `DEFAULT_BRIDGE_PORT = 60526`, loopback, có đổi cổng | Chỉ là client config; chưa chứng minh server đang nghe hoặc có quét `60526..60535`. |
| Poll CAPTCHA | `POLL_INTERVAL_MS = 2500`, nghỉ sau xử lý vòng lặp | Bỏ 800ms. 2,5s là khoảng nghỉ, không phải chu kỳ thực tế cố định. |
| Heartbeat | `HEARTBEAT_MS = 30000` | Có code; chưa đo runtime. |
| Auth/credits | Cấu hình `/fx/api/auth/session`, cookie NextAuth, `/v1/credits`; có gọi tokeninfo | Xác nhận client thử gọi, chưa xác nhận response hiện tại. Không sao chép key/token vào tài liệu. |
| Gói tài khoản | `classifyTier()` có fallback credits dương → PRO | Heuristic của extension, không coi là thông tin gói đã xác minh. |
| reCAPTCHA | HAR thành công ghi nhận POST Enterprise reload chứa action `VIDEO_GENERATION`; adapter truyền action này khi tạo video | `USER_GENERATION` chỉ là giá trị test cũ của popup và bị Flow từ chối ở RPC tạo video. |
| Auto clear | Mặc định `true`, `1` giây; khởi động timer từ handler setting | Không khẳng định timer chạy ngay cold start: `startPolling()` không gọi `startAutoClearCacheTimer()`. |
| Xóa dữ liệu | `clearLabsCache()` xóa cacheStorage, IndexedDB, localStorage, serviceWorkers, fileSystems của Labs | Không đồng nhất với xóa cookie. `clearTrackingCookiesAndRefresh()` xử lý cookie/reload riêng. |
| Giữ cookie | Fallback `harvestCfg.h.ap = []`; giữ cookie theo prefix cấu hình | Cần kiểm tra config runtime; không hứa session ổn định. |
| Credential | `saveState()` ghi cookie/token vào `chrome.storage.local` | Không phải chỉ lưu in-memory. |
| Khôi phục | Token/cookie được lưu riêng; `harvestedAccounts` là map trong RAM | Cần thử worker restart và dựng lại danh sách trước khi push. |
| Popup | Có code 5 chỉ báo Bridge/Tab/Login/reCAPTCHA/Token | UI/handler tồn tại; chưa PASS độ chính xác. |
| Sinh video | Không thấy create-project/upload-image/dispatch-video/poll-video trong các file extension đã đọc | Không suy ra đã hoàn thành luồng MP4. |

### 3.3. Vòng đời worker

Code đặt watchdog `0.4` phút và PING qua port mỗi 25s. Chrome 120 quy định alarm tối thiểu 30s; từ Chrome 114, message qua port giúp duy trì worker, chỉ mở port không reset timer. Worker vẫn có thể dừng và mất biến toàn cục. [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

**Đề xuất:** điều chỉnh alarm theo Chrome mục tiêu, kiểm thử restart và tái dựng trạng thái. Nếu bỏ lưu credential lâu dài, phải thiết kế lấy lại phiên/storage phù hợp; không chỉ chuyển sang biến RAM rồi coi là hoàn tất.

### 3.4. Artifact đã kiểm tra

| File | Byte | Kết quả |
|---|---:|---|
| `manifest.json` | 1,216 | **LOCAL CHECK:** đầu file `7B-0D-0A`, không UTF-8 BOM; chưa thử Chrome load. |
| `background.js` | 55,424 | Đọc phần liên quan, không phải chứng nhận an toàn toàn bộ mã. |
| `content.js` | 7,072 | Có FAB và PING. |
| `popup.html` | 14,808 | Có UI trạng thái/cấu hình. |
| `popup.js` | 17,112 | Có handler trạng thái/điều khiển. |
| `icons/` | 6 file | `16.png`, `32.png`, `48.png`, `128.png`, `forever.png`, `logo.png`. |

**LOCAL CHECK:** SHA-256 của `assets/forever.png`, `icons/forever.png`, `icons/logo.png` giống nhau. Chưa kiểm chứng cách tạo bốn icon nhỏ hoặc chất lượng hiển thị trong Chrome.

## 4. Giả định giao thức trong bản cũ phải rút lại

### 4.0. Cập nhật kiểm chứng runtime ngày 2026-09-05

HAR `flow.google.com.har` và lần chạy trực tiếp trên tài khoản đang đăng nhập đã xác nhận phạm vi sau:

| Thành phần | Giá trị đã quan sát |
|---|---|
| Biến thể | Text-to-video, UI `Omni 1.1 Flash`, 6 giây, x1 |
| Model ID trong request | `abra_t2v_6s` |
| reCAPTCHA Enterprise action | `VIDEO_GENERATION` |
| RPC tạo / poll / lấy asset | `YhhmEf` / `jwpduf` / `as29s` qua `AiSandboxAngularFrontend/data/batchexecute` |
| CDN kết quả | HTTPS host `flow-content.google` |

Adapter chỉ cho phép đúng biến thể này. Không suy rộng ID sang 4s/8s/10s, 360p, mode ảnh, ingredients hay Extend khi chưa có HAR thành công tương ứng.

Lần test trực tiếp với prompt `Cat` đã được Flow nhận và số dư hiển thị giảm từ 791 xuống 781 credits, nhưng media còn ở trạng thái poll `2` quá giới hạn 270 giây ban đầu. Scene đang mở sau đó cung cấp một MP4 H.264 dài 6.016 giây, 720×1280. Vì media ID của lần poll bị mất khi timeout và file đo được là dọc, bằng chứng này chưa đủ để khẳng định output đó chính là job 16:9 vừa gửi. Adapter đã tăng giới hạn poll lên 600 giây và có recovery cho scene đang mở; vẫn cần một lần E2E mới giữ được media ID từ create đến MP4 để chốt tỉ lệ 16:9.

Chưa tìm được tài liệu Google xác nhận các contract Flow dưới đây. Điều này không chứng minh chúng không tồn tại; phải quan sát request thực tế trước khi dùng.

| Khẳng định cũ | Trạng thái | Bằng chứng thiếu |
|---|---|---|
| `project.createProject` nhận `{title: "VeoAI"}` | Chưa xác minh | Method, URL, wrapper tRPC, body/response thực tế. |
| `/fx/api/flow/uploadImage` trả `mediaId` | Chưa xác minh | Format upload, metadata, ID và cách dùng cho từng mode. |
| `:batchAsyncGenerateVideoText` / `:batchAsyncGenerateVideoImage` | Chưa xác minh | Request thành công từ site và response đã loại bí mật. |
| `veo_3_1_t2v_lite_low_priority`, `veo_3_1_r2v_lite_low_priority`, `veo_2_0_t2v` | Chưa xác minh | Mapping tên UI → internal ID theo tác vụ/tài khoản; không suy nghĩa từ hậu tố. |
| `PINHOLE`, `recaptchaContext`, enum tỉ lệ, seed trong body cũ | Chưa xác minh | Vị trí field, kiểu dữ liệu, yêu cầu thực tế. Đã bỏ JSON mẫu. |
| AI Sandbox GET `/v1/operations/<id>`, `done: true`, direct MP4 CDN | Chưa xác minh | Protocol trạng thái/lỗi/output và request download của Flow. |
| reCAPTCHA luôn dưới 2s | Chưa xác minh | Số đo nhiều lần gồm lỗi/timeout; bỏ cam kết. |
| Tự tải vào `Backend/Data/veo_outputs` | Đề xuất | Chưa tìm thấy implementation download/lưu metadata. |

Đã tìm tên endpoint cụ thể trên miền tài liệu Google. Code extension hoặc bài bên thứ ba không được dùng để biến những giả định này thành đặc tả chính thức.

### 4.1. Bằng chứng cần có trước khi viết adapter Flow

Trong phiên Flow đã đăng nhập, thu bản ghi đã loại Cookie, Authorization, access token, reCAPTCHA token và tham số URL chứa bí mật:

1. Ngày giờ, phiên bản Chrome/extension, gói tài khoản và cấu hình website.
2. Một thao tác thành công cho mỗi mode dự kiến: T2V, frame đầu, đầu/cuối, ingredients, Extend nếu có.
3. Request/response project, upload, dispatch, trạng thái, download; liên kết ID để biết request nào thuộc job nào.
4. Model thực dùng, mode, tỉ lệ, duration, resolution, số output; giữ cấu trúc payload sau khi che bí mật.
5. MP4 phát được; duration/dimensions/audio đo từ file; chi phí quan sát được hoặc ghi chưa xác định.
6. Lỗi tự nhiên gặp khi thử và phản hồi site; không tự suy quy tắc retry từ HTTP code đơn lẻ.

**Điều kiện chốt contract:** có lần thành công xuyên suốt cho mode tương ứng, fixture đã loại bí mật và kết quả kiểm tra media. Chưa đạt thì adapter đó vẫn chưa xác minh.

## 5. Kiến trúc và UI đề xuất

Mục này là **ĐỀ XUẤT CỦA DỰ ÁN**, không phải code đã tồn tại hoặc đặc tả Google.

```text
Veo Studio (React / Electron)
    → FastAPI: job, trạng thái, output, history
        → adapter Flow [chờ contract có bằng chứng]
            ↔ Bridge cục bộ [chưa tìm thấy implementation]
            ↔ FlowsVeo-Clean [đã có client]
    → media hợp lệ → Video Editor / màn hình soạn lịch đăng
```

Chưa chốt Bridge là process riêng hay thành phần FastAPI: cần xác định có dịch vụ gốc ngoài repo hay phải xây mới. 60526 là cổng mặc định client; dải quét cổng chưa phải tính năng đã có.

### 5.1. Sidebar và khu vực kết quả

Giữ hai cột; sidebar 360px là lựa chọn UI, điều chỉnh responsive khi triển khai.

| Khu vực | Nội dung | Điều kiện bật |
|---|---|---|
| Text → Video | Prompt, model, tỉ lệ, duration, số output | Tổ hợp adapter đã xác minh. |
| Image → Video | Tách Frames/Ingredients, preview và vai trò ảnh | Có contract upload/generate đúng mode. |
| Extend / Ghép cảnh | Tách Extend, tiếp cảnh bằng frame, ghép clip | Mỗi thao tác có kiểm chứng riêng. |
| Status / Accounts | Bridge, tab, phiên, tài khoản, thời điểm cập nhật | Thiếu/hết hạn phải hiển thị rõ. |
| Main stage | Player, trạng thái job, history, handover | Chỉ dùng file đã tải và kiểm tra thành công. |

Điều chỉnh bắt buộc từ mock cũ:

- Bỏ `Motion Strength 1–10`: chưa có field được xác minh. Preset camera có thể chèn prompt, không quảng bá là tham số Google.
- Gemini Enhance là chức năng ứng dụng tùy chọn, cần contract riêng.
- Seed chỉ hiện khi adapter xác minh hỗ trợ, không hứa output giống hệt.
- Dùng trạng thái “Chờ xử lý / Đang tạo / Đang tải / Hoàn tất / Lỗi”. Bỏ render `65%` và ETA giả định; chỉ hiện số đo khi có dữ liệu.
- Metadata thumbnail lấy từ file thật; không gắn sẵn `1080p`/`8s`.
- Handover Pippit/YouTube mở màn hình soạn/lên lịch với media; người dùng thực hiện hành động đăng trong luồng đó.
- Cookie Voice là chức năng extension riêng có code, chưa có bằng chứng cần cho Veo; không đặt làm điều kiện tạo video.

### 5.2. API nội bộ dự kiến

Chỉ là trách nhiệm API FastAPI của `tools`, **chưa tồn tại**, không phải endpoint Google:

| Nhóm | Trách nhiệm |
|---|---|
| Capabilities/status | Tổ hợp đã kiểm chứng và trạng thái có timestamp. |
| Submit job | Validate input, local job ID, lưu provider ID khi có. |
| Read job | Trạng thái/lỗi/output; tách lỗi generation và download. |
| History/file | Metadata và media cục bộ đã kiểm tra. |
| Handover | Đưa media vào contract editor/lịch đăng hiện có. |

Tên route `/api/veo/*`, schema job, cơ chế lưu và thư mục output sẽ chốt khi implementation. Không dùng danh sách route của bản cũ như API đang hoạt động.

## 6. Kế hoạch triển khai theo bằng chứng

Bỏ ước lượng “MVP 15–30 phút”, “Studio 1–2 giờ”: chưa có contract và baseline E2E để ước lượng.

### Giai đoạn 1 — Xác minh runtime và contract

- [x] Nghiên cứu website/tài liệu Google, đối chiếu code liên quan trong audit này.
- [ ] Xác định Bridge gốc hoặc xây mới; ghi interface client đang gọi: `/bridge/secret`, `/api/v1/config/init`, credential, CAPTCHA, heartbeat.
- [ ] Thu bằng chứng mục 4.1, bắt đầu T2V rồi xác minh riêng từng mode.
- [ ] Giải quyết điểm nguồn chưa thống nhất bằng phiên Flow; chưa xác minh thì chưa bật mode.
- [ ] Điều chỉnh extension theo phát hiện code: auto-clear/reload, config giữ cookie, alarm, restart, phân loại gói và trạng thái chưa biết.
- [ ] Xác minh xác thực Bridge trước khi gửi credential; che bí mật trong log/fixture và kiểm tra vòng đời lưu credential.

**Nghiệm thu:** contract T2V có bằng chứng, xác định implementation Bridge. Quan sát site thành công chưa phải E2E từ ứng dụng.

### Giai đoạn 2 — T2V tích hợp và Studio tối thiểu

- [ ] Xây Bridge/adapter theo contract đã xác minh; đăng ký router/lifecycle Backend theo implementation thực tế.
- [ ] Thêm Veo Studio vào menu/App; triển khai Text, Status, player, history trước.
- [ ] Chạy job từ ứng dụng qua extension/Flow đến MP4 cục bộ; kiểm tra phát lại/metadata.
- [ ] Kiểm thử mất tab/phiên, Bridge ngắt, worker restart, timeout, upstream error và download thất bại.
- [ ] Không tự submit lại khi chưa biết request trước đã được nhận; lưu provider ID để theo dõi nếu có.

**Nghiệm thu:** bằng chứng E2E từ ứng dụng, file hợp lệ, trạng thái/lỗi đúng. Đèn xanh hoặc token riêng lẻ không đủ.

### Giai đoạn 3 — Mode còn lại, handover, đóng gói

- [ ] Thêm Frames, Ingredients, Extend độc lập theo bằng chứng từng mode; T2V không chứng minh I2V.
- [ ] Nếu cần, xây tiếp cảnh bằng frame/ghép clip như chức năng ứng dụng riêng.
- [ ] Nối editor/Pippit/YouTube bằng contract thực tế, kiểm tra nhận đúng media/metadata.
- [ ] Cân nhắc đổi/tìm cổng sau khi Bridge có thiết kế rõ ràng.
- [ ] Đóng gói và kiểm thử cài extension trên Chrome mục tiêu; không hứa `.crx`/1-click khi chưa xác minh phân phối.

**Nghiệm thu:** từng mode có fixture và mẫu thành công; lỗi, handover, đóng gói được kiểm tra riêng.

## 7. Trạng thái nghiệm thu cuối audit

| Hạng mục | Trạng thái thực tế |
|---|---|
| Nghiên cứu nguồn Google | Đã thực hiện, link cạnh kết luận. |
| Đối chiếu code | Đã thực hiện trong phạm vi nêu trên. |
| BOM, số file/kích thước, hash logo | Đã kiểm tra tĩnh. |
| Chrome load, icon hiển thị, độ chính xác 5 đèn | Chưa kiểm thử runtime. |
| Bridge hoạt động, auth/session ổn định | Chưa kiểm chứng. |
| Protocol Flow, internal model IDs | Chưa xác minh bằng phiên đăng nhập/network trace. |
| T2V / Frames / Ingredients / Extend E2E | Chưa kiểm thử. |
| Studio, history, handover | Chưa triển khai tại các điểm tích hợp đã kiểm tra. |
| An toàn toàn diện / quyền phân phối extension | Chưa có kết luận; không dùng “100% sạch”. |

Mỗi thay đổi tiếp theo về endpoint, model, duration, credits hoặc trạng thái PASS phải bổ sung nguồn đúng sản phẩm hoặc bằng chứng runtime tương ứng.
