# Kế hoạch nâng chất lượng hình ảnh Chiến dịch AI (v2.2)

> **ĐÃ LƯU TRỮ (2026-11-12), chỉ để tham khảo lịch sử.** Đã triển khai nhưng bị thay một phần bởi v2.4: bước keyframe/frame_pair_check đã bỏ. Hiện hành: [PLAN_campaign_v24_storyboard_ingredients.md](../PLAN_campaign_v24_storyboard_ingredients.md). Đường dẫn file và số dòng trong tài liệu phản ánh thời điểm viết.


Ngày: 2026-11-10. Nguồn: rà soát của chuyên gia (dán vào phiên) đối chiếu với dữ liệu thật của campaign `ab172628e62e` (3 shot, 3 clip 720p, video 18 s) và code hiện tại.

## 1. Đối chiếu nhận định với dữ liệu thật

| # | Nhận định | Kết luận | Bằng chứng |
|---|---|---|---|
| 1 | Lời thoại và hình mâu thuẫn ("đồ ở nhà… lột xác" nhưng giây 0 đã mặc đủ set) | **Đúng, lỗi nặng nhất** | hook:1 loại `contrast`, `visual` = "plain homewear quickly transitions into the oversized white…". Keyframe/clip chỉ có MỘT bộ đồ, không có cảnh "trước". Không bước nào kiểm lời thoại với hình. |
| 2 | Camera tĩnh 100%, chuyển động vi mô | **Đúng** | Cả 3 shot `camera_move = static`; delta: "vén tóc", "vải rủ nhẹ", "chớp mắt". Đo độ khác nhau frame đầu/cuối của clip: 0,022 / 0,022 / 0,012 (rất thấp). |
| 2b | Nguyên nhân là cờ `gentle` của hồ sơ áo | **Đúng một phần** | `risk.motion_limit = gentle` (áo có logo) chỉ chặn chuyển động *của chủ thể*. Camera tĩnh còn do **prompt shot_plan v3 do chính mình viết**: "ĐÚNG MỘT thay đổi", "cùng chiều cao máy, cùng nền", "detail dùng minimal". Hướng dẫn nguồn ngoài nói "một hành động + một chuyển động máy", mình áp nhầm thành "một thay đổi nhỏ". |
| 2c | Người mẫu nhìn thẳng, vô hồn | **Đúng** | Mọi khung đều nét mặt trung tính nhìn máy. Do ảnh nhân vật mình tạo ("neutral calm expression") và không có trường biểu cảm nào trong shot/keyframe. |
| 3 | Phụ đề hộp đen, font Arial, che logo | **Đúng về kiểu, sai về "che logo"** | `boxcolor=black@0.55`, `arialbd.ttf`. Logo nằm ở 30–45% chiều cao, chữ ở 70–80%: không đè logo, nhưng đè quần/tay và rơi vào vùng giao diện TikTok. Dấu `->` là chữ Gemini sinh ra. |
| 4 | Nền/ánh sáng bệt | **Đúng, nhưng là lựa chọn của mình** | Style do mình nhập: "bright minimal studio or clean urban wall". Áo trắng + tường xám + ánh sáng tản. Mặc định của hệ thống cũng sơ sài, không có sáng viền hay chiều sâu. |
| 5 | Ghép nối cụt, không chuyển cảnh | **Đúng một phần** | Concat copy, cắt cứng. Với TikTok cắt cứng là bình thường; vấn đề thật là mỗi shot dài 6 s mà chỉ có chuyển động nhỏ, nên nhịp chậm. |
| 6 | Hook "trước/sau" không có shot "trước" | **Đúng** | Cùng gốc với #1; `hook` không kiểm khả năng thể hiện bằng hình. |
| 7 | "Dùng Single Frame / Ingredients cho một số shot" | **Chưa xác minh / không đúng với hạ tầng hiện có** | Omni 1.2 chỉ có 3 mô hình đã xác minh: `t2v_10s`, `i2v_fl_6s/10s` (cần CẢ hai khung), `r2v_13s/15s`. KHÔNG có model đầu-chỉ-một-khung cho Omni 1.2; "4/6/8/10 s một khung" thuộc Omni 1.1 và Veo 3.1 (đường giao diện, `provider_model_id` chưa xác minh, Omni 1.1 bị gỡ 5/12/2026). Các tỉ lệ "bám logo 90–95%…" trong bản rà soát không có nguồn. |
| 8 | "Ép `mode == i2v` là sai lầm" | **Chưa chứng minh** | Đây là lựa chọn có chủ đích (neo vào keyframe đã duyệt). Lỗi thật nằm ở cặp khung quá giống nhau và máy tĩnh, không phải ở chế độ. Cặp khung có khác biệt rõ (shot 1 vén tóc) đã cho chuyển động đọc được. |

**Tự phê bình:** cổng `frame_pair_check` mình thêm chỉ kiểm cặp khung, không kiểm lời thoại với hình, nên không bắt được lỗi #1. Hook mặc định lấy `hook:1` dù không thể thể hiện được.

## 2. Research (tóm tắt, nguồn chủ yếu là blog thương mại)

- **Chuyển động thời trang:** một chuyển động máy chính mỗi shot; đi tới máy hoặc máy lùi theo nhịp bước; chuyển động vải gắn với bước đi; vi chuyển động người (thở, chớp mắt, quay nhẹ) chỉ là phụ. Tránh chồng đi + xoay ở lần đầu. Không tìm thấy nguồn nói cách tạo vẻ "tự nhiên đời thường", cần thử.
- **Biểu cảm:** chỉ định rõ ("ánh nhìn chuyển chậm", nét mặt) trong prompt; hiện không có trường nào cho việc này.
- **Vùng an toàn TikTok:** các nguồn mâu thuẫn (chừa 17% đến 34% dưới đáy, ~12% trên, ~11% hai bên cho quảng cáo); không có tài liệu chính thức. Chọn thận trọng: khối chữ nằm trên 25% đáy.
- **Phụ đề:** chữ đậm có viền/đổ bóng, không hộp đen. `drawtext` hỗ trợ `borderw`, `shadowx/y`; font phải hỗ trợ tiếng Việt (Be Vietnam Pro ExtraBold, OFL, đã tải về `Backend/resources/fonts`).
- **Chuyển cảnh/nhịp:** `xfade` + `acrossfade`; tăng tốc clip bằng `setpts` (hình) mà không đụng tiếng thoại.
- **Hook:** ba thành phần hình/tiếng/chữ phải khớp trong 1–2 giây đầu; dạng "trước/sau" cần hai trạng thái; hook một trạng thái (thấy kết quả ngay, câu hỏi, điểm nhấn) hợp với một bộ đồ. Không có nguồn đo mức rớt người xem khi lệch.

## 3. Kế hoạch

### GĐ-F: Kịch bản khớp hình (ưu tiên 1)
- F1 `hook.txt` v2: chỉ có MỘT bộ đồ trong ảnh; cấm hứa biến hình, trước/sau, "đồ ở nhà"; hook phải thể hiện được bằng một khung đầu. `contrast` đổi nghĩa thành tương phản phong cách (đơn giản mà nổi bật), không phải hai trạng thái.
- F2 Lint hook/shot: mã `needs_unavailable_visual` / `script_claims_not_visible` bắt từ khóa biến hình (lột xác, trước/sau, biến hình, đồ ở nhà, transition…). `chosen` mặc định là hook đầu tiên KHÔNG dính cờ.
- F3 `shot_plan.txt` v4: lời thoại và chữ chỉ được nói điều khung đầu thể hiện được.
- F4 `frame_pair_check`: thêm câu hỏi `script_matches` (lời thoại + chữ so với hình), mức cảnh báo.

### GĐ-G: Chuyển động và biểu cảm
- G1 `shot_plan.txt`: `end_delta` = MỘT chuyển động RÕ (bước tới máy, xoay 3/4, tay lên tóc, máy gần/xa hơn 15–20%…), không phải "hơi hơi"; camera mặc định theo kiểu shot (hero: đẩy vào hoặc đi theo; motion: lia/xoay; detail: đẩy chậm; cta: đẩy vào); thêm trường `expression`.
- G2 Lint: `camera_static` (mọi shot đứng yên), `expression_missing`.
- G3 Keyframe v4: dòng `EXPRESSION:` từ trường mới; thêm vào `item_fields` của keyframe và motion_prompt.
- G4 Giới hạn chuyển động chỉnh được ở giao diện shot (theo hồ sơ áo / tối thiểu / vừa / tự do); clip tôn trọng trần ghi trong shot.
- G5 Style mặc định có sáng viền, chiều sâu nền; thêm mẫu style chọn nhanh trong khối 2.

### GĐ-H: Hậu kỳ
- H1 Phụ đề kiểu "chữ viền": Be Vietnam Pro ExtraBold (fallback Arial), viền đen dày + đổ bóng, màu trắng hoặc vàng, hiện dần, nằm trên vùng an toàn; vẫn giữ kiểu hộp cũ làm tùy chọn; thay `->` bằng dấu phù hợp.
- H2 Nhịp: `beat_seconds` ngắn hơn clip thì TĂNG TỐC clip (tối đa 1,5x) rồi mới cắt đuôi; shot_plan gợi ý nhịp theo vai trò.
- H3 Chuyển cảnh tùy chọn: cắt (mặc định), mờ chồng, trượt, phóng; âm thanh `acrossfade`.

### GĐ-I (hoãn, cần thử nghiệm trước): chế độ Ingredients theo từng shot
Chỉ `r2v_13s/15s` được xác minh (13 s 720p = 48 credit); không có đường đầu-một-khung cho Omni 1.2. Đưa Ingredients vào đòi hỏi bước keyframe/kiểm cặp khung/motion_prompt có thể bỏ qua theo từng shot (engine hiện không hỗ trợ) và cổng kiểm logo riêng. Đề xuất: thử một clip Ingredients 13 s ở Veo Studio để so logo và chuyển động trước khi tích hợp.

## 4. Kiểm chứng
Mỗi giai đoạn có test; hậu kỳ kiểm bằng ffmpeg thật trên clip đã có (0 credit); kế hoạch mới kiểm bằng Gemini trên dữ liệu thật mà không ghi vào campaign. Tạo lại keyframe/clip (tốn credit Veo và hạn mức ChatGPT) chỉ làm khi được duyệt chi.

## 5. Trạng thái triển khai (2026-11-10)

| GĐ | Kết quả |
|---|---|
| F | Xong. `hook.txt` v2, `shot_plan.txt` v4, cờ `needs_unavailable_visual`, lint `script_claims_not_visible`, hook mặc định bỏ qua hook không thể hiện được, `frame_pair_check` thêm câu hỏi `script_matches`. Kiểm bằng Gemini thật trên dữ liệu campaign (không ghi vào campaign): 5/5 hook thể hiện được bằng hình, lời thoại khớp hình. |
| G | Xong. Trường `expression`, `motion_cap`, trần chuyển động chỉnh được, lint `camera_static` / `expression_missing` / `camera_mostly_static`, keyframe v4 (dòng EXPRESSION), style mặc định có sáng viền và nền có chiều sâu, 4 mẫu style trong giao diện. Gemini thật: 3/3 shot dùng `push_in`, có biểu cảm, delta rõ (đẩy máy 15–20%, bước tới máy). |
| H | Xong. Phụ đề chữ viền (Be Vietnam Pro ExtraBold kèm theo), vùng an toàn, hiện dần, màu trắng/vàng; tăng tốc theo nhịp (≤1,5x); chuyển cảnh fade/slide/zoom; bước ghép và đọc giọng chuyển sang `isolated` (không kéo clip tốn credit chạy lại). |
| I | Hoãn như đã nêu ở mục 3. |

Chưa kiểm chứng: chất lượng thật của keyframe/clip sinh từ prompt mới (cần chạy lại, tốn hạn mức ChatGPT và credit Veo).
