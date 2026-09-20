import type { SidebarDoc } from '../types'

export const watermarkDoc: SidebarDoc = {
  id: 'Xóa Watermark',
  title: 'Bóc Tách & Xóa Watermark Video Đa Nền Tảng',
  category: 'Khai thác & Nghiên cứu',
  badge: 'Clean Video',
  summary:
    'Công cụ trích xuất video sạch không logo từ TikTok, Douyin, Kuaishou, Instagram Reels, Facebook và tự động xóa watermark mờ bằng thuật toán FFmpeg Inpainting.',
  subTabs: [
    {
      id: 'download-clean',
      label: '1. Tải Video Gốc Không Logo',
      iconName: 'video',
      desc: 'Trích xuất luồng video sạch trực tiếp từ máy chủ mạng xã hội.',
      flowSteps: [
        'Sao chép liên kết video trên ứng dụng TikTok / Douyin / Instagram',
        'Dán link vào khung nhập liệu',
        'Bấm "Phân tích & Tải xuống"',
        'Nhận file MP4 gốc chất lượng cao không dính logo watermark trôi',
      ],
    },
    {
      id: 'inpaint-remover',
      label: '2. Xóa Logo Chữ Mờ (Inpainting)',
      iconName: 'sparkles',
      desc: 'Xử lý các video đã bị dính logo chết hoặc phụ đề tiếng nước ngoài.',
      flowSteps: [
        'Tải file video lên hệ thống',
        'Khoanh vùng chứa logo hoặc chữ mờ cần xóa',
        'Kích hoạt bộ lọc AI Inpainting làm mờ và tái tạo pixel nền',
        'Xuất video sạch để tái sản xuất',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Lấy liên kết video chia sẻ',
      desc: 'Mở ứng dụng mạng xã hội (TikTok, Douyin...) → Bấm nút "Chia sẻ" → Bấm "Sao chép liên kết".',
      badge: 'Lấy link',
    },
    {
      step: 2,
      title: 'Dán link và bắt đầu bóc tách',
      desc: 'Dán URL vào thanh công cụ → Chọn chất lượng cao nhất (HD/FHD) → Nhấn nút "Tải Video Sạch".',
      badge: 'Bóc tách',
    },
    {
      step: 3,
      title: 'Tải về hoặc Chuyển tiếp xưởng video',
      desc: 'Lưu file về máy hoặc đưa trực tiếp vào "AI Workflow" để dùng làm cảnh bối cảnh nhân vật.',
      badge: 'Hoàn tất',
    },
  ],
  features: [
    {
      title: 'Hỗ Trợ Mạng Xã Hội Trung Quốc (Douyin & Kuaishou)',
      desc: 'Được tối ưu đặc biệt để vượt qua các lớp mã hóa của Douyin và Kuaishou, lấy về video gốc độ nét cao 1080p không bị nén chất lượng.',
      tag: 'Douyin Support',
    },
    {
      title: 'Thuật Toán Inpainting Tự Động',
      desc: 'Thuật toán nội suy hình ảnh thông minh dựa trên các khung hình lân cận để xóa sạch logo cố định mà không làm biến dạng bối cảnh xung quanh.',
      tag: 'Smart Inpaint',
    },
  ],
  proTips: [
    'Douyin là kho tư liệu vô tận cho các chủ đề review đồ ăn, review đồ gia dụng thông minh và đời sống.',
    'Video sau khi làm sạch có thể đưa sang "Veo Studio" làm ảnh tĩnh tham khảo để tạo các video chuyển động mới lạ.',
  ],
  troubleshooting: [
    {
      issue: 'Báo lỗi "Link không hợp lệ hoặc đã bị xóa"?',
      solution:
        'Hãy mở link trên trình duyệt máy tính xem video có xem được bình thường không. Một số video ngắn Douyin cần sao chép toàn bộ đoạn text chia sẻ dán vào ô nhập.',
    },
  ],
  relatedPages: ['Khám Phá Kênh', 'AI Workflow', 'Workflow'],
}
