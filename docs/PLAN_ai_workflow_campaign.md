# Kế hoạch triển khai AI Workflow v2 ("Chiến dịch" quảng cáo thời trang)

Ngày: 2026-11-09. Trạng thái: **kế hoạch, chưa có code**. Đi kèm [AI_WORKFLOW_FASHION_DESIGN.md](AI_WORKFLOW_FASHION_DESIGN.md) (kiến trúc đầy đủ ~25 node) và sơ đồ 8 khối (artifact "Sơ đồ AI Workflow").

Cách đọc: mục 1–3 là **bối cảnh và quyết định chung**; mục 4 là **danh sách giai đoạn** (mỗi giai đoạn nhỏ, tự chạy và kiểm được); mục 5–7 là rủi ro, thứ tự, bảng theo dõi.

---

## 1. Mục tiêu và phạm vi

**Mục tiêu:** người dùng đưa ảnh sản phẩm (áo quần) → ra video quảng cáo ngắn đúng áo thật, sửa một khâu không mất công các khâu khác, biết trước tốn bao nhiêu credit.

**Giải quyết 4 lỗi của bản hiện tại** (đọc từ code, xem `docs/AI_WORKFLOW_FASHION_DESIGN.md` §1):

| Lỗi hiện tại | Nơi trong code | Cách v2 xử lý |
|---|---|---|
| Sửa nhỏ xóa clip đã render (tốn credit) | `workflowState.ts` (`clearSceneOutput`, `invalidateNode`, `reconcileWorkflowNodes`) | Artifact bất biến + vân tay; đổi đầu vào chỉ gắn "cũ" |
| Clip nối chuỗi frame cuối → frame đầu, hỏng một kéo theo cả dây | `invalidateSceneChain` | Mỗi clip neo vào keyframe đã duyệt, độc lập nhau |
| Đồ thị không được lưu (đổi trang là mất) | `useWorkflowState.ts` chỉ giữ trong bộ nhớ | Lưu bền vào SQLite, tự lưu |
| Không có ước tính credit, không có bước kiểm tra áo | — | Dry-run + Budget; Fidelity/Clip Check |

**Ngoài phạm vi (làm sau):** Performance Log, nhập hàng loạt CSV/URL, đồ gia dụng, tự đăng lên nền tảng.

## 2. Quyết định kiến trúc chung (đề xuất, cần bạn gật)

1. **Xây module mới cạnh module cũ, không sửa tại chỗ.** Backend `Backend/app/campaign/`, frontend `Frontend/src/features/campaign/`, route riêng. Lý do: `WorkflowPage.tsx` dài 2163 dòng và `service.py` 2227 dòng đang chạy được; sửa tại chỗ dễ làm hỏng luồng đang dùng. Workflow cũ giữ nguyên đến giai đoạn 10, rồi mới gỡ.
2. **UI hiển thị 8 khối, engine chạy đồ thị bước nhỏ.** Mỗi khối gồm vài bước (xem bảng 3.1). Người dùng thấy 8 khối; engine vẫn theo dõi vân tay và trạng thái từng bước.
3. **Lưu bền bằng SQLite** theo mẫu đang dùng (`Backend/app/veo/models.py`: model SQLAlchemy kế thừa `Base`, `create_all` theo bảng khi router khởi tạo). File ảnh/video nằm dưới `DATA_DIR / "campaigns" / <id> /` (`DATA_DIR` lấy từ `app.core.config`, đúng quy ước thư mục dữ liệu hiện có).
4. **Trạng thái "cũ" được tính, không lưu.** So vân tay hiện tại của bước với vân tay đã dùng để tạo artifact đang chọn. Không có cờ để lệch.
5. **Một đường chạy duy nhất, có hàng đợi và hủy.** Không còn "mỗi node tự gọi API riêng".
6. **Giữ nguyên ràng buộc nghiệp vụ Flow:** không tự gửi lại lệnh tạo video; tối đa 3 ảnh Ingredients; 1 kịch bản = 1 clip; chỉ commit khi bạn yêu cầu.
7. **Prompt là công dân hạng nhất** (bạn yêu cầu 2026-11-09): mọi bước gọi AI (ảnh, video, LLM) có **prompt mặc định đi kèm** và cho người dùng **tự viết/sửa**; prompt cuối cùng xem trước được trước khi chạy và là một phần của vân tay. Chi tiết ở mục 3.6.
8. **Tái dùng, không viết lại:** Gemini phân tích (`workflow/service.py: execute_gemini_analysis`), LLM chat (`ai/chatgpt/service.py: chat_completion`), tạo ảnh ChatGPT có ảnh tham chiếu (`ai/image_gen/gptimage/adapter.py: GptImageClient.generate(prompt, dest, ref_paths, aspect)`), tạo video Flow (`veo/service.py`, đã có đường HTTP cho Omni 1.2 t2v), voice/BGM/ghép video của workflow cũ (`concat_workflow_scenes`, `generate_voiceover_batch`).

### 2.1 Quy ước: mỗi giai đoạn có một màn hình để bạn tự bấm thử (bạn yêu cầu 2026-11-09)

Một giai đoạn chỉ coi là xong khi: (a) test tự động xanh, (b) **có giao diện trong trang "Chiến dịch AI"** để bạn tự thử từng bước bằng dữ liệu thật, (c) tôi đã chạy một kịch bản e2e trong trình duyệt thật (Playwright) trên backend cô lập, kèm ảnh chụp màn hình. Các khối chưa làm hiện nhãn "Sắp có (GĐx)" trên sơ đồ 8 khối thay vì giả vờ chạy.

| GĐ | Màn hình bạn thử được |
|---|---|
| 1–2 (đã có) | Trang "Chiến dịch AI": tạo/xóa chiến dịch, sơ đồ 8 khối với huy hiệu trạng thái, trần credit, sổ chạy |
| 3 (đã có) | Khối 1: hồ sơ áo do Gemini trích, sửa tay, điểm rủi ro, prompt sửa được. Khối 2: thư viện nhân vật + form phong cách |
| 4 | Khối 4: prompt (xem/sửa/nhân bản), tạo look sheet, chọn ứng viên, duyệt/từ chối (**đã có bản đầu**) |
| 5 (đã có) | Khối 3: brief, góc kể, hook, danh sách shot sửa được từng shot, lời thoại + cảnh báo lời chứng giả |
| 6 (đã có) | Khối 5: dải keyframe theo từng shot, duyệt từng cặp, tạo lại riêng một shot |
| 7 (đã có) | Khối 6: dry-run credit, clip nháp/final theo từng shot, duyệt bản nháp, xác nhận chưa gửi khi `unknown` |
| 8 | Khối 7–8: báo cáo kiểm tra, xem video ghép, tải gói xuất |
| 9 | Biến thể hook, bảng chi phí, trần credit theo chiến dịch |

## 3. Mô hình dữ liệu và engine (dùng chung cho mọi giai đoạn)

### 3.1 Tám khối → bước nội bộ

| Khối (UI) | Bước nội bộ (engine) | Tốn gì |
|---|---|---|
| 1. Sản phẩm | Garment Source → Fact Sheet (+ điểm rủi ro) | Gemini |
| 2. Người mẫu | Cast, Style | ChatGPT ảnh (nếu tạo mới) |
| 3. Kế hoạch | Brief → Angle → Hook → Shot Planner → Script & Caption | LLM |
| 4. Ảnh mẫu mặc áo ✋ | Probe Look → Fidelity Check → **Approve Look** | ChatGPT ảnh + Gemini |
| 5. Keyframe | Keyframe Studio (theo từng shot) → Fidelity Check | ChatGPT ảnh + Gemini |
| 6. Clip ✋ | Clip (theo từng keyframe, `tier`) → **Approve Draft** → Clip final | **Credit Flow** |
| 7. Kiểm tra | Clip Check, Compliance | Gemini |
| 8. Ghép & Xuất | Voice/Music → Assemble → Export Pack | Cục bộ (ffmpeg) |

### 3.2 Bảng dữ liệu (SQLite)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `campaign` | `id`, `name`, `niche`, `platform`, `created_at`, `updated_at` | Một chiến dịch = một sản phẩm |
| `campaign_step` | `campaign_id`, `step_key`, `params_json`, `selected_artifact_id`, `pinned` | Tham số người dùng chỉnh + artifact đang chọn |
| `artifact` | `id`, `kind`, `content_hash`, `path`, `meta_json`, `fingerprint`, `parent_ids_json`, `created_at` | **Bất biến.** `meta_json` chứa provenance (prompt, model id, tham số, credit) |
| `run` | `id`, `campaign_id`, `step_key`, `element_key`, `fingerprint`, `state`, `attempt`, `credit_est`, `credit_actual`, `external_ref`, `error`, `started_at`, `finished_at` | Sổ chạy; `external_ref` = id job Veo/Flow |
| `gate` | `campaign_id`, `gate_key`, `artifact_id`, `state` (`pending/approved/rejected`), `note` | Cổng duyệt gắn artifact cụ thể |

`element_key` rỗng với bước thường; với bước dạng danh sách là `shot:2`, `hook:3`…

### 3.3 Vân tay (fingerprint)

`sha256` của JSON chuẩn hóa gồm: loại bước, phiên bản logic bước, tham số liên quan, danh sách `content_hash` artifact đầu vào (đã sắp xếp), model id, `tier`. Trùng vân tay đã có artifact → dùng lại, **0 credit**.

### 3.4 Quy tắc engine

- **Stale (cũ):** vân tay hiện tại ≠ vân tay của artifact đang chọn → "cũ" kèm lý do (đầu vào nào đổi). Không xóa gì. **Pin:** đóng băng, không đề nghị chạy lại.
- **Cổng duyệt:** chỉ trước chỗ tốn tiền hoặc không đảo ngược (Ảnh mẫu, Clip nháp → final). Upstream đổi thì cổng thành "cần duyệt lại", không hủy phần đã làm.
- **Dry-run:** trả về danh sách bước sẽ chạy / đã cache / chờ duyệt, tổng credit ước tính. Có bước 💳 thì bắt buộc xác nhận.
- **Idempotent:** việc đang chạy trùng vân tay thì gia nhập, không tạo mới.
- **Không gửi lại:** nếu đã gửi lệnh tạo video mà mất kết nối, đánh dấu `unknown` và khôi phục từ Flow theo `external_ref`/prompt+thời điểm; không tự gửi lại (xem ghi chú `flow-aborted-generation`).
- **Làn tài nguyên:** `flow`, `chatgpt-image`, `llm`, `local`. Mỗi làn có hàng đợi riêng và giới hạn song song; có hủy.
- **Khởi động lại:** `run` đang `running` có `external_ref` → đối soát; không có → `unknown`, hỏi người dùng.

### 3.5 API (dự kiến, `/api/campaigns`)

```
POST   /api/campaigns                         tạo
GET    /api/campaigns / {id}                  danh sách / trạng thái đầy đủ (bước, stale, gate, credit)
PUT    /api/campaigns/{id}/steps/{key}/params sửa tham số (tự lưu)
POST   /api/campaigns/{id}/plan               dry-run (đích, tier)
POST   /api/campaigns/{id}/run                chạy đến đích (cần confirm_credit nếu có 💳)
POST   /api/campaigns/runs/{run_id}/cancel    hủy
POST   /api/campaigns/{id}/gates/{key}/approve | reject
POST   /api/campaigns/{id}/steps/{key}/pin | unpin
GET    /api/campaigns/artifacts/{id}/file     tải file
```
Frontend theo dõi tiến độ bằng polling (mẫu `services/pollJob.ts`), không cần WebSocket ở giai đoạn đầu.

### 3.6 Hệ thống prompt (mặc định + người dùng tự viết)

**Vì sao quan trọng:** chất lượng ảnh/video và độ đúng áo phụ thuộc phần lớn vào prompt; người dùng phải chỉnh được mà không sửa code, và đổi prompt phải được engine hiểu là đổi đầu vào (bước "cũ", không xóa gì).

**Bốn tầng, tầng sau đè tầng trước:**
1. **Mặc định hệ thống** — đi kèm app, chỉ đọc, có số phiên bản.
2. **Bản của người dùng** — nhân bản từ mặc định rồi sửa, đặt tên, dùng lại giữa các chiến dịch (cùng cách `prompt-presets` hiện có của workflow cũ).
3. **Ghi đè theo chiến dịch/phần tử** — ví dụ riêng cho shot 2.
4. **Ô "thay đổi tùy chọn"** — một ô văn bản ngắn chỉ ghi điều muốn *khác* tham chiếu (như `[OPTIONAL CHANGES]` trong prompt mặc định bạn đưa); để trống là không đổi gì.

**Cấu trúc một mẫu prompt (`prompt_template`):** `id`, `kind`, `name`, `body` (có biến `{{...}}`), `ref_slots` (khai báo thứ tự ảnh tham chiếu và vai trò), `version`, `is_default`, `owner` (system|user).

**Mẫu prompt theo loại (mỗi loại có một mặc định):**

| `kind` | Dùng ở khối | Ảnh tham chiếu (`ref_slots`) | Nguồn mặc định |
|---|---|---|---|
| `look_sheet` | 4. Ảnh mẫu mặc áo | Ảnh 1 = nhân dạng, Ảnh 2 = trang phục | **Prompt bạn đưa 2026-11-09** (lưu nguyên văn làm mặc định đầu tiên) |
| `keyframe` | 5. Keyframe | Look sheet (+ ảnh áo thật) | Soạn ở GĐ6, hiệu chỉnh bằng thử thật |
| `clip_video` | 6. Clip | Khung đầu/cuối (khi có i2v) hoặc không | Soạn ở GĐ7 sau khi bạn đưa HAR và thử thật |
| `fact_sheet`, `angle`, `hook`, `shot_plan`, `script`, `check_*` | 1, 3, 7 (LLM) | ảnh áo/clip | Tái dùng preset Gemini/GPT hiện có, bổ sung bản cho thời trang |

**Biến dùng được** (lấy từ artifact đã duyệt, không gõ tay): `{{garment.summary}}`, `{{garment.risk}}`, `{{cast.profile}}`, `{{style}}`, `{{shot.description}}`, `{{shot.camera}}`, `{{shot.motion_level}}`, `{{duration}}`, `{{aspect}}`, `{{changes}}` (ô thay đổi tùy chọn).

**Quy tắc kỹ thuật:**
- **Thứ tự ảnh tham chiếu là một phần của prompt.** Client ChatGPT ảnh gán ảnh theo *thứ tự* (`ref_labels` bị bỏ qua), nên mẫu khai báo `ref_slots` và bộ dựng tự sắp đúng thứ tự; tối đa 3 ảnh mỗi lần.
- **Xem trước:** luôn có nút xem "prompt cuối cùng" (đã thay biến, đã ghép ô thay đổi) cùng danh sách ảnh tham chiếu theo thứ tự — mẫu hiện có là `preview_gpt_script_prompt`.
- **Kiểm tra mềm (lint), không chặn cứng:** cảnh báo khi số ảnh tham chiếu không khớp `ref_slots`, thiếu câu "tham chiếu thắng mô tả văn bản", prompt video yêu cầu chuyển động vượt mức cho phép theo điểm rủi ro của áo, hoặc có lời chứng giả ngôi thứ nhất.
- **Vân tay và provenance:** vân tay lấy *prompt cuối cùng đã dựng* + phiên bản mẫu; artifact lưu lại prompt đó (xem lại/tái hiện được). Đổi prompt → bước "cũ", bản đã tạo vẫn còn.
- **Lịch sử và quay lại:** mỗi lần lưu mẫu của người dùng là một phiên bản; khôi phục được; "đặt lại về mặc định" luôn có.
- **Không lộ dữ liệu nhạy cảm:** prompt và provenance không chứa cookie/token/URL ký.

**Lưu ý với prompt mặc định `look_sheet` bạn đưa:** giữ nguyên văn khi thử ở GĐ0. Hai điểm nên xử lý ở bản sản phẩm: (a) câu "keep *her* exact face" gắn cứng giới tính nữ — nên thành biến theo hồ sơ người mẫu; (b) prompt yêu cầu "headless neck-down turnaround" cho phần mặc áo, nghĩa là ảnh sheet mang nhân dạng ở bên trái và trang phục ở bên phải, nên bước Keyframe cần lấy cả hai nửa làm tham chiếu (xem GĐ4/GĐ6).

### 3.7 Bảng chi phí dùng cho dry-run

| Loại | Credit | Nguồn |
|---|---|---|
| Omni 1.2 t2v 10s, 360p | 10 | đã xác minh live |
| Omni 1.2 t2v 10s, 720p | 30 | đã xác minh live |
| Omni 1.2 r2v 15s, 360p | 20 | quan sát trong HAR |
| Omni 1.2 i2v (khung đầu/cuối) | **chưa biết** | cần HAR; tạm cấu hình sẵn, đánh dấu "ước tính" |

Bảng này để trong cấu hình, không rải trong code.

---

## 4. Các giai đoạn

Quy ước mỗi giai đoạn: **Mục tiêu · Làm gì · File dự kiến · Kiểm tra (tự động) · Bạn tự kiểm · Tốn credit · Xong khi**. Mỗi giai đoạn merge/dùng được độc lập; không giai đoạn nào đòi chạy dở dang rồi mới thấy kết quả.

### Giai đoạn 0 — Thử nghiệm rủi ro lớn nhất (1–2 ngày, không viết sản phẩm)

**Mục tiêu:** biết trước ý tưởng cốt lõi có thật không, trước khi dựng engine. Câu hỏi: ChatGPT tạo ảnh người mẫu mặc *đúng* áo thật từ ảnh tham chiếu tới mức nào, và Gemini có bắt được lỗi không?

- **Tài liệu thử (bạn cung cấp 2026-11-09):** nhân vật `demo/images.jpg`; áo 1 `demo/Screenshot 2026-09-30 195431.png` (áo thun trắng, chữ logo "Haim" xanh navy + mặt cười + hashtag cam); áo 2 `demo/Screenshot 2026-09-11 200909.png` (bộ áo thun + quần short trắng, logo "NY" đen — logo thương hiệu bên thứ ba). **Cả hai áo đều là áo trắng có logo/chữ**, tức là bài khó nhất về logo; chưa có áo trơn hay họa tiết để đối chứng, và mới có một nhân vật.
- **Làm gì:** script trong `Backend/poc/campaign_look/`. Dùng **đúng prompt `look_sheet` bạn đưa** (nguyên văn), ảnh tham chiếu theo thứ tự [nhân vật, áo]. Gọi `GptImageClient.generate(prompt, dest, ref_paths=[nhân vật, áo], aspect="16:9")`, mỗi áo 2 lần (kiểm độ ổn định). Rồi gọi Gemini với checklist (dài, cổ, tay, form, màu, logo/chữ, họa tiết, nút/túi) và so với bạn chấm tay. Lưu prompt, thứ tự ảnh, tài khoản dùng (thường hay Plus), thời gian vào một file kết quả.
- **Kiểm tra:** bảng kết quả: ảnh nào đúng áo (đặc biệt chữ "Haim" và logo "NY" có giữ đúng không); Gemini kết luận trùng bạn bao nhiêu; khác biệt giữa tài khoản thường và Plus.
- **Tốn credit:** 0 Flow; chỉ hạn mức ChatGPT ảnh (4 ảnh lượt đầu) và Gemini. Hai tài khoản ChatGPT (1 thường, 1 Plus) bạn đã thêm.
- **Xong khi:** có số liệu. Nếu tỉ lệ đúng áo quá thấp ở áo họa tiết/logo → **đổi thiết kế** (ví dụ chỉ nhận áo trơn ở phiên bản đầu, hoặc dùng ảnh thật làm khung chính) trước khi đi tiếp.

**Kết quả lần 1 (2026-11-09; 4 ảnh, 2 áo trắng có logo, 1 nhân vật).** Script: `Backend/poc/campaign_look/run_look_sheet.py` (tạo ảnh) và `run_fidelity_check.py` (Gemini chấm); ảnh và `results.json`/`fidelity.json` ở `Backend/poc/campaign_look/out/`.
- **Tạo ảnh:** 4/4 thành công, 40–61 giây mỗi ảnh, cả hai tài khoản đều được dùng (xen kẽ, mỗi tài khoản 2 ảnh), không lỗi/giới hạn. Chưa phân biệt được tài khoản thường và Plus từ log.
- **Đánh giá bằng mắt (của tôi, chỉ là tham khảo — bạn cần xem lại ảnh):**
  - Giữ tốt: chữ "Haim", hashtag, mặt cười và logo "NY" đúng nội dung và đúng vị trí ở cả 4 ảnh; bố cục chia đôi 16:9 đúng yêu cầu; không có chữ phụ đề của ảnh nhân vật lọt vào ảnh; nhân dạng (tóc buộc cao, nơ, mái) nhất quán giữa các lần.
  - Chưa đúng: **tay áo gập (cuff) của áo 1 không được tái tạo** (2/2); **độ dài quần short của bộ NY không ổn định** (lần 1 gần với ảnh thật, lần 2 ngắn và loe hơn rõ); **tự thêm đồ không có trong ảnh tham chiếu** (quần jean/short denim, giày, tất) dù prompt ghi "EXACTLY the outfit"; chân dung bên trái đổi áo giữa các lần (lần thì yếm camisole của ảnh nhân vật, lần thì áo thun); ở góc nhìn nghiêng, logo ngực hiện phẳng ở mép trước — không đúng vật lý.
- **Gemini chấm (prompt chấm nghiêm khắc, 9 hạng mục):** **4/4 "pass", 36/36 hạng mục "match"**. Bỏ sót đúng hai lỗi ở trên (tay áo gập, độ dài short lần 2) và còn đọc nhầm quần short của lần 2 là "đồ thừa". **Kết luận: với prompt chấm này, Gemini không phân biệt được ảnh đúng và ảnh lệch, nên Fidelity Check chưa được dùng làm cổng tự động.**
- **Quyết định điều chỉnh thiết kế (từ số liệu này):**
  1. `Fidelity Check` chỉ để **cảnh báo tham khảo**; cổng **Approve Look** luôn là người duyệt. Chỉ cân nhắc tự động hóa sau khi hiệu chỉnh lại prompt chấm và đo lại trên nhiều áo hơn.
  2. Hướng hiệu chỉnh prompt chấm cần thử (chưa thử, chưa biết có hiệu quả): bắt buộc liệt kê ≥3 khác biệt trước khi kết luận; so từng vùng cắt (ngực/tay/gấu/cổ) thay vì cả ảnh; tách Gemini chỉ trả mô tả thuần của từng ảnh rồi so sánh các mô tả.
  3. Mẫu `look_sheet` mặc định cần mục **"Chỉ mặc những món có trong Image 2; không thêm quần/giày/phụ kiện khác ngoài món trung tính"** và ghi rõ chi tiết dễ mất (tay gập, độ dài) lấy từ hồ sơ áo ở Fact Sheet. Đây là giả thuyết cần chạy lại GĐ0 để kiểm, chưa khẳng định.
- **Giới hạn của lần thử này:** 4 ảnh, hai áo đều trắng có logo, một nhân vật; chưa có áo trơn/họa tiết/ren; chưa đo độ ổn định giữa nhiều lần chạy; "nhân dạng nhất quán" mới chỉ xét bằng mắt. Gemini phải làm mới cookie qua Chrome ở lần chạy này (đã tự phục hồi).

### Giai đoạn 1 — Lõi engine phía backend (nền cho mọi thứ)

**Mục tiêu:** có kho artifact, vân tay, stale/pin, sổ chạy, dry-run — kiểm bằng test, chưa cần giao diện, chưa gọi AI thật.

Chia nhỏ (mỗi mục một lần làm + test riêng):
- **1.1 Mô hình dữ liệu:** `Backend/app/campaign/models.py` (5 bảng ở 3.2), tạo bảng khi router khởi tạo.
- **1.2 Kho artifact:** ghi file theo `content_hash`, tạo artifact bất biến, đọc lại. `store.py`.
- **1.3 Vân tay:** `fingerprint.py` (chuẩn hóa JSON, thứ tự khóa, bỏ trường không liên quan). Test: đổi thứ tự khóa → cùng vân tay; đổi một tham số → khác.
- **1.4 Đồ thị bước và stale:** `graph.py` định nghĩa các bước + phụ thuộc (bảng 3.1) cho nhánh thời trang; hàm tính trạng thái (`fresh/stale/missing/pinned/need-approval`). Test: sửa đầu vào → chỉ bước hạ nguồn "cũ", artifact vẫn còn.
- **1.5 Dry-run và Budget:** `planner.py` tính danh sách chạy + credit theo 3.7; chặn khi vượt trần.
- **1.6 Bộ chạy:** `runner.py` có hàng đợi theo làn, hủy, idempotent, khôi phục sau khởi động lại. Dùng **bộ thực thi giả** (fake executor) để test.
- **1.7 Thư viện prompt:** `prompts.py` + bảng `prompt_template` (mục 3.6): mẫu mặc định hệ thống (đọc từ file trong repo, có phiên bản), mẫu của người dùng (tạo/sửa/nhân bản/đặt lại), bộ dựng prompt cuối cùng (thay biến, ghép ô thay đổi, sắp ảnh tham chiếu theo `ref_slots`), lint mềm. API: `GET/POST/PUT/DELETE /api/campaigns/prompts`, `POST /api/campaigns/prompts/render` (xem trước). Test: biến thiếu báo rõ, thứ tự ảnh đúng, đổi một chữ trong prompt → vân tay đổi.
- **1.8 Router + schema + đăng ký vào `main.py`:** các API ở 3.5 và 1.7.

- **File:** `Backend/app/campaign/{__init__,models,store,fingerprint,graph,planner,runner,schemas,router}.py`; test `Backend/tests/campaign/`.
- **Kiểm tra:** pytest cho từng mục; đặc biệt **"sửa shot 2 chỉ làm lại clip 2"** (đối lập với hành vi cũ xóa clip 2 và 3) và **"khởi động lại không gửi lại job đã gửi"**.
- **Tốn credit:** 0.
- **Xong khi:** toàn bộ test xanh; gọi API bằng curl tạo chiến dịch, sửa tham số, xem dry-run, thấy trạng thái "cũ" đúng.

**Trạng thái: ĐÃ LÀM (2026-11-09), 39 test xanh** (`Backend/tests/campaign/`, chạy lặp 3 lần không chập chờn; 82 test workflow/video-chain cũ vẫn xanh). Chưa commit.

Code: `Backend/app/campaign/` — `models.py` (6 bảng), `store.py` (kho artifact), `fingerprint.py`, `graph.py` (đồ thị 19 bước, 8 khối), `engine.py` (trạng thái + dry-run), `runner.py` (hàng đợi theo làn), `prompts.py` + `prompt_defaults/look_sheet.txt` (mẫu mặc định = prompt bạn đưa), `service.py`, `router.py` (23 route `/api/campaigns/...`). Đăng ký ở `app/main.py` (router + tạo bảng lúc khởi động, có `recover()`), và thêm `prompt_defaults` vào `backend.spec` để bản đóng gói không thiếu file.

Khác với kế hoạch ban đầu / quyết định lúc làm:
- **Chưa có executor thật.** Bộ chạy nhận `register_executor(step, fn)`; chưa bước nào gọi AI/Flow thật (làm ở GĐ3–GĐ7). Nếu chạy bước chưa có executor, sổ chạy ghi lỗi rõ "Chưa có executor". Test dùng executor giả.
- **Bước chờ duyệt có trạng thái riêng `waiting`** trong dry-run (khác `blocked`): upstream đang chờ người duyệt thì bước sau xếp hàng chờ, không báo lỗi.
- **Bước tốn tiền + không rõ kết quả:** run `unknown`, chặn chạy lại bước/phần tử đó cho tới khi gọi `POST /runs/{id}/resolve` (`not_sent`). Khởi động lại khi đang chạy: bước tốn credit → `unknown`, bước thường → `error`. Chưa có thao tác "gắn kết quả vào" (làm ở GĐ7 cùng khôi phục từ Flow).
- **Một lượt thực thi mỗi chiến dịch** tại một thời điểm (`409` nếu chạy thêm). Việc trùng vân tay trong cùng chiến dịch thì gia nhập, không gửi lại (có test cho cả đường đua giữa lúc kiểm tra và lúc nhận quyền chạy).
- **Cache theo vân tay trong phạm vi một chiến dịch** (chưa dùng chung giữa các chiến dịch).
- **Sửa tay JSON** (`PUT .../artifact`) tạo artifact mới mang vân tay đầu vào hiện tại: "mới" cho tới khi upstream đổi. `reroll` tăng `_nonce` để có kết quả khác với cùng đầu vào.
- **Duyệt bản nháp → chạy final:** bản final kế thừa quyết định đã duyệt của phần tử đó; phần tử chưa duyệt bị bỏ qua (`skip_not_approved`). Ước tính credit chỉ dùng đơn giá đã xác minh (t2v 10 giây: 10/30); i2v hay độ dài khác 10 giây báo `unknown_cost_items` chứ không đoán.
- **Dry-run cận trên:** bước phụ thuộc bước sắp chạy lại được tính là "có thể chạy" (`estimate=true`); lúc thực thi, nếu kết quả bước trước giống hệt thì bước sau không chạy.
- Hạn chế đã biết: `look_check`, `clip_check`, `compliance`, `voice`... đã có trong đồ thị nhưng chưa có logic; `Budget` mới là trần credit + chi tiêu thực (từ sổ chạy), chưa đối soát số dư Flow.

### Giai đoạn 2 — Khung giao diện chiến dịch (8 khối, chưa có AI)

**Mục tiêu:** trang mới hiển thị 8 khối, trạng thái từng khối, tự lưu, dry-run — dùng được với dữ liệu giả.

- **2.1 Route + trang + danh sách chiến dịch** (`Frontend/src/features/campaign/CampaignPage.tsx`, đăng ký trong `App.tsx` lazy như `WorkflowPage`).
- **2.2 Bản đồ 8 khối** theo sơ đồ đã duyệt: huy hiệu trạng thái (đã cache / cũ / đang chạy / cần duyệt / lỗi / ghim), credit sẽ tốn trên khối 💳.
- **2.3 Bảng chi tiết khối** (mở khối thấy các bước con, tham số, lịch sử phiên bản).
- **2.4 Thanh dry-run + xác nhận credit + nút hủy.**
- **2.5 Tự lưu** gọi `PUT .../params` (debounce); polling trạng thái.
- **2.6 Trình soạn prompt:** ở mỗi khối gọi AI có ô chọn mẫu (mặc định/của tôi), nút **Sửa**, **Nhân bản**, **Đặt lại mặc định**, ô "thay đổi tùy chọn", và **xem prompt cuối cùng + ảnh tham chiếu theo thứ tự** trước khi chạy; hiển thị cảnh báo lint.
- **File:** `Frontend/src/features/campaign/{CampaignPage.tsx, components/, services/campaignApi.ts, types.ts}`; thêm script `test:campaign` vào `Frontend/package.json` (mẫu `test` hiện có chạy `node --experimental-strip-types --test`).
- **Kiểm tra:** test thuần cho `campaignApi` và hàm suy ra huy hiệu; `npm run typecheck`.
- **Bạn tự kiểm:** mở trang, tạo chiến dịch, đổi tham số, đóng app mở lại vẫn còn.
- **Tốn credit:** 0.
- **Xong khi:** thấy 8 khối đúng sơ đồ, trạng thái "cũ" hiện đúng khi sửa tham số giả.

**Trạng thái: ĐÃ LÀM MỘT PHẦN (2026-11-09).** Đã có: mục "Chiến dịch AI" trên sidebar (`Frontend/src/features/campaign/`), danh sách/tạo/đổi tên/xóa chiến dịch, sơ đồ 8 khối với huy hiệu, trần credit, sổ chạy (kèm nút "Xác nhận chưa gửi"), polling khi đang chạy, tự lưu bền (tải lại trang vẫn còn). Chưa có: bảng chi tiết lịch sử phiên bản của từng bước, hoàn tác/ghim trên UI, xác nhận credit dạng hộp thoại riêng (đang dùng hộp xác nhận của trình duyệt). Test: `npm run test:campaign` (7 test hàm hiển thị).

### Giai đoạn 3 — Khối 1 và 2: Sản phẩm + Người mẫu

**Mục tiêu:** nạp áo thật, ra hồ sơ áo có điểm rủi ro; có người mẫu cố định dùng lại.

- **3.1 Garment Source:** tải nhiều ảnh theo vai (flat lay, trước/sau, cận chi tiết, nhãn), giá/khuyến mãi/size. Tái dùng `save_workflow_asset`.
- **3.2 Fact Sheet:** gọi Gemini (tái dùng `execute_gemini_analysis` với prompt riêng cho áo) → `Garment` có cấu trúc + **điểm rủi ro** + danh sách "không được nói". Người dùng sửa được; sửa = artifact mới.
- **3.3 Cast:** thư viện người mẫu (ảnh tham chiếu + canonical profile EN + số phiên bản), dùng lại giữa các sản phẩm. Tái dùng `extract_character_scene_profiles`.
- **3.4 Style:** ánh sáng, bối cảnh, màu, "Standing Don'ts"; một khung phong cách để duyệt.
- **Quy tắc rủi ro** (dữ liệu, để Giai đoạn 5 và 7 dùng): trơn → đi/xoay; họa tiết/kẻ sọc → chuyển động nhẹ; ren/bóng → cận ảnh thật; có logo/chữ → chỉ dùng logo từ ảnh thật.
- **Kiểm tra:** test hàm điểm rủi ro; test parse hồ sơ áo từ phản hồi Gemini mẫu.
- **Tốn credit:** 0 Flow.
- **Xong khi:** bạn đưa 4 ảnh một áo thật, nhận hồ sơ áo đúng, sửa được, đổi ảnh thì hồ sơ báo "cũ".

**Trạng thái: ĐÃ LÀM (2026-11-09), chưa thử với Gemini thật.** Backend 63 test xanh, frontend 9 test, e2e trình duyệt (Gemini và ChatGPT giả) không lỗi console.
- **3.1 Garment Source:** đã có từ trước (tải tối đa 4 ảnh, vai trò, thứ tự).
- **3.2 Fact Sheet:** executor `fact_sheet` (`executors/fact_sheet.py`) gửi TẤT CẢ ảnh áo cho Gemini qua `execute_gemini_analysis`, prompt mặc định `system:fact_sheet` (sửa/nhân bản được), parse JSON chịu được khối ```json và văn bản thừa. Điểm rủi ro **tính bằng luật cố định** (trơn → thấp; họa tiết nhỏ/kẻ sọc/lớn → trung bình, chuyển động nhẹ; ren/trong suốt/bóng → cao, chuyển động tối thiểu; logo → chỉ dùng logo từ ảnh thật; logo + họa tiết → cao), không lấy từ Gemini. Logo thì tự thêm điều "không khẳng định hàng chính hãng". Sửa tay mọi ô → tạo phiên bản mới, backend tính lại rủi ro; Gemini trả sai định dạng → run lỗi rõ, không tự thử lại.
- **3.3 Cast:** thư viện nhân vật dùng lại giữa chiến dịch (lưu file riêng, bảng `campaign_cast_library`). **Chưa có** canonical profile tiếng Anh của nhân vật (chỉ cần khi tới prompt video/keyframe; làm ở GĐ6).
- **3.4 Style:** form phong cách (ánh sáng, bối cảnh, bảng màu, "luôn tránh") lưu thành tham số. Tôi **bỏ `style` khỏi phụ thuộc của bước `look`** vì prompt look sheet chưa dùng phong cách; nếu không, đổi style sẽ làm ảnh mẫu thành "Cũ" vô lý. Style sẽ dùng ở kế hoạch/keyframe/clip. Chưa có "khung phong cách để duyệt".
- Luật rủi ro chỉ là điểm khởi đầu, **chưa kiểm chứng trên nhiều áo thật**; hồ sơ do Gemini sinh chưa đo độ chính xác (bạn nên so với áo thật khi thử).

### Giai đoạn 4 — Khối 4: Ảnh mẫu mặc áo (kiểm chứng giá trị, vẫn 0 credit Flow)

**Mục tiêu:** từ áo + người mẫu + style ra ảnh mẫu mặc đúng áo, có kiểm tra và cổng duyệt.

- **4.1 Probe Look (tạo "look sheet"):** dùng mẫu prompt `look_sheet` (mặc định là prompt bạn đưa; sửa được, mục 3.6) với ảnh tham chiếu [nhân dạng, trang phục]; tạo 1–4 ứng viên bằng ChatGPT ảnh (**tối đa 3 ảnh tham chiếu mỗi lần**); đưa qua làn `chatgpt-image`, xoay tài khoản khi đụng giới hạn (đã có). Bước này gộp "Cast + Look" thành một tấm ảnh duy nhất; tài khoản thường và Plus có thể giới hạn khác nhau nên dry-run hiện số ảnh sẽ tạo.
- **4.2 Fidelity Check:** Gemini chấm theo checklist ở Giai đoạn 0 (đã hiệu chỉnh bằng số liệu thật); trả `Report` + lý do.
- **4.3 Approve Look:** cổng chọn đúng 1 ảnh làm chuẩn; từ chối kèm ghi chú → ghi chú vào prompt lần sau.
- **Kiểm tra:** test runner với executor giả cho luồng tạo → chấm → duyệt → đổi Cast thì cổng "cần duyệt lại"; chạy thật 1 áo.
- **Tốn credit:** 0 Flow; có hạn mức ChatGPT ảnh.
- **Xong khi:** một áo thật ra được ảnh mẫu bạn tự đánh giá "đúng áo", và cổng/stale hoạt động.

**Trạng thái: LÀM MỘT PHẦN (2026-11-09).** Đã có executor thật `look` (`Backend/app/campaign/executors/look.py`, gọi `GptImageClient` với ảnh [nhân vật, áo mặt trước] + prompt look sheet) và màn hình khối 4: chọn/nhân bản/sửa mẫu prompt (mỗi lần lưu = phiên bản mới), ô "thay đổi tùy chọn", xem prompt cuối cùng + ảnh tham chiếu theo thứ tự (cùng hàm dựng với lúc chạy), số ảnh ứng viên, tạo, hủy, chọn ứng viên, duyệt, từ chối kèm ghi chú (ghi chú vào prompt lần tạo lại), tạo ảnh khác. **Chưa làm:** 4.2 Fidelity Check (theo kết quả GĐ0 chỉ là cảnh báo tham khảo). Giới hạn: look sheet hiện chỉ dùng **một** ảnh áo (vai trò "Mặt trước"); các ảnh khác bị báo "chưa được dùng". Đã kiểm bằng e2e trình duyệt thật với client ảnh GIẢ (không gọi ChatGPT); lần chạy thật bằng tài khoản ChatGPT do bạn thử.

### Giai đoạn 5 — Khối 3: Kế hoạch

**Mục tiêu:** từ hồ sơ áo + brief ra góc kể, hook, danh sách shot, lời thoại — toàn LLM, rẻ.

- **5.1 Brief:** đối tượng, dịp mặc, giá, khuyến mãi, nền tảng đích.
- **5.2 Angle Picker:** xếp hạng góc kể theo rủi ro (áo họa tiết/logo hạ điểm góc cần xoay người).
- **5.3 Hook Lab:** 5 hook (đối lập, nói thẳng vào máy, câu hỏi nỗi đau, hình ảnh bất ngờ, con số), phải liên quan sản phẩm, 3–6 giây đầu.
- **5.4 Shot Planner:** danh sách `Shot` (vai trò, thời lượng, máy, mức chuyển động bị giới hạn theo rủi ro, chữ, lời thoại, mô tả keyframe). Tái dùng `parse_gpt_scripts`/`validate_gpt_scripts`.
- **5.5 Script & Caption:** lời thoại, chữ, caption; **chặn lời chứng giả ngôi thứ nhất**; quét "không được nói".
- **Kiểm tra:** test validator (chặn "tôi đã mua và dùng"; shot vượt mức chuyển động bị hạ).
- **Tốn credit:** 0 Flow.
- **Xong khi:** từ một áo ra kế hoạch 3 shot × 10 giây hợp lý, sửa shot 2 chỉ làm "cũ" những gì phụ thuộc shot 2.

**Trạng thái: ĐÃ LÀM (2026-11-09), chưa thử với Gemini thật.** Backend 155 test xanh (73 cho campaign), frontend 9 test, e2e trình duyệt (LLM giả) không lỗi console.
- **5.1 Brief:** form (đối tượng, dịp mặc, giá, khuyến mãi, ngôn ngữ, nền tảng) lưu thành tham số; giá/khuyến mãi chỉ được nhắc tới nếu có trong brief.
- **5.2 Angle:** Gemini đề xuất 4 góc kể đã xếp hạng theo rủi ro áo; bạn chọn góc (lưu = phiên bản "đã sửa tay").
- **5.3 Hook:** 1–5 hook, mỗi kiểu một loại (đối lập, nói thẳng, câu hỏi nỗi đau, hình ảnh bất ngờ, con số), kẹp 3–6 giây.
- **5.4 Shot:** danh sách shot (vai trò hook/lợi ích/CTA, máy quay, chuyển động, chữ, lời thoại, khung đầu/cuối, dùng ảnh thật). **Chuyển động bị kẹp xuống mức cho phép theo rủi ro áo** và hiện cảnh báo; chuẩn hóa chạy cả sau khi bạn sửa tay (idempotent). Giữ nguyên khóa `shot:N` khi sửa nên sửa shot 2 chỉ làm "Cũ" shot 2 và keyframe/clip của nó.
- **5.5 Script:** lời thoại + chữ + caption + hashtag + CTA. Cảnh báo (không chặn): lời chứng ngôi thứ nhất, điều "không được nói" từ hồ sơ áo (so khớp chuỗi đơn giản), khẳng định "chính hãng" khi áo có logo, shot lạ/thiếu.
- Prompt mặc định cho cả 4 bước (`prompt_defaults/angle|hook|shot_plan|script.txt`), sửa/nhân bản được; các prompt này **chưa được hiệu chỉnh bằng kết quả Gemini thật**. Đổi phụ thuộc: `script` thêm `fact_sheet`; `hook`/`shot_plan` thêm `brief`; `shot_plan` bỏ `cast` (ảnh nhân vật không ảnh hưởng chữ của kế hoạch).
- **Gợi ý tự động cho form (bạn đề xuất 2026-11-09):** nút "Gợi ý bằng Gemini" ở **Brief** và **Phong cách** (`executors/suggest.py`, `POST /{id}/steps/{brief|style}/suggest`). Gemini xem ảnh áo + hồ sơ áo (nếu có) + các ô bạn đã gõ, rồi **chỉ điền vào ô trống** (ô tô màu để bạn xem lại, bấm Lưu mới ghi). Giá/khuyến mãi chỉ điền khi đọc được trên ảnh, không bao giờ đoán. Gợi ý không lưu và không vào sổ chạy; prompt gợi ý là mẫu cố định (`brief_suggest.txt`, `style_suggest.txt`), chưa có giao diện sửa vì để trong tham số brief sẽ làm góc kể thành "Cũ".
- Giới hạn: quét "không được nói" là so khớp chuỗi (không hiểu ngữ nghĩa); số từ/giây (3 từ/giây) là ước lượng; chưa có nút chạy "cả khối" một lần (mỗi bước có nút riêng, bấm bước sau sẽ tự chạy các bước trước còn thiếu).

### Giai đoạn 6 — Khối 5: Keyframe

**Mục tiêu:** mỗi shot có khung đầu/cuối bám đúng áo và đúng người mẫu.

- **6.1 Bước theo danh sách (map):** chạy một lần mỗi `Shot`, cache từng phần tử, một phần tử lỗi không làm hỏng các phần tử khác.
- **6.2 Keyframe Studio:** ảnh ChatGPT bám look sheet đã duyệt + mô tả keyframe của shot, dùng mẫu prompt `keyframe` (có mặc định, sửa được, ghi đè được theo shot). Look sheet có nhân dạng ở nửa trái và trang phục ở nửa phải nên cắt hai nửa làm hai ảnh tham chiếu riêng (vẫn trong giới hạn 3 ảnh), kèm ảnh áo thật nếu có logo.
- **6.3 Fidelity Check cho keyframe;** cổng "Approve Keyframes" tự qua nếu pass hết và rủi ro thấp.
- **Kiểm tra:** test map (sửa shot 2 → chỉ keyframe 2 chạy lại; lỗi keyframe 3 không chặn 1–2).
- **Tốn credit:** 0 Flow.
- **Xong khi:** 3 shot ra 3 cặp keyframe, đúng áo, bạn duyệt được từng cặp.

**Trạng thái: ĐÃ LÀM (2026-11-09), chưa thử với ChatGPT thật.** Backend 88 test xanh (thêm 10 cho keyframe), e2e trình duyệt (ChatGPT giả) không lỗi console.
- **Mỗi shot = một cặp khung đầu + khung cuối** (2 ảnh ChatGPT, ~1–2 phút). Tham chiếu lấy từ look sheet **đã duyệt**: cắt nửa trái (nhân dạng) và nửa phải (trang phục) bằng Pillow (vị trí cắt chỉnh được, mặc định 33%), thêm ảnh áo thật (mặt trước). **Khung cuối dùng chính khung đầu làm Image 1** để giữ nguyên người/áo/bối cảnh. Kết quả lưu thành artifact `bundle` {start, end}; bước clip nhận cả hai (đã sửa lỗi: bundle phải được bung ra thành các thành viên khi bước sau lấy làm đầu vào).
- **Cổng duyệt từng shot** (✋ trước bước tốn credit): clip chỉ dùng keyframe đã duyệt. Có "Duyệt tất cả", từ chối kèm ghi chú (ghi chú vào prompt lần tạo lại).
- **Tạo lại riêng một shot:** API plan/run nhận `elements` (chỉ chạy các phần tử chọn của bước đích). Các bản cũ vẫn xem/chọn lại được ("Các bản đã tạo").
- **Quy tắc mới của engine:** bước sau KHÔNG chạy khi bước gate phía trên có kết quả mới chưa duyệt (hiện "chờ duyệt"); tránh tốn ảnh/credit dựng trên bản đã duyệt cũ rồi phải làm lại. Đổi phong cách/hồ sơ áo/ảnh mẫu đã duyệt/danh sách shot làm keyframe thành "Cũ"; đổi phong cách không ảnh hưởng ảnh mẫu.
- **Prompt keyframe mặc định là bản nháp chưa hiệu chỉnh bằng ảnh thật** (`prompt_defaults/keyframe.txt`, sửa/nhân bản được). Cách cắt cố định theo tỉ lệ chiều rộng, nên nếu bố cục look sheet đổi (ảnh ChatGPT không luôn chia đúng 1/3) thì chỉnh thanh cắt; chưa tự phát hiện đường chia.
- Khung đầu/cuối không qua bước Gemini chấm (đã quyết ở GĐ0: chỉ cảnh báo, chưa làm); bạn duyệt bằng mắt. Nếu khung cuối lỗi sau khi khung đầu xong, cả shot báo lỗi (không lưu nửa cặp) và không tự thử lại.
- Thêm `Pillow>=10.0.0` vào requirements.txt (code cũ đã dùng nhưng chưa khai báo).
- **Thử THẬT với ChatGPT (2026-11-09, chiến dịch "v1", shot:1):** thành công, **114 giây cho 1 shot** (khung đầu 70s, khung cuối 43s; mỗi ảnh thường 40–70s, không điều chỉnh được). Chất lượng: khung đầu và cuối giữ đúng người (tóc cột cao, nơ), logo NY đúng ngực trái, quần có dây rút, cùng bối cảnh; khung cuối đổi dáng nhẹ. Với 3 shot và 2 làn song song cần khoảng 4 phút. Cắt look sheet 33% hơi lấn vài chục pixel viền chân dung sang nửa áo ở ảnh này (divider ở ~35%); chưa ảnh hưởng kết quả nhưng nên cân nhắc mặc định 0,34–0,35 hoặc tự dò đường chia.
- **Lỗi sửa sau khi thử thật:** (1) giao diện kẹt "Đang tạo…" dù backend đã xong do ảnh chụp trạng thái tự mâu thuẫn (đọc DB trước, hỏi "đang chạy không" sau) → backend hỏi trước, frontend coi là đang chạy nếu còn bất kỳ run nào đang chạy; (2) prompt có dòng rỗng khi chưa điền phong cách → dùng mặc định trung tính và bỏ cả dòng của mục rỗng; (3) thông báo "Chưa có executor" nay nói rõ cần khởi động lại Backend (backend `--reload` của bạn đã không nạp code mới, các lần bấm 14:56/14:57/15:02 UTC đều lỗi ngay vì thế); (4) thêm tiến độ trong lúc chạy: khâu đang làm ("Khung đầu: đang tạo…") và số giây đã trôi qua, cho cả keyframe và ảnh mẫu.

### Giai đoạn 7 — Khối 6: Clip (có credit — làm theo hai bước nhỏ)

Giai đoạn này phụ thuộc điểm chưa giải xong: **Omni 1.2 i2v/khung đầu-cuối cần upload ảnh qua HTTP** (xem `docs/PLAN_flow_http_submit.md`, "chưa làm") và **Omni 1.1 bị gỡ 5/12/2026**.

- **Prompt video:** mẫu `clip_video` có mặc định theo vai shot (hook / lợi ích / CTA) và mức chuyển động bị giới hạn theo điểm rủi ro của áo; người dùng viết/sửa/ghi đè theo từng shot (mục 3.6). Bản mặc định chỉ soạn nháp và **hiệu chỉnh bằng clip thật** khi tới giai đoạn này; trước đó không khẳng định nó tốt.
- **7.1 Clip nháp 360p bằng đường đã có** (chạy được ngay, không phụ thuộc i2v mới):
  - Bước Clip gọi `veo/service` tạo job (HTTP t2v Omni 1.2 đã chạy; hoặc frames Omni 1.1 qua UI nếu cần neo keyframe trước 5/12).
  - `tier=draft` (360p, 10 credit/clip 10s). Đối soát credit từ số dư trả về khi submit.
  - Cổng **Approve Draft**: chọn clip nào lên final.
  - **Quy tắc quan trọng:** một job lỗi sau khi đã gửi không tự gửi lại; bước chuyển `unknown` và khôi phục từ Flow.
- **7.2 Clip final 720p** (30 credit/clip 10s) chỉ cho phần tử đã duyệt.
- **7.3 (khi có HAR) Neo bằng keyframe qua HTTP cho Omni 1.2:** thêm RPC upload ảnh vào `page/video-http.js` và `Backend/poc/flow_http/flow_rpc.py`, tách khỏi giai đoạn này nếu chưa có dữ liệu.
- **Kiểm tra:** test dispatch/builder cho request; test "đổi tier không đổi nội dung, đổi vân tay"; chạy thật 1 clip nháp.
- **Tốn credit:** ~10 credit mỗi clip nháp khi kiểm thật (bạn xác nhận từng lần).
- **Xong khi:** 3 clip nháp ra, bạn duyệt 2, 2 clip chạy 720p, sửa shot 2 chỉ tạo lại clip 2.

**Trạng thái: ĐÃ LÀM (2026-11-09), CHƯA thử với Flow thật (không tốn credit để kiểm).** HAR `flow.google_2_test_gd_7.com` đã phân tích: xem `docs/PLAN_flow_http_submit.md`, mục "GĐ7". Backend 267 test xanh (campaign 109, veo + omni12 + workflow), extension 126 test (thêm 11 cho frames, dựng lại khớp 3 request `nprQif` thật), frontend 14 test, e2e trình duyệt (Veo giả) chạy hết 7 lần gửi đúng như kỳ vọng.
- **7.1/7.2 Clip nháp 360p rồi chốt 720p:** `executors/clip.py` đưa cặp keyframe đã duyệt + prompt video cho Veo (`submit_job`, Omni 1.2 frames, idempotency_key = vân tay) và chờ tới khi xong, lưu mp4 thành artifact. Tab "Nháp 360p / Chốt 720p" trên giao diện; chốt chỉ chạy các clip nháp **đã duyệt** và kế thừa quyết định duyệt. Phát được video ngay trong trang.
- **Giá hiển thị trước khi chạy (dry-run), chỉ các điểm đã xác minh:** 10s: 360p = 10, 720p = 30; 6s: 720p = 18. **360p 6s và mọi thời lượng khác báo "chưa rõ giá"** (không đoán); thời lượng shot chỉ nhận 6 hoặc 10 giây cho clip.
- **7.3 Neo keyframe qua HTTP:** làm bằng upload `maseQ` + `nprQif` (xem trên). **Điểm duy nhất chưa kiểm chứng live là upload `maseQ`.** Lần thử đầu: tạo MỘT clip nháp (10 credit); nếu upload sai thì báo lỗi rõ và không mất credit.
- **Không bao giờ gửi lại lệnh tạo video:** chỉ lỗi chắc chắn xảy ra trước khi Flow nhận lệnh (bridge/extension/đăng nhập/captcha/upload ảnh) mới là lỗi thường; mọi lỗi sau khi đã đưa job cho Veo (mất kết nối, quá 20 phút, Flow từ chối/hủy, job biến mất) → "Chưa rõ kết quả", chặn chạy lại tới khi bạn kiểm tra Flow và bấm "Xác nhận chưa gửi"; mã job Veo được lưu để đối chiếu. Credit của run "chưa rõ" vẫn được tính vào "đã dùng" cho tới khi xác nhận.
- **Quy tắc engine:** bước tốn credit chờ khi keyframe mới chưa duyệt (không dựng clip trên keyframe cũ). Đổi prompt clip/phong cách/hồ sơ áo/keyframe làm clip "Cũ".
- **Yêu cầu khi chạy thật:** (1) chọn project trong Veo Studio và mở đúng project đó trong tab Flow đang đăng nhập; (2) nạp lại extension FlowsVeo-Clean (bundle mới) trong chrome://extensions; (3) khởi động lại backend.
- **Chưa làm:** r2v/ingredients cho clip; thời lượng 8s/4s; đối soát số dư Flow thật với ước tính (hiện `credit_actual` = ước tính theo bảng); khôi phục video từ Flow cho run "chưa rõ" (hiện xác nhận "chưa gửi" thủ công); prompt video mặc định chưa hiệu chỉnh bằng clip thật.

### Giai đoạn 8 — Khối 7 và 8: Kiểm tra + Ghép & Xuất

- **8.1 Clip Check:** tách khung đầu/giữa/cuối, Gemini so với áo thật; **luật cứng:** logo hiện/mất/đổi dạng, hoặc xoay tạo bố cục họa tiết mới ⇒ lỗi.
- **8.2 Voice/Music:** tái dùng `generate_voiceover_batch` và thư viện BGM.
- **8.3 Assemble:** ghép hook + thân + CTA, chữ, âm thanh (ffmpeg cục bộ; tái dùng `concat_workflow_scenes`).
- **8.4 Compliance:** nhãn AI theo nền tảng (TikTok Shop, Shopee, Meta), quét lời quảng cáo, tỉ lệ/độ dài.
- **8.5 Export Pack:** file theo nền tảng + caption + hashtag + báo cáo tuân thủ + provenance JSON.
- **Tốn credit:** 0 (cục bộ + Gemini).
- **Xong khi:** từ áo thật ra video hoàn chỉnh kèm gói xuất.

### Giai đoạn 9 — Biến thể hook và Budget

- **9.1 Biến thể:** 5 hook × 2 thân = 7 clip (cache thân giữa các biến thể); `Zip/Join` ghép từng cặp.
- **9.2 Budget:** trần credit cho chiến dịch; chặn chạy khi vượt; hiển thị đã chi/còn lại theo số dư thật.
- **9.3 So sánh ứng viên:** chọn tốt nhất trong ứng viên (tay hoặc theo điểm `Report`).
- **Tốn credit:** theo biến thể bạn chạy (210 chốt / 70 nháp cho bộ 5 hook × 2 thân, tính theo đơn giá 3.7).
- **Xong khi:** một áo ra 5 video biến thể với đúng 7 clip.

### Giai đoạn 10 — Chuyển đổi và gỡ bản cũ

- **10.1** Nhập chiến dịch/dự án cũ có thể nhập (nếu cần), hoặc giữ bản cũ ở chế độ chỉ-đọc.
- **10.2** Điều hướng mặc định sang Chiến dịch; ẩn workflow cũ sau một thời gian chạy ổn.
- **10.3** Gỡ code cũ (`workflowState.ts` invalidation, `graphResolver.ts`…) **chỉ khi bạn yêu cầu.**
- **10.4** Cập nhật tài liệu, ghi chú bộ nhớ dự án.

---

## 5. Rủi ro và cách giảm

| Rủi ro | Mức | Cách giảm |
|---|---|---|
| ChatGPT ảnh không giữ đúng áo (họa tiết, logo) | Cao | Giai đoạn 0 đo trước; luật cứng logo; chuyển động tối thiểu cho áo rủi ro; duyệt tay |
| Gemini kiểm tra không đáng tin | Trung bình | Hiệu chỉnh bằng số liệu giai đoạn 0; báo "cảnh báo" chứ không tự loại; người duyệt quyết định cuối |
| i2v khung đầu/cuối Omni 1.2 chưa có HAR upload | Cao với giai đoạn 7 | Tách 7.1/7.3; 7.1 chạy bằng đường đã có; cần HAR trước 5/12 nếu muốn neo keyframe |
| Omni 1.1 bị gỡ 5/12/2026 | Trung bình | Không xây phần mới phụ thuộc Omni 1.1; chuyển model mặc định sang Omni 1.2 trong giai đoạn 7 |
| Hạn mức tài khoản ChatGPT ảnh | Trung bình | Xoay tài khoản đã có; làn `chatgpt-image` có hàng đợi; dry-run hiện số ảnh sẽ tạo |
| Định dạng phản hồi Flow đổi (đã từng đổi 30/09) | Trung bình | Giữ test fixture đã làm sạch; lỗi parse không được ngầm gửi lại |
| Số lượng bước nhiều khiến người mới choáng | Trung bình | UI chỉ hiện 8 khối; bước con thu gọn; mẫu chiến dịch dựng sẵn |
| Dữ liệu hiệu quả thị trường VN chưa kiểm chứng | Thấp với kỹ thuật | Không ràng buộc logic vào số liệu; Performance Log (sau) mới có dữ liệu thật |

## 6. Thứ tự và phụ thuộc

```
GĐ0 (thử rủi ro) ─┬─> GĐ1 (engine) ─> GĐ2 (khung UI) ─> GĐ3 ─> GĐ4 ─> GĐ5 ─> GĐ6 ─> GĐ7 ─> GĐ8 ─> GĐ9 ─> GĐ10
                  │                                                              ▲
                  └── (song song) lấy HAR upload ảnh i2v cho Omni 1.2 ───────────┘ (cần trước 5/12 cho 7.3)
```

- GĐ0 làm trước, độc lập. Kết quả có thể đổi phạm vi GĐ3–GĐ6.
- GĐ1 và GĐ2 có thể làm song song một phần (backend và frontend) vì hợp đồng API đã chốt ở 3.5.
- GĐ5 (chỉ LLM) có thể làm song song GĐ4 nếu cần, vì không phụ thuộc ảnh.
- Mỗi giai đoạn kết thúc bằng một mốc "bạn tự kiểm"; không sang giai đoạn tiếp khi mốc chưa qua.

## 7. Bảng theo dõi

| GĐ | Nội dung | Tốn Flow credit | Trạng thái |
|---|---|---|---|
| 0 | Thử nghiệm ảnh mẫu + Gemini kiểm tra | 0 | ◐ lần 1 xong (4 ảnh); cần chạy lại sau khi sửa prompt, và thêm áo trơn/họa tiết |
| 1 | Lõi engine backend | 0 | ☑ xong (39 test); chưa nối UI, chưa có executor thật |
| 2 | Khung giao diện 8 khối | 0 | ◐ đã có khung + panel khối 1, 2, 4 |
| 3 | Sản phẩm + Người mẫu | 0 | ☑ xong (chưa thử Gemini thật) |
| 4 | Ảnh mẫu mặc áo + cổng duyệt | 0 | ◐ look sheet + duyệt đã có; thiếu Fidelity Check cảnh báo |
| 5 | Kế hoạch | 0 | ☑ xong (chưa thử Gemini thật) |
| 6 | Keyframe | 0 | ☑ xong (chưa thử ChatGPT thật) |
| 7 | Clip nháp/final | có | ☑ xong (chưa thử Flow thật; upload `maseQ` cần xác nhận live) |
| 8 | Kiểm tra + Ghép & Xuất | 0 | ☐ |
| 9 | Biến thể hook + Budget | có | ☐ |
| 10 | Chuyển đổi, gỡ bản cũ | 0 | ☐ |

## 8. Quyết định đã chốt và việc còn mở

**Đã chốt (2026-11-09):**
1. **Xây module mới** cạnh workflow cũ; workflow cũ sẽ bỏ sau khi bản mới hoàn thành và ổn định.
2. **Tài liệu thử GĐ0:** 2 áo trắng có logo + 1 nhân vật (đường dẫn ở GĐ0). Hai tài khoản ChatGPT (1 thường, 1 Plus) đã thêm.
3. **HAR upload ảnh của Flow (i2v):** bạn sẽ đưa khi tới GĐ7.
4. **Prompt:** có mặc định + người dùng tự viết cho cả ảnh và video (mục 3.6). Prompt ảnh mặc định = prompt `look_sheet` bạn đưa.

**Còn mở:** (a) áo **trơn** và áo **họa tiết** để đối chứng với áo logo (chưa bắt buộc cho GĐ0, nhưng cần trước khi kết luận "hệ thống đúng áo" cho mọi loại áo); (b) nhân vật thứ hai để xem độ ổn định nhân dạng; (c) ảnh nhân vật hiện có chữ phụ đề đóng cứng ("EM DE COI LONG RONG CHOI...") nên có thể lọt vào ảnh tạo ra — GĐ0 sẽ kiểm, bản sản phẩm cần bước cắt/làm sạch ảnh tham chiếu.

## 9. Những điều chưa biết (không đoán)

- Chất lượng thật của Fidelity/Clip Check bằng Gemini (GĐ0 đo).
- Chi phí credit i2v của Omni 1.2.
- Thời lượng ngoài 10 giây của Omni 1.2 (chưa có HAR).
- Quy định quảng cáo AI ở Việt Nam (đã có tài liệu nước ngoài, chưa có nguồn pháp lý trong nước).
