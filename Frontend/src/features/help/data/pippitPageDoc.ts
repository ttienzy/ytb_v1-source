import type { HelpDoc } from '../model.ts'

export const pippitPageDoc: HelpDoc = {
  pageId: 'Lên lịch Pippit',
  title: 'Lên lịch Pippit (Facebook & TikTok)',
  summary:
    'Đặt lịch đăng hàng loạt video từ Chiến dịch AI, Thư viện AI (Flow, Muse Canvas, Motion Long, Muse Studio), Recap & Audio, file máy tính hoặc Google Drive lên Fanpage Facebook và kênh TikTok qua Pippit. Hỗ trợ tự kéo caption từ nguồn, sửa riêng từng bài, nhờ Gemini viết caption hàng loạt (0 credit) và xem trước video thật.',
  verifiedAt: '2026-11-25',
  requires: [
    {
      label: 'Tài khoản Pippit đã đăng nhập, có Fanpage / kênh TikTok liên kết',
      fixPage: 'Cài đặt',
      fixHint: 'Tab “Pippit AI & Fanpages”. Chưa liên kết thì trang báo “Chưa có kênh Facebook / TikTok nào”.',
    },
    {
      label: 'Tài khoản Gemini đã đăng nhập (chỉ cần khi bấm “AI viết” caption)',
      fixPage: 'Cài đặt',
      fixHint: 'Tab Gemini. Nếu chưa đăng nhập bạn vẫn kéo caption sẵn từ nguồn, sửa tay hoặc dùng mẫu chung bình thường.',
    },
    {
      label: 'Google Drive đã kết nối (chỉ cần nếu dùng tab “Google Drive”)',
      fixPage: 'Cài đặt',
      fixHint: '4 tab nguồn còn lại (Chiến dịch AI, Thư viện AI, Recap & Audio, Từ máy) hoạt động trực tiếp không cần Google Drive.',
    },
  ],
  start: [
    {
      title: 'Chọn video từ một hoặc nhiều nguồn',
      do: 'Ở “1. Kho Video Nguồn”, chuyển qua các tab Chiến dịch AI, Thư viện AI, Recap & Audio, Từ máy hoặc Google Drive. Tích chọn các video cần đăng (có thể chọn trộn nhiều nguồn trong cùng một lượt).',
    },
    {
      title: 'Chọn kênh, khung giờ và chế độ Caption',
      do: 'Ở “2. Kênh đăng, Lịch phát & Caption”, chọn kênh Facebook / TikTok (kèm tùy chọn quyền riêng tư, bình luận, Duet/Stitch cho TikTok), chọn Khung giờ vàng hoặc Giãn cách đều, rồi chọn chế độ caption hoặc bấm “AI viết” để Gemini viết riêng cho từng bài.',
    },
    {
      title: 'Sửa từng bài, xem trước video thật và đặt lịch',
      do: 'Ở “3. Dòng thời gian chi tiết”, bấm “Sửa caption” để chỉnh riêng từng bài, bấm “Xem trước” để phát video thật trên khung TikTok/Facebook, rồi bấm “Đặt lịch N video” ở thanh dưới cùng.',
      result: 'Video cục bộ được tải thẳng từ máy lên Pippit Cloud (không đi vòng qua Google Drive). Bảng “Kết quả lượt đặt lịch” báo rõ từng bài; bài đã lên lịch xong tự bỏ chọn và xuất hiện ở tab “Lịch đã đặt”.',
    },
  ],
  areas: [
    {
      id: 'kho-nguon',
      name: 'Kho Video Nguồn (5 tab)',
      what: 'Gồm Chiến dịch AI (video ghép, bản xóa watermark, biến thể Hook Multiplier kèm caption có sẵn), Thư viện AI (Flow, Muse Canvas, Motion Long, Muse Studio, video đã xử lý), Recap & Audio (video final kèm caption recap), Từ máy (kéo thả file MP4/MOV/WEBM) và Google Drive (nhớ thư mục gần nhất, lưu lối tắt thư mục nhanh).',
    },
    {
      id: 'chien-luoc-lich',
      name: 'Chiến lược lên lịch & Tuỳ chọn TikTok',
      what: '“Khung giờ vàng” hỗ trợ 1–3 bài/ngày hoặc thêm mốc tùy chỉnh kèm lệch ngẫu nhiên ±5–10p chống spam Meta. “Giãn cách đều” dàn đều bài theo phút/giờ. Khi có kênh TikTok, bạn chọn thêm quyền riêng tư, Bình luận, Duet và Stitch.',
    },
    {
      id: 'caption-ai',
      name: 'Caption riêng từng bài, AI viết hàng loạt & Mẫu Spintax',
      what: 'Chế độ “Riêng từng bài / Tự kéo nguồn” tự lấy caption sẵn có của Chiến dịch AI hoặc Recap. Nút “AI viết” gọi Gemini web (0 credit Flow/Muse) viết góc nội dung và hashtag khác nhau cho tối đa 15 video mỗi lượt. Chế độ “Mẫu chung + Spintax” hỗ trợ biến {title}, {hashtags}, {cta}, {a|b|c} và lưu nhiều bộ mẫu theo ngành.',
    },
    {
      id: 'dong-thoi-gian',
      name: 'Dòng thời gian chi tiết & Cảnh báo mềm',
      what: 'Mỗi thẻ video cho phép đổi kênh đích, đổi giờ (+15p/+30p/+1h), sửa trực tiếp caption/tiêu đề, gọi “AI viết lại” cho riêng 1 bài, và hiện cảnh báo mềm khi caption trống, quá dài (Facebook > 500 ký tự, TikTok > 2.200 ký tự), chứa tên file thô hoặc file > 250 MB.',
    },
    {
      id: 'thanh-dat-lich',
      name: 'Thanh đặt lịch (dưới cùng)',
      what: 'Luôn hiện ở đáy màn hình: số video → kênh, khoảng giờ đăng từ bài đầu tới bài cuối, số video trùng kênh kèm nút “Bỏ chọn”, và nút “Đặt lịch N video”.',
      how: [
        'Trong lúc chạy, thanh hiện video đang upload (vd. 2/4) và nút “Dừng”: video đang gửi vẫn chạy xong, các video sau không gửi.',
        'Video lỗi không tự gửi lại (riêng cookie Pippit hết hạn được tự đăng nhập lại 1 lần). Xem lý do trong bảng kết quả, kiểm tra tab “Lịch đã đặt” rồi mới đặt lại.',
      ],
    },
    {
      id: 'lich-da-dat',
      name: 'Tab “Lịch đã đặt”',
      what: 'Cùng danh sách với Lịch sử > “Đăng FB & TikTok (Pippit)”: nhóm theo ngày, lọc theo trạng thái, theo nền tảng và kênh; nút “Đồng bộ” lấy trạng thái mới từ Pippit.',
    },
  ],
  concepts: [
    { term: 'Pippit', meaning: 'Dịch vụ trung gian đăng bài lên Fanpage Facebook và TikTok. App đăng nhập Pippit bằng tài khoản bạn thêm ở Cài đặt.' },
    { term: 'Spintax', meaning: 'Cú pháp {lựa chọn 1|lựa chọn 2|lựa chọn 3} trong mẫu caption giúp mỗi bài tự chọn một câu khác nhau để tránh trùng lặp nội dung.' },
  ],
  problems: [
    {
      symptom: 'Không thấy kênh nào để chọn',
      fix: 'Liên kết Fanpage / kênh TikTok ở tài khoản Pippit rồi quét lại kênh liên kết trong Cài đặt.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Bấm “AI viết” báo lỗi Gemini',
      fix: 'Đăng nhập lại tài khoản Gemini trong Cài đặt. Bạn vẫn có thể sửa trực tiếp từng bài hoặc dùng Mẫu chung + Spintax mà không cần Gemini.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Tab Google Drive báo chưa kết nối',
      fix: 'Kết nối Google Drive trong Cài đặt nếu muốn lấy video từ Drive; 4 tab Chiến dịch AI, Thư viện AI, Recap & Audio và Từ máy vẫn dùng bình thường.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Bảng kết quả có video lỗi',
      fix: 'Đọc lý do ở dòng lỗi. Kênh hiện “Hết hạn ủy quyền” thì cấp quyền lại trong Cài đặt. Lỗi “Pippit không trả task id” hoặc lỗi mạng: bấm “Đồng bộ” ở tab “Lịch đã đặt” trước, vì Pippit có thể đã nhận bài.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Video bị đánh dấu “Đã đăng lên kênh này”',
      fix: 'Video đó đã được đăng hoặc lên lịch lên đúng kênh đích (khớp theo ID video cục bộ hoặc Drive). Bấm “Bỏ chọn” ở thanh dưới cùng hoặc đổi kênh riêng cho video đó.',
    },
  ],
  related: ['Chiến dịch AI', 'Canvas AI', 'Recap & Audio', 'Lên lịch Youtube', 'Cài đặt', 'Lịch sử'],
  changes: [
    { date: '2026-11-25', text: 'Nâng cấp Lên lịch Pippit 2.0: chọn & trộn video từ 5 nguồn (Chiến dịch AI, Thư viện AI, Recap & Audio, Từ máy, Google Drive), tự kéo caption từ nguồn, sửa caption riêng từng bài, AI viết caption hàng loạt (Gemini 0 credit), mẫu Spintax, tuỳ chọn TikTok, xem trước phát video thật và tự đăng nhập lại Pippit khi cookie hết hạn.' },
    { date: '2026-11-15', text: 'Đặt lịch gửi lần lượt từng video: có tiến trình thật, nút “Dừng”, bảng kết quả từng video; video đã xong tự bỏ chọn. Cảnh báo video đã đăng lên đúng kênh đích.' },
  ],
}
