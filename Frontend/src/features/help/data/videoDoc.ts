import type { SidebarDoc } from '../types'

export const videoDoc: SidebarDoc = {
  id: 'Video',
  title: 'Kho Quản Lý Video & Thành Phẩm',
  category: 'Kho tài nguyên',
  badge: 'Media Storage',
  summary:
    'Trung tâm lưu trữ và kiểm soát toàn bộ video thành phẩm được tạo ra từ Canvas AI, Veo Studio và Batch Recap. Hỗ trợ xem trước chất lượng cao, quản lý dung lượng ổ đĩa và mở trực tiếp vị trí file trên hệ điều hành.',
  subTabs: [
    {
      id: 'gallery',
      label: 'Danh Sách Video Thành Phẩm',
      iconName: 'video',
      desc: 'Quản lý toàn bộ danh sách file video đã xuất trên ổ cứng.',
      flowSteps: [
        'Duyệt danh sách video theo thời gian tạo gần nhất',
        'Xem kích thước dung lượng (MB/GB) và định dạng file',
        'Bấm icon Play để xem trước ngay trên ứng dụng',
        'Bấm icon Mở Thư Mục để mở Windows Explorer tại vị trí file',
      ],
    },
    {
      id: 'actions',
      label: 'Thao Tác Nhanh & Điều Phối',
      iconName: 'layers',
      desc: 'Phân phối video sang các phân hệ phát sóng đa kênh.',
      flowSteps: [
        'Chọn video ưng ý',
        'Chuyển sang "Lên lịch YouTube" hoặc "Lên lịch Pippit"',
        'Thiết lập tiêu đề và lên lịch đăng bài',
      ],
    },
  ],
  quickSteps: [
    {
      step: 1,
      title: 'Kiểm tra video vừa render',
      desc: 'Mỗi khi một tác vụ xuất video hoàn tất ở Canvas AI hoặc Studio → File video sẽ lập tức xuất hiện tại đầu danh sách trang này.',
      badge: 'Cập nhật tức thì',
    },
    {
      step: 2,
      title: 'Xem trước nội dung (Preview)',
      desc: 'Bấm nút Play để kiểm tra chất lượng hình ảnh, độ sắc nét và âm thanh lồng tiếng trước khi đem đi đăng bài.',
      badge: 'Kiểm duyệt',
    },
    {
      step: 3,
      title: 'Mở thư mục hoặc Chia sẻ',
      desc: 'Nhấn nút "Mở thư mục" để lấy file trực tiếp hoặc kéo thả sang các phần mềm dựng phim khác nếu muốn biên tập thêm.',
      badge: 'Sử dụng',
    },
  ],
  features: [
    {
      title: 'Trình Phát Video Không Giật Lag',
      desc: 'Tích hợp trình xem video MP4 tốc độ cao, hỗ trợ tua khung hình, bật tắt âm thanh và chế độ lặp lại (Loop) để kiểm tra độ mượt của các vòng lặp Shorts.',
      tag: 'Player',
    },
    {
      title: 'Tích Hợp Windows Explorer Một Chạm',
      desc: 'Không cần mất công mở từng ổ đĩa tìm kiếm, ứng dụng gọi lệnh hệ thống mở chính xác vị trí file trong thư mục `exports/` chỉ với 1 cú click.',
      tag: 'Native Integration',
    },
  ],
  proTips: [
    'Định kỳ dọn dẹp các video nháp hoặc video thử nghiệm không dùng đến để tránh làm đầy dung lượng ổ đĩa SSD.',
    'Có thể đổi tên file video theo quy tắc: [Ngày]_[Tên_Kênh]_[Tiêu_Đề].mp4 để dễ dàng quản lý lịch đăng thủ công nếu cần.',
  ],
  troubleshooting: [
    {
      issue: 'Bấm nút mở thư mục nhưng không có cửa sổ Windows Explorer hiện lên?',
      solution:
        'Kiểm tra xem file video đó có bị xóa hoặc chuyển sang ổ đĩa khác thủ công trước đó không. Hãy bấm nút Làm mới để đồng bộ lại danh sách.',
    },
  ],
  relatedPages: ['Dashboard', 'Canvas AI', 'Lên lịch Youtube', 'Lên lịch Pippit'],
}
