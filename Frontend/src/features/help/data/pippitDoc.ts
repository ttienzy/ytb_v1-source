import type { SidebarDoc } from '../types'

export const pippitDoc: SidebarDoc = {
  id: 'Lên lịch Pippit',
  title: 'Lên Lịch Đăng Bài Tự Động (TikTok & Facebook)',
  category: 'Phân phối đa kênh',
  badge: 'Social Auto-Post',
  summary:
    'Hệ thống điều phối lịch đăng bài tự động hóa lên mạng xã hội TikTok và Fanpage Facebook thông qua nền tảng Pippit. Tự động kiểm tra tiến độ đăng hàng ngày và cảnh báo kênh thiếu nội dung.',
  subTabs: [
    {
      id: 'channels',
      label: '1. Quản Lý Kênh & Trạng Thái',
      iconName: 'layers',
      desc: 'Theo dõi tình trạng kết nối và số ngày dự trữ bài của từng tài khoản.',
      flowSteps: [
        'Xem danh sách tài khoản TikTok và Trang Facebook đã liên kết',
        'Kiểm tra nhãn trạng thái: Xanh (Đã đăng), Vàng (Cần thêm lịch), Đỏ (Chưa có bài hôm nay)',
        'Bấm "Đồng bộ từ Pippit" để cập nhật dữ liệu mới nhất',
      ],
    },
    {
      id: 'schedule',
      label: '2. Lên Lịch Phát Sóng Hàng Loạt',
      iconName: 'activity',
      desc: 'Hẹn giờ đăng bài tự động theo từng ngày và khung giờ.',
      flowSteps: [
        'Chọn kênh cần đăng',
        'Chọn video từ kho thành phẩm',
        'Soạn tiêu đề, nội dung và bộ hashtag viral',
        'Chọn thời điểm xuất bản (hẹn giờ chính xác theo phút)',
        'Xác nhận đưa vào hàng đợi tự động',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Kiểm tra kênh báo động đỏ',
      desc: 'Nếu thấy chấm đỏ cảnh báo trên menu "Lên lịch Pippit", nghĩa là đang có kênh chưa có bài phát sóng trong ngày hôm nay.',
      badge: 'Cảnh báo',
    },
    {
      step: 2,
      title: 'Chọn video và viết mô tả',
      desc: 'Chọn video có sẵn → Điền caption thu hút kèm các thẻ hashtag thịnh hành.',
      badge: 'Nội dung',
    },
    {
      step: 3,
      title: 'Hẹn giờ khung giờ vàng',
      desc: 'Đặt lịch phát sóng vào các khung giờ nhiều người online: 11:30 – 12:30 (Trưa) hoặc 19:30 – 21:00 (Tối).',
      badge: 'Hẹn giờ',
    },
  ],
  features: [
    {
      title: 'Hệ Thống Giám Sát Buffer Days',
      desc: 'Đo lường chính xác kênh của bạn còn bao nhiêu ngày có video dự trữ trong tương lai. Giúp bạn chủ động sản xuất trước, không lo bị gián đoạn tần suất đăng.',
      tag: 'Buffer Monitor',
    },
    {
      title: 'Đăng Bài Chạy Ngầm Bất Đồng Bộ',
      desc: 'Tác vụ đẩy video lên mạng xã hội được xử lý ngầm, không làm treo máy tính. Bạn có thể tắt app sau khi đã lên lịch xong.',
      tag: 'Cloud Scheduler',
    },
  ],
  proTips: [
    'Luôn duy trì ít nhất 3–5 video trong hàng đợi lên lịch cho mỗi kênh để thuật toán TikTok đánh giá kênh hoạt động đều đặn và phân phối nhiều view hơn.',
    'Hashtag nên gồm 3 tầng: #chủ_đề_chung (#foryou, #xuhuong), #ngách_nội_dung (#reviewamthuc), và #tên_kênh.',
  ],
  troubleshooting: [
    {
      issue: 'Kênh báo "Lỗi token hoặc mất quyền truy cập"?',
      solution:
        'Truy cập mục "Cài đặt" → Tab "Pippit AI & Fanpages" để làm mới (refresh) mã token bảo mật tài khoản.',
    },
  ],
  relatedPages: ['Dashboard', 'Lên lịch Youtube', 'Video'],
}
