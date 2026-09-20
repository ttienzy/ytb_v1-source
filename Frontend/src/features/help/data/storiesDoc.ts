import type { SidebarDoc } from '../types'

export const storiesDoc: SidebarDoc = {
  id: 'Crawl truyện',
  title: 'Crawl Truyện & Bóc Tách Kịch Bản Văn Học',
  category: 'Khai thác & Nghiên cứu',
  badge: 'Web Novel Scraper',
  summary:
    'Hệ thống tự động cào và trích xuất nội dung tiểu thuyết, truyện tranh/chữ trực tuyến, hỗ trợ phân tách chương hồi, làm sạch văn bản để chuẩn bị làm kịch bản review truyện hoặc audiobook.',
  quickSteps: [
    {
      step: 1,
      title: 'Duyệt theo thể loại hoặc Tìm tên tác phẩm',
      desc: 'Chọn thể loại truyện yêu thích từ thanh menu lọc (Tiên hiệp, Kiếm hiệp, Đô thị, Trọng sinh, Ngôn tình...) hoặc tìm kiếm theo từ khóa.',
      badge: 'Chọn truyện',
    },
    {
      step: 2,
      title: 'Kích hoạt cào chương (Crawl Chapters)',
      desc: 'Chọn cào theo từng chương, cào các chương mới nhất hoặc chọn "Cào hàng loạt" (Bulk Crawl) để tải về máy toàn bộ nội dung của bộ truyện.',
      badge: 'Cào dữ liệu',
    },
    {
      step: 3,
      title: 'Đọc & Bóc tách nội dung chương',
      desc: 'Vào tab "Truyện đã lưu trong máy", mở trình đọc chương để đọc, làm sạch và sao chép văn bản đưa sang làm giọng đọc Voices hoặc kịch bản AI.',
      badge: 'Sử dụng',
    },
  ],
  features: [
    {
      title: 'Hai Chế Độ Xem Linh Hoạt (View Mode)',
      desc: 'Chuyển đổi tức thì giữa: "Xem theo thể loại trực tuyến" (khám phá kho truyện khổng lồ trên web) và "Truyện đã lưu trong máy" (lưu trữ offline trong cơ sở dữ liệu SQLite của bạn).',
      tag: 'Catalog',
    },
    {
      title: 'Bộ Lọc & Sắp Xếp Nâng Cao',
      desc: 'Sắp xếp danh sách truyện theo: Nhiều lượt xem nhất, Ít lượt xem nhất, Mới cập nhật gần đây, hoặc Mới nạp vào máy gần đây.',
      tag: 'Sorting',
    },
    {
      title: 'Cơ Chế Cào Chạy Nền Không Gián Đoạn (Background Jobs)',
      desc: 'Tác vụ cào truyện chạy ngầm bất đồng bộ trên Backend với mã định danh (Job ID). Người dùng có thể theo dõi tiến độ cào số lượng chương theo thời gian thực mà không bị đơ giao diện.',
      tip: 'Bạn có thể bật tùy chọn "Cào lại toàn bộ" nếu website truyện vừa cập nhật lại bản dịch chuẩn hơn.',
      tag: 'Async Jobs',
    },
    {
      title: 'Trình Đọc Chương Tích Hợp (Built-in Reader)',
      desc: 'Giao diện đọc truyện chuyên nghiệp với phông chữ tối ưu cho mắt, tự động ngắt đoạn văn bản, hiển thị số chữ, số chương và thanh điều hướng chương trước/chương kế tiếp.',
      tag: 'Reader',
    },
  ],
  proTips: [
    'Khi làm video dạng Review Tóm Tắt Truyện (10-15 phút), nên cào các cụm 10–20 chương đầu để nắm cốt truyện và mở đầu ấn tượng.',
    'Dữ liệu văn bản chương sau khi cào đã được xử lý làm sạch các câu quảng cáo website rác, bạn có thể dán thẳng vào phân hệ "Voices" để sinh giọng đọc tự nhiên.',
    'Để tạo video hoạt họa minh họa cho truyện, hãy copy đoạn miêu tả bối cảnh/nhân vật trong chương sang "Veo Studio" để tạo video AI tương ứng.',
  ],
  troubleshooting: [
    {
      issue: 'Tiến trình cào truyện bị dừng hoặc báo lỗi mạng?',
      solution:
        'Một số website đọc truyện có thể giới hạn tốc độ request. Bạn chỉ cần chờ vài phút rồi bấm nút cào lại, hệ thống sẽ tự động tiếp tục từ chương chưa tải thành công.',
    },
    {
      issue: 'Truyện đã cào xong nhưng không hiển thị trong danh sách?',
      solution:
        'Hãy chuyển qua tab "Truyện đã lưu trong máy" và bấm nút biểu tượng "Làm mới" trên thanh công cụ để đồng bộ lại danh mục từ database cục bộ.',
    },
  ],
  relatedPages: ['Voices', 'AI Workflow', 'Workflow'],
}
