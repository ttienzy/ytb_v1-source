# Plan: tái thiết kế Motion Control (logic prompt + giao diện)

Trạng thái (2026-11-22): **GĐ 0 + GĐ 1 đã làm; giao diện cập nhật trên canvas hiện có.**

Quyết định của chủ dự án: (1) chỉ có ảnh nhân vật → **giữ nền video mẫu** (kiểu A) là mặc định, A′ là tùy chọn "Nền: Ảnh nhân vật";
(2) **giữ canvas**, không làm studio 3 cột — chỉ làm mới các node, Inspector và nhãn (mục 5 bên dưới chỉ còn là tham khảo);
(3) GĐ 2 (chạy thật trên Flow) **chưa duyệt ngân sách** — chưa chạy lượt nào, các câu tiếng Anh ở mục 4.2 chưa kiểm chứng bằng video thật.

Đã làm: `services/motionPromptBuilder.ts` viết lại theo v2 (kiểu chỉnh, khối Thay đổi/Giữ nguyên tự sinh, chip tùy chọn, ghi chú
"thay người nào", chặn kiểu D khi trống, chữ ký bộ ảnh để cảnh báo prompt sửa tay bị lệch); preset bỏ câu trùng; bỏ tự nạp
brief mặc định từ `motion_control_prompt.txt`; node Chỉ Dẫn Sáng Tạo hiện kiểu chỉnh + công tắc nền; node Prompt hiện khối tự sinh
(khóa), lỗi chặn, cảnh báo lệch ảnh (Dựng lại / Giữ bản sửa tay); Inspector: tab Nhân vật liệt kê Nhân vật 1–3 kèm ghi chú, tab
Chỉ dẫn có ô Không khí & ánh sáng (trước đây thiếu), Đổi máy quay, chip; nhãn "Veo" cũ đổi thành Flow/Thư Viện. Test: `motionPrompt.test.ts`.
Phạm vi: tab Motion Control của "Canvas AI" (`Frontend/src/features/workflow/components/MotionControlWorkspace.tsx`, `MotionInspectorPanel.tsx`, `nodes/motion/*`, `services/motionPromptBuilder.ts`, `services/motionReferences.ts`, preset `Backend/prompts/workflow/motion_prompt_presets.json`). Đường gửi Flow (`video_edit`, Omni 1.2 `macaron_cookie_edit`, 1–3 ảnh) **không đổi**.

---

## 1. Hiện trạng

### 1.1 Logic prompt (đã đọc code, in ra prompt thật)

Prompt = câu mở đầu tự sinh theo ảnh đang có (`referenceOpening`) + 5 ô chữ người dùng (Chỉ đạo chính, Chuyển động, Camera, Bối cảnh, Phong cách) + "Điều cần tránh" → ghép thành một đoạn.

Prompt mặc định in ra từ `buildStructuredPrompt(DEFAULT_MOTION_CREATIVE_DIRECTION, …)`:

| Ảnh đang có | Prompt gửi đi |
|---|---|
| không ảnh | Edit the input video, keeping its motion and timing. Keep the movement natural and fluid, matching the timing and rhythm of the input video. Keep the camera path and framing of the input video. Photorealistic, with lighting that matches the scene. |
| nhân vật | Apply the pose and motion from the input video to the person in the image. Keep the face, hairstyle and outfit from the image unchanged. Keep the movement natural and fluid, matching the timing and rhythm … Keep the camera path … Photorealistic … |
| bối cảnh | Keep the people and their motion from the input video, and move them into the setting shown in the image. Keep the movement natural … |
| nhân vật + bối cảnh | Apply the pose and motion from the input video to the person in Image 1, placed in the setting shown in Image 2. Keep the face, hairstyle and outfit from Image 1 unchanged. Keep the movement natural … |
| 2–3 nhân vật (mới thêm hôm nay) | ghép từng người theo thứ tự trái → phải, "Image N", bối cảnh là ảnh cuối |

### 1.2 Giao diện

- Canvas React Flow với 4 node cố định (Nguyên liệu, Chỉ dẫn sáng tạo, Prompt cấu trúc, Xuất video) + node tùy chọn "Tạo ảnh nhân vật mới"; dây nối chỉ để trang trí, không có ý nghĩa dữ liệu; thanh bên trái liệt kê "thành phần" nhưng bấm vào chỉ mở Inspector.
- Mỗi thứ có hai chỗ sửa (trên node và trong Inspector). Inspector là ngăn kéo 1.521 dòng; workspace 2.107 dòng; tổng phần Motion ~7.400 dòng gồm CSS.
- Nhãn cũ/không khớp: "Tạo Video (Veo)", "Thư Viện Veo", "Reference Inputs (Ingredients)" — thực tế là chỉnh video Omni 1.2 trên Flow, 30 credit/lượt.

---

## 2. Đánh giá feedback nhận được (điểm feedback tự chấm prompt: 6.5/10)

| # | Ý của feedback | Nhận định | Quyết định |
|---|---|---|---|
| F1 | "Vai trò tham chiếu" chung chung: *Edit the input video, keeping its motion and timing* | **Đúng một phần.** Đó là câu cho trường hợp **không có ảnh** (ảnh chụp màn hình lúc chưa nạp ảnh). Vấn đề thật lớn hơn: không ảnh + chỉ đạo mặc định = **không yêu cầu thay đổi gì**, vẫn tốn 30 credit. | Chế độ "không ảnh" bắt buộc có câu mô tả thay đổi; chặn chạy nếu trống. |
| F2 | Thiếu lệnh ánh xạ vai trò khi cắm ảnh Nhân vật/Bối cảnh; cần câu mở đầu đổi theo slot | **Sai về hiện trạng** — câu mở đầu đã đổi theo slot từ trước (bảng 1.1). Nhưng có **lỗi thật liên quan**: sửa tay prompt thì câu mở đầu bị "đóng băng", thêm/bỏ ảnh sau đó không cập nhật (đã xác minh, `activePrompt = isCustomPrompt ? customPromptText : …`); và nếu chữ người dùng có "image 1"… thì câu mở đầu bị bỏ hẳn (`MENTIONS_ROLES`). | Sửa hai lỗi này (Giai đoạn 0). |
| F3 | Lặp từ nặng giữa khối 1 và Chỉ đạo chính ("timing", "of the input video") | **Đúng.** Prompt không ảnh nhắc "input video" 4 lần, "timing" 2 lần; preset "choreography" cũng lặp. | Mỗi ràng buộc chỉ nói một lần, do code sinh (mục 4.2). |
| F4 | Câu thay người nên nói rõ "Completely replace… Do not retain any facial features or clothing from the original person" | **Đúng hướng.** Câu hiện tại theo mẫu Google ("apply the pose and motion … to the person in the image") nhưng không nói người gốc phải biến mất → dễ lai mặt/lai đồ. Google cũng dùng "do not" trong ví dụ chính thức. | Thêm câu thay thế rõ + một câu "không giữ mặt/đồ của người gốc". |
| F5 | Thêm vật lý tóc/vải, giữ tỉ lệ cơ thể, "zero flickering or morphing" | **Một phần.** Tỉ lệ cơ thể: hợp lý khi thay người (người mới khác vóc người trong video). Tóc/vải: hợp với preset thời trang/vũ đạo, không cần mặc định. "Zero flickering or morphing", "strictly", "exact" dồn dập: không có nguồn nào cho thấy có tác dụng; hướng dẫn chỉnh video khuyên prompt ngắn, đổi một thứ. | Thành tùy chọn bật/tắt, không nhồi mặc định. |
| F6 | Camera: thêm "lens perspective… no unintended zoom or drift" | **Đúng nhẹ.** "lens perspective" có ích khi thay bối cảnh. | Gộp vào câu "Keep" duy nhất. |
| F7 | Phong cách: thêm contact shadows, đồng bộ ánh sáng | **Đúng khi thay bối cảnh/nhân vật** (ghép người vào nền mới). Thừa khi chỉ đổi phong cách. | Tự bật khi có ảnh bối cảnh. |
| F8 | Gọi ảnh là "the character reference image" / "the background reference image" | **Ổn với 1 ảnh mỗi loại**, mơ hồ khi có 2–3 nhân vật. Google dùng cả hai kiểu (tên đánh số `image-0` và mô tả "the image environment"). | Dùng cả số và vai trò: "Image 1 (character)". |

**Kết luận về feedback:** chẩn đoán đúng về lặp ý, câu không ảnh quá mơ hồ, thiếu lệnh "bỏ người gốc" và thiếu khớp ánh sáng khi ghép nền. Sai ở chỗ cho rằng prompt không đổi theo slot. Đề xuất viết lại thì quá dài và nhiều từ "strictly/zero/exact", ngược với hướng dẫn "đổi một thứ, giữ phần còn lại". Mình chấm feedback khoảng **6/10**: hữu ích để sửa nội dung từng câu, không nên dùng nguyên văn.

Điều quan trọng mà **cả prompt hiện tại lẫn feedback đều bỏ sót**: khi chỉ có ảnh nhân vật, **nền lấy từ đâu**? Ví dụ chính thức của Google ("Apply the pose and motion from input video to provided character from this image") là kiểu "làm sống ảnh": nền thường theo ảnh nhân vật. Người dùng app thường muốn giữ nền video mẫu. Hiện prompt không nói gì → kết quả không đoán trước được.

---

## 3. Research (2026-11-22)

**Từ Google (chính thức):**
- Mẫu chuyển động: *"Apply the pose and motion from input video to provided character from this image. Apply style from image reference to the new video"*; đặt người vào môi trường của ảnh: *"Transport the violinist to the image environment"*; giữ phần không đổi: *"edit this keeping everything the same…"*, *"Keep the environment, only change styles."*; Google dùng "do not" trong ví dụ (*"do not show the drawing in the final video"*). Cách gọi nhiều tệp: đánh số (`image_0.png`, `image-1`) hoặc mô tả ("the provided image"); không có cú pháp `@image`. — [Introducing Gemini Omni](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-omni/)
- Flow: thêm tối đa 3 ảnh tham chiếu khi chỉnh; video tải lên ≤ 60 s / 1 GB, cắt đoạn ≤ 10 s (≤ 15 s với gói AI Plus/Pro/Ultra); chỉnh video tính credit theo giây như tạo thường. — [Flow Help: Edit videos & build scenes](https://support.google.com/flow/answer/16935718?hl=en)

**Bên thứ ba (tham khảo, chưa kiểm chứng):**
- Mẫu "Change only: [một thứ]. Keep everything else the same. Preserve: subject identity, action timing, camera framing, lighting, background…"; đổi nhiều thứ một lúc (người + đồ + cảnh + máy) làm tăng lỗi; lỗi hay gặp: trôi danh tính, mặt/tay/nền đổi ngoài ý muốn, đổi cảnh toàn bộ khó hơn. — [Atlas Cloud: Omni Flash video editing workflow](https://www.atlascloud.ai/blog/tips/gemini-omni-1.1-flash-video-editing)
- Nói rõ vai trò từng tệp đính kèm, nếu không model tự đoán; kết thúc prompt chỉnh bằng "Keep everything else the same"; prompt đơn giản cho chỉnh video. — [Google Omni Prompting Guide](https://roo.beehiiv.com/p/google-omni-prompting-guide-every-technique-that-actually-works), [MindStudio: Omni Flash tutorial](https://www.mindstudio.ai/blog/how-to-use-google-flow-gemini-omni-video-editing)

**Chưa có nguồn nào nói về:** nhiều người trong một video chỉnh, nhấp nháy, tỉ lệ cơ thể, khớp bóng đổ. Các phần này chỉ kiểm chứng được bằng chạy thật (mục 6, Giai đoạn 2).

---

## 4. Thiết kế logic mới

### 4.1 "Kiểu chỉnh" tường minh (suy ra từ ảnh, hiện rõ trên giao diện)

| Kiểu | Khi nào | Thay | Giữ từ video mẫu |
|---|---|---|---|
| **A. Thay người** | có ≥1 ảnh nhân vật, không ảnh bối cảnh | người → người trong ảnh | chuyển động, nhịp, máy quay, khung hình, **nền + ánh sáng** (mặc định) |
| **A′. Làm sống ảnh nhân vật** | như A, người dùng chọn "Nền lấy từ: ảnh nhân vật" | toàn bộ hình → ảnh nhân vật | chuyển động, nhịp (đúng mẫu chính thức của Google) |
| **B. Thay bối cảnh** | chỉ có ảnh bối cảnh | nền → ảnh bối cảnh | người, chuyển động, nhịp, máy quay |
| **C. Thay người + bối cảnh** | cả hai | người + nền | chuyển động, nhịp, máy quay; cảnh báo "đổi 2 thứ một lần, rủi ro cao hơn" |
| **D. Chỉnh theo mô tả** | không ảnh | đúng một điều người dùng viết | mọi thứ khác; **bắt buộc có mô tả thay đổi**, trống thì chặn chạy |

Nhiều nhân vật (2–3) áp vào A/A′/C: ghép trái → phải; mỗi ô nhân vật có thêm một **ghi chú ngắn tùy chọn** (ví dụ "người mặc áo đỏ, bên trái") để dùng khi thứ tự trái → phải không rõ.

### 4.2 Cấu trúc prompt: Thay đổi → Chỉ đạo → Giữ nguyên (mỗi ý nói đúng một lần)

1. **Thay đổi** (code sinh theo kiểu chỉnh, kèm vai trò từng ảnh `Image N (character|setting)`).
2. **Chỉ đạo** (người dùng, một ô chính + preset): điều muốn thêm về diễn xuất/không khí. Preset viết lại để **không lặp** các câu "giữ" (vd. choreography chỉ còn "Copy every move and beat of the dance.").
3. **Tùy chọn** (chip bật/tắt, mỗi chip một câu ngắn): giữ vóc dáng người trong ảnh (mặc định bật ở A/C) · khớp phối cảnh, ánh sáng, bóng đổ (mặc định bật ở B/C) · tóc và vải chuyển động tự nhiên · ảnh chân thực · không thêm người/chữ.
4. **Giữ nguyên** (code sinh, một câu duy nhất theo kiểu chỉnh): "Keep everything else the same as the input video: …".

Bản nháp tiếng Anh (sẽ chốt sau khi chạy thử Giai đoạn 2):

- **A:** Replace the person in the input video with the person in Image 1 (character), performing the same pose, motion and timing. Use the face, hairstyle, body shape and outfit from Image 1; do not keep the original person's face or clothes. *[Chỉ đạo]* Keep everything else the same as the input video: background, lighting, camera path and framing.
- **A′:** Apply the pose and motion from the input video to the person in Image 1 (character), in the setting shown in Image 1. *[Chỉ đạo]* Keep the face, hairstyle and outfit from Image 1, and the timing of the input video.
- **B:** Move the person from the input video into the setting shown in Image 1 (setting), with the same pose, motion and timing. Match the setting's perspective, scale and lighting, with natural contact shadows. *[Chỉ đạo]* Keep the person's face, hair and outfit, the camera path and framing the same as the input video.
- **C:** Replace the person in the input video with the person in Image 1 (character) and place them in the setting shown in Image 2 (setting), with the same pose, motion and timing. Use the face, hairstyle, body shape and outfit from Image 1; do not keep the original person or background. Match the setting's perspective, scale and lighting, with natural contact shadows. *[Chỉ đạo]* Keep the camera path and framing of the input video.
- **D:** *[Thay đổi người dùng viết]*. Keep everything else the same as the input video: the people, their motion and timing, the camera path, framing and lighting.

### 4.3 Sửa tay prompt

- Khối **Thay đổi** luôn do code sinh (khóa, có nút "Mở khóa sửa"). Phần còn lại sửa tự do.
- Nếu đã mở khóa/sửa tay mà người dùng đổi ảnh: hiện dải cảnh báo "Ảnh đã đổi — prompt tự viết có thể gọi sai Image N" + nút "Dựng lại".
- Bỏ cơ chế "thấy chữ image 1 thì bỏ cả câu mở đầu".

### 4.4 Kiểm tra trước khi chạy (thêm vào `missingReasons`)

- Kiểu D mà ô thay đổi trống → chặn.
- Prompt > ~700 ký tự → cảnh báo (không chặn).
- Kiểu C → nhắc "đổi 2 thứ một lần; nếu lệch, thử A trước rồi B".
- Tổng ảnh > 3 → chặn (đã có).

### 4.5 Code

- Tách logic prompt ra module thuần `services/motionPromptV2.ts` (kiểu chỉnh, khối Thay đổi/Giữ, chip, kiểm tra) + test `node:test`; giữ `motionPromptBuilder.ts` cho tới khi gỡ UI cũ.
- Preset: thêm trường `version: 2`, bỏ câu "giữ camera/nhịp" khỏi preset; giữ đọc preset cũ (bỏ qua các câu trùng).
- Bản nháp lưu localStorage hiện có (`motion_creative_direction_v1`) chuyển sang khóa v2, phần người dùng đã tự viết giữ nguyên (như `migrateLegacyCreative`).

---

## 5. Thiết kế giao diện mới

Bỏ canvas giả (dây trang trí, thanh "thành phần", Inspector trùng chức năng). Motion Control là một quy trình thẳng nên dùng **bố cục studio 3 cột**, mọi thứ sửa tại chỗ:

```
┌ Motion Control ─ [Project: …▾] ───────────────────────────── 30 credit/lượt · [▶ Tạo video] ┐
│ 1 NGUYÊN LIỆU            │ 2 CHỈ ĐẠO                          │ 3 XUẤT & KẾT QUẢ           │
│ ┌ Video mẫu (bắt buộc) ┐ │ Kiểu chỉnh: [A Thay người] (tự nhận)│ Tỉ lệ 9:16 | 16:9          │
│ │ ▶ preview            │ │ Nền lấy từ: (•) video mẫu ( ) ảnh  │ Độ dài 3–10 s (theo đoạn cắt)│
│ │ |====[3s──10s]====|  │ │ Preset: [Vũ đạo ▾]                 │ Biến thể: 1 2 3 4          │
│ └──────────────────────┘ │ Chỉ đạo: [________________]        │ ✓ Đủ điều kiện / lý do thiếu│
│ Nhân vật (2/3 ảnh)       │ Tùy chọn: [vóc dáng✓][ánh sáng][tóc│ ┌ Kết quả ───────────────┐ │
│ [1 trái ][2 ][+ Thêm]    │  & vải][chân thực]                 │ │ v1 ▶  v2 ⟳ Thử lại      │ │
│  ghi chú: "áo đỏ"        │ ┌ Prompt gửi đi ───────── 412 ký tự┐│ │ so sánh với video mẫu  │ │
│ Bối cảnh [ảnh] [x]       │ │[Thay đổi 🔒][Chỉ đạo][Giữ nguyên] ││ └────────────────────────┘ │
│ [✨ Tạo ảnh nhân vật mới]│ └───────────────────────────────────┘│ Video dài > 10 s →        │
└──────────────────────────┴────────────────────────────────────┴───────────────────────────┘
```

- **Cột 1:** video mẫu có thanh cắt đoạn ngay trên preview; danh sách nhân vật kéo-thả để đổi thứ tự (thứ tự = trái → phải = Image N), mỗi thẻ có ghi chú; bộ đếm N/3 ảnh; "Tạo ảnh nhân vật mới" mở hộp thoại, kết quả đổ vào thẻ nhân vật được chọn (không còn chỉ ô 1).
- **Cột 2:** kiểu chỉnh hiện dạng chip với một dòng giải thích ("Giữ nền video mẫu, thay người"); prompt gửi đi tô màu theo khối, khối tự sinh có khóa.
- **Cột 3:** cấu hình xuất, chi phí ước tính (30 credit × biến thể), danh sách lý do chưa chạy được, kết quả + so sánh với video mẫu, thử lại từng biến thể, lối vào Motion dài.
- Nhãn sửa cho đúng: "Thư viện" (không "Veo"), "Tạo video (Flow · Omni 1.2)".
- Tách component, mỗi file < ~400 dòng: `MotionStudio.tsx`, `MotionInputsColumn.tsx`, `MotionDirectionColumn.tsx`, `MotionOutputColumn.tsx`, `MotionTrimBar.tsx`, `MotionCharacterList.tsx`. Logic chạy (upload, submit, poll, retry) chuyển nguyên trạng sang hook `useMotionRun.ts` để không đụng đường Flow đã chạy.

---

## 6. Lộ trình

| GĐ | Nội dung | Credit | Kiểm chứng |
|---|---|---|---|
| **0** | Sửa lỗi nhỏ trên UI hiện tại: prompt sửa tay bị đóng băng khi đổi ảnh (cảnh báo + "Dựng lại"); bỏ `MENTIONS_ROLES` bỏ cả câu mở đầu; kiểu không ảnh phải có mô tả thay đổi | 0 | test `node:test` |
| **1** | `motionPromptV2.ts` (kiểu chỉnh A/A′/B/C/D, khối Thay đổi/Giữ, chip, kiểm tra) + preset v2 + test; nối vào UI hiện tại sau cờ "Prompt v2" | 0 | test, so sánh bảng prompt cũ/mới |
| **2** | Chạy thật để chốt câu: 1 video mẫu 5 s, mỗi kiểu A, A′, B, C cũ vs mới, + 1 lượt 2 nhân vật | ~10 lượt × 30 = **~300 credit** — **cần bạn duyệt** | ghi kết quả vào plan này (giữ danh tính, nền, lai mặt, nhịp) |
| **3** | Giao diện studio 3 cột + `useMotionRun` + Playwright e2e (nạp video giả, thêm 2 nhân vật, đổi kiểu, xem prompt; không gửi Flow) + cập nhật trợ giúp F1 | 0 | e2e, `test:help`, `tsc` |
| **4** | Gỡ canvas cũ, Inspector, node Motion; xóa CSS thừa | 0 | test toàn bộ |

---

## 7. Câu hỏi cần bạn chốt

1. Mặc định khi chỉ có ảnh nhân vật: **giữ nền video mẫu (A)** hay **nền theo ảnh nhân vật (A′, mẫu của Google)**? Plan đang đề xuất A.
2. Có bỏ hẳn giao diện canvas cho Motion Control (thay bằng studio 3 cột) không, hay giữ canvas làm chế độ phụ?
3. Duyệt ngân sách chạy thử Giai đoạn 2 (~300 credit) hay chạy ít hơn (chỉ A và C, ~120 credit)?
