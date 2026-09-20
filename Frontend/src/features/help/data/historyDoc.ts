import type { SidebarDoc } from '../types'

export const historyDoc: SidebarDoc = {
  id: 'Lịch sử',
  title: 'Nhật Ký Tác Vụ & Lịch Sử Hoạt Động (Audit Logs)',
  category: 'Hạ tầng & Vận hành',
  badge: 'Audit Logs',
  summary:
    'Sổ nhật ký lưu trữ toàn bộ các tác vụ sản xuất, tiến trình render video, các mốc đăng bài và lịch sử cào dữ liệu. Giúp bạn tra cứu nguyên nhân lỗi và giám sát hiệu năng tổng thể của máy tính.',
  subTabs: [
    {
      id: 'logs-view',
      label: 'Nhật Ký Hoạt Động',
      iconName: 'activity',
      desc: 'Theo dõi dòng sự kiện của hệ thống.',
      flowSteps: [
        'Chọn mốc thời gian cần kiểm tra',
        'Lọc theo trạng thái: Tất cả, Hoàn thành, hoặc Gặp lỗi',
        'Xem thời gian bắt đầu, thời gian kết thúc và tài nguyên tiêu hao',
      ],
    },
    {
      id: 'error-inspector',
      label: 'Tra Cứu Chi Tiết Lỗi',
      iconName: 'sparkles',
      desc: 'Xem chi tiết stack trace khi có tác vụ render hoặc upload thất bại.',
      flowSteps: [
        'Nhấp chuột vào dòng tác vụ báo đỏ',
        'Xem mã lỗi và thông báo phản hồi từ máy chủ',
        'Bấm "Sao chép log" để lưu trữ hoặc gửi hỗ trợ kỹ thuật',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Mở danh sách nhật ký gần nhất',
      desc: 'Mỗi khi nghi ngờ video không xuất được hoặc tiến trình bị gián đoạn → Vào trang Lịch sử để kiểm tra dòng sự kiện mới nhất.',
      badge: 'Kiểm tra',
    },
    {
      step: 2,
      title: 'Bấm xem chi tiết lỗi (Error Details)',
      desc: 'Nhấp trực tiếp vào dòng nhật ký màu đỏ để mở hộp thoại giải trình nguyên nhân (thiếu token, hết dung lượng ổ cứng, hoặc sai định dạng).',
      badge: 'Bóc tách lỗi',
    },
    {
      step: 3,
      title: 'Dọn dẹp nhật ký định kỳ',
      desc: 'Nhấn nút "Xóa log cũ" để dọn bớt các bản ghi thành công của những tuần trước, giúp cơ sở dữ liệu luôn nhẹ nhàng.',
      badge: 'Bảo trì',
    },
  ],
  features: [
    {
      title: 'Lưu Trữ Bền Vững Trong SQLite Cục Bộ',
      desc: 'Toàn bộ thông tin lịch sử được lưu trực tiếp trong tệp cơ sở dữ liệu SQLite trên máy của bạn, không lo bị mất dữ liệu khi mất kết nối mạng.',
      tag: 'Local Database',
    },
    {
      title: 'Tìm Kiếm Theo Mã Định Danh (Job ID)',
      desc: 'Dễ dàng tra cứu lại một tác vụ cụ thể bằng cách gõ Job ID vào thanh tìm kiếm.',
      tag: 'Searchable',
    },
  ],
  proTips: [
    'Nếu gặp lỗi render mà không rõ nguyên nhân, việc sao chép dòng log trong trang Lịch sử sẽ giúp bạn tìm ra nguyên nhân ngay lập tức (thường do file nguồn bị di chuyển hoặc FFmpeg hết bộ nhớ).',
  ],
  troubleshooting: [
    {
      issue: 'Trang nhật ký trống không có bản ghi nào?',
      solution:
        'Bấm nút Làm mới trên thanh công cụ. Nếu bạn vừa cài đặt lại ứng dụng, lịch sử sẽ bắt đầu ghi nhận từ các tác vụ tiếp theo.',
    },
  ],
  relatedPages: ['Dashboard', 'Cài đặt'],
}
