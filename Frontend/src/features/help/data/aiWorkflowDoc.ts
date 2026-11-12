import type { SidebarDoc } from '../types'

export const aiWorkflowDoc: SidebarDoc = {
  id: 'Canvas AI',
  title: 'Xưởng Tự Động Hóa Video AI (Node-Graph Canvas)',
  category: 'Sản xuất AI',
  badge: 'Visual Automation',
  summary:
    'Không gian đồ họa node-graph trực quan tự động hóa 100% quy trình sản xuất video quảng cáo thương mại: từ ảnh chụp sản phẩm thật → phân tích Gemini → sinh kịch bản GPT → tạo clip Veo AI → lồng tiếng → ghép video hoàn chỉnh.',
  subTabs: [
    {
      id: 'nodes-assets',
      label: '1. Đầu Vào: Sản Phẩm & Nhân Vật',
      iconName: 'layers',
      desc: 'Thiết lập nguyên liệu gốc để AI hiểu rõ hình dáng sản phẩm và bối cảnh diễn xuất.',
      flowSteps: [
        'Kéo node ProductAssetsNode vào màn hình',
        'Tải lên 1–3 ảnh chụp sản phẩm sắc nét',
        'Nối sang CharacterSceneNode (chọn model / bối cảnh)',
        'Dữ liệu tự động chảy sang node phân tích',
      ],
    },
    {
      id: 'nodes-ai-script',
      label: '2. Trí Tuệ: Gemini & GPT Kịch Bản',
      iconName: 'bot',
      desc: 'Tự động bóc tách ưu điểm sản phẩm (USP) và chia thành kịch bản 5 phân cảnh chuẩn bán hàng.',
      flowSteps: [
        'GeminiVision quét và nhận diện điểm nổi bật',
        'Tạo bản tóm tắt lợi ích cốt lõi (USP)',
        'GptScriptNode sinh 5 kịch bản cảnh (Hook → Pain → Solution → Demo → CTA)',
        'Chuyển kịch bản sang các cảnh quay Veo',
      ],
    },
    {
      id: 'nodes-veo-motion',
      label: '3. Diễn Hoạt: Veo Motion Studio',
      iconName: 'video',
      desc: 'Chuyển từng phân cảnh kịch bản thành các clip chuyển động mượt mà bằng Google Veo.',
      flowSteps: [
        'Mỗi cảnh được gán 1 prompt hình ảnh tương ứng',
        'Mở MotionControlWorkspace để chỉnh góc lia camera',
        'Bấm Sinh Video cho từng cảnh hoặc chạy tự động cả luồng',
        'Xem trước từng phân đoạn video',
      ],
    },
    {
      id: 'nodes-export',
      label: '4. Dựng Phim: Export Timeline Node',
      iconName: 'film',
      desc: 'Ghép nối tất cả các phân cảnh, đồng bộ lồng tiếng, hòa âm nhạc nền và xuất video.',
      flowSteps: [
        'Tự động nối chuỗi clip từ các cảnh trước',
        'Sinh giọng đọc Voiceover đồng bộ thời lượng',
        'Mix nhạc nền BGM với âm lượng cân bằng',
        'Chọn tùy chọn: Tải có/không watermark, có/không âm thanh',
        'Bấm Render Video Thành Phẩm',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Nạp ảnh sản phẩm & Khởi tạo luồng',
      desc: 'Tại node đầu tiên (Product Assets) → Bấm tải lên ảnh chụp sản phẩm → Điền tên sản phẩm và thương hiệu.',
      badge: 'Đầu vào',
    },
    {
      step: 2,
      title: 'Kích hoạt Gemini & GPT Kịch bản',
      desc: 'Nhấn nút "Phân tích sản phẩm" trên Gemini Node → Nhấn "Sinh kịch bản 5 cảnh" trên GPT Node để nhận kịch bản chuẩn bán hàng.',
      badge: 'AI Script',
    },
    {
      step: 3,
      title: 'Render các cảnh Veo & Xuất timeline',
      desc: 'Chạy sinh video cho các Scene Node → Tại Export Timeline Node bấm "Render Video Hoàn Chỉnh" để nhận file MP4 cuối cùng.',
      badge: 'Xuất xưởng',
    },
  ],
  features: [
    {
      title: 'Canvas Node-Graph Trực Quan Chuẩn Điện Ảnh',
      desc: 'Tự do phóng to thu nhỏ (Zoom), kéo thả vị trí các node, tạo đường nối (Edge) linh hoạt. Hệ thống có sẵn MiniMap và các nút căn chỉnh lưới tự động.',
      tip: 'Giữ phím cách (Space) hoặc lăn chuột giữa để di chuyển canvas nhanh chóng.',
      tag: 'Node Canvas',
    },
    {
      title: 'Bộ Điều Khiển Camera Motion Tích Hợp',
      desc: 'Mỗi cảnh Veo đều có thể mở MotionControlWorkspace để tùy chỉnh các trục quay 3D: Pan, Tilt, Zoom, Orbit, Roll giúp video cực kỳ chuyên nghiệp.',
      tag: 'Camera 3D',
    },
    {
      title: 'Bộ Giải Nghĩa Cấu Trúc Độc Lập (Deterministic Resolver)',
      desc: 'Thuật toán đồ thị tự động kiểm tra tính hợp lệ của các đường nối, phát hiện sớm các liên kết lỗi hoặc thiếu ảnh trước khi bạn bấm render.',
      tag: 'Graph Engine',
    },
    {
      title: 'Tùy Chọn Xuất Video Đa Dạng',
      desc: 'Hỗ trợ tải video có tiếng hoặc không tiếng (No-Audio), xuất video có hoặc không watermark phục vụ cho nhiều mục đích tái chế nội dung khác nhau.',
      tag: 'Export Options',
    },
  ],
  proTips: [
    'Luôn kiểm tra kịch bản tại GPT Node trước khi bấm sinh video ở Veo để chỉnh sửa những từ ngữ chưa ưng ý, tránh tốn lượt sinh clip.',
    'Các video sau khi render ở ExportTimelineNode sẽ tự động được đồng bộ về Dashboard và thư mục exports/ trên máy tính của bạn.',
    'Nếu muốn đổi góc quay cho cảnh sản phẩm, hãy thử chọn Motion "Zoom In" ở cảnh mở đầu (Hook) để hút mắt người xem ngay 2 giây đầu.',
  ],
  troubleshooting: [
    {
      issue: 'Node báo cờ đỏ hoặc không cho bấm Render?',
      solution:
        'Kiểm tra xem đường nối giữa các node có bị đứt quãng không. Luồng chuẩn: Product Assets → Gemini Analysis → GPT Script → Veo Scenes → Export Timeline.',
    },
    {
      issue: 'Thời lượng giọng đọc không khớp với độ dài video?',
      solution:
        'Hệ thống tự động điều chỉnh tốc độ đọc (speech rate) để khớp với tổng thời lượng các cảnh Veo, bạn không cần phải cắt ghép thủ công.',
    },
  ],
  relatedPages: ['Veo Studio', 'Voices', 'Thư viện nhạc', 'Dashboard'],
}
