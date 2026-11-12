import type { HelpDoc } from '../model.ts'

export const storiesPageDoc: HelpDoc = {
  pageId: 'Crawl truyện',
  title: 'Crawl truyện (Story Crawler)',
  summary:
    'Lấy truyện chữ từ daotruyen.me về máy: chọn thể loại, chọn truyện rồi cào từng chương (hoặc cả thể loại). Nội dung lưu trong cơ sở dữ liệu cục bộ (SQLite) và là nguyên liệu cho Workflow Audio ở trang Recap & Audio.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Kết nối Internet tới nguồn truyện',
      fixHint: 'Nguồn là daotruyen.me. App tự giữ tốc độ khoảng 0,25 giây/request và tự chậm lại khi gặp rate-limit.',
    },
  ],
  start: [
    {
      title: 'Chọn thể loại',
      do: 'Mở ô “Thể loại truyện”, tích một hoặc nhiều thể loại. Có thể bấm “Chọn nhanh” 5 / 10 / 15 / 20 / Tất cả (chọn N thể loại đầu).',
      result: 'Danh sách truyện của các thể loại đã chọn hiện ra.',
    },
    {
      title: 'Chọn truyện',
      do: 'Bấm một truyện trong “Danh sách truyện” để xem thông tin và các chương. Dùng ô “Sắp xếp” nếu cần (cập nhật, lượt xem, thứ tự import).',
    },
    {
      title: 'Cào truyện',
      do: 'Bấm “Cào truyện” để cào các chương chưa có. Tiến trình hiện ở “Tiến trình cào”; chương đã đủ thì được bỏ qua.',
      result: 'Chương hiện trong “Chương đã lưu”; bấm “Xem nội dung đã lưu” để đọc.',
    },
    {
      title: 'Dùng truyện trong Recap & Audio',
      do: 'Sang Recap & Audio → Workflow Audio: truyện đã cào xuất hiện trong Kho truyện, sẵn sàng chọn chương để làm video.',
    },
  ],
  areas: [
    {
      id: 'the-loai',
      name: 'Thể loại truyện',
      what: 'Ô chọn nhiều thể loại, có tìm kiếm. Các thể loại đã chọn luôn được đưa lên đầu danh sách. “Bỏ chọn” xóa lựa chọn.',
    },
    {
      id: 'danh-sach-truyen',
      name: 'Danh sách truyện và thông tin',
      what: 'Mỗi truyện hiện nhóm dịch, số theo dõi (Following), tổng lượt xem, tình trạng (Đang cập nhật…) và số chương. Sắp xếp theo: Cập nhật gần nhất, Cập nhật cũ → mới / mới → cũ, Lượt xem cao → thấp / thấp → cao, Import CSDL cũ → mới / mới → cũ.',
    },
    {
      id: 'cao-truyen',
      name: 'Cào truyện và tiến trình',
      what: '“Cào truyện” lấy danh sách chương rồi cào từng chương. Chương đã có đủ nội dung hiển thị “Đã đủ chương · bỏ qua”. Chương chưa cào có nhãn “Chưa cào”. Tiến trình theo dõi được ngay trên trang.',
    },
    {
      id: 'cao-theo-the-loai',
      name: 'Cào toàn bộ theo thể loại',
      what: '“Cào toàn bộ” cào mọi truyện của các thể loại đã chọn trong một lượt (“Đang cào hàng loạt…”). Có tùy chọn “Cào lại truyện đã đủ chương” để cào lại cả truyện đã đủ.',
      tip: 'Cào hàng loạt có thể lâu. Chỉ chọn vài thể loại một lần, hoặc cào từng truyện bạn thật sự cần.',
    },
    {
      id: 'truyen-da-cao',
      name: 'Truyện đã cào (SQLite)',
      what: 'Tab/khối “Truyện đã cào” liệt kê những truyện đã lưu cục bộ (“Đã lưu trong SQLite”), mở “Xem nội dung đã lưu” để đọc từng chương. Đây chính là nguồn của Kho truyện trong Workflow Audio.',
    },
  ],
  concepts: [
    { term: 'Cào (crawl)', meaning: 'Tải nội dung chữ của từng chương từ trang nguồn và lưu vào máy.' },
    { term: 'Rate-limit', meaning: 'Trang nguồn giới hạn số request; app tự giảm tốc độ khi bị giới hạn.' },
  ],
  problems: [
    {
      symptom: 'Báo “Cào truyện thất bại”',
      fix: 'Kiểm tra kết nối mạng và trang nguồn còn truy cập được; thử cào lại, app chỉ cào những chương còn thiếu.',
    },
    {
      symptom: 'Chương hiện “Chương chưa được cào”',
      fix: 'Bấm “Cào truyện” lại cho truyện đó. Chương rỗng sẽ bị Workflow Audio từ chối (“Nội dung chương N đang rỗng”).',
      link: 'Recap & Audio',
    },
    {
      symptom: 'Danh sách thể loại hoặc truyện không tải',
      fix: 'Kiểm tra backend đang chạy (“Không thể tải truyện”) rồi tải lại trang.',
    },
    {
      symptom: 'Cào hàng loạt chạy rất lâu',
      fix: 'Bình thường: app giữ tốc độ an toàn để khỏi bị chặn. Chọn ít thể loại hơn hoặc cào riêng từng truyện cần dùng.',
    },
  ],
  related: ['Recap & Audio', 'Voices', 'Thư viện nhạc'],
  changes: [
    { date: '2026-11-12', text: 'Truyện đã cào hiện trong Kho truyện của Workflow Audio (kèm đọc chương và tóm tắt Gemini).' },
  ],
}
