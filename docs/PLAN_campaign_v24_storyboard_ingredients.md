# Kế hoạch Chiến dịch AI v2.4: Ingredients + storyboard theo từng shot

Ngày: 2026-11-10. Thay chế độ khung đầu + khung cuối (Frames) bằng Ingredients trên toàn bộ chiến dịch. Mỗi shot có một ảnh storyboard và chọn được thời lượng 3–15 giây.

## 1. Bằng chứng

| Câu hỏi | Kết quả | Nguồn |
|---|---|---|
| Ingredients có chọn 3–15 giây không | Có. Không có gói Google AI thì 3–10 giây | [Google Flow Help](https://support.google.com/flow/answer/16352836?hl=en), [Gemini API](https://aistudio.google.com/docs/omni) |
| Mã model theo thời lượng | `macaron_cookie_r2v_<N>s[_360p]`. HAR máy này có 10, 13, 15; gflow-cli bắt được 3 và 8 trong request bị chặn | HAR nội bộ, [gflow-cli #1174](https://github.com/ffroliva/gflow-cli/pull/1174) |
| Giá | 13s 720p = 48, 15s 360p = 20 đã đo. Giao diện Flow báo 15s 720p = 60 | `docs/PLAN_flow_http_submit.md` |
| Điều khiển nhịp trong clip | Mốc thời gian `[0-5s] ...`; "single continuous shot" khi không muốn cắt cảnh; mô tả vai trò từng ảnh bằng lời | [Gemini API](https://aistudio.google.com/docs/omni) |
| Storyboard dạng lưới | Khung sát nhau, không viền, không chữ, không số; ít khung thì mỗi khung rõ hơn, nên ưu tiên lưới 3 khung hơn 9 khung | [DomoAI](https://domoai.app/blog/how-to-storyboard-ai-videos), [invideo](https://invideo.io/faq/why-use-a-3-panel-grid-instead-of-a-9-panel-grid-when/) |
| Số shot | 15 giây khoảng 3 shot, 30 giây khoảng 6 shot (nguồn nhà cung cấp công cụ, chỉ là mốc tham khảo) | [ai-video-storyboard](https://github.com/aicontentskills/ai-video-storyboard-skill) |
| Nhịp quảng cáo thời trang | Hero, chạm vải, chuyển động, tĩnh vật sản phẩm, kết; phủ trước/hông/sau/cận | [invideo](https://invideo.io/faq/how-do-you-storyboard-an-ai-fashion-ad-campaign-before/) |

**Chưa kiểm chứng:** các nguồn về lưới storyboard viết cho Seedance. Chưa có nguồn nào đo Omni 1.2 đọc lưới tốt tới đâu, nên có thể video hiện cả lưới. Prompt đã cấm việc này, nhưng cần thử thật một shot nháp trước khi chạy cả chiến dịch.

**Giá:** từ 11 giây trở đi, mỗi giây đắt gấp đôi (công thức khớp ba mốc đã đo: 360p = 1 credit/giây tới 10 giây, 2 credit/giây sau đó; 720p = 3 và 6). Vì vậy kịch bản mặc định dùng shot 3–10 giây. Độ dài chưa đo được ghi là "dự kiến".

## 2. Luồng mới

| Khối | Đầu ra | Đi vào clip thế nào |
|---|---|---|
| 1 Sản phẩm | Ảnh áo thật, hồ sơ áo | Ảnh tham chiếu 3 của clip, giữ logo |
| 2 Người mẫu | Ảnh nhân vật, phong cách, bối cảnh chung | Qua khung mẫu |
| 3 Kế hoạch | Tổng thời lượng → số shot đề xuất → kiểu storyboard, thời lượng và các nhịp của từng shot | Thành các mốc `[0-3s] ...` trong prompt clip |
| 4 Ảnh mẫu | Look sheet, khung mẫu | Khung mẫu là ảnh tham chiếu 1 của clip |
| 5 Storyboard | Mỗi shot một ảnh gồm 2–4 khung | Ảnh tham chiếu 2 của clip |
| 6 Clip | Ingredients 3 ảnh + prompt theo mốc thời gian | |

## 3. Kiểu storyboard

| Mã | Tên | Dùng khi |
|---|---|---|
| `hero_walk` | Bước tới | Mở đầu có năng lượng, thấy toàn bộ trang phục |
| `turn_reveal` | Xoay khoe dáng | Thể hiện form trước, hông, sau |
| `pose_sequence` | Chuỗi tạo dáng | Kiểu lookbook, cho phép cắt cảnh trong clip |
| `detail_macro` | Cận chi tiết | Logo, đường may; không có mặt |
| `fabric_touch` | Chạm vải | Tay chạm hoặc gió làm vải chuyển động; không có mặt |
| `still_life` | Tĩnh vật | Áo không có người, nghỉ nhịp giữa các cảnh |
| `closer_cta` | Kết | Toàn bộ trang phục, chờ chữ kêu gọi |

Số khung theo thời lượng: tới 5 giây 2 khung, tới 10 giây 3 khung, trên 10 giây 4 khung.

## 4. Bỏ đi

- Bước keyframe, motion_prompt, frame_pair_check và các màn hình đi kèm. Mỗi shot giảm từ 2 ảnh ChatGPT xuống 1, và bớt 2 lượt Gemini.
- Ô chọn chế độ i2v/r2v, ô cắt look sheet, các trường khung đầu/khung cuối, `beat_seconds`, `camera` tự do.
- Bản sao code cũ: `Backend/Data/backups/campaign_v23_frames`.

## 5. Thay đổi khác

- Chữ trên video xuống sát hơn: đáy khối chữ ở 83% chiều cao, ngay trên vùng giao diện TikTok/Reels.
- Kiểu dựng mặc định chuyển thành giữ trọn từng shot, vì bạn đã chọn thời lượng và trả credit cho cả clip. Cắt nhanh vẫn là tùy chọn.
- Sửa lỗi có sẵn ở extension: Ingredients lỗi trước khi gửi từng có thể rơi sang đường tạo video bằng chữ, tốn credit mà không có ảnh tham chiếu.

## 6. Việc cần duyệt chi

Thử một shot thật: 1 ảnh storyboard ChatGPT + 1 clip nháp 360p khoảng 6 giây (dự kiến 6 credit). Mục tiêu là xem video có hiện lưới không và Flow có nhận độ dài ngoài 10/13/15 không.
