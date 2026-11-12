import type { SidebarDoc } from '../types'

export const voicesDoc: SidebarDoc = {
  id: 'Voices',
  title: 'Thư Viện Giọng Đọc AI & Lồng Tiếng (TTS)',
  category: 'Kho tài nguyên',
  badge: 'Voice Lab',
  summary:
    'Không gian quản lý và thử nghiệm giọng đọc nhân tạo (Text-to-Speech) đa dạng: từ EdgeTTS miễn phí không giới hạn đến ElevenLabs chất lượng điện ảnh. Hỗ trợ tạo Preset giọng đọc riêng biệt cho từng kênh YouTube/TikTok.',
  subTabs: [
    {
      id: 'voices-list',
      label: 'Danh Sách Giọng Đọc & Nghe Thử',
      iconName: 'mic',
      desc: 'Kho giọng đọc đa vùng miền (Bắc, Trung, Nam) và đa phong cách.',
      flowSteps: [
        'Chọn giọng đọc mong muốn từ danh sách',
        'Chọn câu thử giọng nhanh (Review phim, Tin tức, Hài hước, Kể chuyện, Triết lý)',
        'Bấm icon Play để nghe thử âm điệu và ngữ điệu',
        'Tùy chỉnh tốc độ nói (Speed) và cao độ (Pitch)',
      ],
    },
    {
      id: 'voice-clone',
      label: 'Nhân Bản Giọng Đọc (Voice Clone)',
      iconName: 'sparkles',
      desc: 'Tải lên đoạn ghi âm mẫu để nhân bản giọng đọc cá nhân.',
      flowSteps: [
        'Chuẩn bị file âm thanh mẫu (.mp3, .wav) sạch tạp âm từ 30s – 1 phút',
        'Điền tên định danh cho giọng',
        'Tải file lên hệ thống',
        'Hệ thống xử lý và sinh ra model giọng mới sẵn sàng sử dụng',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Khám phá và nghe thử giọng mẫu',
      desc: 'Duyệt danh sách giọng đọc → Bấm vào các câu thoại mẫu có sẵn (Tin tức, Kể chuyện, Review...) → Bấm Play để cảm nhận ngữ điệu.',
      badge: 'Chọn giọng',
    },
    {
      step: 2,
      title: 'Thiết lập Preset cho kênh của bạn',
      desc: 'Mỗi kênh nên dùng 1 giọng đặc trưng. Lưu cấu hình giọng và tốc độ thành Preset (ví dụ: "Kênh Review Phim - HoaiMy").',
      badge: 'Lưu Preset',
    },
    {
      step: 3,
      title: 'Tự động áp dụng vào Canvas AI',
      desc: 'Giọng đọc đã chọn sẽ được tự động liên kết với node Voiceover trong "Canvas AI" và xưởng "Studio" khi sản xuất video.',
      badge: 'Tự động hóa',
    },
  ],
  features: [
    {
      title: 'Tổng Hợp Đầy Đủ Giọng Tiếng Việt Tự Nhiên',
      desc: 'Bao gồm các giọng đọc chuẩn nhất hiện nay: Hoài My (Nữ miền Bắc truyền cảm), Nam Minh (Nam miền Bắc đĩnh đạc), cùng các giọng miền Nam ngọt ngào.',
      tag: 'Vietnamese Voices',
    },
    {
      title: 'Các Mẫu Thoại Test Nhanh (Quick Prompts)',
      desc: 'Cung cấp sẵn 5 kịch bản thoại ngắn đại diện cho các phong cách phổ biến: Review phim kịch tính, Bản tin thời sự nóng hổi, Kể chuyện huyền bí, Mẩu tin hài hước và Triết lý sâu lắng.',
      tag: 'Quick Test',
    },
    {
      title: 'Điều Chỉnh Tốc Độ & Cao Độ Tinh Vi',
      desc: 'Tùy biến tốc độ đọc từ 0.8x (chậm rãi, kể chuyện) đến 1.25x (dồn dập, review ngắn, tin tức giật gân) phù hợp với nhịp độ video Shorts.',
      tag: 'Fine Tuning',
    },
  ],
  proTips: [
    'Đối với video YouTube Shorts và TikTok: Giọng HoaiMy chỉnh tốc độ 1.1x hoặc 1.15x sẽ tạo cảm giác cuốn hút, giữ chân người xem rất tốt.',
    'Để giọng đọc ngắt nghỉ tự nhiên, trong kịch bản hãy dùng dấu phẩy (,) hoặc dấu chấm (...) tại các điểm cần nghỉ lấy hơi.',
  ],
  troubleshooting: [
    {
      issue: 'Bấm nghe thử nhưng không có tiếng phát ra?',
      solution:
        'Kiểm tra xem thiết bị loa/tai nghe của máy tính có đang tắt tiếng không. Đợi khoảng 1–2 giây để hệ thống tổng hợp file audio mẫu.',
    },
  ],
  relatedPages: ['Canvas AI', 'Recap & Audio', 'Thư viện nhạc'],
}
