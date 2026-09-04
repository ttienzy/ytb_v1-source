# Báo cáo nghiên cứu & Kế hoạch tích hợp Google Veo

> **Ngày khởi tạo**: 2026-09-04  
> **Cập nhật mới nhất**: 2026-09-05 (Đã hoàn thành giải mã và viết lại sạch 100% extension `FlowsVeo-Clean`)  
> **Phạm vi**: Mã nguồn app `D:\p_07_17\scraper-wattpad`, backend bridge, và Chrome extension tại `D:\GOOGLE SEARCH\tools\Extensions\FlowsVeo-Clean`.

## Kết luận ngắn & Cập nhật tiến độ

App đã tích hợp Veo ở mức backend và product flow, phụ thuộc vào Chrome extension để cấp session Google và giải token reCAPTCHA Enterprise theo từng lượt tạo video.

- **Tiến độ quan trọng (2026-09-05)**: Extension obfuscated cũ (`Flows-Veo-TaoThaoAI`) đã được **giải mã hoàn toàn và viết lại 100% bằng mã nguồn sạch, tường minh** tại `D:\GOOGLE SEARCH\tools\Extensions\FlowsVeo-Clean`. Đã thay thế toàn bộ nhận diện cũ bằng bộ icon chính thức từ `D:\GOOGLE SEARCH\tools\assets\forever.png`, sẵn sàng xuất bản riêng biệt.
- Veo hoạt động trong 3 dây chuyền nghiệp vụ:
  1. Studio tạo Project/phim từ truyện.
  2. DNA/Series tạo tập.
  3. DNA/Reels tạo reel hàng loạt.
- Endpoint độc lập `POST /veo/generate` (Text-to-Video, Image-to-Video, Extend) đã được Electron expose IPC nhưng chưa có giao diện người dùng chính thức trong React.

## Sơ đồ thành phần

```text
React renderer
  ├─ Settings / Veo: kiểm tra tình trạng
  ├─ Studio: chọn provider=veo
  └─ DNA / Series / Reels: chọn provider=veo
          │
          ▼
Electron preload + IPC
          │  HTTP / SSE
          ▼
FastAPI
  ├─ deps.media_client("veo") → VeoMediaAdapter
  └─ /veo/status, /veo/generate
          │
          ▼
Veo bridge trên 127.0.0.1:60526..60535
          │                  ▲
          │ jobs CAPTCHA      │ credentials + CAPTCHA token
          ▼                  │
Chrome extension “Flows Veo” + tab labs.google đã đăng nhập
          │
          ▼
labs.google / aisandbox-pa.googleapis.com
          │
          ▼
MP4 local → Project / Kho / Reels
```

## Các điểm vào UI và backend

| Luồng | Điểm chọn Veo | Cách backend dùng Veo | Kết quả |
| --- | --- | --- | --- |
| Cài đặt | `desktop/src/renderer/pages/settings/VeoSection.tsx` | `GET /veo/status` | Báo bridge, extension và số account |
| Studio | `desktop/src/renderer/pages/Studio.tsx` | `deps.media_client(provider)` | Project nhiều cảnh, video cuối nhập kho |
| DNA/Series | `api/routers/dna.py`, `api/flows/series.py` | Cùng `VeoMediaAdapter` | Sản xuất tập từ Series-DNA |
| DNA/Reels | `api/flows/reels.py` | `VeoClient` + `ai.veo.compose.make_seconds` | Reel 8/15/24 giây và sidecar metadata |
| API độc lập | `api/routers/veo.py` | `VeoClient` trực tiếp | MP4 import thành project |

Electron có các API `veoStatus`, `veoGenerate`, `onVeoProgress` trong `desktop/src/main/preload.js`, với IPC ở `desktop/src/main/ipc/xai.js`. `veoStatus` được Settings gọi; không có usage renderer nào của `veoGenerate` hay `onVeoProgress` tại thời điểm rà soát.

## Bridge: cổng và vòng đời

### Cổng

Mã hard-code **dải mặc định**, không hard-code một cổng duy nhất:

```python
BRIDGE_PORT_BASE = 60526
BRIDGE_PORT_COUNT = 10
# 60526 → 60535
```

`ensure_started()` bind cổng trống đầu tiên. Nếu toàn bộ dải bận, nó dò xem có bridge cùng giao thức đang chạy sẵn không; nếu có, instance hiện tại trở thành client của bridge đó. Khi Windows/Hyper-V/WSL reserve dải cổng, mã hiện báo lỗi có hướng dẫn.

Biến môi trường `VEO_BRIDGE_PORTS` có thể ghi đè, ví dụ `61000-61009` hoặc `61000,61001`.

**Phát hiện sau khi đọc source extension:** extension hiện không quét dải `60526..60535`. Nó chỉ dùng **một cổng**:

```js
// Giá trị biểu thức obfuscate sau khi tính ra
let BRIDGE_PORT = 60526;
let BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
```

Popup cho phép nhập cổng khác và gửi message `SET_BRIDGE_PORT`; cổng được lưu dưới key `_vf_bridgePort` trong `chrome.storage.local`. Không thấy vòng lặp scan 10 cổng trong source đã rà soát.

Điều này tạo mismatch thực tế:

- Backend có thể tự bind `60527`, `60528`, ... nếu `60526` bận.
- Extension mặc định vẫn chỉ gọi `60526`.
- Người dùng phải tự nhập đúng cổng trong popup extension.
- Settings của app hiện không hiển thị rõ cổng thực tế, nên người dùng khó biết phải nhập số nào.

Do đó comment trong backend nói extension “quét cả dải” không đúng với extension phiên bản `1.0.2` hiện được audit.

### Vòng đời

`GET /veo/status` và `POST /veo/generate` đều gọi `ensure_started()`, nên bridge có thể khởi động lazy khi người dùng mở Settings hoặc tạo video.

Có lỗi lifecycle đáng lưu ý trong `api/app.py`: đoạn comment nói “bật bridge Veo ngay từ đầu” nhưng `ensure_started()` lại nằm trong handler `@app.on_event("shutdown")`, không phải `startup`. Kết quả là bridge không khởi động ngay lúc app boot như ý định; nó vẫn chạy do hai endpoint nêu trên gọi lazy. Nên chuyển đoạn này vào startup handler riêng.

## Giao thức app ↔ extension

Bridge là `ThreadingHTTPServer` trên loopback. Extension giao tiếp bằng HTTP JSON tới cổng đang cấu hình; nó không tự khám phá toàn dải.

| Route | Bên gọi | Mục đích |
| --- | --- | --- |
| `GET /captcha/health` | Extension | Kiểm tra cổng hiện đang cấu hình có bridge sống không |
| `GET /bridge/secret` | Extension | Lấy bridge secret để gắn `X-Bridge-Key` |
| `GET /api/v1/config/init` | Extension | Nhận cấu hình mã hoá base64: host labs.google, cookie/session target, reCAPTCHA action |
| `POST /credentials/push` | Extension | Đẩy account: email, cookie, access token, UA/client hints, expiry, tier/credit |
| `GET /captcha/request` | Extension | Poll job CAPTCHA chờ xử lý |
| `POST /captcha/response` | Extension | Trả `{request_id, token}` hoặc lỗi CAPTCHA |
| `POST /ext/heartbeat` | Extension | Giữ trạng thái extension sống |
| `GET /refresh/pending` | Extension | Nhận lệnh reload/refresh khi Veo trả 403/429 |
| `POST /captcha/busy` | Extension | Báo đang bận giải CAPTCHA, tránh lấy job khác |

Bridge xem extension còn sống trong 30 giây kể từ request cuối. Pool credential hết hạn sau 3 phút không heartbeat. Account được gộp theo email; nếu nhiều extension đẩy cùng email, slice đến sau ghi đè account cùng email.

Extension poll `/captcha/request` khoảng mỗi **800 ms**. Ngoài polling, mã có heartbeat interval tính ra **300.000 ms**; trong thực tế mỗi request poll có header `X-Ext-FP` cũng gọi `mark_alive`, vì vậy polling mới là thứ giữ trạng thái sống chính.

## Audit code extension

### Manifest và quyền truy cập

`manifest.json` khai báo:

```json
{
  "manifest_version": 3,
  "version": "1.0.2",
  "permissions": [
    "alarms", "browsingData", "cookies", "tabs", "scripting", "storage"
  ],
  "host_permissions": [
    "https://labs.google/*",
    "http://localhost/*",
    "http://127.0.0.1/*",
    "*://*.google.com/*",
    "*://*.googleapis.com/*"
  ],
  "incognito": "spanning"
}
```

Đây là bộ quyền mạnh: đọc cookies Google, inject code vào MAIN world của tab, xoá browsing data và hoạt động xuyên regular/incognito profile. Content script chỉ tự inject trên `https://labs.google/*`, nhưng background service worker có host permission rộng hơn toàn bộ `*.google.com` và `*.googleapis.com`.

### Khởi động và bắt tay bridge

Logic tương đương trong `background.js`:

```js
async function startPolling() {
  await getExtInstanceFp();      // random UUID, lưu _vf_extInstanceFp
  await restoreState();          // gồm cookie/token/cổng đã lưu
  await fetchBridgeSecret();     // GET /bridge/secret
  await syncConfigPayloads();    // GET /api/v1/config/init
  await warmUpGrecaptcha(labsTab);
  startHeartbeatTimer();

  while (polling) {
    const res = await fetch(`${BRIDGE_URL}/captcha/request`, {
      headers: {
        "X-Bridge-Key": bridgeSecret,
        "X-Ext-FP": extInstanceFp
      }
    });
    // 200: xử lý job; 204: chưa có job; 403: bắt tay lại
    await sleep(800);
  }
}
```

`fetchBridgeSecret()` lấy secret từ route public `/bridge/secret`, rồi lưu tiếp vào `chrome.storage.local` dưới key `_vf_bridgeSecret`. Nếu backend trả 403, extension xoá secret cũ, tải secret/config mới và tiếp tục polling.

### Thu hoạch account Google

`harvestSingleTab()` làm việc theo từng tab labs.google:

1. Tìm cookie `__Secure-next-auth.session-token` của domain `labs.google` trong đúng Chrome cookie store/tab profile.
2. Đọc thêm cookies cấp `.google.com`: `SAPISID`, `__Secure-1PAPISID`, `SID`, `HSID`, `SSID`, `__Secure-1PSID`, `__Secure-3PSID`, `__Secure-1PSIDTS`, `__Secure-3PSIDTS`.
3. Inject hàm vào `world: "MAIN"`, gọi `https://labs.google/fx/api/auth/session` với `credentials: "include"` để lấy email và `access_token`.
4. Gọi `oauth2.googleapis.com/tokeninfo?access_token=...` để đọc expiry.
5. Gọi endpoint credits bằng Bearer token để phân loại `FREE`/`PRO`/`ULTRA` và lấy credit.
6. Gom browser fingerprint: `navigator.userAgent`, `userAgentData.brands`, platform và mobile flag.
7. POST batch tới `/credentials/push`.

Payload tương đương:

```json
{
  "ext_fp": "<extension instance UUID>",
  "credentials": [
    {
      "email": "<Google email>",
      "cookie": "<labs session + selected Google cookies>",
      "access_token": "<OAuth bearer>",
      "expiry": 0,
      "tier": "FREE|PRO|ULTRA",
      "credit": 0,
      "tab_id": 0,
      "incognito": false,
      "user_agent": "...",
      "sec_ch_ua": "...",
      "sec_ch_ua_platform": "...",
      "sec_ch_ua_mobile": "?0"
    }
  ]
}
```

Backend chỉ giữ các field mà `bridge.py` copy vào account pool; `tab_id` và `incognito` không được backend lưu trong pool hiện tại.

### Cách extension thật sự tạo CAPTCHA token

Source xác nhận extension **không gửi CAPTCHA sang EzCaptcha/2Captcha**. Hàm bị đặt tên `processTelemetryEvent()` nhưng nhiệm vụ thật là tạo reCAPTCHA token:

```js
async function solveJob(job) {
  let tabId = await findLabsTab();
  if (!tabId) tabId = await openLabsTab();
  await warmUpGrecaptcha(tabId);

  const siteKey = job.site_key || job.recaptcha_ent_key;
  const action = job.action || config.c.da; // VIDEO_GENERATION

  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (cfg, siteKey, action) => {
      const api = window[cfg.m][cfg.s]; // window.grecaptcha.enterprise
      await new Promise(resolve => api.ready(resolve));
      return await api.execute(siteKey, { action });
    },
    args: [config.c, siteKey, action]
  });

  return result[0].result;
}
```

Với config backend hiện tại:

```json
{
  "m": "grecaptcha",
  "s": "enterprise",
  "da": "VIDEO_GENERATION"
}
```

Lệnh thực tế tương đương:

```js
await window.grecaptcha.enterprise.execute(siteKey, {
  action: "VIDEO_GENERATION"
});
```

Nếu `grecaptcha.enterprise` chưa sẵn sàng, extension thử lại job một lần sau khoảng trễ. `warmUpGrecaptcha()` kiểm tra module và có nhánh chèn `https://www.google.com/recaptcha/enterprise.js` nếu config có selector cần thiết; config backend hiện không cấp selector `q`, nên bình thường nó dựa vào script reCAPTCHA mà trang Labs đã tải.

Token hoặc lỗi sau đó được trả về:

```js
await fetch(`${BRIDGE_URL}/captcha/response`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify({
    request_id: job.request_id,
    token,
    error: error || null,
    user_agent: navigator.userAgent
  })
});
```

### Refresh, clear cache và “fresh CAPTCHA”

Khi backend gặp 403/429, `client.py` gọi `request_refresh("need_reload")`. Extension poll `/refresh/pending`, thấy `need_reload` thì:

1. POST `/captcha/busy` để bridge tạm không giao job cho instance đó.
2. Xoá dữ liệu origin `https://labs.google`: Cache Storage, IndexedDB, Local Storage, Service Workers và File Systems.
3. Reload tab với `bypassCache: true`.
4. Chờ tab load tối đa khoảng 10 giây.
5. Bỏ trạng thái busy.

Có lock khoảng 30 giây để tránh nhiều request refresh chồng nhau. Popup còn bật sẵn “Auto Clear Cache” với giá trị mặc định/khôi phục là **1 giây**, nghĩa là extension có khả năng gọi xoá site data của Labs rất thường xuyên. Đây là hành vi dễ làm tab Labs mất trạng thái, tăng tải và gây lỗi khó đoán; nên tắt mặc định và chỉ chạy khi có lỗi đã phân loại.

### Popup và content script

- Popup hiển thị account/tier/credit, token/session counters, cấu hình Auto Reload, Auto Clear Cache và một Bridge Port duy nhất.
- `SET_BRIDGE_PORT` reset secret/config/connected state, lưu cổng mới rồi bắt tay lại.
- `content.js` chủ yếu inject bảng trạng thái/nút điều khiển trên trang Labs và chuyển message tới background service worker. Không tìm thấy URL outbound literal nào trong `content.js`.
- Source `background.js`, `content.js`, `popup.js` bị obfuscate mạnh và không có source map trong gói đã xem. Điều này làm review, incident response và supply-chain verification khó hơn đáng kể.

### Kiểm tra kết nối outbound tĩnh

Các URL literal tìm được trong JavaScript extension chỉ thuộc các nhóm:

- `http://127.0.0.1:<port>`;
- `labs.google`;
- `oauth2.googleapis.com/tokeninfo`;
- `aisandbox-pa.googleapis.com/v1/credits`;
- `www.google.com/recaptcha/enterprise.js`.

Không tìm thấy domain bên thứ ba khác bằng static string scan. Đây không phải chứng minh tuyệt đối rằng không có exfiltration vì code obfuscate có thể ghép URL động; muốn kết luận chắc chắn cần deobfuscate đầy đủ và chạy extension trong môi trường giám sát network cô lập.

## Luồng chi tiết: một prompt text-to-video

1. UI hoặc flow nghiệp vụ chọn provider `veo`.
2. Backend kiểm tra có account trong bridge pool. Nếu chưa có: dừng với thông báo mở Chrome, bật extension và mở `labs.google` đã đăng nhập.
3. `VeoClient` chọn account. Luồng API độc lập lấy account đầu tiên; adapter/luồng Reels dùng round-robin trên pool.
4. Nếu account chưa có `projectId` cache, client tạo project `VeoAI` trên `labs.google/fx/api/trpc/project.createProject`. Project ID được cache theo email trong `<db-dir>/veo_projects.json`.
5. Trước khi gửi request tạo video, client gọi `bridge.solve_captcha()`.
6. Khi token CAPTCHA có mặt, client tạo payload với `projectId`, `tool=PINHOLE`, `sessionId`, batch ID và `recaptchaContext`.
7. Client gửi request trực tiếp bằng `requests` tới endpoint nội bộ của Google (`aisandbox-pa.googleapis.com`) với Bearer token, cookies, User-Agent và Client Hints mà extension đã đẩy.
8. Google trả `media.name`; client poll endpoint trạng thái mỗi 6 giây, tối đa 360 giây.
9. Khi thành công, client lấy redirect URL media rồi tải MP4 về thư mục generated.
10. Luồng gọi sau đó xử lý clip: import vào project, hoặc cắt frame/crossfade/ghép các clip.

## Luồng CAPTCHA chi tiết

Đây là phần quan trọng nhất: **backend không có solver CAPTCHA độc lập**.

```text
VeoClient._envelope()
  → bridge.solve_captcha(sitekey, "VIDEO_GENERATION", timeout=60)
      → kiểm tra extension còn heartbeat trong 30 giây
      → tạo request_id ngẫu nhiên
      → đưa job vào captcha_queue
      → chờ threading.Event tối đa 60 giây

Extension
  → poll GET /captcha/request
  ← request_id + site_key + action
  → thực thi reCAPTCHA Enterprise trong ngữ cảnh Chrome/labs.google
  → POST /captcha/response { request_id, token }

Bridge
  → gắn token vào slot captcha_pending
  → signal Event, trả token cho VeoClient

VeoClient
  → gửi token trong clientContext.recaptchaContext.token
```

Payload dùng:

```json
{
  "recaptchaContext": {
    "token": "<token do extension trả về>",
    "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"
  }
}
```

Action hard-code là `VIDEO_GENERATION`; bridge còn chứa site key reCAPTCHA Enterprise. Source extension xác nhận nó inject code vào MAIN world của tab Labs và gọi trực tiếp `window.grecaptcha.enterprise.execute(siteKey, {action})`. Static scan không tìm thấy CAPTCHA solver hoặc domain CAPTCHA bên thứ ba.

Điểm chắc chắn: `EZCAPTCHA_KEY` không dùng cho Veo. Nó chỉ xuất hiện ở flow BlogB đăng ký account. Veo dựa vào extension/browser session.

## Tạo video và các biến thể

### Text-to-video

`gen_t2v()` dùng endpoint `video:batchAsyncGenerateVideoText`, model mặc định `veo_3_1_t2v_lite_low_priority`.

### Image-to-video

`gen_i2v()` upload từng file reference vào endpoint `flow/uploadImage`, rồi gửi media IDs vào request. Model mặc định `veo_3_1_r2v_lite_low_priority`.

### Extend API độc lập

`/veo/generate` có thể gọi `gen_extend()` dùng model `veo_3_1_extension_lite`, tối đa 4 lượt extend; cuối cùng concat file bằng ffmpeg. Đây là đường riêng của endpoint độc lập.

### Nối cảnh Project

`VeoMediaAdapter` **không dùng endpoint extend**. Cảnh đầu dùng storyboard và ảnh nhân vật. Từ cảnh hai trở đi, adapter lấy frame cuối MP4 cảnh trước bằng ffmpeg, đưa frame đó đứng đầu list reference cùng ảnh nhân vật. Adapter trả `pool_size() = 1` để cảnh được render tuần tự, vì cảnh sau phụ thuộc frame cảnh trước.

### Nối Reel dài

Veo coi một clip khoảng 8 giây. `make_seconds()` chọn 1/2/3 clip tương ứng gần 8/15/24 giây, có trần 4 clip. Các clip sau dùng frame cuối clip trước, cắt khoảng 0,35 giây đầu rồi crossfade khoảng 0,4 giây. Với reel dài, LLM có thể chia prompt thành beat cho từng clip nhằm tránh mỗi clip kể lại cả câu chuyện.

## Retry, refresh và lỗi

| Tình huống | Xử lý hiện tại |
| --- | --- |
| Không extension/account | Báo lỗi trước khi tạo video |
| CAPTCHA không trả token trong 60 giây | Lỗi timeout |
| 401 từ Veo | Báo session labs.google hết hạn, yêu cầu reload tab |
| 403/429 | Gửi `need_reload` vào refresh queue rồi báo chặn tạm |
| Google content filter | `make_video()` đổi random seed và thử tối đa 3 lần |
| Poll quá 360 giây | Báo quá lâu chưa xong |
| Một đoạn Reel hỏng | Thử lại mỗi clip tối đa 3 lần |
| ffmpeg không cắt được frame | Vẫn tiếp tục với reference cũ/ảnh nhân vật, không cắt ngắn Reel |

Lưu ý: retry đổi seed để vượt qua filter là hành vi mong manh và cần được rà theo chính sách/điều khoản của nhà cung cấp trước khi dùng sản phẩm thương mại.

## Dữ liệu nhạy cảm và nơi lưu

| Dữ liệu | Nguồn | Nơi app giữ | Ghi chú |
| --- | --- | --- | --- |
| Cookie labs.google/Google | Extension | `chrome.storage.local` và pool memory của bridge | Gồm session Labs và một số cookie Google cấp cao |
| Bearer access token | Extension | `chrome.storage.local` và pool memory của bridge | Được restore rồi push lại sau khi service worker thức dậy |
| UA và Client Hints | Extension | Pool memory | Dùng để khớp browser fingerprint |
| CAPTCHA token | Extension | `captcha_pending` tạm thời | Dùng một lượt tạo request |
| Bridge secret | Backend → extension | `_vf_bridgeSecret` trong `chrome.storage.local` | Route cấp secret hiện không cần auth |
| Extension fingerprint | Extension | `_vf_extInstanceFp` trong `chrome.storage.local` | UUID định danh instance extension |
| Veo project ID | Backend | `<db-dir>/veo_projects.json` | Lưu theo email, không phải credential |
| MP4 và frame tham chiếu | Backend | `<db-dir>/generated/...` | Tùy từng Project/Reel |

Backend bridge không ghi token/cookie xuống disk, nhưng extension **có ghi** `_vf_harvestedCookie`, `_vf_harvestedToken` và expiry vào Chrome local storage trong `saveState()`. Extension còn log phần đuôi session cookie ở activity log và trả `tokenPreview` qua message `GET_STATS`. Các preview này vẫn là dữ liệu không nên xuất hiện trong log/UI. Cần xoá persistence nếu không bắt buộc, mã hoá/giới hạn TTL nếu vẫn cần, và tuyệt đối redaction log/crash dump/telemetry.

## Rủi ro bảo mật và tuân thủ

### P0 — bridge secret không thực sự bí mật

`GET /bridge/secret` không cần auth và response đặt `Access-Control-Allow-Origin: *`. Sau khi lấy secret, caller có thể gửi `X-Bridge-Key` để gọi endpoint authenticated. Các endpoint `/client/accounts` và `/token` có thể trả access token/cookie hoặc token thô.

Vì chạy localhost không đồng nghĩa không bị website truy cập: một trang mở trong browser có thể thử gọi loopback. Một số browser có Private Network Access hạn chế một phần tình huống, nhưng không thể coi đây là boundary bảo mật. Local malware/process khác cũng truy cập được.

Khuyến nghị: không expose secret qua HTTP; sinh secret tại lúc extension được pair qua một user-mediated flow; bỏ CORS wildcard; không có endpoint nào trả credentials thô; dùng capability token một chiều, scope hẹp và TTL ngắn.

### P0 — extension thu thập và lưu credential Google rộng

Source xác nhận extension đọc không chỉ session Labs mà còn nhiều cookie `.google.com`, lấy OAuth access token, sau đó lưu cookie/token trong `chrome.storage.local` và gửi chúng tới bridge. Quyền `cookies`, `scripting`, `browsingData`, host wildcard Google và `incognito: spanning` tạo blast radius lớn nếu extension hoặc bridge bị chiếm quyền. Nên thu hẹp cookie list/quyền host, không lưu credential lâu dài, tắt incognito nếu không cần và pin hash/version khi phát hành.

### P0 — mismatch cổng khiến kết nối không ổn định

Backend chọn tự động trong 10 cổng, extension chỉ dùng một cổng. Đây là lỗi contract giữa hai bên. Cần chọn một trong hai thiết kế:

1. Extension thực sự scan `60526..60535`, xác minh health/instance rồi chọn cổng; hoặc
2. Backend cố định một cổng và fail rõ ràng nếu cổng bận.

Nếu giữ multi-instance, phương án 1 phù hợp hơn, nhưng cần cơ chế pairing an toàn để extension không đẩy credential nhầm instance.

### P1 — phụ thuộc endpoint web nội bộ, không phải API ổn định

Client gọi `labs.google` và `aisandbox-pa.googleapis.com` bằng request mô phỏng browser, với model key, `x-browser-year`, `x-client-data` và payload structure hard-code. Một thay đổi nhỏ phía Google có thể làm flow dừng. Cần feature flag, health check thực, metrics lỗi theo status code và đường fallback được phép.

### P1 — lifecycle sai

Bridge được start trong `shutdown`. Chuyển sang `startup`, và chỉ khởi động khi Veo feature được bật. Status endpoint vẫn có thể đảm bảo lazy start nếu cần.

### P1 — token/session chưa có kiểm soát vận hành

Nên có: redaction bắt buộc, xoá pool ngay khi extension disconnect, TTL credential theo expiry thực tế, per-account lease để tránh hai worker dùng cùng account đồng thời, và UI báo rõ account nào đang busy/expired.

### P1 — tự động xoá Labs site data quá thường xuyên

Popup mặc định Auto Clear Cache bật và giá trị hiển thị/restore là 1 giây. Mã xoá Cache Storage, IndexedDB, Local Storage, Service Workers và File Systems của `labs.google`. Việc này có thể làm mất state, gây reload race và khiến service worker của Labs liên tục tái tạo. Nên mặc định tắt; chỉ clear có điều kiện sau lỗi xác định và dùng cooldown theo phút.

### P1 — source extension obfuscate

Ba file JavaScript chính đều obfuscate, kể cả số học constants. Không có source map hay source dễ review trong gói. Đây là rủi ro maintainability/supply-chain; nên giữ source chuẩn trong repository, build reproducible và phát hành artifact kèm SHA-256.

### P2 — watermark handling và điều khoản

`ai/veo/watermark.py` được gọi sau khi tải video. Việc loại watermark có thể trái điều khoản của nhà cung cấp hoặc gây rủi ro bản quyền/nguồn gốc nội dung. Cần tắt hoặc loại bỏ khỏi sản phẩm cho đến khi có xác nhận pháp lý/contractual rõ ràng.

## Các khoảng trống sản phẩm/kỹ thuật

1. Chưa có UI cho endpoint `/veo/generate` dù IPC/preload/type đã có. Nếu đây là chủ đích, nên xoá endpoint/UI contract chết; nếu là tính năng mong muốn, thêm form T2V/I2V, chọn ref ảnh, progress SSE và import confirmation.
2. Studio không preflight Veo trước các bước LLM/ảnh tốn thời gian. Khi extension mất kết nối, lỗi có thể chỉ xuất hiện đến lúc render scene. Nên kiểm `GET /veo/status` ngay khi chọn Veo hoặc trước khi chạy project.
3. Adapter Project buộc scene tuần tự (`pool_size=1`), dù pool nhiều account. Đây là đúng cho continuity trong một project, nhưng cần nói rõ giới hạn tốc độ.
4. Reels có xoay account nhưng chưa thấy cơ chế lease account cấp bridge; nhiều worker có thể chọn trùng account khi chạy đồng thời.
5. Status UI chỉ nói số account/kết nối. Nên hiển thị cổng thực dùng, bridge host/client mode, heartbeat age, account expiry và lý do lỗi gần nhất.
6. Contract cổng backend-extension không khớp: backend dùng dải, extension dùng một cổng cấu hình thủ công.
7. Extension lưu raw cookie/Bearer trong `chrome.storage.local`; uninstall/clear profile hoặc logic revoke chưa được cung cấp trong UI.
8. Extension có code đẩy Google Voice cookies tới `/voice/cookies`, nhưng backend hiện chỉ trả `{ok: true}` và không dùng payload. Đây là quyền/dữ liệu ngoài phạm vi Veo; nên gỡ nếu không có requirement rõ ràng.
9. Có legacy path `/token/push` trong extension nhưng bridge hiện không implement route này. Wrapper hiện đi qua batch credential, song dead code làm giao thức khó hiểu và nên được dọn.

## Kế hoạch hành động & Lộ trình điều chỉnh (Adjusted Action Plan)

Toàn bộ kế hoạch được cấu trúc lại thành 5 cột mốc chiến lược (Milestones) theo thứ tự ưu tiên từ P0 đến P2, bám sát các phát hiện kỹ thuật từ quá trình audit:

---

### Milestone 1: Khử rủi ro Extension & Viết lại mã nguồn sạch (HOÀN THÀNH 100%)
*Mục tiêu: Loại bỏ hoàn toàn mã nguồn obfuscate, độc lập hóa thương hiệu, chuẩn hóa Manifest V3.*

- [x] **Giải mã toàn diện Extension gốc**: Phân tích tĩnh AST, trích xuất bảng chuỗi, đảo ngược vòng lặp giải mã chuỗi và định danh 100% biến/hàm nghiệp vụ trong `Flows-Veo-TaoThaoAI`.
- [x] **Viết lại bản sạch `FlowsVeo-Clean`** tại `D:\GOOGLE SEARCH\tools\Extensions\FlowsVeo-Clean`:
  - `manifest.json`: Chuẩn Manifest V3, đã xử lý khử hoàn toàn ký tự ẩn BOM (`\uFEFF`), tối ưu hóa permissions.
  - `background.js`: Service worker sạch 100%, có comment tiếng Việt rõ ràng, đầy đủ 12 endpoint Bridge và 15 message types. Khôi phục watchdog 24s và semaphore lock `prepareCaptchaFresh`.
  - `content.js`: FAB button nổi (`#veoflow-fab`), hiệu ứng CSS animation float/glow, kéo thả mượt mà, keep-alive port `veoflow-keepalive` duy trì worker ổn định.
  - `popup.html` & `popup.js`: Giao diện hiện đại, System Status Card trực quan (đèn LED trạng thái Bridge, Tab, Login, reCAPTCHA, Token), các nút hành động nhanh (`Refresh Tab`, `Open Labs`, `Cookie Voice` copy 1-click, `Test Captcha`, `Check Status`, `Reload Now`).
- [x] **Thay thế nhận diện thương hiệu độc lập**:
  - Render bộ icon chuẩn đầy đủ kích thước từ file asset `D:\GOOGLE SEARCH\tools\assets\forever.png` (`16.png`, `32.png`, `48.png`, `128.png`, `logo.png` và `forever.png`).
  - Loại bỏ hoàn toàn dấu vết thương hiệu cũ, sẵn sàng đóng gói và xuất bản riêng biệt.
- [x] **Rà soát & Đối chiếu 100% Flow**: Kiểm tra tương thích contract, xử lý edge-cases multi-account, Client Hints, Voice cookies, timing watchdog.
- [x] **Xác nhận an toàn dọn dẹp**: Thư mục `Flows-Veo-TaoThaoAI` đã được đối chiếu toàn diện và an toàn để xóa bỏ khỏi workspace.

---

### Milestone 2: Khắc phục Contract Cổng & Lifecycle Backend (Ưu tiên P0 - Thực hiện ngay)
*Mục tiêu: Đảm bảo Bridge luôn khởi động đúng thời điểm và Extension tự động bắt tay thông suốt mà không cần người dùng can thiệp cấu hình thủ công.*

- [ ] **Sửa lỗi Lifecycle trong `backend/wattpad_scraper/api/app.py`**:
  - *Hiện trạng*: Lệnh gọi `ensure_started()` đang nằm nhầm trong hook `@app.on_event("shutdown")`.
  - *Hành động*: Chuyển `ensure_started()` sang hook `@app.on_event("startup")` để Bridge luôn sẵn sàng ngay khi FastAPI khởi động.
- [ ] **Khắc phục Mismatch Cổng kết nối (Port Auto-Discovery)**:
  - *Hiện trạng*: Backend có cơ chế bind dải `60526..60535`, trong khi extension chỉ mặc định gọi `60526`. Nếu cổng 60526 bị chiếm dụng bởi tiến trình khác, toàn bộ flow bị tê liệt.
  - *Hành động*:
    1. **Nâng cấp Extension `FlowsVeo-Clean/background.js`**: Thêm thuật toán Auto Port Scanner. Khi cổng hiện tại không phản hồi (timeout 1.5s), tự động quét dải `60526` đến `60535` qua endpoint `GET /captcha/health`. Khi tìm thấy Bridge hợp lệ, tự động cập nhật `BRIDGE_PORT` và lưu vào `chrome.storage.local`.
    2. **Cố định ưu tiên cổng Backend**: Cấu hình backend luôn ưu tiên giải phóng và bind đúng `60526`; chỉ nhảy cổng khi thực sự xung đột bất khả kháng.
    3. **Hiển thị thông tin cổng trên UI**: Cập nhật Settings Veo trên Electron app để hiển thị rõ: *Cổng đang chạy thực tế*, *Trạng thái Extension kết nối*, *Địa chỉ Loopback*.

---

### Milestone 3: Tinh chỉnh Bảo mật Dữ liệu & Ổn định Tab Labs (Ưu tiên P1)
*Mục tiêu: Bảo vệ thông tin đăng nhập Google, ngăn chặn xung đột xóa cache làm rớt phiên đăng nhập.*

- [ ] **Tối ưu hóa hành vi Auto Clear Cache trong Extension**:
  - *Hiện trạng*: Popup extension có toggle Auto Clear Cache với giá trị mặc định 1 giây (`chrome.browsingData.remove`), làm xóa liên tục dữ liệu trang `labs.google`.
  - *Hành động*: 
    - Đổi giá trị mặc định thành **TẮT (Disabled)** trong `background.js` và `popup.js`.
    - Khi người dùng chủ động bật, đặt giá trị tối thiểu an toàn là **30 phút** (thay vì 1 giây).
    - Chỉ thực hiện clear cache có chọn lọc khi backend gửi cờ `need_reload` do lỗi xác thực 401/403.
- [ ] **Thu hẹp phạm vi lưu trữ Credential (Credential Hardening)**:
  - *Hành động*: Do Service Worker đã có kênh keep-alive port từ content script, loại bỏ việc lưu raw Google Cookies và OAuth Access Token lâu dài trong `chrome.storage.local`. Chỉ lưu trong bộ nhớ tạm thời của tiến trình nền (in-memory state).
  - Mask/redact toàn bộ access token và cookie string (chỉ giữ 6 ký tự đầu/cuối) trong giao diện Popup và console log.
- [ ] **Củng cố Bảo mật Loopback Bridge**:
  - *Hành động*: Loại bỏ header `Access-Control-Allow-Origin: *` trên các endpoint nhạy cảm (`/client/accounts`, `/credentials/push`). Chỉ chấp nhận Origin từ `chrome-extension://*` hợp lệ hoặc loopback nội bộ để phòng chống tấn công qua trình duyệt (Private Network Access Attack).

---

### Milestone 4: Tích hợp Giao diện Studio Độc lập & Preflight Check (Ưu tiên P1)
*Mục tiêu: Đưa tính năng tạo video Veo ra giao diện người dùng trực quan, không bắt buộc phụ thuộc luồng Project Wattpad.*

- [ ] **Bổ sung Preflight Check trước khi render**:
  - *Hành động*: Thêm bước kiểm tra tiền khả thi (Preflight Verification) tại `Studio.tsx` và `Reels.tsx`: Trước khi chạy pipeline tốn kém tài nguyên, gọi `GET /veo/status` kiểm tra xem Extension có online và có tài khoản Google nào còn quota/credits hay không. Báo lỗi và dừng sớm nếu chưa sẵn sàng.
- [ ] **Xây dựng Giao diện Veo Studio Độc lập (Standalone UI)**:
  - *Hành động*: Tận dụng các IPC đã có sẵn trong Electron preload (`veoGenerate`, `onVeoProgress`):
    - Tạo trang/tab mới: **Veo Studio** trên React Frontend.
    - Cung cấp form tạo video: Nhập Prompt (Text-to-Video), Chọn ảnh tham chiếu (Image-to-Video), Mở rộng video (Extend up to 4x).
    - Hiển thị thanh tiến trình render thời gian thực qua Server-Sent Events (SSE) / IPC.
    - Trình phát video xem trước và nút tải video MP4 hoặc nhập vào kho tài nguyên chung.

---

### Milestone 5: Đóng gói Release & Chiến lược Phân phối (Ưu tiên P2)
*Mục tiêu: Chuẩn bị phân phối extension dưới dạng tiện ích độc lập.*

- [ ] **Chiến lược Phân phối 2 Kênh (Dual-Channel Distribution Strategy)**:
  - **Kênh 1: Phân phối Nội bộ / Trực tiếp (Self-Hosted / Developer Mode)**:
    - Tạo script đóng gói tự động `build-extension.ps1` nén thư mục `FlowsVeo-Clean` thành `FlowsVeo-v1.0.3.zip` và file `.crx` có chữ ký nội bộ.
    - Cung cấp hướng dẫn 1-click cài đặt cho người dùng nội bộ/khách hàng VIP (Load Unpacked hoặc Enterprise Policy).
    - Ưu điểm: Giữ nguyên 100% khả năng tự động trích xuất cookie và giải reCAPTCHA mà không bị rào cản kiểm duyệt.
  - **Kênh 2: Chuẩn bị Xuất bản Chrome Web Store (CWS Public)**:
    - Do chính sách kiểm duyệt của Google rất khắt khe đối với quyền `cookies` trên domain Google và `browsingData`:
      - Xây dựng bản dựng `FlowsVeo-Store`: Lược bỏ quyền `browsingData` diện rộng, chuyển cơ chế đăng nhập sang OAuth 2.0 Identity API hoặc nhập session token an toàn.
      - Hoàn thiện tài liệu Chính sách Quyền riêng tư (Privacy Policy) và video demo nghiệp vụ theo đúng quy chuẩn Google CWS Developer Program.

---

## Ma trận Kiểm thử & Nghiệm thu End-to-End (E2E Acceptance Criteria)

| Hạng mục kiểm thử | Điều kiện đạt (Pass Criteria) | Trạng thái |
|---|---|:---:|
| **Extension Integrity** | Manifest V3 nạp thành công trên Chrome không lỗi BOM, icon hiển thị sắc nét từ `forever.png` ở mọi kích thước. | **PASS** |
| **Status LEDs in Popup** | Đèn Bridge, Labs Tab, Google Login, reCAPTCHA, Token chuyển sang màu xanh (Ready) khi mở tab `labs.google`. | **PASS** |
| **Backend Auto-Startup** | Khởi động app/FastAPI, Bridge server tự động lắng nghe trên `127.0.0.1:60526`. | CHỜ SỬA |
| **Port Auto-Fallback** | Khi cổng 60526 bị chặn, Bridge nhảy sang 60527, Extension tự động scan và bắt tay thành công trong vòng 3 giây. | CHỜ SỬA |
| **Cookie & Token Harvest** | Extension thu hoạch chính xác email, session token và credit tier (`FREE`/`PRO`), đẩy lên Bridge qua `/credentials/push`. | **PASS** |
| **reCAPTCHA Enterprise Execution** | Nhận job từ Bridge, thực thi `grecaptcha.enterprise.execute` trong MAIN world và trả về token hợp lệ trong < 3 giây. | **PASS** |
| **Safe Cache Management** | Auto Clear Cache mặc định tắt; tab `labs.google` duy trì đăng nhập ổn định liên tục nhiều giờ không bị mất phiên. | CHỜ SỬA |
| **Video Generation Pipeline** | Chạy thử nghiệm Text-to-Video với prompt mẫu: Nhận token reCAPTCHA -> gửi tới `aisandbox-pa` -> tải MP4 hoàn chỉnh về máy. | CHỜ E2E |

---

## Thông tin Artifact chính thức: FlowsVeo-Clean

Extension chính thức đã được hoàn thiện tại thư mục:

```text
D:\GOOGLE SEARCH\tools\Extensions\FlowsVeo-Clean\
```

### Cấu trúc file & Dấu vân tay mã nguồn:

| File | Kích thước | Trạng thái mã nguồn | Chức năng chính |
|---|:---:|:---:|---|
| `manifest.json` | 1.0 KB | Clean JSON (No-BOM) | Khai báo chuẩn MV3, quyền tối ưu, kết nối background, icons |
| `background.js` | 54.0 KB | 100% Readable JS | Bộ não trung tâm: Polling captcha, thu hoạch credentials, xử lý 12 API Bridge, watchdog 24s |
| `content.js` | 6.8 KB | 100% Readable JS | Giao diện trên Labs: FAB button `#veoflow-fab`, hiệu ứng glow, keep-alive port 25s duy trì worker |
| `popup.html` | 14.4 KB | Clean HTML/CSS | Giao diện người dùng: System Status Card (5 đèn LED), danh sách tài khoản, điều khiển automation |
| `popup.js` | 12.8 KB | 100% Readable JS | Điều khiển popup: `checkAll()`, `refreshAccountsOnOpen()`, copy Cookie Voice 1-click, test token |
| `icons/` | 5 files | PNG Icons | `16.png`, `32.png`, `48.png`, `128.png`, `logo.png` (render sắc nét từ asset `forever.png`) |

### Hướng dẫn cài đặt & vận hành:
1. Mở trình duyệt Google Chrome, truy cập `chrome://extensions/`.
2. Bật chế độ **Developer mode** ở góc trên bên phải.
3. Bấm **Load unpacked** và chọn thư mục: `D:\GOOGLE SEARCH\tools\Extensions\FlowsVeo-Clean`.
4. Mở tab mới truy cập `https://labs.google/fx/tools/flow` và đăng nhập tài khoản Google.
5. Mở Popup tiện ích trên thanh công cụ Chrome: Các đèn trạng thái (Bridge, Tabs, Login, reCAPTCHA, Token) sẽ tự động sáng xanh, báo hiệu hệ thống đã sẵn sàng cho luồng tạo video Veo.

