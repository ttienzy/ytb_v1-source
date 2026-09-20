import type { SidebarDoc } from '../types'

export const youtubePublisherDoc: SidebarDoc = {
  id: 'Lên lịch Youtube',
  title: 'Tự Động Hóa Lịch Phát Sóng YouTube Shorts & Video',
  category: 'Phân phối đa kênh',
  badge: 'YouTube Publisher',
  summary:
    'Hệ thống quản lý kênh, tự động phân bổ lịch phát sóng YouTube Shorts thông minh theo các khung giờ vàng tương tác cao (Sáng 07:15, Trưa 11:45, Tối 19:45). Hỗ trợ đồng bộ video trực tiếp từ Google Drive hoặc ổ cứng nội bộ.',
  subTabs: [
    {
      id: 'source-selection',
      label: '1. Chọn Kênh & Nguồn Video',
      iconName: 'youtube',
      desc: 'Thiết lập kênh đích và chọn thư mục video cần phân phối.',
      flowSteps: [
        'Chọn kênh YouTube đã kết nối tài khoản',
        'Chọn nguồn video: Thư mục máy tính cục bộ hoặc Google Drive đám mây',
        'Quét danh sách video có sẵn trong thư mục',
        'Tự động làm sạch tiêu đề video loại bỏ ký tự rác',
      ],
    },
    {
      id: 'golden-slots',
      label: '2. Cấu Hình Khung Giờ Vàng (Golden Slots)',
      iconName: 'activity',
      desc: 'Lựa chọn mật độ xuất bản tối ưu cho kênh.',
      flowSteps: [
        'Chọn chế độ: 1 bài/ngày (Tối 19:45), 2 bài/ngày (Trưa 11:45 + Tối 19:45), hoặc 3 bài/ngày (Sáng + Trưa + Tối)',
        'Hoặc dùng Interval Presets: Giãn cách đều mỗi 30 phút, 1 giờ, 2 giờ',
        'Hệ thống tự động tính toán ngày giờ đăng cho từng video trong hàng đợi',
      ],
    },
    {
      id: 'metadata-publish',
      label: '3. Siêu Dữ Liệu & Đăng Tải Tự Động',
      iconName: 'sparkles',
      desc: 'Hoàn thiện thông tin video và đẩy lên YouTube.',
      flowSteps: [
        'Tự động gắn thẻ #shorts, #recap, #review',
        'Chọn trạng thái xuất bản: Riêng tư, Không công khai, hoặc Công khai theo giờ hẹn',
        'Bấm "Bắt đầu lên lịch xuất bản"',
        'Theo dõi tiến trình tải lên qua thanh trạng thái',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Chọn kênh YouTube mục tiêu',
      desc: 'Bấm chọn kênh trong danh sách thả xuống ở đầu trang. Đảm bảo kênh có huy hiệu kết nối hợp lệ.',
      badge: 'Chọn kênh',
    },
    {
      step: 2,
      title: 'Chọn cài đặt khung giờ vàng',
      desc: 'Chọn gói "3 bài / ngày (Khuyên dùng)" để tự động rải đều video vào 3 khung giờ đông người xem nhất.',
      badge: 'Lập lịch',
    },
    {
      step: 3,
      title: 'Kích hoạt tải lên tự động',
      desc: 'Nhấn nút "Bắt đầu lên lịch hàng loạt" → Hệ thống sẽ tự động upload và hẹn giờ trên YouTube Studio cho bạn.',
      badge: 'Tự động tải',
    },
  ],
  features: [
    {
      title: 'Tự Động Làm Sạch Tiêu Đề (Smart Title Cleaner)',
      desc: 'Tự động cắt bỏ các đuôi file .mp4, các hậu tố xử lý như _clean, _final, _watermark_removed và chuỗi ngày giờ để biến tên file thành tiêu đề video tự nhiên, hấp dẫn.',
      tag: 'Auto Title',
    },
    {
      title: 'Đồng Bộ Trực Tiếp Từ Google Drive',
      desc: 'Nếu bạn dựng video ở máy khác hoặc có cộng tác viên đẩy video lên Google Drive, hệ thống có thể đọc trực tiếp thư mục Drive để đăng bài mà không cần tải thủ công về máy tính.',
      tag: 'Cloud Sync',
    },
    {
      title: 'Giám Sát Hạn Ngạch YouTube Quota Realtime',
      desc: 'YouTube giới hạn 10,000 unit API mỗi ngày. Ứng dụng tự động tính toán chi phí upload để không bao giờ vượt ngưỡng hạn ngạch cho phép.',
      tag: 'Quota Safe',
    },
  ],
  proTips: [
    'Đối với kênh mới xây, hãy chọn chế độ "2 bài / ngày" (Trưa và Tối) liên tục trong 14 ngày để kích hoạt thuật toán đề xuất của YouTube Shorts.',
    'Luôn giữ hashtag #shorts ở tiêu đề để YouTube nhận diện đúng định dạng video ngắn.',
  ],
  troubleshooting: [
    {
      issue: 'Báo lỗi "The user has exceeded the number of videos they may upload"?',
      solution:
        'Kênh YouTube chưa xác minh số điện thoại hoặc tài khoản mới bị giới hạn upload trong 24 giờ. Hãy vào YouTube Studio trên trình duyệt để xác minh nâng cao tính năng kênh.',
    },
  ],
  relatedPages: ['Dashboard', 'Lên lịch Pippit', 'Video', 'Cài đặt'],
}
