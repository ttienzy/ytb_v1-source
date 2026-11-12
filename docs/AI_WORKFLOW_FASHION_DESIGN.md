# AI Workflow v2 – kiến trúc node cho quảng cáo THỜI TRANG

> **Cập nhật 2026-11-12:** đây là thiết kế gốc; engine đã được cài đặt theo [PLAN_ai_workflow_campaign.md](PLAN_ai_workflow_campaign.md) và đã đổi hướng ở [PLAN_campaign_v24_storyboard_ingredients.md](PLAN_campaign_v24_storyboard_ingredients.md). Danh sách ~25 node và bước Keyframe trong file này không còn khớp code (`Backend/app/campaign/graph.py` hiện có 19 bước).

Ngày: 2026-11-09. Trạng thái ban đầu: thiết kế (nay đã cài đặt, xem ghi chú đầu file). Thay thế bản "4 giai đoạn" trước đó (bị loại: quá ít node, quá giống wizard).
Nguồn thị trường là blog/trang hãng công cụ (có lợi ích thương mại); con số hiệu quả chưa kiểm chứng. Phần engine tham khảo cách ComfyUI (cache theo vân tay đầu vào), Weavy (iterator cho danh sách biến thể), LangGraph (interrupt/resume có lưu trạng thái); các nguồn đó là bản sao/tài liệu không chính thức, cần đối chiếu mã nguồn chính thức trước khi bắt chước chi tiết.

> **Cập nhật 2026-11-09:** bạn thấy ~25 node là quá phức tạp, nên giao diện chỉ hiện **8 khối** (Sản phẩm → Người mẫu → Kế hoạch / Ảnh mẫu mặc áo ✋ → Keyframe → Clip ✋ → Kiểm tra → Ghép & Xuất). Các node ở §4 là **bước nội bộ của engine**, nằm trong các khối (bảng ánh xạ ở §4.1). Kế hoạch triển khai từng giai đoạn: [PLAN_ai_workflow_campaign.md](PLAN_ai_workflow_campaign.md).

## 1. Chẩn đoán canvas hiện tại (đọc từ code)

- `WorkflowNodeType` cố định 8 loại; mỗi node tự kéo dữ liệu từ node trước bằng `graphResolver.ts` (viết tay từng cặp).
- Chỉnh sửa → `workflowState.ts` **xóa** kết quả (`clearSceneOutput`, `clearedExport`, `invalidateNode`), nên một thay đổi nhỏ mất clip đã render (tốn credit).
- Clip nối chuỗi `end frame → start frame` (`invalidateSceneChain`), nên một clip hỏng kéo theo mọi clip sau.
- Không có khái niệm danh sách/biến thể, không có bước kiểm tra trung thực, không có cổng duyệt, không có ước tính credit, đồ thị không lưu bền.

## 2. Tám nguyên tắc của kiến trúc mới

1. **Mọi đầu ra là Artifact bất biến, định danh theo nội dung** (ảnh, clip, JSON, văn bản). Sửa không bao giờ xóa; tạo phiên bản mới, bản cũ vẫn xem/khôi phục được.
2. **Node = hàm thuần** của (tham số + artifact đầu vào + phiên bản mô hình). **Vân tay (fingerprint)** = hash của các thứ đó. Trùng vân tay = dùng lại bản có sẵn, **0 credit** (cách ComfyUI chỉ chạy lại node có đầu vào đổi).
3. **Đổi đầu vào ≠ xóa đầu ra.** Node chỉ bị gắn **"cũ" (stale)** kèm lý do (đầu vào nào đổi). Người dùng chọn chạy lại hay **ghim (pin)** để đóng băng.
4. **Cổng duyệt chỉ đặt trước chỗ tốn tiền** (khuyến nghị LangGraph: chỉ interrupt ở bước không đảo ngược/có chi phí). Cổng gắn vào artifact cụ thể; upstream đổi thì cổng chuyển "cần duyệt lại" chứ không hủy phần đã làm.
5. **Danh sách là công dân hạng nhất.** Một node "map" chạy một lần cho mỗi phần tử, cache từng phần tử; một phần tử lỗi không làm hỏng các phần tử khác (như iterator của Weavy). Biến thể hook = danh sách, không phải sao chép node.
6. **Chất lượng là tham số chạy, không phải node riêng**: `tier = draft(360p) | final(720p)`. Cùng đồ thị, hai vân tay khác nhau.
7. **Tiền được quản lý bởi engine, không phải bởi người bấm**: chạy thử khô (dry-run) hiện node nào sẽ chạy và tốn bao nhiêu; node tốn tiền không tự chạy lại khi lỗi (ràng buộc "không tự gửi lại lệnh tạo").
8. **Mọi artifact mang nguồn gốc (provenance)**: prompt, model id, tham số, artifact cha, credit. Gói xuất kèm file này (phục vụ tuân thủ và tái hiện).

## 3. Kiểu dữ liệu của cổng (type-checked)

| Kiểu | Nội dung |
|---|---|
| `Photos` | Ảnh thật của sản phẩm (flat lay, trước/sau, cận chi tiết, nhãn) |
| `Garment` | Hồ sơ áo: loại, màu, chất liệu, form, dài, cổ, tay, họa tiết, logo/chữ, chi tiết, size; **điểm rủi ro**; danh sách "không được nói" |
| `Cast` | Người mẫu cố định: ảnh tham chiếu + canonical profile EN + số phiên bản |
| `Style` | Ánh sáng, bối cảnh, màu, ngôn ngữ máy, "Standing Don'ts" + khung phong cách đã duyệt |
| `Brief` | Đối tượng, dịp mặc, giá, khuyến mãi, nền tảng đích |
| `Angle`, `Hook` | Góc kể (lookbook/OOTD/…) và biến thể mở đầu (danh sách) |
| `Shot` | Vai trò (hook/lợi ích/CTA), thời lượng, máy, mức chuyển động, chữ, lời thoại, mô tả keyframe |
| `Look` | Ảnh người mẫu mặc đúng áo đã duyệt (khóa Cast+Garment+Style) |
| `KeyframePair` | Khung đầu + khung cuối của một shot |
| `Clip` | Video + tier + thời lượng + tỉ lệ + model + credit |
| `Report` | Danh sách kiểm tra + kết luận pass/cảnh báo/lỗi + khung làm bằng chứng |

## 4. Danh mục node

### 4.1 Ánh xạ node → 8 khối hiển thị

| Khối (UI) | Node bên trong |
|---|---|
| 1. Sản phẩm | Garment Source, Fact Sheet |
| 2. Người mẫu | Cast, Style |
| 3. Kế hoạch | Brief, Angle Picker, Hook Lab, Shot Planner, Script & Caption |
| 4. Ảnh mẫu mặc áo ✋ | Probe Look, Fidelity Check, Approve Look |
| 5. Keyframe | Keyframe Studio (map theo Shot), Fidelity Check, Approve Keyframes |
| 6. Clip ✋ | Clip (map, `tier` nháp/final), Approve Draft |
| 7. Kiểm tra | Clip Check, Compliance |
| 8. Ghép & Xuất | Voice/Music, Pick Best, Zip/Join, Assemble, Export Pack; `Budget` là lớp engine chạy ngầm |

Ký hiệu chi phí: 🆓 cục bộ · 🧠 gọi LLM (rẻ) · 💳 tốn credit Flow · 🖼 hạn mức tài khoản ChatGPT · ✋ cổng duyệt.

### A. Nguồn và tri thức
| Node | Vào → Ra | Ghi chú |
|---|---|---|
| **Garment Source** 🆓 | ảnh/URL → `Photos` | Tải nhiều ảnh theo vai (trước, sau, chi tiết, nhãn), giá/khuyến mãi/size |
| **Fact Sheet** 🧠 | `Photos` → `Garment` | Gemini trích xuất, người dùng sửa; tính **điểm rủi ro**; nguồn sự thật của mọi bước |
| **Cast** 🖼 | ảnh/mô tả → `Cast` | Thư viện dùng lại giữa các sản phẩm của shop; khóa theo phiên bản |
| **Style** 🧠 | ảnh tham chiếu → `Style` | Có "Standing Don'ts"; tạo 1 khung phong cách để duyệt |
| **Brief** 🆓 | form → `Brief` | Nền tảng đích quyết định hồ sơ tuân thủ |
| **Performance Log** 🆓 (sau) | số liệu thật → ưu tiên | Ghi lượt xem/đơn theo gói xuất; làm "prior" cho Angle Picker |

### B. Lập kế hoạch (chỉ LLM)
| Node | Vào → Ra | Ghi chú |
|---|---|---|
| **Angle Picker** 🧠 | `Garment`+`Brief` → `Angle[]` | Xếp hạng góc kể theo rủi ro: áo họa tiết/logo bị hạ điểm với góc cần xoay người |
| **Hook Lab** 🧠 | `Angle`+`Garment` → `Hook[]` | Thư viện: đối lập trước/sau, nói thẳng vào máy, câu hỏi nỗi đau, hình ảnh bất ngờ, con số tín hiệu. Phải liên quan sản phẩm, 3–6 giây đầu |
| **Shot Planner** 🧠 | `Angle`+`Garment`+`Cast`+`Style` → `Shot[]` | Giới hạn mức chuyển động theo rủi ro; gán shot nào dùng ảnh thật |
| **Script & Caption** 🧠 | `Shot[]`+`Brief` → lời thoại, chữ, caption | Chặn lời chứng ngôi thứ nhất giả; quét "không được nói" |

### C. Tạo nội dung (tốn tiền)
| Node | Vào → Ra | Ghi chú |
|---|---|---|
| **Probe Look** 🖼 | `Garment`+`Cast`+`Style` → ảnh `Look` ứng viên (1–4) | Khung thăm dò: ảnh GPT mặc đúng áo với ảnh thật làm tham chiếu |
| **Keyframe Studio** 🖼 *(map theo `Shot`)* | `Look`+`Shot` → `KeyframePair` | Khung đầu/cuối mỗi shot, bám `Look`; neo đúng áo ở hai đầu clip |
| **Clip** 💳 *(map theo `KeyframePair`)* | `KeyframePair`+`Shot` → `Clip` | Tham số `tier`, thời lượng; **đầu vào là keyframe đã duyệt, không phải clip trước** |
| **Voice/Music** 🆓/🧠 | lời thoại → audio | Dùng lại Voices và thư viện nhạc hiện có |

### D. Kiểm tra
| Node | Vào → Ra | Ghi chú |
|---|---|---|
| **Fidelity Check** 🧠 | ảnh + `Garment`+`Photos` → `Report` | Checklist: dài, cổ, tay, form, màu, họa tiết, logo, nút/túi |
| **Clip Check** 🧠 | `Clip`+`Garment` → `Report` | Tách khung đầu/giữa/cuối, so với áo thật; **luật cứng**: logo hiện/mất/đổi dạng, hoặc xoay tạo bố cục họa tiết mới ⇒ lỗi |
| **Compliance** 🆓 | gói + hồ sơ nền tảng → `Report` | Nhãn AI theo nền tảng, quét lời quảng cáo, tỉ lệ/độ dài, phát hiện lời chứng giả |

### E. Cổng duyệt ✋
| Node | Duyệt cái gì | Mặc định |
|---|---|---|
| **Approve Look** | Chọn 1 ảnh `Look` làm chuẩn | Luôn bật (khóa trước khi tốn tiền hàng loạt) |
| **Approve Keyframes** | Cả bộ keyframe | Tự qua nếu Fidelity pass hết và rủi ro thấp |
| **Approve Draft** | Chọn clip nháp nào lên final | Luôn bật (cổng trước 720p) |

Cổng cho phép: duyệt, từ chối kèm ghi chú (ghi chú đi vào prompt lần chạy lại), duyệt một phần danh sách.

### F. Điều khiển và đầu ra
| Node | Vai trò |
|---|---|
| **Budget** 🆓 | Trần credit + ước tính; chặn chạy nếu vượt; đối soát số dư thật từ kết quả submit |
| **Pick Best** 🆓 | Chọn tốt nhất trong ứng viên (tay hoặc theo điểm `Report`) |
| **Zip/Join** 🆓 | Ghép danh sách (Hook × thân video) |
| **Assemble** 🆓 | Ghép hook + thân + CTA, chữ, âm thanh (ffmpeg cục bộ) |
| **Export Pack** 🆓 | File theo nền tảng + caption + hashtag + báo cáo tuân thủ + provenance JSON |

## 5. Đồ thị mẫu "Lookbook / OOTD" (nhóm trực quan để nhìn gọn)

```
╔ KHÁCH HÀNG & SẢN PHẨM ═══════════╗   ╔ BỐI CẢNH ═══════════╗
 [Garment Source]→[Fact Sheet]─┐      [Cast]──┐   [Style]──┐
 [Brief]──────────────────────┐│                │            │
╚═════════════════════════════╝│                │            │
                               ▼                ▼            ▼
 [Angle Picker]→[Hook Lab]     ┌───────→ [Probe Look] → [Fidelity Check] → ✋Approve Look
        │            │         │                                    │
        └→[Shot Planner]───────┘                                    ▼
                │                                          [Keyframe Studio ×N]
                ├→[Script & Caption]                               │
                │                                      [Fidelity Check] → ✋Approve Keyframes
                ▼                                                  ▼
           [Voice/Music]                              [Clip ×N  tier=draft] → [Clip Check]
                │                                                  │
                │                                       ✋Approve Draft → [Clip ×N tier=final]
                ▼                                                  ▼
                └──────────────→ [Assemble] ← [Pick Best] ← [Clip Check]
                                       │
                          [Compliance] → [Export Pack] ←─ [Budget]
```

**Biến thể hook:** `Hook Lab` ra 5 hook → `Clip` (map) làm 5 clip mở đầu; clip thân (2 clip) có vân tay không đổi ⇒ dùng cache; `Zip/Join` + `Assemble` ra 5 video. Với đơn giá đã xác minh (10 giây: 10 credit ở 360p, 30 ở 720p): 5 hook + 2 thân = 7 clip = **70 credit nháp / 210 credit chốt**, thay vì 15 clip.

**Nháp → chốt:** cùng node `Clip`, đổi `tier`; sau `Approve Draft` chỉ phần tử được chọn chạy ở 720p.

## 6. Quy tắc nghiệp vụ thời trang nhúng trong node

- **Rủi ro → giới hạn chuyển động** (Shot Planner áp, Clip Check kiểm):
  trơn/đơn sắc = cho đi/xoay; họa tiết nhỏ/kẻ sọc/hoa = chuyển động nhẹ, tránh xoay; ren/trong suốt/vải bóng = cận ảnh thật, chuyển động tối thiểu; **có logo/chữ = chỉ dùng logo từ ảnh thật, không để AI vẽ lại**.
- **Neo bằng keyframe:** clip nhận keyframe đầu/cuối đã duyệt. Liên tục nhân vật đến từ `Cast`+`Look`, không từ khung cuối clip trước. Hệ quả: tạo lại một clip không ảnh hưởng clip khác.
- **Cấu trúc mỗi video:** hook (3–6s, liên quan sản phẩm) → thông điệp lợi ích → CTA; hiểu được khi tắt tiếng nên chữ là một phần của shot.
- **Chặn lời chứng giả:** nhân vật AI không được nói "tôi đã mua và dùng" như khách thật (FTC Mỹ cấm đánh giá giả do AI tạo; luật Việt Nam cần xem riêng).
- **Nhãn AI theo nền tảng:** TikTok Shop yêu cầu khai báo; Shopee yêu cầu gắn nhãn và theo BigSeller video bị gắn nhãn mất hoa hồng; Meta gắn "AI info" khi cảnh/người không có thật. `Compliance` sinh chú thích đề xuất và cảnh báo.

### 6.1 Prompt (nguyên tắc; chi tiết ở PLAN §3.6)

Mỗi bước gọi AI có **prompt mặc định đi kèm** và người dùng **tự viết/sửa** được (mặc định hệ thống → bản của người dùng → ghi đè theo chiến dịch/shot → ô "thay đổi tùy chọn"). Prompt cuối cùng xem trước được, thứ tự ảnh tham chiếu là một phần của prompt (client ChatGPT ảnh gán ảnh theo thứ tự), và prompt đã dựng nằm trong vân tay + provenance. Prompt ảnh mặc định ban đầu là mẫu "look sheet" (Ảnh 1 = nhân dạng, Ảnh 2 = trang phục, bố cục chia đôi chân dung + turnaround) do người dùng cung cấp; prompt video soạn và hiệu chỉnh ở giai đoạn Clip.

## 7. Engine thực thi

- **Lập lịch:** sắp xếp tô-pô, chạy lười (lazy) theo đích yêu cầu ("Chạy đến node này"). Với mỗi node: tính vân tay → trùng cache thì bỏ qua → còn lại xếp hàng.
- **Dry-run:** trước khi chạy hiển thị node sẽ chạy / đã cache / đang chờ duyệt và tổng credit; cần xác nhận khi có node 💳. `Budget` chặn nếu vượt trần.
- **Làn tài nguyên (resource lanes):** Flow (credit, nhịp gửi; thực nghiệm 3 lần gửi cách ~9 giây không bị chặn; render song song được), nhóm tài khoản ChatGPT (xoay tài khoản, đụng giới hạn thì chờ), Gemini (LLM), ffmpeg cục bộ. Mỗi làn có hàng đợi, độ ưu tiên, hủy.
- **Idempotent:** khóa việc = vân tay + số lần thử; việc đang chạy trùng vân tay thì **gia nhập, không gửi lại**. Lỗi mạng sau khi đã gửi thì khôi phục từ Flow chứ không gửi lại (ràng buộc có sẵn, xem ghi chú aborted generation).
- **Stale/Pin:** upstream đổi → downstream "cũ" + lý do; bản cũ giữ nguyên; ghim để không bị đề nghị chạy lại.
- **Lưu bền:** đồ thị + kho artifact + sổ chạy (run ledger) vào DB; tự lưu, hoàn tác, ảnh chụp phiên bản đồ thị; tiếp tục được sau khi khởi động lại; hủy được job.
- **Đối soát credit:** số dư trả về trong kết quả submit của Flow (đã xác minh: `payload[1]`) cập nhật `Budget` ngay.

## 8. Giao diện theo logic (chưa nói hình thức)

- Mỗi node có huy hiệu trạng thái: đã cache / cũ / đang chạy / cần duyệt / lỗi / ghim; node 💳 hiện **credit sẽ tốn**.
- Node map hiển thị dải phần tử (hook 1..5, shot 1..3) với trạng thái từng phần tử.
- Khung nhóm (Brief, Look, Storyboard, Render, Giao hàng) chỉ để nhìn; không ràng buộc logic.
- Chế độ so sánh các ứng viên; xem lịch sử phiên bản của từng node; mẫu video là **đồ thị con** mở rộng được, có tham số lộ ra ngoài (nhiều node nhưng có thể thu gọn).

## 9. Giữ / đổi / bỏ so với hiện tại

| Hiện tại | Mới |
|---|---|
| `ProductAssetsNode`, `AssetInputNode` | `Garment Source` |
| `GeminiAnalysisNode` | `Fact Sheet` + các node Check |
| `CharacterSceneNode` (+ canonical profile) | `Cast` + `Style` |
| `GptScriptNode` (thể loại, số clip) | `Angle Picker`, `Hook Lab`, `Shot Planner`, `Script & Caption` |
| `VeoFlowStudioNode` (chuỗi nối frame) | `Keyframe Studio` + `Clip` (map, neo keyframe) |
| `SceneVideoNode`, `ExportTimelineNode` | `Assemble`, `Export Pack` |
| `graphResolver.ts` (viết tay từng cặp) | bộ giải cổng có kiểu |
| `workflowState.ts` xóa kết quả | vân tay + stale + pin |
| `workflowRunner.ts` một đường chạy | bộ lập lịch có làn và dry-run |

**Giữ:** không tự gửi lại lệnh tạo; tối đa 3 ảnh tham chiếu mỗi lần; tạo job hủy được; chỉ commit khi người dùng yêu cầu.

## 10. Phân kỳ

Đã chuyển thành kế hoạch chi tiết 10 giai đoạn (GĐ0 thử rủi ro → GĐ1 engine → GĐ2 khung UI → GĐ3–6 sản phẩm/người mẫu/ảnh mẫu/kế hoạch/keyframe → GĐ7 clip → GĐ8 kiểm tra và xuất → GĐ9 biến thể hook + Budget → GĐ10 chuyển đổi) tại [PLAN_ai_workflow_campaign.md](PLAN_ai_workflow_campaign.md). Thứ tự giữ nguyên tinh thần cũ: lõi engine trước, nhánh "Look" rẻ để kiểm chứng ý tưởng, rồi mới tới video; Angle Picker có prior từ Performance Log và nhập hàng loạt để sau cùng.

## 11. Chưa biết / rủi ro

- **Frames/ingredients cho Omni 1.2:** model id đã thấy trong HAR (`macaron_cookie_i2v_fl_10s`, `_360p`, `r2v_*`) nhưng chưa làm upload ảnh; Omni 1.1 bị gỡ 5/12/2026. Nhánh video bị chặn bởi việc này.
- **Độ dài khác 10s** của Omni 1.2 chưa có HAR.
- Chất lượng thật của `Fidelity Check`/`Clip Check` bằng Gemini chưa đo; là đề xuất của tôi, các nguồn chỉ khuyên duyệt tay từng khung. Cần thử trên áo thật trước khi tin.
- Hiệu quả các mẫu tại Việt Nam chưa có dữ liệu (không tìm được bảng xếp hạng thời trang TikTok Shop VN; chỉ có số áo dài ~2 triệu đơn tháng 1/2026 từ Index.vn qua kết quả tìm kiếm).
- Chưa tìm được nguồn về chuẩn cận chất liệu và thông tin size trong video thời trang; phần cận chất liệu là suy luận.
- Số lượng node lớn: cần đồ thị con thu gọn và mẫu dựng sẵn, nếu không người mới sẽ bị choáng.
