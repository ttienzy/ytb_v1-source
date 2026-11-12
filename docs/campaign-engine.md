# Chiến dịch AI: engine (`Backend/app/campaign/`)

> **Hiện hành**, đối chiếu code ngày 2026-11-12. Đây là tài liệu nên đọc đầu tiên trước khi sửa trang *Chiến dịch AI*. Lịch sử thiết kế và lý do từng quyết định: [PLAN_ai_workflow_campaign.md](PLAN_ai_workflow_campaign.md), [PLAN_campaign_v24_storyboard_ingredients.md](PLAN_campaign_v24_storyboard_ingredients.md), [archive/](archive/).

## 1. Chiến dịch AI là gì

Người dùng đưa ảnh áo thật → app tạo video quảng cáo ngắn đúng áo thật: hồ sơ áo → người mẫu → ảnh mẫu mặc áo → kế hoạch shot → storyboard → clip Flow → giọng đọc → ghép → gói xuất.

Nó khác Canvas AI (`app/workflow/`, cũ hơn, vẫn đang chạy song song) ở chỗ: kết quả mỗi bước là **artifact bất biến**, và "cũ/mới" được **tính** từ dữ liệu chứ không lưu cờ. Sửa một chỗ không làm mất thứ đã render (vốn tốn credit).

## 2. Ba khái niệm phải hiểu

### 2.1 Step, artifact, fingerprint
- **Step (bước)** khai báo trong [`graph.py`](../Backend/app/campaign/graph.py) bằng `StepDef`. `STEPS` luôn sắp theo thứ tự tô-pô và được **kiểm tra lúc import** (`_validate`): thêm bước sai thứ tự là app không khởi động.
- **Artifact** (`store.py`, bảng `campaign_artifacts`) là kết quả của một lần chạy: JSON, ảnh hoặc video, **không bao giờ sửa/xóa**. Lưu file ở `DATA_DIR/campaigns/<id>/` theo hash nội dung.
- **Fingerprint** (`fingerprint.py`) là `sha256` của JSON chuẩn hóa gồm: loại bước, `logic` (phiên bản logic), tham số liên quan (`param_keys`), danh sách artifact đầu vào, prompt cuối, `tier`. Cùng fingerprint đã có artifact → dùng lại, **0 credit**.

### 2.2 Trạng thái được tính, không lưu
`Engine.state_of()` (`engine.py`) so fingerprint hiện tại với fingerprint của artifact đang chọn:

| `state` | Nghĩa |
|---|---|
| `fresh` | Đang chọn artifact đúng với đầu vào hiện tại |
| `stale` | Đầu vào đổi sau khi tạo (kèm lý do, ví dụ `params.duration`, `inputs.fact_sheet`) |
| `missing` | Chưa có artifact |
| `blocked` | Thiếu đầu vào ở bước trước |
| `pinned` | Người dùng ghim: đóng băng, không đề nghị chạy lại |

Đổi đầu vào **không xóa gì**; chỉ con trỏ "đang chọn" đổi khi chạy lại. Nhờ vậy sửa lời thoại không làm mất clip đã render.

### 2.3 Cổng duyệt (gate) và bước map
- **`gate=True`** (`look`, `anchor_frame`, `storyboard`, `clip`): bước sau chỉ dùng artifact **đã duyệt** (`campaign_gates`, `approved|rejected`, kèm `note` đưa vào prompt lần chạy lại). Upstream đổi thì cổng thành "cần duyệt lại", không hủy phần đã làm.
- **`map_from="shot_plan"`** (`storyboard`, `clip`, `clip_check`): bước chạy **một lần mỗi phần tử** (`element_key = shot:<n>`). `item_fields` quy định trường nào của shot vào fingerprint; ví dụ sửa lời thoại không làm `storyboard`/`clip` thành stale vì chúng không dùng trường đó.

## 3. Pipeline hiện tại (19 bước, 8 khối)

Sự thật cuối cùng là `graph.py`. Tóm tắt:

| Khối | Bước (`key`) | Làn | Ghi chú |
|---|---|---|---|
| 1 Sản phẩm | `garment_source` (ảnh), `fact_sheet` | llm | Gemini trích hồ sơ áo từ ảnh thật |
| 2 Người mẫu | `cast`, `style` | – | Thư viện nhân vật; `style.master_scene` là **một** bối cảnh chung |
| 3 Kế hoạch | `brief`, `angle`, `hook`, `shot_plan`, `script` | llm | `shot_plan` thấy ảnh mẫu đã duyệt + hook đã chọn; đề xuất số shot, `board_type`, 3–15 s, `panels` |
| 4 Ảnh mẫu | `look` ✋, `look_check`, `anchor_frame` ✋ | chatgpt-image / llm | `anchor_frame` = **một** ảnh chốt mặt, áo, nơi quay, ánh sáng cho cả chiến dịch |
| 5 Storyboard | `storyboard` ✋ (map) | chatgpt-image | Mỗi shot **một** ảnh ChatGPT gồm 2–4 khung (≤5 s: 2, ≤10 s: 3, >10 s: 4) |
| 6 Clip | `clip` ✋💳 (map) | **flow** | Flow Omni 1.2 **Ingredients**: tham chiếu khung mẫu + storyboard + ảnh áo thật; `panels` thành các dòng `[0-3s]…` |
| 7 Kiểm tra | `clip_check`, `compliance` | llm / local | `advisory`: chỉ cảnh báo |
| 8 Ghép & xuất | `voice`, `assemble`, `export_pack` | local | `voice` và `assemble` là `isolated` |

✋ = có cổng duyệt, 💳 = tốn credit Flow.

**Bước khai báo nhưng chưa có executor**: `look_check`, `clip_check`, `compliance`, `export_pack` không được `register_all()` đăng ký (`executors/__init__.py`). Chạy chúng sẽ ra lỗi "Chưa có executor cho bước…". Việc xuất gói đi qua `exports.py` và các endpoint `/exports` (không qua runner). Nếu bạn làm các bước này, thêm executor ở đó.

## 4. Chạy một bước: luồng từ UI tới Flow

```
UI  POST /api/campaigns/{id}/run  { target, tier, only_approved, confirm_credit, elements }
 └─ service.run ─► runner.execute
      1. engine.plan()  → dry-run: bước nào chạy / cached / chờ duyệt / bị chặn, credit
      2. plan.runnable == 0           → không làm gì
         plan.over_budget             → 409 {error: "over_budget"}
         plan.needs_confirm & !confirm_credit → 409 {error: "confirm_required"}  (UI hỏi người dùng)
         đang có exec chạy cho chiến dịch → AlreadyRunning
      3. tạo thread "campaign-exec-<id>" → _coordinate → các thread pool theo làn
      4. mỗi (bước, phần tử): _run_one
           - tính lại state; chỉ chạy nếu missing|stale, không bị chặn, không chờ duyệt
           - cùng fingerprint đang chạy → GIA NHẬP việc đó, không chạy lại (_inflight)
           - ghi Run(running) → gọi executor(ctx) → _store_result (artifact + chọn làm đầu ra)
```

- **Tier**: `draft` (Flow 360p) và `final` (720p) nằm trong fingerprint của bước `uses_tier`.
- **Làn tài nguyên** (`LANE_LIMITS`): `llm` 2, `chatgpt-image` 2, `flow` 3, `local` 2: mỗi làn một `ThreadPoolExecutor`.
- **Hủy**: `POST /{id}/cancel` đặt cờ; executor kiểm `ctx.cancelled()`.
- **Bước `isolated`** (`voice`, `assemble`): chỉ chạy chính nó trên kết quả **đã có/đã duyệt**, không bao giờ kéo `clip` (tốn credit) chạy lại dù clip bị đánh dấu stale. `needed_for()` trong `graph.py` thể hiện điều này.
- **`unknown`**: nếu một bước `paid` ném `SubmittedUnknown` (đã gửi mà mất kết nối), run chuyển `unknown`, **không retry**. Khi backend khởi động lại, `runner.recover()` đổi mọi run đang dở: bước `paid` → `unknown` ("có thể ĐÃ gửi lên Flow"), còn lại → `error`. Người dùng kiểm tra bên Flow rồi gọi `POST /runs/{id}/resolve` với `outcome=not_sent` để cho phép chạy lại.
- Mọi lỗi executor chỉ ghi vào sổ (`campaign_runs.error`), **không có retry tự động**.

### Giá credit
`graph.py`: `FLOW_CREDIT_R2V` chỉ chứa **điểm đã đo thật** (13 s 720p = 48, 15 s 360p = 20). `clip_cost` trả `None` cho điểm chưa đo ("chưa rõ giá", không đoán); `clip_cost_estimate` là **công thức có nhãn** (720p 3 cr/s, 360p 1 cr/s tới 10 s, gấp đôi từ giây 11) chỉ để hiển thị và tính trần ngân sách. Thêm điểm đo mới thì thêm vào bảng, đừng sửa công thức cho khớp.

## 5. Dữ liệu (SQLite, tạo bằng `ensure_campaign_tables` ở `lifespan`)

| Bảng | Vai trò |
|---|---|
| `campaigns` | Một chiến dịch = một sản phẩm |
| `campaign_steps` | Tham số người dùng chỉnh + artifact đang chọn + cờ ghim, theo `(step_key, element_key)` |
| `campaign_artifacts` | Artifact bất biến + provenance (prompt, model, tham số, credit) |
| `campaign_runs` | Sổ chạy: `state` (`queued/running/done/cached/error/cancelled/unknown`), `attempt`, `credit_est/actual`, `external_ref` (id job Flow) |
| `campaign_gates` | Cổng duyệt gắn artifact cụ thể |
| `campaign_prompt_templates` | Mẫu prompt **do người dùng sửa**, mỗi lần sửa một dòng version mới |
| `campaign_cast_library` | Thư viện nhân vật dùng lại |

Mẫu prompt hệ thống nằm trong **file** `app/campaign/prompt_defaults/*.txt`, đăng ký ở `prompts.py` (`SYSTEM_TEMPLATES`, mỗi mẫu có `version`; **tăng `version` khi đổi nội dung file**). File phải nằm trong `datas` của `backend.spec` (đã có). Prompt cuối cùng xem trước được (`/steps/{key}/prompt-preview`) và là một phần của fingerprint.

## 6. API (`/api/campaigns`, `router.py`)

Nhóm chính: `GET/POST ""`, `GET/PATCH/DELETE /{id}`; `PUT /{id}/steps/{key}/params`; `POST /{id}/steps/{key}/input|select|pin|unpin|reroll|suggest|prompt-preview`; `PUT /{id}/steps/{key}/artifact` (sửa tay JSON); `POST /{id}/gates/{key}/approve|reject`; `POST /{id}/plan`, `/run`, `/cancel`; `GET /{id}/runs`, `POST /runs/{id}/resolve`; `GET /{id}/artifacts`, `GET /artifacts/{id}/file`; `/exports`; `/prompts*`; `/cast-library*`. Swagger ở `http://127.0.0.1:8000/docs`.

## 7. Giao diện (`Frontend/src/features/campaign/`)

| Thành phần | Vai trò |
|---|---|
| `CampaignPage.tsx`, `hooks/useCampaign.ts` | Trang và hook polling trạng thái |
| `services/campaignApi.ts`, `services/campaignView.ts` | Gọi API; hàm thuần dựng view (có test `__tests__/campaignView.test.ts`) |
| `components/BlockMap.tsx`, `StepList.tsx` | Sơ đồ 8 khối, huy hiệu trạng thái, credit |
| `components/*Panel.tsx` | Một panel cho mỗi khối (Fact sheet, Look, Anchor, Storyboard, Clip, Assemble…) |
| `components/PromptEditor.tsx`, `RunsPanel.tsx` | Xem/sửa prompt, sổ chạy và xử lý `unknown` |

Test frontend: `npm run test:campaign`. Test backend: `python -m pytest tests/campaign` (không gọi AI/Flow thật: executor giả, SQLite tạm).

## 8. Cách thêm hoặc sửa một bước

1. **Khai báo** `StepDef` trong `graph.py`, đặt đúng vị trí tô-pô; chọn `lane`, `gate`, `paid`, `param_keys`, `item_fields`, `isolated`. Nếu đổi logic bước đã có, **tăng `logic`** để vô hiệu cache cũ.
2. **Executor** `executors/<tên>.py` (`run_<tên>(ctx) -> ExecResult`), đăng ký trong `register_all()`. Nếu có prompt: thêm file vào `prompt_defaults/`, mục vào `SYSTEM_TEMPLATES`, và hàm `build_request` vào `PREVIEWERS` để xem trước dùng đúng code với lúc chạy.
3. **Test** trong `Backend/tests/campaign/` với executor giả (xem `conftest.py`): cover fingerprint đổi khi nào, gate, stale.
4. **UI**: panel trong `components/` + dòng trong `BlockMap/StepList`. Quy ước dự án: mỗi giai đoạn mới **phải có giao diện bấm thử được và e2e Playwright** (hiện repo chưa có bộ e2e Playwright được commit cho phần này; trong tài liệu cũ nó chạy trên backend cô lập).
5. Bước tốn credit: **không retry tự động**, khai báo `cost`, xử lý `SubmittedUnknown`, và đi qua [flow-integration.md](flow-integration.md).

## 9. Bẫy đã gặp

- Restart backend khi đang có run: bước `paid` thành `unknown` (xem mục 4). Dùng `npm run start:stable` khi chạy thật.
- Ghép chữ lên video (`executors/assemble.py`): `drawtext` dùng đường dẫn **tương đối** và `cwd` = thư mục tạm, luôn truyền font (`app/media/fonts.py`); `clean_caption` bỏ mũi tên kiểu `->` vì font không có glyph. Xem quy tắc ffmpeg ở mục 10 của [README gốc](../README.md).
- Sửa prompt hệ thống mà không tăng `version` thì người dùng đã sửa/lưu bản cũ không thấy thay đổi.
