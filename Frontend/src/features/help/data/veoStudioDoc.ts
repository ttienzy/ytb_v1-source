import type { SidebarDoc } from '../types'

export const veoStudioDoc: SidebarDoc = {
  id: 'Veo Studio',
  title: 'Google Veo Studio & Nano Banana Pro',
  category: 'Sản xuất AI',
  badge: 'Veo 2/3 Lab',
  summary:
    'Trạm làm việc chuyên sâu với mô hình video AI điện ảnh Google Veo và tạo ảnh Nano Banana Pro. Hỗ trợ đầy đủ Text-to-Video, Image-to-Video với camera motion control 3D và quản lý dự án Google Cloud.',
  subTabs: [
    {
      id: 'text',
      label: 'Tạo Video (Text-to-Video)',
      iconName: 'video',
      desc: 'Sinh clip chuyển động hoàn toàn từ câu lệnh văn bản mô tả bối cảnh và hành động.',
      flowSteps: [
        'Nhập Prompt chi tiết',
        'Chọn Tỷ lệ (9:16 Shorts / 16:9 Ngang)',
        'Chọn Độ phân giải (720p / 1080p)',
        'Bấm "Tạo Video"',
        'Xem clip tại Video Gallery',
      ],
    },
    {
      id: 'image-gen',
      label: 'Tạo Ảnh (Nano Banana Pro)',
      iconName: 'sparkles',
      desc: 'Sinh hình ảnh nghệ thuật độ phân giải cao, hỗ trợ chuyển thẳng sang tab làm video.',
      flowSteps: [
        'Nhập mô tả ảnh sản phẩm / bối cảnh',
        'Chọn tỷ lệ khung hình',
        'Bấm "Tạo Ảnh"',
        'Bấm nút "Chuyển sang Video" để tiếp tục tạo chuyển động',
      ],
    },
    {
      id: 'image',
      label: 'Ảnh sang Video (Image-to-Video)',
      iconName: 'film',
      desc: 'Thổi hồn chuyển động sống động vào ảnh tĩnh với khả năng điều khiển camera 3D chuẩn xác.',
      flowSteps: [
        'Tải ảnh lên hoặc nhận từ Tab Tạo ảnh',
        'Thiết lập Camera Motion (Pan, Tilt, Zoom, Orbit)',
        'Đặt thời lượng (4s – 10s)',
        'Bấm "Tạo Video" để bắt đầu render',
      ],
    },
    {
      id: 'status',
      label: 'Hệ Thống & Bridge',
      iconName: 'activity',
      desc: 'Giám sát kết nối Google Cloud Platform, kiểm tra quota hạn mức và tình trạng bridge.',
      flowSteps: [
        'Xem trạng thái kết nối GCP',
        'Kiểm tra dự án khả dụng (Project ID)',
        'Đồng bộ hạn ngạch (Quota)',
        'Kiểm tra nhật ký kết nối realtime',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Chọn Project Google Cloud khả dụng',
      desc: 'Tại góc trên giao diện, chọn Project ID đã kích hoạt dịch vụ Google Veo. Nếu chưa có, chuyển sang Tab "Hệ Thống & Bridge" để kiểm tra.',
      badge: 'Bắt buộc',
    },
    {
      step: 2,
      title: 'Chọn Phân Tab làm việc phù hợp',
      desc: 'Tab Tạo Video (văn bản thuần) → Tab Tạo Ảnh (tạo ảnh mẫu) → Tab Ảnh sang Video (điều khiển chuyển động camera).',
      badge: 'Recap & Audio',
    },
    {
      step: 3,
      title: 'Tạo chuyển động & Nhận video hoàn chỉnh',
      desc: 'Thiết lập tham số → Bấm "Tạo Video" → Theo dõi tiến trình tải trên thanh trạng thái → Nhấn tải về hoặc mở xem trước.',
      badge: 'Xuất xưởng',
    },
  ],
  features: [
    {
      title: 'Bảng Điều Khiển Camera Chuyển Động (Motion Control)',
      desc: 'Hỗ trợ các chuyển động quay chuyên nghiệp: Pan (lia ngang trái/phải), Tilt (ngước lên/cúi xuống), Zoom (phóng to/thu nhỏ), Orbit (xoay quanh vật thể).',
      tip: 'Kết hợp Pan nhẹ + Zoom In để tạo cảm giác máy quay tiến vào trung tâm sản phẩm rất điện ảnh.',
      tag: 'Camera 3D',
    },
    {
      title: 'Bộ Sưu Tập Video & Trình Phát Tích Hợp (Video Gallery)',
      desc: 'Toàn bộ clip sinh ra được lưu giữ trong danh sách bên cạnh. Hỗ trợ xem trước lặp lại (Loop), xem thông số prompt gốc và tải trực tiếp về máy.',
      tag: 'Gallery',
    },
    {
      title: 'Chuyển Đổi Liền Mạch Ảnh $\\rightarrow$ Video',
      desc: 'Khi tạo được bức ảnh đẹp ở tab Nano Banana Pro, chỉ cần bấm nút "Chuyển sang Video", hệ thống sẽ tự động chuyển bức ảnh sang tab Image-to-Video giữ nguyên định dạng.',
      tag: 'Auto Forward',
    },
    {
      title: 'Quản Lý Nhiều Dự Án Google Cloud (Multi-Project)',
      desc: 'Dễ dàng chuyển đổi linh hoạt giữa các Project ID để tận dụng hạn mức quota và tránh bị giới hạn lưu lượng.',
      tag: 'GCP Bridge',
    },
  ],
  proTips: [
    'Luồng tối ưu nhất: Dùng tab Tạo Ảnh sinh ảnh sản phẩm siêu nét → Bấm "Chuyển sang Video" → Chọn Motion Orbit nhẹ → Bấm Tạo Video.',
    'Để làm YouTube Shorts / TikTok, hãy nhớ luôn chọn tỷ lệ khung hình 9:16 dọc trước khi sinh clip.',
    'Các clip sinh từ Veo có thể dùng trực tiếp trong phân hệ "Canvas AI" để ghép thành chuỗi video hoàn chỉnh có nhạc và lồng tiếng.',
  ],
  troubleshooting: [
    {
      issue: 'Báo lỗi "Project ID required" hoặc nút Tạo Video bị vô hiệu hóa?',
      solution:
        'Bạn cần chọn một dự án Google Cloud ở góc trên bên phải. Nếu danh sách trống, hãy vào mục "Cài đặt" → Tab "Google Veo" để cập nhật cookie/token.',
    },
    {
      issue: 'Clip sinh ra chuyển động bị méo hoặc không đúng ý?',
      solution:
        'Hãy giảm bớt độ dài xuống 4–5 giây và chọn ảnh mẫu có góc chụp rõ ràng, chủ thể tách biệt với hậu cảnh.',
    },
  ],
  relatedPages: ['Canvas AI', 'Recap & Audio', 'Video', 'Cài đặt'],
}
