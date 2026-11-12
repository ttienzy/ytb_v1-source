import type { HelpDoc } from '../model.ts'

export const bgmPageDoc: HelpDoc = {
  pageId: 'Thư viện nhạc',
  title: 'Thư viện nhạc (nhạc nền)',
  summary:
    'Kho nhạc nền dùng chung: thêm bài lẻ hoặc nhập cả thư mục, nghe thử, ghi nhận bản quyền (miễn credit hoặc bắt buộc ghi nguồn CC BY) và lấy sẵn đoạn credit để dán vào mô tả video. Recap & Audio, Chiến dịch AI và Motion video dài chọn nhạc từ đây.',
  verifiedAt: '2026-11-12',
  requires: [],
  start: [
    {
      title: 'Thêm nhạc vào kho',
      do: 'Bấm “+ Thêm Track Mới”: kéo thả hoặc chọn file nhạc (MP3, WAV, AAC, OGG), đặt tên bài. Hoặc bấm “Nhập Thư Mục” rồi nhập đường dẫn thư mục nhạc trên máy để quét cả thư mục.',
      result: 'Bài hát hiện trong bảng thư viện.',
    },
    {
      title: 'Chọn loại bản quyền',
      do: 'Với bài cần ghi nguồn, chọn “Bản quyền CC BY” và dán đoạn credit (ví dụ “Carefree by Kevin MacLeod … Licensed under Creative Commons: By Attribution 4.0”). Bài tự do thì để “Miễn phí bản quyền”. Bấm “Lưu Vào Kho Nhạc”.',
    },
    {
      title: 'Nghe thử',
      do: 'Bấm “Nghe thử bài hát”; trình phát có tua, âm lượng, tắt tiếng.',
    },
  ],
  areas: [
    {
      id: 'them-bai',
      name: 'Thêm bài hát mới',
      what: 'Cần chọn file âm thanh và nhập tên bài. Có ô gợi ý tên dạng slug (ví dụ carefree-by-kevin-macleod) và ô mô tả bản quyền/credit.',
    },
    {
      id: 'nhap-thu-muc',
      name: 'Nhập thư mục',
      what: 'Quét toàn bộ tệp nhạc từ một thư mục trên máy và đưa vào kho (hiện “Đang nhập…”). Hợp khi bạn có sẵn bộ nhạc miễn phí bản quyền.',
    },
    {
      id: 'ban-quyen',
      name: 'Bản quyền và trích dẫn credit',
      what: 'Mỗi bài có nhãn “Miễn credit” hoặc “Cần ghi nguồn CC BY”. Nút “Copy credit” / “Sao chép văn bản credit” chép sẵn đoạn trích dẫn để dán vào mô tả YouTube. Phần “Bắt buộc ghi nguồn credit (Creative Commons CC BY)” nhắc bạn phải ghi nguồn tác giả trong mô tả video.',
      tip: 'Dùng nhạc CC BY mà không ghi nguồn có thể bị gỡ hoặc claim bản quyền.',
    },
    {
      id: 'thu-vien',
      name: 'Bảng thư viện và trình phát',
      what: 'Bảng gồm Tên Bài Hát, Thời Lượng, Bản Quyền, Thao Tác. Có tìm theo tên hoặc mô tả bản quyền, nghe thử, xóa bài khỏi kho. Đầu trang hiển thị tổng số bài và tổng thời lượng dự trữ.',
    },
  ],
  concepts: [
    { term: 'CC BY (Creative Commons Attribution)', meaning: 'Được dùng miễn phí nhưng bắt buộc ghi tên tác giả/nguồn.' },
    { term: 'Miễn credit', meaning: 'Nhạc tự do sử dụng, không cần ghi nguồn.' },
  ],
  problems: [
    {
      symptom: 'Báo “Vui lòng chọn file âm thanh và nhập tên bài hát”',
      fix: 'Chọn file (MP3, WAV, AAC, OGG) và điền tên bài trước khi lưu.',
    },
    {
      symptom: 'Báo “Nhập thư mục thất bại”',
      fix: 'Kiểm tra đường dẫn thư mục (ví dụ C:\\Users\\bạn\\Music\\music_no_copyright) có tồn tại và có file nhạc.',
    },
    {
      symptom: 'Báo “Không phát được bài hát này”',
      fix: 'File lỗi hoặc định dạng không hỗ trợ. Xóa bài và thêm lại bằng file khác.',
    },
    {
      symptom: 'Recap & Audio hoặc Chiến dịch AI báo thư viện nhạc trống',
      fix: 'Thêm ít nhất một bài hợp lệ ở đây rồi quay lại.',
      link: 'Recap & Audio',
    },
  ],
  related: ['Recap & Audio', 'Chiến dịch AI', 'Voices', 'Lên lịch Youtube'],
  changes: [],
}
