# Dành cho dev mới: đọc gì, hiểu gì, làm gì trước

> **Hiện hành**, đối chiếu code ngày 2026-11-12. Cài đặt môi trường và các lệnh nằm ở [README gốc](../README.md); file này là **bản đồ để định hướng** trong code và cách làm việc đúng với dự án. Mục lục mọi tài liệu: [README.md](README.md).

## 1. Mô hình tư duy (đọc 2 phút)

- App desktop Windows. **Electron** chứa giao diện **React**; giao diện gọi **Backend FastAPI** chạy cục bộ ở `127.0.0.1:8000` bằng `fetch`. Không có đăng nhập người dùng, mọi thứ là loopback (CORS mở `*`).
- Backend gọi các **dịch vụ thật** mà không có API chính thức: Google Flow (qua extension Chrome), Gemini web và ChatGPT web (qua cookie/Chrome profile), Meta Muse (qua CDP), Pippit (HTTP reverse-engineered). Đây là lý do code có nhiều thứ "phòng thủ": cookie hết hạn, định dạng đổi, **credit thật bị trừ**.
- Một dịch vụ riêng, **voice-service** (VieNeu-TTS, venv riêng bằng `uv`), chạy ở cổng 8001; trình duyệt không bao giờ gọi nó trực tiếp.
- **Hai quy tắc sống còn:** (1) việc tốn credit **không được tự gửi lại** (xem [flow-integration.md](flow-integration.md) mục 6); (2) mọi file ghi lúc chạy phải đúng thư mục ở cả dev lẫn bản cài ([data-and-paths.md](data-and-paths.md)).

## 2. Ngày đầu tiên (checklist)

1. Làm theo mục 3–5 của [README gốc](../README.md); chạy `npm start` ở gốc repo.
2. Kiểm tra sống: `http://127.0.0.1:8000/api/ping` (Backend), `http://127.0.0.1:8001/health` (voice; lần đầu tải model nên chậm), `http://127.0.0.1:8000/docs` (Swagger toàn bộ API).
3. Chạy test để chắc môi trường đúng: `python -m pytest tests` (trong `Backend/`, ~2,5 phút), `npm run typecheck` và `npm run test:all` (trong `Frontend/`).
4. Mở app → **Cài đặt**, kết nối thứ bạn cần ([README gốc](../README.md) mục 6). Muốn chạy thử Flow thì nạp extension và đăng nhập tab Flow.
5. Đọc theo thứ tự ở mục 3, **chỉ phần liên quan** tới việc bạn sắp làm.

> Mẹo an toàn: bản dev dùng **dữ liệu thật** ở `Backend/Data/` (DB, cookie, video). Sao lưu trước khi thử thứ có thể ghi đè; đừng chạy test thủ công `manual_test_*.py` nếu không hiểu chúng gọi gì.

## 3. Thứ tự đọc

| Bạn sắp làm | Đọc |
|---|---|
| Bất cứ việc gì | file này → [data-and-paths.md](data-and-paths.md) → [modules.md](modules.md) (tìm module của bạn) |
| Tạo video, Flow, extension, Motion | [flow-integration.md](flow-integration.md) → [Extensions/FlowsVeo-Clean/docs/](../Extensions/FlowsVeo-Clean/docs/) → [PLAN_flow_http_submit.md](PLAN_flow_http_submit.md) |
| Chiến dịch AI | [campaign-engine.md](campaign-engine.md) → [PLAN_campaign_v24…](PLAN_campaign_v24_storyboard_ingredients.md) |
| Recap / Audio | [recap.md](recap.md) → [PLAN_audio_story_studio.md](PLAN_audio_story_studio.md) |
| Giọng đọc | [services/voice-service/README.md](../services/voice-service/README.md) |
| Đóng gói, phát hành | mục 9 của [README gốc](../README.md) |
| Cẩm nang người dùng trong app | [PLAN_help_redesign.md](PLAN_help_redesign.md) |

## 4. Cách code được tổ chức

### Backend (`Backend/app/`)
- `main.py` mount **một router mỗi package**; `lifespan` khởi động Veo bridge và gọi các `ensure_*_table(s)` (lỗi ở đây bị **nuốt**: nếu bảng "không có", xem log).
- Mỗi package: `router.py` (HTTP, mỏng) → `service.py` (nghiệp vụ) (+ `schemas.py` Pydantic, `models.py` SQLAlchemy). Prefix API thường là `/api/<package>`.
- `core/config.py` (`TOOLS_DIR`, `DATA_DIR`, `settings`), `core/database.py` (engine SQLite, **WAL**, `get_db`), `core/storage.py` (`read_config`/`write_config` → `config.json`).
- Cấu hình người dùng (cookie, tài khoản, OAuth) nằm trong **`config.json`**, không phải DB.

### Ba kiểu "job nền" bạn sẽ gặp
| Kiểu | Ví dụ | Lưu trạng thái | Sống sót qua restart? |
|---|---|---|---|
| Thread + dict trong bộ nhớ, frontend **poll** | Veo (`veo/service.py`), Recap (asyncio + `state._JOBS`) | bộ nhớ + file JSON/`job.json` | Một phần: job đang chạy bị đánh dấu "bị gián đoạn", có nút thử lại |
| Engine có sổ trong DB | Chiến dịch AI | SQLite (`campaign_runs`…) | Có; run đang dở thành `unknown`/`error` khi khởi động |
| Job ghi file JSON | Watermark (`watermark/jobs.json`), Motion dài (`job.json`) | file | Có |

Khi thêm tính năng chạy lâu: chọn một trong ba kiểu trên cho nhất quán, trả `202 + job_id`, và để frontend poll. **Đừng** giữ request HTTP mở hàng phút.

### Frontend (`Frontend/src/`)
- `App.tsx` là router sidebar thủ công: biến `activePage` (chuỗi nhãn trang) quyết định component nào hiện (lazy import). Không dùng react-router.
- `shared/navModel.ts` là **nguồn duy nhất** của danh sách trang và nhóm; `shared/constants.ts` gắn icon và `API_URL`.
- `features/<trang>/` chứa mọi thứ của trang; gọi API bằng `fetch(`${API_URL}/api/...`)` trong `services/*Api.ts`. Lỗi mạng chuyển thành thông báo dễ hiểu bằng `toApiError` (`shared/apiError.ts`); lỗi backend trả `{ "detail": "..." }`.
- Logic không phụ thuộc React đặt trong module `.ts` thuần để test được bằng `node:test` (xem mục 6).
- Electron: `electron/main.ts` (spawn backend/voice ở bản đóng gói, auto-update), `electron/preload.ts` (API `window.desktop`: chọn thư mục, lưu file, cập nhật app).

## 5. Công thức thường gặp

**Thêm một endpoint/package backend**
1. Tạo `app/<pkg>/{router.py,schemas.py,service.py}`, `router = APIRouter(prefix="/api/<pkg>", tags=[...])`.
2. `app.include_router(...)` trong `app/main.py`.
3. Lỗi nghiệp vụ → `HTTPException(status_code=..., detail="tiếng Việt, hành động được")`. Việc nặng/chặn → `run_in_threadpool` hoặc thread; không chặn event loop.
4. Test trong `Backend/tests/<pkg>/` (pytest). Không gọi dịch vụ thật.

**Thêm một bảng SQLite**
1. Model kế thừa `Base` (`from app.db import Base`).
2. Hàm `ensure_<x>_table()` gọi `Base.metadata.create_all(bind=engine, tables=[...])`, và **gọi nó trong `lifespan`** ở `main.py` (một số router cũ dùng `@router.on_event("startup")`; đừng nhân rộng kiểu đó).
3. Không cần Alembic (chỉ có 0001–0006, hầu hết bảng không qua Alembic). Đổi cột bảng đã phát hành phải tự xử lý dữ liệu người dùng cũ.

**Thêm một trang vào sidebar**
1. `shared/navModel.ts`: thêm `{ label: '...' }` vào nhóm phù hợp (`PageId` được suy ra từ đây).
2. `shared/constants.ts`: thêm icon vào `NAV_ICONS` (kiểu `Record<PageId, …>` nên **typecheck sẽ lỗi nếu quên**).
3. `App.tsx`: lazy import component và thêm nhánh `activePage === '...'`.
4. `features/help/`: thêm doc và đăng ký ở `registry.ts` (`HELP_DOCS` là `Record<PageId, HelpDoc>` nên thiếu là typecheck lỗi; test `help.test.ts` còn yêu cầu có `verifiedAt` và không nhắc từ khóa đã bỏ).
5. Cập nhật [modules.md](modules.md) và bảng sidebar ở mục 1 của README gốc.

**Thêm/đổi prompt**
- Chiến dịch AI: file ở `app/campaign/prompt_defaults/`, đăng ký trong `SYSTEM_TEMPLATES`, **tăng `version`** ([campaign-engine.md](campaign-engine.md)).
- Prompt khác: `Backend/prompts/...` (Recap, Discover, Workflow). Lưu ý đường dẫn trong bản đóng gói ([data-and-paths.md §3](data-and-paths.md)).

**Thêm model/chế độ Flow mới**: cần HAR, cập nhật hai hàm eligibility cùng lúc, test; đọc [flow-integration.md](flow-integration.md) mục 5.

## 6. Kiểm thử và chất lượng

| Phần | Lệnh | Ghi chú |
|---|---|---|
| Backend | `python -m pytest tests` (trong `Backend/`) | ~560 test; không gọi dịch vụ thật; `manual_test_*.py` **không** tự động |
| Frontend | `npm run typecheck` (đây là "lint" duy nhất); `npm run test:all` (tất cả) hoặc từng nhóm `npm test`, `test:campaign|studio|video|audio|discover|voices|veo|help` | `node:test` + `--experimental-strip-types` |
| Voice | `uv run python -m unittest discover -s tests` | trong `services/voice-service/` |
| Extension | `npm test`, `npm run verify` | trong `Extensions/FlowsVeo-Clean/` |
| Launcher | `npm test --prefix Desktop` | |

Quy tắc cho module frontend được test: **TS thuần** (không React/DOM, không path alias) và **import tương đối phải có đuôi `.ts`** (Node strip-types không tự thêm). `tsc` không bắt lỗi này; test sẽ đỏ.

CI (`.github/workflows/release.yml`) chạy: `unittest` watermark, test voice-service, `typecheck`, `test:all`, `npm run verify:ci` extension (không có smoke trình duyệt, xem README gốc mục 9), và smoke test bản đóng gói (voice, watermark). Các job chạy song song (xem [README gốc](../README.md) mục 9). **Chỉ chạy khi tag `v*` hoặc chạy tay**; không có CI cho mỗi PR và **không chạy pytest của Backend**, nên **tự chạy test trước khi merge**.

## 7. Tìm lỗi

| Cần | Cách |
|---|---|
| Log backend | Cửa sổ chạy `npm start` (tiền tố `[BACKEND]`); lỗi ở bước khởi tạo bảng bị nuốt nhưng có log |
| Xem DB | `Backend/Data/app.db` bằng bất kỳ công cụ SQLite nào (đang ở chế độ WAL; đóng ứng dụng hoặc mở chỉ-đọc) |
| Trạng thái Flow | `GET /api/veo/status`, `GET /api/veo/jobs` |
| Trạng thái Recap | `GET /api/recap/jobs/{id}` và `Backend/Data/Downloads/<id>/timings.json` |
| Trạng thái Chiến dịch | `GET /api/campaigns/{id}` (state đầy đủ), `/runs` |
| Voice | `GET :8001/health`, `GET /api/voices/health` |
| API nào gọi API nào | Mở DevTools của Electron (Network) hoặc xem `Frontend/src/features/<trang>/services/` |

## 8. Việc tồn đọng đã biết (nên dọn)

Cập nhật khi xử lý xong.

1. **Đường dẫn dữ liệu không thống nhất giữa dev và bản đóng gói** (5 cách tính khác nhau), kèm 3 nghi vấn lỗi ở bản cài: prompt Recap/Discover/Workflow, dữ liệu Veo ghi vào thư mục tạm, workflow và veo nhìn hai thư mục. Cần kiểm chứng bằng bản cài hiện tại. Chi tiết: [data-and-paths.md](data-and-paths.md).
2. `Backend/.env.example` lỗi thời: `WORKFLOW_DEFAULT_VEO_MODEL=Omni 1.1 Flash` (code mặc định `Omni 1.2 Flash`) và `DATABASE_URL` là đường dẫn tuyệt đối của một máy.
3. Nhãn tab Cài đặt → Google Veo ghi "Tạo video AI (Veo 2 & 3)" trong khi app chỉ dùng Omni 1.2 (`features/settings/SettingsPage.tsx`).
4. `VeoSection.tsx` hiển thị cổng bridge dự phòng `56526`, trong khi cổng mặc định là `60526`.
5. `features/studio/pollState.test.ts` và `timing.test.ts` chưa có script npm nào chạy (thêm `test:studio`).
6. Bốn bước của Chiến dịch AI khai báo nhưng chưa có executor: `look_check`, `clip_check`, `compliance`, `export_pack` ([campaign-engine.md §3](campaign-engine.md)).
7. ~~`run_server.py` bật `reload=True`~~ (đã sửa ở v2.1.0): lỗi này làm backend trong bản đóng gói sinh reloader vô hạn và không bao giờ phục vụ; CI smoke test đã bắt được. Nay reload mặc định tắt, chỉ bật khi đặt `BACKEND_RELOAD=1`.
8. Không có CI chạy test ở mỗi PR, và CI không chạy `pytest` của Backend (~560 test).
9. Bảo mật bridge (`/bridge/secret` không xác thực, CORS rộng, extension lưu token/cookie) và `OAUTHLIB_IGNORE_TLS=1` trong code OAuth chưa được xử lý.
