import type { HelpDoc } from '../model.ts'

export const dashboardPageDoc: HelpDoc = {
  pageId: 'Dashboard',
  title: 'Dashboard (Trung tâm điều hành)',
  summary:
    'Cho bạn thấy ngay hôm nay kênh nào đã đăng, kênh nào sắp hết bài hẹn giờ, lịch phát sóng 7 ngày tới, sản lượng 7 ngày qua và các video thành phẩm gần nhất, kèm lối tắt vào các xưởng làm video.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Kênh để theo dõi: YouTube hoặc tài khoản Pippit đã kết nối',
      fixPage: 'Cài đặt',
      fixHint: 'Chưa có kênh thì trang báo “Chưa có kênh nào được cấu hình giám sát”. Số liệu lấy từ các bài đã hẹn giờ/đã đăng ở YouTube và Pippit (giờ Việt Nam, GMT+7).',
    },
  ],
  start: [
    {
      title: 'Xem kênh nào cần đăng hôm nay',
      do: 'Nhìn khối “Cần xuất bản hôm nay” và “Ma Trận Phát Sóng Đa Kênh Hôm Nay”. Kênh “Chưa đăng hôm nay” là việc ưu tiên số một.',
    },
    {
      title: 'Kiểm tra lịch đệm',
      do: 'Xem “Mức đệm lịch đăng trung bình” và “Lịch Phát Sóng 7 Ngày Tới”. Kênh gắn “Cần nạp bài” sắp hết bài hẹn giờ.',
    },
    {
      title: 'Làm tiếp hoặc lên lịch',
      do: 'Bấm một thẻ nhanh (Canvas AI, Veo Studio, Lên Lịch Đa Kênh) hoặc “Lên lịch ngay” ở dòng kênh cần nạp bài (nhảy tới trang lên lịch đúng nền tảng).',
      result: 'Chuyển thẳng sang trang tương ứng.',
    },
  ],
  areas: [
    {
      id: 'tien-do-phat-song',
      name: 'Tiến độ phát sóng hôm nay',
      what: 'Các chỉ số đầu trang: số kênh cần xuất bản hôm nay, số kênh đã hoàn thành mục tiêu và mức đệm lịch trung bình. Bấm vào để xem danh sách kênh chi tiết.',
    },
    {
      id: 'ma-tran-kenh',
      name: 'Ma trận phát sóng đa kênh',
      what: 'Mỗi kênh một dòng với trạng thái: “Chưa đăng hôm nay” (hôm nay chưa có bài nào), “Cần nạp bài” (chỉ còn tối đa 1 bài sắp tới hoặc lịch đệm không quá 1 ngày), “Đã đủ bài”. “Lịch dự trữ” cho biết còn bao nhiêu ngày có bài hẹn. Nút “Lên lịch ngay” nhảy tới trang Lên lịch Youtube hoặc Lên lịch Pippit tùy nền tảng của kênh.',
      tip: 'Giữ lịch đệm từ vài ngày trở lên để không đứt mạch đăng khi gặp sự cố.',
    },
    {
      id: 'lich-7-ngay',
      name: 'Lịch phát sóng 7 ngày tới',
      what: 'Biểu đồ các bài hẹn giờ trong 7 ngày tới; di chuột qua từng ngày để xem chi tiết, “Xem chi tiết lịch” mở bảng tình trạng từng kênh (lịch đăng, số bài sắp tới). Lịch đầy đủ theo tháng nằm ở trang Lịch sử → Lịch phát sóng.',
    },
    {
      id: 'san-luong',
      name: 'Sản lượng video 7 ngày qua',
      what: 'Số video thành phẩm làm ra mỗi ngày. Có thể chuyển giữa “Video Hoàn Chỉnh (Exports)” (chỉ video ghép hoàn chỉnh) và “Toàn Bộ Media AI” (tính cả phân đoạn Veo).',
    },
    {
      id: 'du-an-gan-day',
      name: 'Dự án video xuất xưởng gần nhất',
      what: 'Thư viện thành phẩm: phát xem nhanh (“Phát video toàn cảnh”) và mở thư mục chứa file trong Windows Explorer.',
    },
    {
      id: 'the-nhanh',
      name: 'Thẻ truy cập nhanh',
      what: 'Lối tắt tới Canvas AI (“AI Product-to-Video”), Veo Studio (“Veo Generative Studio”) và Lên Lịch Đa Kênh (YouTube Shorts & TikTok).',
    },
  ],
  concepts: [
    { term: 'Mức đệm (buffer)', meaning: 'Số ngày khác nhau, từ hôm nay trở đi, đang có bài hẹn giờ. Càng nhiều thì càng an toàn.' },
    { term: 'Kênh', meaning: 'Một kênh YouTube hoặc một Fanpage/tài khoản Pippit mà app theo dõi lịch đăng.' },
  ],
  problems: [
    {
      symptom: 'Hiện “Chưa có kênh nào được cấu hình giám sát”',
      fix: 'Kết nối kênh YouTube hoặc tài khoản Pippit (có Fanpage) trong Cài đặt, rồi bấm đồng bộ lại.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Số liệu không cập nhật',
      fix: 'Bấm nút đồng bộ dữ liệu thời gian thực ở góc trang (“Đang đồng bộ…” sẽ hiện).',
    },
    {
      symptom: 'Kênh báo “Chưa đăng hôm nay” dù bạn đã đăng',
      fix: 'Dashboard chỉ tính bài đăng/hẹn giờ qua app (YouTube, Pippit) theo giờ Việt Nam. Bài đăng thủ công ngoài app không được tính.',
    },
    {
      symptom: 'Thư viện thành phẩm trống',
      fix: 'Chưa có video ghép hoàn chỉnh. Làm video ở Chiến dịch AI, Canvas AI hoặc Recap & Audio trước.',
      link: 'Chiến dịch AI',
    },
  ],
  related: ['Canvas AI', 'Veo Studio', 'Lên lịch Youtube', 'Lên lịch Pippit', 'Lịch sử'],
  changes: [],
}
