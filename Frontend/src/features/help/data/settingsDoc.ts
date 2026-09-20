import type { SidebarDoc } from '../types'

export const settingsDoc: SidebarDoc = {
  id: 'Cài đặt',
  title: 'Trung Tâm Cấu Hình Hệ Thống & Tích Hợp Dịch Vụ',
  category: 'Hạ tầng & Cấu hình',
  badge: 'System Settings',
  summary:
    'Quản trị tập trung tất cả các kết nối dịch vụ đám mây, khóa bảo mật API (Gemini, OpenAI, ElevenLabs), tài khoản Google Cloud Veo, phân quyền YouTube OAuth và email ảo Mail.tm.',
  subTabs: [
    {
      id: 'gemini_yt',
      label: '1. Gemini & YouTube Cookie',
      iconName: 'sparkles',
      desc: 'Cấu hình kết nối Google Gemini phân tích sản phẩm và tải video dự phòng.',
      flowSteps: [
        'Lấy Cookie từ trình duyệt hoặc nhập Gemini API Key',
        'Dán vào ô nhập liệu',
        'Bấm "Kiểm tra kết nối"',
        'Đèn trạng thái chuyển sang xanh lá biểu thị sẵn sàng',
      ],
    },
    {
      id: 'chatgpt',
      label: '2. LLM Agent (9router / GPT)',
      iconName: 'bot',
      desc: 'Cấu hình mô hình ngôn ngữ lớn để sinh kịch bản bán hàng và kịch bản video.',
      flowSteps: [
        'Nhập 9router API Key hoặc OpenAI API Key',
        'Chọn mô hình mong muốn (ví dụ: gpt-5.5 / gpt-4o)',
        'Nhấn "Kiểm tra hoạt động"',
        'Lưu cấu hình',
      ],
    },
    {
      id: 'veo',
      label: '3. Google Veo & Cloud Project',
      iconName: 'video',
      desc: 'Kết nối nền tảng video AI Google Veo 2 và Veo 3.',
      flowSteps: [
        'Nhập GCP Project ID đã bật Vertex AI / Veo',
        'Dán Session Cookie / Bearer Token xác thực',
        'Bấm "Đồng bộ hạn ngạch (Quota)"',
        'Kiểm tra danh sách dự án khả dụng tại Veo Studio',
      ],
    },
    {
      id: 'youtube',
      label: '4. YouTube Data API & OAuth',
      iconName: 'youtube',
      desc: 'Cấp quyền cho ứng dụng tự động upload và quản lý kênh YouTube.',
      flowSteps: [
        'Tạo OAuth 2.0 Client trên Google Cloud Console',
        'Điền Client ID và Client Secret vào hệ thống',
        'Bấm "Xác thực tài khoản Google"',
        'Cấp quyền quản lý video trên kênh của bạn',
      ],
    },
    {
      id: 'pippit',
      label: '5. Pippit AI & Mạng Xã Hội',
      iconName: 'activity',
      desc: 'Kết nối hệ thống phân phối TikTok và Fanpage Facebook.',
      flowSteps: [
        'Dán mã Access Token từ tài khoản Pippit',
        'Bấm "Nạp danh sách kênh liên kết"',
        'Chọn các kênh được phép xuất bản tự động',
      ],
    },
    {
      id: 'gdrive',
      label: '6. Google Drive Đồng Bộ',
      iconName: 'hard-drive',
      desc: 'Liên kết thư mục đám mây để tự động quét video thành phẩm.',
      flowSteps: [
        'Ủy quyền truy cập Google Drive',
        'Chọn thư mục chứa video nguồn',
        'Bật tự động đồng bộ khi có video mới',
      ],
    },
    {
      id: 'mailtm',
      label: '7. Mail.tm Email Ảo & OTP',
      iconName: 'mail',
      desc: 'Tự động tạo hòm thư tạm thời để nhận mã xác thực.',
      flowSteps: [
        'Bấm "Tạo tài khoản Email mới"',
        'Hệ thống tự động lắng nghe và trích xuất mã OTP khi có thư gửi đến',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Chọn Tab dịch vụ cần kết nối',
      desc: 'Tại thanh menu dọc bên trái trang Cài đặt → Chọn dịch vụ bạn muốn cấu hình (Gemini, ChatGPT, Veo, YouTube...).',
      badge: 'Chọn dịch vụ',
    },
    {
      step: 2,
      title: 'Điền thông tin và bấm Kiểm tra kết nối',
      desc: 'Dán API Key hoặc Token → Luôn bấm nút "Kiểm tra kết nối" (Test Connection) trước khi lưu để đảm bảo khóa hợp lệ.',
      badge: 'Xác thực',
    },
    {
      step: 3,
      title: 'Lưu thay đổi',
      desc: 'Bấm nút "Lưu cấu hình" → Dữ liệu được mã hóa lưu trữ trực tiếp trên máy tính của bạn và có hiệu lực ngay tức thì.',
      badge: 'Áp dụng',
    },
  ],
  features: [
    {
      title: 'Bảo Mật Cục Bộ Tuyệt Đối (Local Encrypted Storage)',
      desc: 'Toàn bộ API Key, Cookie và Token được lưu cục bộ trên máy tính của bạn, hoàn toàn không gửi lên bất kỳ máy chủ trung gian nào của bên thứ ba.',
      tag: 'Security',
    },
    {
      title: 'Đèn Báo Trạng Thái Trực Quan (Live Status Pill)',
      desc: 'Mỗi tab dịch vụ đều có đèn báo trạng thái: Xanh lục (Kết nối tốt), Đỏ (Hết hạn hoặc sai key), Xám (Chưa cấu hình) giúp bạn dễ dàng rà soát toàn bộ hệ thống.',
      tag: 'Status Watch',
    },
  ],
  proTips: [
    'Khi sao chép API Key từ trình duyệt, hãy cẩn thận không để thừa khoảng trắng ở đầu hoặc cuối chuỗi ký tự.',
    'Đối với token Google Veo, nếu phiên làm việc hết hạn sau vài ngày, bạn chỉ cần mở lại tab Veo trong Cài đặt và dán token mới mà không cần thiết lập lại từ đầu.',
  ],
  troubleshooting: [
    {
      issue: 'Bấm "Kiểm tra kết nối" báo lỗi 401 hoặc 403?',
      solution:
        'Khóa API key hoặc token của bạn đã hết hạn, bị thu hồi hoặc tài khoản hết tiền/credit. Hãy tạo khóa mới trên trang chủ của dịch vụ tương ứng.',
    },
  ],
  relatedPages: ['Dashboard', 'AI Workflow', 'Veo Studio', 'Lên lịch Youtube'],
}
