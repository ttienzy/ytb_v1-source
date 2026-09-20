import type { SidebarDoc } from '../types'

export const bgmDoc: SidebarDoc = {
  id: 'Thư viện nhạc',
  title: 'Thư Viện Nhạc Nền Không Bản Quyền (BGM)',
  category: 'Kho tài nguyên',
  badge: 'BGM Library',
  summary:
    'Kho lưu trữ và quản lý nhạc nền (Background Music) bản quyền sạch, được phân loại theo từng tâm trạng và nhịp điệu cảm xúc để tự động phối trộn vào video thương mại và video ngắn.',
  subTabs: [
    {
      id: 'categories',
      label: 'Phân Loại Theo Tâm Trạng',
      iconName: 'layers',
      desc: 'Kho bài nhạc được gắn nhãn theo cảm xúc phù hợp với kịch bản video.',
      flowSteps: [
        'Chọn thể loại: Vui vẻ sôi động, Kịch tính hồi hộp, Chill thư giãn, hoặc Quảng cáo thương mại',
        'Nghe thử bản nhạc bằng thanh phát nhạc',
        'Xem độ dài và thông số bitrate của file',
        'Đặt bài hát làm nhạc nền ưu tiên',
      ],
    },
    {
      id: 'upload',
      label: 'Tải Lên Nhạc Cá Nhân',
      iconName: 'sparkles',
      desc: 'Nạp thêm các bài hát yêu thích hoặc giai điệu hot trend vào hệ thống.',
      flowSteps: [
        'Chuẩn bị file nhạc (.mp3, .wav, .m4a)',
        'Bấm "Tải lên bài nhạc mới"',
        'Gắn nhãn thể loại và tâm trạng',
        'Lưu vào thư viện để dùng chung cho mọi workflow',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Lựa chọn phong cách âm nhạc',
      desc: 'Duyệt danh sách BGM theo chủ đề video của bạn (ví dụ video review kịch tính thì chọn nhóm "Dramatic / Suspense").',
      badge: 'Chọn phong cách',
    },
    {
      step: 2,
      title: 'Cân chỉnh tỷ lệ âm lượng tiêu chuẩn',
      desc: 'Quy tắc vàng: Nhạc nền luôn đặt ở mức 15% – 20% để tôn giọng đọc thuyết minh lên hàng đầu.',
      badge: 'Cân bằng âm lượng',
    },
    {
      step: 3,
      title: 'Tự động hòa âm vào video',
      desc: 'Hệ thống tự động cắt gọt độ dài bài nhạc, fade-out (nhỏ dần) ở cuối video một cách êm ái, không bị ngắt cụt.',
      badge: 'Tự động Mix',
    },
  ],
  features: [
    {
      title: 'Tự Động Lặp & Fade-Out Thông Minh',
      desc: 'Nếu video dài hơn bài nhạc, hệ thống tự động nối loop mượt mà. Ở 2 giây cuối cùng của video, nhạc nền sẽ tự động giảm dần âm lượng (Fade-out) chuẩn chuyên nghiệp.',
      tag: 'Auto Mix',
    },
    {
      title: 'An Toàn Tuyệt Đối Về Bản Quyền Đa Nền Tảng',
      desc: 'Toàn bộ bài nhạc trong thư viện được tuyển chọn theo giấy phép Creative Commons / Royalty-Free, an toàn khi bật kiếm tiền trên YouTube, TikTok và Facebook.',
      tag: 'No Copyright',
    },
  ],
  proTips: [
    'Video đồ ăn, du lịch đường phố (Street Food) nên kết hợp nhạc phong cách Acoustic hoặc Lofi nhẹ nhàng.',
    'Video quảng cáo bán hàng nên dùng nhạc Upbeat Commercial có tiết tấu tươi vui, tích cực.',
  ],
  troubleshooting: [
    {
      issue: 'Tiếng nhạc nền át mất tiếng giọng đọc thuyết minh?',
      solution:
        'Hãy vào phần Cấu hình âm thanh giảm thanh trượt BGM Volume xuống mức 15% hoặc kiểm tra lại âm lượng gốc của file nhạc.',
    },
  ],
  relatedPages: ['Voices', 'AI Workflow', 'Workflow'],
}
