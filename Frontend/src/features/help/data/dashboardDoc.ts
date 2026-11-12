import type { SidebarDoc } from '../types'

export const dashboardDoc: SidebarDoc = {
  id: 'Dashboard',
  title: 'Trung Tâm Điều Hành Video AI',
  category: 'Vận hành & Giám sát',
  badge: 'Production Hub',
  summary:
    'Bảng điều khiển trung tâm giúp bạn giám sát toàn diện tiến độ phát sóng đa kênh (YouTube, TikTok, Facebook), đo lường vận tốc sản xuất video và truy cập nhanh vào các xưởng sáng tạo AI.',
  quickSteps: [
    {
      step: 1,
      title: 'Kiểm tra trạng thái phát sóng hôm nay',
      desc: 'Nhìn vào thanh KPI trên cùng xem có kênh nào gắn cờ "Cần xuất bản hôm nay" (màu đỏ) hay không.',
      badge: 'Ưu tiên',
    },
    {
      step: 2,
      title: 'Đảm bảo lịch dự trữ phát sóng an toàn',
      desc: 'Duy trì số ngày đệm (Buffer Days) tối thiểu từ 3 ngày trở lên để không bao giờ bị đứt mạch đăng bài khi có sự cố kỹ thuật.',
      badge: 'Buffer Check',
    },
    {
      step: 3,
      title: 'Khởi tạo tác vụ sản xuất nhanh',
      desc: 'Bấm vào 1 trong 3 thẻ tắt: "AI Product-to-Video" (Node-graph), "Veo Generative Studio" (AI Clip), hoặc "Lên Lịch Đa Kênh".',
      badge: 'Quick Launch',
    },
  ],
  features: [
    {
      title: 'Dải thẻ KPI Sản Xuất (Production KPI Strip)',
      desc: 'Tổng hợp tức thì 4 chỉ số sống còn: Số kênh cần đăng bài hôm nay, Tiến độ các kênh đã hoàn tất, Tổng số video hoàn chỉnh đã xuất, và Số ngày dự trữ bài trung bình.',
      tip: 'Bấm vào ô "Cần xuất bản hôm nay" để mở nhanh danh sách các kênh chưa có video phát sóng.',
      tag: 'KPIs',
    },
    {
      title: 'Biểu đồ Vận Tốc Sản Xuất (Production Velocity)',
      desc: 'Đồ thị đường cong diện tích (Area Spline Chart) thể hiện sản lượng video tạo ra trong 7 ngày qua. Bạn có thể chuyển đổi giữa 2 chế độ: "Chỉ video thành phẩm" (Exports) và "Toàn bộ clip AI" (bao gồm các phân cảnh Veo).',
      tip: 'Rê chuột vào các điểm mốc trên biểu đồ để xem chi tiết số lượng video và tổng dung lượng MB/GB được sinh ra trong ngày đó.',
      tag: 'Analytics',
    },
    {
      title: 'Pipeline Lịch Dự Trữ 7 Ngày Tới',
      desc: 'Hiển thị dự báo phát sóng từ Hôm nay đến 6 ngày tới. Mỗi ngày được phân loại màu: Xanh lục (đủ bài), Vàng (ít bài), Xám (trống lịch phát sóng).',
      tag: 'Calendar',
    },
    {
      title: 'Thư Viện Video Hoàn Chỉnh Gần Đây',
      desc: 'Danh sách các video vừa render xong. Bạn có thể nhấn icon Play để xem trực tiếp hoặc nhấn icon Thư mục để mở ngay vị trí file trên máy tính.',
      tag: 'File Manager',
    },
    {
      title: 'Nút "Làm Mới" Đồng Bộ Dữ Liệu Thời Gian Thực',
      desc: 'Gửi đồng thời 6 yêu cầu API tới Backend FastAPI để kiểm tra ping máy chủ, ping SQLite, quét thư mục xuất video và đồng bộ lịch phát sóng trực tiếp từ các nền tảng mạng xã hội.',
      tag: 'Sync',
    },
  ],
  proTips: [
    'Nếu thấy dải cảnh báo đỏ "Kênh chưa đăng hôm nay", hãy ưu tiên vào Canvas AI để tạo video ngắn 15s-30s và đăng trước khung giờ vàng (11:30 hoặc 19:30).',
    'Nút mở thư mục trong danh sách Video gần đây sẽ mở trực tiếp Windows Explorer tại đúng file video đã chọn.',
    'Chế độ xem "Toàn bộ clip AI" trên biểu đồ vận tốc rất hữu ích để bạn biết hôm nay bạn đã chạy bao nhiêu lượt sinh clip qua mô hình Veo.',
  ],
  troubleshooting: [
    {
      issue: 'Bấm nút "Làm mới" nhưng các con số thống kê không thay đổi?',
      solution:
        'Hệ thống lấy dữ liệu trực tiếp từ file và database. Nếu bạn chưa xuất thêm video mới hoặc chưa thêm lịch đăng trên YouTube/TikTok thì số liệu giữ nguyên là hoàn toàn bình thường.',
    },
    {
      issue: 'Đèn trạng thái Backend API hoặc SQLite báo "Mất kết nối"?',
      solution:
        'Hãy kiểm tra xem cửa sổ terminal chạy Backend FastAPI (cổng 8000) có bị tắt không. Chạy lệnh: `python -m uvicorn app.main:app --port 8000` tại thư mục Backend.',
    },
  ],
  relatedPages: ['Canvas AI', 'Veo Studio', 'Lên lịch Youtube', 'Lên lịch Pippit'],
}
