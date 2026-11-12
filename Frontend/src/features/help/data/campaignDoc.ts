import type { HelpDoc } from '../model.ts'

export const campaignDoc: HelpDoc = {
  pageId: 'Chiến dịch AI',
  title: 'Chiến dịch AI (video quảng cáo thời trang)',
  summary:
    'Biến ảnh áo thật + ảnh người mẫu thành video quảng cáo hoàn chỉnh qua 8 khối: Sản phẩm → Người mẫu → Kế hoạch → Ảnh mẫu → Storyboard → Clip → Kiểm tra → Ghép & Xuất. Mỗi khâu quan trọng bạn duyệt trước khi sang khâu sau; chỉ khối Clip mới tốn credit.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Tài khoản ChatGPT (viết chữ và tạo ảnh)',
      fixPage: 'Cài đặt',
      fixHint: 'Ảnh mẫu, Khung mẫu và Storyboard được vẽ qua tài khoản ChatGPT web; phần viết kế hoạch cũng đi đường này.',
    },
    {
      label: 'Gemini đã đăng nhập (đọc ảnh áo)',
      fixPage: 'Cài đặt',
      fixHint: '“Hồ sơ áo” do Gemini đọc từ ảnh thật và là nguồn sự thật cho mọi bước sau.',
    },
    {
      label: 'Khối Clip: extension Flow đang chạy và đã đăng nhập Google Flow',
      fixPage: 'Veo Studio',
      fixHint: 'Clip được tạo bằng Omni 1.2 (Ingredients) trong Google Flow, tốn credit thật.',
    },
    {
      label: 'Khối Ghép & Xuất: giọng đọc (bắt buộc), Thư viện nhạc (tùy chọn)',
      fixPage: 'Voices',
      fixHint: 'Video luôn kèm tiếng đọc nên phải chọn một giọng. Thư viện nhạc trống thì không dùng được nhạc nền.',
    },
  ],
  start: [
    {
      title: 'Tạo chiến dịch',
      do: 'Cột trái “Chiến dịch”: nhập tên (ví dụ “Áo Haim”) rồi bấm “Tạo”. Mỗi chiến dịch là một video quảng cáo cho một mẫu áo.',
    },
    {
      title: 'Khối 1–2: nạp ảnh',
      do: 'Tải ảnh áo thật (mặt trước, mặt sau, chi tiết/logo, nhãn) và một ảnh nhân vật rõ mặt, rõ tóc. Đặt bối cảnh chung ở “Phong cách”.',
      result: 'Hồ sơ áo được Gemini đọc ra, bạn có thể sửa.',
    },
    {
      title: 'Khối 3–4: lên kế hoạch và duyệt ảnh mẫu',
      do: 'Chọn Góc kể, Hook, danh sách shot, lời thoại. Bấm “Tạo ảnh mẫu”, chọn ảnh ưng ý và “Duyệt ảnh này”, rồi duyệt “Khung mẫu” bối cảnh.',
    },
    {
      title: 'Khối 5: duyệt storyboard từng shot',
      do: 'Mỗi shot được vẽ thành một ảnh 2–4 khung. Xem, “Duyệt” hoặc từ chối kèm lý do để vẽ lại.',
    },
    {
      title: 'Khối 6: tạo clip (tốn credit)',
      do: 'Chọn độ phân giải 360p (rẻ) hoặc 720p (nét), kiểm tra giá dự kiến, rồi tạo clip cho từng shot. Nên thử 360p trước.',
      result: 'Mỗi shot có một clip để duyệt.',
    },
    {
      title: 'Khối 7–8: kiểm tra, ghép và xuất',
      do: 'Xem phần kiểm tra, chọn giọng đọc/nhạc/phụ đề/kiểu dựng rồi bấm “Ghép & Xuất”. Tải video ở menu Tải xuống.',
      result: 'Video hoàn chỉnh kèm caption và hashtag.',
    },
  ],
  areas: [
    {
      id: 'danh-sach-chien-dich',
      name: 'Danh sách chiến dịch và đầu trang',
      what: 'Bên trái: tìm, tạo, chọn chiến dịch. Đầu trang: “Đổi tên”, “Trần credit Flow” và “Sơ đồ 8 khối” cho biết khối nào đang ở trạng thái nào.',
      how: [
        'Trần credit: nhập số nguyên không âm; lần chạy vượt trần sẽ bị chặn. Để trống = không giới hạn.',
        'Đổi ảnh/đầu vào đã lưu sẽ làm các bước sau thành “Cũ”. Kết quả cũ không bị xóa; chỉ cần tạo lại bước nào bạn muốn.',
      ],
    },
    {
      id: 'khoi-1-san-pham',
      name: 'Khối 1 — Sản phẩm',
      what: 'Ảnh sản phẩm: mặt trước, mặt sau, chi tiết/logo, nhãn. Ảnh “Mặt trước” dùng cho look sheet; Gemini xem tất cả. Sau đó là “Hồ sơ áo” (loại sản phẩm, chất liệu nhìn thấy, họa tiết, cổ áo, dịp mặc, có logo/chữ in…).',
      how: [
        'Sửa hồ sơ rồi “Lưu chỉnh sửa”; app cảnh báo các bước sẽ tính lại.',
        'Không có ô trống nào được tự điền thêm: chỗ nào bạn chưa điền sẽ để trống.',
      ],
    },
    {
      id: 'khoi-2-nguoi-mau',
      name: 'Khối 2 — Người mẫu & Phong cách',
      what: 'Một ảnh nhân vật rõ mặt và tóc (tránh ảnh có chữ/phụ đề cứng vì có thể lọt vào ảnh tạo ra). Thư viện nhân vật dùng lại giữa các chiến dịch. “Phong cách” chọn một bối cảnh chung (một nơi quay, một kiểu ánh sáng) cho mọi storyboard và clip, có mẫu nhanh và mục “Luôn tránh”.',
    },
    {
      id: 'khoi-3-ke-hoach',
      name: 'Khối 3 — Kế hoạch',
      what: 'Brief (ngôn ngữ, nền tảng đăng, khuyến mãi…), Góc kể, Hook (3–6 giây đầu), Danh sách shot và Lời thoại & caption (kèm hashtag). Danh sách shot do AI đề xuất số shot, thời lượng 3–15 giây và các nhịp của từng shot; bạn sửa được.',
      tip: 'Danh sách shot nhìn thấy ảnh mẫu đã duyệt và hook đã chọn, nên duyệt ảnh mẫu càng sớm càng tốt.',
    },
    {
      id: 'khoi-4-anh-mau',
      name: 'Khối 4 — Ảnh mẫu & Khung mẫu',
      what: 'Look sheet: chân dung bên trái, áo xoay 3 góc bên phải. “Tạo ảnh mẫu” có thể ra nhiều ứng viên; soi logo, chữ, tay áo, độ dài trước khi “Duyệt ảnh này”. Khung mẫu bối cảnh chốt mặt, áo, nơi quay, ánh sáng và là ảnh tham chiếu số 1 của clip; chỉ có một ảnh cho cả chiến dịch.',
      how: [
        'Từ chối thì nhập lý do (ví dụ “logo bị méo”); ghi chú được gắn vào prompt lần tạo lại.',
        '“Nâng cao: prompt và ảnh tham chiếu” cho xem và sửa prompt cuối cùng sẽ gửi.',
        'Mọi khối sau chỉ dùng ảnh đã duyệt.',
      ],
    },
    {
      id: 'khoi-5-storyboard',
      name: 'Khối 5 — Storyboard',
      what: 'Mỗi shot một ảnh gồm 2–4 khung (các nhịp). Duyệt từng shot, từ chối kèm lý do để vẽ lại; chọn Tỉ lệ video; có mẫu prompt storyboard riêng ở “Nâng cao”.',
    },
    {
      id: 'khoi-6-clip',
      name: 'Khối 6 — Clip (tốn credit Flow)',
      what: 'Omni 1.2 nhận 3 ảnh: khung mẫu, storyboard đã duyệt, ảnh áo thật; các nhịp của storyboard thành mốc thời gian [0–3s]… Chọn thời lượng 3–15 giây và độ phân giải. Giá dự kiến: 360p ≈ 1 credit/giây tới 10 giây rồi 2 credit/giây; 720p ≈ 3 credit/giây tới 10 giây rồi 6 credit/giây.',
      how: [
        '“Tạo clip mới cho shot này (tốn credit)” là lệnh duy nhất gửi lên Flow. App không bao giờ tự gửi lại.',
        'Nếu Flow hủy request nhưng video vẫn có thể đã được tạo, clip báo “Chưa rõ kết quả — KHÔNG gửi lại”. Hãy kiểm tra trong Flow thay vì tạo lại.',
        'Sổ chạy (“Xác nhận chưa gửi”): xác nhận một lần chạy chưa hề gửi lên Flow thì mới chạy lại được.',
      ],
      tip: 'Dùng 360p (rẻ) để thử chuyển động, hài lòng rồi mới tạo 720p. 720p có thể tạo thẳng, không bắt buộc qua 360p.',
    },
    {
      id: 'khoi-7-kiem-tra',
      name: 'Khối 7 — Kiểm tra',
      what: 'Kiểm tra ảnh mẫu, kiểm tra clip và tuân thủ nền tảng (theo nền tảng đăng bạn chọn ở Brief). Đây chỉ là gợi ý để bạn xem, không chặn bạn đi tiếp.',
    },
    {
      id: 'khoi-8-ghep-xuat',
      name: 'Khối 8 — Ghép & Xuất',
      what: 'Giọng đọc (bắt buộc, video luôn kèm tiếng đọc), Phụ đề (không phụ đề / chữ trắng / chữ vàng / chữ viền + đổ bóng — khuyên dùng), Nhạc nền (tự lặp cho đủ độ dài, tự nhỏ khi có tiếng đọc và mờ dần cuối), Kiểu dựng và Chuyển cảnh (Cắt cứng kiểu TikTok, Mờ chồng, Trượt). “Giữ trọn từng shot” cho video dài bằng tổng thời lượng các clip; “Cắt nhanh theo nhịp nhạc” là kiểu beat-cut.',
      how: [
        '“Ghép & Xuất” tạo video; “Ghép lại” khi bạn đổi tùy chọn.',
        'Menu Tải xuống có bản chính và các bản phụ (ví dụ bản không nhạc nền, chỉ giữ tiếng đọc và phụ đề để gắn nhạc trên TikTok; bản xóa watermark). Bản phụ dựng lại đúng video này, tạo một lần (0 credit), lần sau tải ngay.',
        'Gói xuất kèm caption bài đăng và hashtag. Nền tảng đăng (TikTok, Facebook/Instagram Reels hoặc Shopee Video) và ngôn ngữ (Tiếng Việt / English) chọn ở Brief của khối 3.',
      ],
    },
  ],
  concepts: [
    { term: 'Look sheet (ảnh mẫu)', meaning: 'Một ảnh người mẫu mặc đúng áo: chân dung và áo xoay 3 góc. Là chuẩn nhận dạng cho mọi khối sau.' },
    { term: 'Khung mẫu (anchor frame)', meaning: 'Ảnh khóa mặt, áo, nơi quay và ánh sáng; luôn là ảnh tham chiếu số 1 của clip.' },
    { term: 'Shot / Nhịp', meaning: 'Shot là một cảnh quay 3–15 giây; nhịp là các khung nhỏ (2–4) bên trong storyboard, thành mốc thời gian trong clip.' },
    { term: 'Duyệt (cổng)', meaning: 'Bước bạn xác nhận ảnh/clip đạt thì khối sau mới dùng; từ chối kèm lý do để tạo lại.' },
    { term: 'Cũ (stale)', meaning: 'Kết quả được tạo từ đầu vào cũ. Không bị xóa, chỉ được đánh dấu để bạn quyết định có tạo lại không.' },
    { term: 'Trần credit', meaning: 'Hạn mức credit Flow tối đa cho một chiến dịch; lần chạy vượt hạn mức bị chặn.' },
  ],
  problems: [
    {
      symptom: '“Chưa đủ đầu vào” ở một khối',
      fix: 'Khối đó cần kết quả của khối trước (ví dụ Ảnh mẫu cần ảnh sản phẩm ở khối 1 và ảnh nhân vật ở khối 2). Hoàn thành và duyệt khối trước.',
    },
    {
      symptom: 'Clip báo “Chưa rõ kết quả — KHÔNG gửi lại”',
      cause: 'Flow có thể hủy request nhưng vẫn tạo video.',
      fix: 'Mở Google Flow kiểm tra xem video đã có chưa. Chỉ tạo lại khi chắc chắn chưa có để khỏi mất credit hai lần.',
      link: 'Veo Studio',
    },
    {
      symptom: 'Lần chạy bị chặn vì vượt trần credit',
      fix: 'Bấm “Trần credit Flow” ở đầu trang để tăng hạn mức hoặc để trống không giới hạn.',
    },
    {
      symptom: 'Ảnh tạo ra bị méo logo hoặc sai chữ',
      fix: 'Từ chối ảnh kèm lý do cụ thể (ví dụ “logo bị méo”) để ghi chú đi vào prompt lần tạo lại; kiểm tra ảnh chi tiết/logo ở khối 1 đã rõ chưa.',
    },
    {
      symptom: 'Không ghép được vì thiếu giọng đọc hoặc nhạc',
      fix: 'Chọn một giọng ở khối Ghép & Xuất. Nếu danh sách nhạc trống, thêm nhạc ở Thư viện nhạc.',
      link: 'Thư viện nhạc',
    },
    {
      symptom: 'Báo “Backend đang chạy là bản cũ, chưa có bản tải phụ”',
      fix: 'Khởi động lại bằng npm start để backend nạp bản mới.',
    },
    {
      symptom: 'Bản xóa watermark không dùng được',
      fix: 'Công cụ xóa watermark chưa sẵn sàng trên máy; xem hướng dẫn ở trang Xóa Watermark.',
      link: 'Xóa Watermark',
    },
  ],
  related: ['Veo Studio', 'Voices', 'Thư viện nhạc', 'Cài đặt', 'Lên lịch Youtube'],
  changes: [
    { date: '2026-11-12', text: 'Chiến dịch AI có tài liệu hướng dẫn lần đầu.' },
  ],
}
