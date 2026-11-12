import type { SidebarDoc } from '../types'

export const studioDoc: SidebarDoc = {
  id: 'Recap & Audio',
  title: 'Xưởng Xử Lý Hàng Loạt & Video Recap (Studio)',
  category: 'Sản xuất AI',
  badge: 'Batch Studio',
  summary:
    'Hệ thống tự động hóa xử lý hàng loạt video từ YouTube/TikTok hoặc file cục bộ: tự động bóc tách phụ đề (Transcribe) → tóm tắt nội dung bằng AI → lồng tiếng mới → lồng nhạc nền và cắt thành video ngắn (Shorts/Reels).',
  subTabs: [
    {
      id: 'queue',
      label: 'Hàng Đợi Xử Lý (Batch Queue)',
      iconName: 'layers',
      desc: 'Quản lý danh sách các video đang chờ xử lý hoặc vừa nhận từ Khám Phá Kênh.',
      flowSteps: [
        'Dán danh sách link video hoặc nhận tự động từ Khám Phá Kênh',
        'Kiểm tra danh sách hàng đợi và thứ tự xử lý',
        'Bấm "Chạy Hàng Đợi (Start Batch)"',
        'Theo dõi tiến độ phần trăm thời gian thực',
      ],
    },
    {
      id: 'pipeline',
      label: 'Quy Trình Pipeline Tự Động',
      iconName: 'activity',
      desc: 'Luồng biến đổi từ video dài ban đầu thành video tóm tắt ngắn triệu view.',
      flowSteps: [
        'Tải video gốc về máy chủ',
        'Bóc tách âm thanh & nhận diện giọng nói (Whisper)',
        'Gemini tóm tắt nội dung kịch tính nhất',
        'Sinh giọng đọc AI mới đè lên lời cũ',
        'Dựng khung hình tỷ lệ 9:16 cho Shorts/TikTok',
      ],
    },
    {
      id: 'audio-config',
      label: 'Cấu Hình Âm Thanh & Nhạc Nền',
      iconName: 'mic',
      desc: 'Thiết lập giọng lồng tiếng mặc định và kho nhạc nền tự động chèn vào clip.',
      flowSteps: [
        'Chọn giọng đọc yêu thích từ thư viện Voices',
        'Chọn danh sách bài nhạc nền từ kho BGM',
        'Cân chỉnh thanh âm lượng nhạc nền (khuyên dùng 15–20%)',
        'Lưu cấu hình để áp dụng cho mọi video kế tiếp',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Nạp danh sách video mục tiêu',
      desc: 'Dán URL YouTube/TikTok vào khung nhập liệu hoặc chuyển nhanh từ mục "Khám Phá Kênh" → Bấm thêm vào hàng đợi.',
      badge: 'Nạp Video',
    },
    {
      step: 2,
      title: 'Chọn cấu hình kịch bản & giọng đọc',
      desc: 'Chọn phong cách tóm tắt (Review kịch tính / Tóm tắt nhanh) → Chọn giọng đọc AI và nhạc nền mong muốn.',
      badge: 'Cấu hình',
    },
    {
      step: 3,
      title: 'Bắt đầu xử lý & Thu hoạch video',
      desc: 'Nhấn nút "Bắt đầu xử lý hàng loạt" → Sau khi hoàn tất, video thành phẩm sẽ xuất hiện ở danh sách kết quả để xem thử hoặc tải về.',
      badge: 'Thành phẩm',
    },
  ],
  features: [
    {
      title: 'Liên Kết Liền Mạch Với Khám Phá Kênh',
      desc: 'Khi bạn duyệt video hay tại phân hệ Khám Phá Kênh, chỉ cần bấm "Gửi sang Studio Batch", toàn bộ URL sẽ tự động xuất hiện ở trang này mà không cần copy paste thủ công.',
      tag: 'Auto Bridge',
    },
    {
      title: 'Bóc Tách Phụ Đề Chuẩn Xác Bằng Whisper',
      desc: 'Tự động trích xuất toàn bộ lời thoại trong video gốc, làm sạch tiếng ồn và tạo bản dịch/tóm tắt bằng tiếng Việt trôi chảy.',
      tag: 'AI Transcribe',
    },
    {
      title: 'Tự Động Cắt Khung Hình Dọc (9:16 Shorts)',
      desc: 'Thuật toán tự động căn giữa chủ thể chính để chuyển video ngang 16:9 truyền thống thành video dọc 9:16 chuẩn YouTube Shorts và TikTok.',
      tag: 'Smart Crop',
    },
  ],
  proTips: [
    'Nên xử lý theo từng lô từ 5 đến 10 video một lúc để đảm bảo tốc độ render và tài nguyên máy tính ổn định nhất.',
    'Các video sau khi hoàn thành có thể đẩy trực tiếp sang "Lên lịch YouTube" hoặc "Lên lịch Pippit" để đăng bài tự động.',
  ],
  troubleshooting: [
    {
      issue: 'Video bị lỗi ở bước tải xuống (Download failed)?',
      solution:
        'Kiểm tra lại xem video trên YouTube/TikTok có bị đặt ở chế độ riêng tư hoặc giới hạn độ tuổi không. Đảm bảo kết nối internet ổn định.',
    },
  ],
  relatedPages: ['Khám Phá Kênh', 'Video', 'Voices', 'Lên lịch Youtube'],
}
