import type { HelpGuide } from '../model.ts'

export const overviewGuide: HelpGuide = {
  title: 'Tổng quan quy trình',
  summary:
    'Các trang trong app nối với nhau thành những quy trình làm video quen thuộc. Chọn quy trình giống việc bạn định làm rồi đi theo từng bước; bấm tên trang để mở hướng dẫn chi tiết của trang đó.',
  verifiedAt: '2026-11-12',
  journeys: [
    {
      id: 'recap-youtube',
      name: 'Recap từ video YouTube',
      goal: 'Biến video YouTube thành video recap có giọng đọc AI và nhạc nền.',
      steps: [
        { page: 'Cài đặt', note: 'Đăng nhập Gemini (cookie). Nên đăng nhập YouTube dự phòng để tránh Bot-Wall khi tải video.' },
        { page: 'Voices', note: 'Có ít nhất một giọng đọc (preset hoặc giọng clone).' },
        { page: 'Thư viện nhạc', note: 'Thêm nhạc nền nếu muốn.' },
        { page: 'Khám Phá Kênh', note: 'Tìm kênh, lọc “Chưa làm”, tích chọn video (tối đa 10 mỗi lô).' },
        { page: 'Recap & Audio', note: 'Workflow YouTube: dán link hoặc nhận link từ Khám Phá Kênh, bấm tạo recap.' },
        { page: 'Lịch sử', note: 'Xem lại job và kịch bản lồng tiếng. Đăng ngay ở kết quả recap hoặc đưa lên lịch đăng.' },
      ],
    },
    {
      id: 'truyen-audio',
      name: 'Truyện chữ thành video audio',
      goal: 'Mỗi chương truyện thành một video có giọng đọc, nền và nhạc.',
      steps: [
        { page: 'Crawl truyện', note: 'Cào truyện và các chương cần làm về máy.' },
        { page: 'Voices', note: 'Chọn hoặc tạo giọng đọc.' },
        { page: 'Thư viện nhạc', note: 'Thêm nhạc nền (tùy chọn).' },
        { page: 'Video', note: 'Thêm video nền vào kho, hoặc dùng nền ảnh bìa truyện.' },
        { page: 'Recap & Audio', note: 'Workflow Audio: chọn truyện, chọn chương, xem thử 6 giây rồi bấm Bắt đầu.' },
        { page: 'Lên lịch Youtube', note: 'Đẩy video lên Drive rồi hẹn giờ đăng hàng loạt.' },
      ],
    },
    {
      id: 'quang-cao-thoi-trang',
      name: 'Quảng cáo thời trang từ ảnh áo',
      goal: 'Làm video quảng cáo hoàn chỉnh từ ảnh áo thật và ảnh người mẫu.',
      steps: [
        { page: 'Cài đặt', note: 'Thêm tài khoản ChatGPT, đăng nhập Gemini, nạp extension và đăng nhập Google Flow.' },
        { page: 'Voices', note: 'Chọn giọng đọc cho video (bắt buộc ở khối Ghép & Xuất).' },
        { page: 'Chiến dịch AI', note: 'Chọn format, đi qua 6 khối, duyệt cast sheet và khung chốt từng cảnh trước khi tạo clip.' },
        { page: 'Dashboard', note: 'Theo dõi thành phẩm và lịch đăng.' },
      ],
    },
    {
      id: 'video-ai-tu-do',
      name: 'Video AI tự do bằng Google Flow',
      goal: 'Tạo clip từ prompt, từ ảnh hoặc chuyển động tác từ video mẫu.',
      steps: [
        { page: 'Cài đặt', note: 'Nạp extension Flow, đăng nhập Google Flow và kiểm tra Bridge.' },
        { page: 'Veo Studio', note: 'Tạo video từ kịch bản hoặc ảnh; tạo ảnh bằng Nano Banana.' },
        { page: 'Canvas AI', note: 'Hoặc dùng sơ đồ node từ ảnh sản phẩm, và Motion Control để chuyển động tác.' },
        { page: 'Xóa Watermark', note: 'Xóa watermark Gemini/Veo trên clip hoặc ảnh gốc.' },
        { page: 'Video', note: 'Chỉnh khung hình, nền, nhãn, gộp nhiều clip.' },
      ],
    },
    {
      id: 'muse',
      name: 'Video điện ảnh bằng Meta Muse',
      goal: 'Tạo video bằng Meta Muse thông qua Chrome đã đăng nhập.',
      steps: [
        { page: 'Cài đặt', note: 'Tab Muse AI (Meta): kiểm tra cấu hình và cổng CDP.' },
        { page: 'Muse Studio', note: 'Mở Muse Chrome, đăng nhập, viết prompt và tạo video.' },
        { page: 'Video', note: 'Đưa clip vào kho để chỉnh hoặc gộp.' },
      ],
    },
    {
      id: 'dang-bai',
      name: 'Đăng bài và theo dõi',
      goal: 'Hẹn giờ đăng video lên YouTube, Facebook/TikTok và giữ lịch luôn đủ bài.',
      steps: [
        { page: 'Cài đặt', note: 'Kết nối Google Drive, kênh YouTube và tài khoản Pippit (Fanpage).' },
        { page: 'Lên lịch Youtube', note: 'Chọn video từ Drive, đặt tiêu đề/tag và khung giờ vàng hoặc khoảng cách đều.' },
        { page: 'Lên lịch Pippit', note: 'Chọn video, Fanpage, tần suất và xem trước bài đăng Facebook.' },
        { page: 'Dashboard', note: 'Xem kênh nào “Chưa đăng hôm nay” hoặc “Cần nạp bài”.' },
        { page: 'Lịch sử', note: 'Tra cứu lịch phát sóng và bài đã đăng.' },
      ],
    },
  ],
  notes: [
    'Hầu hết lỗi “không chạy được” bắt nguồn từ một kết nối ở Cài đặt đã hết hạn (Gemini, ChatGPT, Flow, YouTube, Drive). Hãy kiểm tra ở đó trước.',
    'Các thao tác tốn credit Flow thật gồm: tạo clip ở Chiến dịch AI, Veo Studio, Canvas AI và Motion Control. App không tự gửi lại; nếu Flow báo lỗi, kiểm tra trong Flow trước khi tạo lại vì có thể video đã được tạo.',
    'Voice-service chỉ đọc một việc một lúc: khi đang chạy một job lồng tiếng, nghe thử giọng ở Voices có thể phải chờ.',
  ],
}
