import type { SidebarDoc } from '../types'

export const discoverDoc: SidebarDoc = {
  id: 'Khám Phá Kênh',
  title: 'Khám Phá Kênh & Thu Thập Video Mẫu',
  category: 'Khai thác & Nghiên cứu',
  badge: 'YouTube Intelligence',
  summary:
    'Công cụ trinh sát nội dung thông minh giúp bạn phân tích các kênh YouTube đối thủ cùng ngách, quét video theo các chủ đề thịnh hành và chuyển nhanh hàng loạt video sang xưởng Studio để tái sản xuất.',
  quickSteps: [
    {
      step: 1,
      title: 'Chọn chủ đề gợi ý hoặc Nhập URL kênh',
      desc: 'Bấm vào một trong các danh mục nhanh (Street Food, Thử thách ăn, Bếp trưởng...) hoặc dán link kênh YouTube / Handle (@channel) vào ô tìm kiếm.',
      badge: 'Tìm kiếm',
    },
    {
      step: 2,
      title: 'Lọc video có độ viral cao',
      desc: 'Sử dụng bộ lọc video: "Khung giờ vàng" (Golden hours) hoặc "Nhiều view nhất" để lọc ra những nội dung có tiềm năng tiếp cận khán giả lớn nhất.',
      badge: 'Chọn lọc',
    },
    {
      step: 3,
      title: 'Gửi sang Studio Batch chỉ với 1 click',
      desc: 'Tích chọn các video ưng ý (hoặc chọn tất cả) $\\rightarrow$ Nhấn nút "Gửi sang Studio Batch" để tự động đẩy link sang xưởng cắt ghép/tóm tắt video.',
      badge: 'Chuyển tiếp',
    },
  ],
  features: [
    {
      title: 'Danh Mục Gợi Ý Sẵn (Quick Categories)',
      desc: 'Tập hợp các truy vấn chuyên sâu về các thị trường triệu view: Street Food Châu Á, Thử thách ăn khổng lồ, Ẩm thực độc lạ, Kỹ nghệ bếp trưởng, Quán ăn huyền thoại US/EU, Buffet hải sản đêm.',
      tag: 'Presets',
    },
    {
      title: 'Lưu Kênh Yêu Thích (Bookmark Channels)',
      desc: 'Lưu lại các kênh đối thủ tiềm năng vào danh sách riêng. Mỗi lần vào lại, hệ thống sẽ tự động hiển thị các kênh đã lưu ở sidebar bên trái để bạn theo dõi đều đặn mà không cần gõ lại.',
      tip: 'Nhấn vào icon Bookmark cạnh tên kênh để thêm hoặc gỡ bỏ khỏi danh sách theo dõi.',
      tag: 'Bookmarks',
    },
    {
      title: 'Bộ Lọc Đa Dạng Theo Mục Tiêu Sản Xuất',
      desc: 'Hỗ trợ lọc video theo: "Tất cả", "Khung giờ vàng" (thuật toán đo tốc độ tăng trưởng view), "Nhiều view nhất", "Chưa xử lý" (video mới tinh chưa đưa vào xưởng) và "Đã xử lý".',
      tag: 'Filters',
    },
    {
      title: 'Xem Metadata & Kịch Bản Gốc',
      desc: 'Hiển thị đầy đủ thời lượng, ngày đăng, số view, tiêu đề gốc. Bạn có thể copy link hoặc xem cấu trúc video để học hỏi phong cách kịch bản.',
      tag: 'Inspector',
    },
  ],
  proTips: [
    'Khi chọn video để làm Shorts/TikTok, hãy ưu tiên những video có thời lượng từ 3 đến 8 phút vì chúng có nhịp độ dồn dập, dễ trích xuất những khoảnh khắc cao trào.',
    'Tính năng "Chọn tất cả" kết hợp với "Gửi sang Studio Batch" cho phép bạn nạp 10–20 video vào hàng đợi sản xuất chỉ trong vòng 5 giây.',
    'Kênh có gắn nhãn "Khung giờ vàng" thường là các video đạt lượng xem tăng vọt trong 48 giờ đầu tiên sau khi đăng.',
  ],
  troubleshooting: [
    {
      issue: 'Tìm kiếm kênh nhưng không ra kết quả hoặc báo lỗi mạng?',
      solution:
        'Kiểm tra lại đường truyền internet hoặc định dạng link kênh. Bạn có thể dùng định dạng @handle (ví dụ `@BestFoodReviewShow`) hoặc link đầy đủ `https://www.youtube.com/@channel`.',
    },
    {
      issue: 'Avatar kênh bị lỗi hình ảnh hiển thị?',
      solution:
        'Hệ thống đã tích hợp sẵn cơ chế dự phòng (fallback gradient avatar) tự động tạo avatar chữ viết tắt chuyên nghiệp nếu link ảnh từ YouTube bị chặn hoặc tải chậm.',
    },
  ],
  relatedPages: ['Recap & Audio', 'Canvas AI', 'Xóa Watermark'],
}
