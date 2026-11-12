# Plan: thiết kế lại hệ thống Tài liệu hướng dẫn (Help)

Trạng thái (2026-11-12): **Cả 5 giai đoạn đã xong** (16/16 trang có doc v2 đã đối chiếu, doc "Tổng quan quy trình", dấu "?" theo ngữ cảnh tại 10 khối, mục "Có gì mới" tổng hợp). Phần còn lại là bảo trì: mỗi lần đổi tính năng thì sửa doc và `verifiedAt`. Ngày lập: 2026-11-12.
Phạm vi: `Frontend/src/features/help/` (HelpDrawer + 14 file `data/*Doc.ts`), nút "?" ở `App.tsx`.

## 1. Hiện trạng và vấn đề (đã đối chiếu code)

### 1.1 Cấu trúc
- Mỗi trang có một `SidebarDoc` với **đúng 3 tab cố định** (Quy trình nhanh / Chi tiết tính năng / Mẹo & lỗi), dù trang đơn giản hay phức tạp.
- **Danh sách trang trong dropdown viết tay** ở `HelpDrawer.tsx` (14 mục, 5 nhóm), tách rời `navGroups` (sidebar) và `docsRegistry.ts`. Ba nơi này lệch nhau:
  - nhóm trong dropdown khác nhóm ở sidebar (ví dụ "Video" ở sidebar thuộc *Nguồn Nội Dung*, trong help thuộc *Kho Tài Nguyên*);
  - sidebar có **16 trang**, help chỉ có **14 doc**.
- `getDocForSidebar()` rơi về `dashboardDoc` khi không tìm thấy, nên **Chiến dịch AI** và **Muse Studio** mở help ra thấy tài liệu của Dashboard mà không báo gì.
- Không có tìm kiếm, không mở được đúng mục (deep-link), không có "cập nhật lần cuối", không có test nào.

### 1.2 Nội dung lỗi thời / sai (ví dụ đã thấy)
| Chỗ | Vấn đề |
|---|---|
| `studioDoc` (Recap & Audio) | Nói "bóc tách bằng Whisper", "Smart Crop 9:16", nút "Gửi sang Studio Batch". Thực tế: R1 transcript YouTube → Gemini viết kịch bản, R2 yt-dlp + ffmpeg cắt, R3 TTS Voice-service, R4 ghép. **Không có** tab Workflow Audio (kho truyện, đọc chương, tóm tắt Gemini, thư viện nền, âm thanh & hiệu ứng, khối Video gộp vào). |
| `videoDoc` | Chưa nói trang đã thiết kế lại, và Video nay còn là khối gập trong Recap & Audio. Nền video local tự chuẩn hóa, không còn chia 9:16/16:9. |
| `discoverDoc`, `studioDoc` | Còn "Studio Batch"; chưa có badge "mới"/"đã làm", cách làm mới kênh. |
| `settingsDoc` | "Veo 2 và Veo 3"; hiện chỉ dùng Omni 1.2. Chưa nói ChatGPT web (không còn 9router). |
| `dashboardDoc` | Gợi ý "3 thẻ tắt" và lối vào cũ, cần đối chiếu lại với Dashboard hiện tại. |
| `aiWorkflowDoc` (Canvas AI) | Mô tả 5 cảnh Hook→Pain→Solution→Demo→CTA và các node; cần đối chiếu với canvas + Motion Control (Omni 1.2, Motion dài). |
| Thiếu hẳn | Chiến dịch AI (engine campaign), Muse Studio. |

Nguyên nhân gốc: **tài liệu không gắn với code**. Đổi tên, đổi luồng hay bỏ tính năng thì không có gì nhắc cập nhật help.

## 2. Mục tiêu
1. Người dùng mới làm được **một video đầu tiên** chỉ nhờ help, không cần hỏi.
2. Mỗi trang có tài liệu **đúng với app hiện tại**, nói rõ điều kiện cần (đăng nhập Gemini, extension Flow, voice-service…).
3. Giữ được tài liệu đúng theo thời gian: **máy kiểm tra** thay vì dựa vào trí nhớ.

## 3. Thiết kế đề xuất

### 3.1 Nguồn dữ liệu duy nhất
- Danh sách trang trong help **sinh từ `navGroups`** (cùng nhóm, cùng thứ tự, cùng icon với sidebar). Bỏ dropdown viết tay.
- `pageId` của doc là kiểu `NavLabel` suy ra từ `navGroups`, nên đổi tên trang mà quên sửa help sẽ **lỗi typecheck**.
- Bỏ fallback về Dashboard: trang chưa có doc hiển thị "Chưa có tài liệu" kèm nút báo, và test chặn trường hợp này.

### 3.2 Mô hình doc v2 (`HelpDoc`)
```
pageId            // kiểu NavLabel
title, summary    // 1 câu "trang này để làm gì"
verifiedAt        // 'YYYY-MM-DD' lần cuối đối chiếu với app (bắt buộc)
requires[]        // điều kiện cần: { label, ok-check?, fixLink: trang Cài đặt/Extension }
start             // "Làm video đầu tiên": 3–6 bước, mỗi bước 1 hành động + kết quả mong đợi
areas[]           // các khối/tab trên giao diện: { name, what, how, flow? }  (thay cho subTabs)
concepts[]        // thuật ngữ ngắn (draft/final, anchor frame, bridge 60526…) khi cần
problems[]        // triệu chứng → nguyên nhân → cách xử lý (+ link sang trang liên quan)
related[]         // pageId liên quan
changes[]         // "Có gì mới" theo ngày, tối đa vài dòng
```
Bỏ trường chung chung (`badge`, `proTips` rời rạc). Mẹo gộp vào `areas` hoặc `problems` để đúng ngữ cảnh.

### 3.3 Giao diện Drawer
- **Cột trái / danh sách trang** theo đúng nhóm sidebar, có ô **tìm kiếm** quét toàn bộ doc (tiêu đề, bước, triệu chứng).
- Thân bài cuộn một cột với mục lục neo (Bắt đầu · Các khối giao diện · Xử lý sự cố), thay cho 3 tab cứng.
- **Banner điều kiện cần** ở đầu trang (nếu `requires` chưa thỏa thì có nút đi tới chỗ sửa).
- **Trợ giúp theo ngữ cảnh**: dấu "?" nhỏ cạnh các khối khó (ví dụ "Nền video", "Âm thanh & hiệu ứng", cổng duyệt của Chiến dịch AI) mở drawer đúng mục (`openHelp(pageId, areaId)`).
- Thêm một doc **"Tổng quan quy trình"**: bản đồ cách các trang nối nhau (Khám Phá Kênh → Recap & Audio → Video → Lên lịch; Canvas AI / Chiến dịch AI → Video; Voices, Thư viện nhạc là nguyên liệu).
- Giữ drawer (không làm trang riêng) và phím Esc; thêm chế độ rộng nếu nội dung dài.

### 3.4 Chống lỗi thời (`node:test`, chạy trong `npm test`)
- Mọi mục trong `navGroups` đều có đúng một doc; không doc mồ côi.
- `related[]` và `fixLink` trỏ tới `pageId` có thật.
- `verifiedAt` hợp lệ; cảnh báo (không chặn) nếu quá 90 ngày.
- **Danh sách từ cấm** (đã bỏ): `Whisper`, `Studio Batch`, `Smart Crop`, `Omni 1.1`, `Veo 2`, `9router`… test sẽ đỏ nếu quay lại. Mỗi lần bỏ một tính năng thì thêm một từ.
- Dùng hàm thuần để test được bằng `--experimental-strip-types` (đúng quy ước repo: không import React/DOM trong module được test).
- Thêm một dòng vào `CLAUDE.md`: đổi tên/luồng trang thì sửa doc tương ứng và `verifiedAt`.

## 4. Các giai đoạn
Mỗi giai đoạn nhỏ, chạy được và kiểm chứng được; không viết lại nội dung trước khi khung xong.

| GĐ | Việc | Kiểm chứng |
|---|---|---|
| 1. Khung | Kiểu `HelpDoc` v2, registry sinh từ `navGroups`, bỏ fallback, test cấu trúc (mục 3.4). Chuyển 14 doc cũ sang mô hình mới bằng script, **chưa sửa nội dung**. | `npm test`, `typecheck`; mở help ở cả 16 trang |
| 2. Giao diện | Drawer mới: danh sách theo nhóm sidebar, tìm kiếm, mục lục neo, banner `requires`, deep-link `openHelp`. Dọn `HelpDrawer.css` (747 dòng). | Playwright: mở từ mỗi trang, tìm kiếm, deep-link, Esc; chụp ảnh |
| 3. Nội dung ưu tiên cao | Viết lại từ **code thật** (router, UI, CLAUDE.md): Recap & Audio, Video, Chiến dịch AI (mới), Muse Studio (mới), Khám Phá Kênh, Cài đặt. | Đối chiếu từng bước với app chạy thật; ghi `verifiedAt` |
| 4. Nội dung còn lại | Canvas AI (+ Motion Control), Veo Studio, Dashboard, Crawl truyện, Voices, Thư viện nhạc, Xóa Watermark, Lên lịch Pippit/YouTube, Lịch sử + doc "Tổng quan quy trình". | Như trên; test từ cấm đỏ nếu sót |
| 5. Ngữ cảnh | Gắn "?" vào các khối khó, "Có gì mới" cho thay đổi gần đây (kho truyện, nền video, đổi tên sidebar). | Playwright bấm "?" mở đúng mục |

## 5. Quyết định cần bạn chốt (kèm đề xuất)
1. **Giữ drawer hay làm trang Trợ giúp riêng?** Đề xuất: giữ drawer + chế độ rộng. Ít phá luồng làm việc, vẫn thấy trang đang dùng.
2. **Nội dung viết bằng TS có kiểu hay Markdown?** Đề xuất: TS có kiểu (typecheck bắt lỗi tên trang, đóng gói sẵn, chạy offline). Markdown dễ viết hơn nhưng mất kiểm tra.
3. **Có chèn ảnh chụp màn hình không?** Đề xuất: chưa. Ảnh lỗi thời rất nhanh; dùng sơ đồ luồng bằng chữ trước.
4. **Phạm vi nội dung ở GĐ 3:** viết lại toàn bộ hay chỉ sửa chỗ sai? Đề xuất: viết lại 6 trang ưu tiên ở GĐ 3 (sai nhiều nhất hoặc thiếu hẳn), các trang còn lại sửa trong GĐ 4.
5. **Ngôn ngữ:** giữ tiếng Việt, thuật ngữ kỹ thuật giữ nguyên tiếng Anh (Flow, Veo, TTS…).

## 6. Rủi ro
- Viết nội dung đúng cần chạy thử từng trang; những phần phụ thuộc dịch vụ ngoài (Flow, Drive, voice-service thật) có thể chưa kiểm chứng được. Khi đó doc sẽ ghi rõ "chưa kiểm chứng" thay vì khẳng định.
- Đổi kiểu `pageId` đụng nhiều file (App, Dashboard, Discover…), nên làm ở GĐ 1 cùng test để bắt hết.
