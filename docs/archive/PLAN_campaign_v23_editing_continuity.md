# Kế hoạch Chiến dịch AI v2.3: nhịp dựng, độ liền mạch, chế độ Ingredients

> **ĐÃ LƯU TRỮ (2026-11-12), chỉ để tham khảo lịch sử.** Đã triển khai nhưng bị thay bởi v2.4: Frames mặc định, bước keyframe và micro-cut mặc định đã bỏ. Hiện hành: [PLAN_campaign_v24_storyboard_ingredients.md](../PLAN_campaign_v24_storyboard_ingredients.md). Đường dẫn file và số dòng trong tài liệu phản ánh thời điểm viết.


Ngày: 2026-11-10. Đầu vào: bản rà soát video 30 giây của campaign `ab172628e62e` và đề xuất chuyển sang Ingredients, cắt nhanh theo nhịp, Master Scene.

## 1. Dữ liệu thật của video 30 giây

- Ba cú máy dài 10 giây, `speed = 1.0`, `beat_seconds = 10`, chuyển cảnh mờ chồng. Cả 3 shot gần như giữ một tư thế suốt clip.
- Nguyên nhân trực tiếp: `shot_plan.txt` bị đổi lúc 18:55 ngày 2026-11-10 thành "Set beat_seconds equal to {{duration}}", cộng với `duration = 10`. Dòng đó vẫn được giữ; kiểu dựng mới không dùng `beat_seconds`.
- `clip.pair_check_override = true` đang bật ở cấp bước, nên cổng kiểm cặp khung bị bỏ qua cho mọi shot.
- Keyframe mới: shot 1 và 3 cùng bức tường và cửa sổ; shot 2 là cận cảnh không thấy nền. Mặt gần giống nhau, shot 3 lệch nhẹ. Logo đổi kiểu giữa cận cảnh (thêu) và toàn cảnh (in phẳng).

## 2. Đánh giá đề xuất

| Nhận định / đề xuất | Kết luận | Lý do |
|---|---|---|
| Frames kéo dài 10 giây làm chuyển động trôi | Đúng về hiện tượng, sai khi quy hết cho chế độ | Biên độ nhỏ trải trên 10 giây thì chậm. Shot "vén tóc" 6 giây trước đó có chuyển động rõ. Google ghi Frames dùng cho 3–10 giây và cần mô tả chuyển động cụ thể. |
| Không góc máy nào quá 2–3 giây | Đúng hướng, con số chưa chắc | Các nguồn nói 0,3–3 giây; không có nghiên cứu theo mẫu. |
| Mặt trôi vì ChatGPT không khóa seed | Đúng một phần | Trong code, mỗi shot tự sinh từ ảnh cắt look sheet, không có ảnh neo chung. Đây là phần sửa được. |
| Mỗi shot một bối cảnh | Đúng về nguyên nhân, quá lời với video này | Prompt có "street, cafe window, balcony" và style có chữ "hoặc", nên không có gì khóa một nơi. Video này tình cờ gần cùng nơi. |
| Chuyển hẳn sang Ingredients | **Không chuyển hẳn; thêm làm tùy chọn từng shot để so A/B** | Omni 1.2 chỉ xác minh r2v 13/15 giây (13 giây 720p = 48 credit, 15 giây 360p = 20). Không làm được "4–6 shot ngắn" như đề xuất; phải cắt từ clip dài. Mất neo khung cuối. Không có nguồn nào đo độ giữ logo, và `reference` được Google mô tả là không phải khung đầu theo nghĩa đen. |
| `@character` / `@outfit` | Không dùng | Google khuyên mô tả vai trò ảnh bằng ngôn ngữ tự nhiên, các thẻ điều khiển đang bị bỏ dần. |
| Rung máy cầm tay, whip-pan giả lập | Không làm lúc này | Thêm rung sau khi render chỉ che chuyển động kém, chưa có nguồn cho thấy lợi ích. Phóng số đổi cỡ khung đã tạo cảm giác nhiều góc máy. |

## 3. Đã triển khai (0 credit Veo)

- **Khung mẫu `anchor_frame`** (có cổng duyệt): một ảnh chốt mặt, áo, nơi quay, ánh sáng từ ảnh nhân vật gốc + look sheet + ảnh áo thật. Mọi keyframe dùng ảnh này làm tham chiếu đầu. Tốn thêm 1 lượt ảnh ChatGPT mỗi chiến dịch.
- **Master Scene**: ô "Bối cảnh chung" ở khối 2, đưa vào kế hoạch shot, khung mẫu và keyframe. Bỏ danh sách nhiều nơi khỏi prompt.
- **Kiểu dựng micro-cut** (mặc định): mỗi clip tách thành 2–3 cú 1,5–3 giây, chọn đoạn nhiều chuyển động nhất theo thứ tự thời gian, phát nhanh tới 1,2 lần, phóng số xen kẽ, điểm cắt theo nhịp nhạc tìm từ file nhạc đã chọn. Lời thoại và chữ của mỗi shot vẫn nằm trọn trong khoảng của shot đó.
- **Prompt clip**: thêm yêu cầu tốc độ thực, có quán tính, không quay chậm.
- **Ingredients theo từng shot**: tham chiếu là khung mẫu + khung đầu + ảnh áo thật; prompt chia mốc thời gian (`[0-6s]…`) theo hướng dẫn của Google; nháp 15 giây 360p, chốt 13 giây 720p. Mặc định vẫn là khung đầu + cuối.

## 4. Chưa kiểm chứng, cần duyệt chi

Thử A/B trên một shot: cùng khung mẫu, một clip Frames 6 giây và một clip Ingredients nháp 15 giây, so mặt, logo, độ tự nhiên. Chi phí dự kiến: 1 ảnh khung mẫu + 2 ảnh keyframe ChatGPT, 18 credit + 20 credit Veo.

Nếu Ingredients thắng về chuyển động mà giữ được logo, chuyển các shot có người sang Ingredients và giữ Frames cho cận cảnh logo. Nếu không, giữ Frames 6 giây + micro-cut.
