import type { HelpDoc } from '../model.ts'

export const discoverPageDoc: HelpDoc = {
  pageId: 'Khám Phá Kênh',
  title: 'Khám Phá Kênh (YouTube Intelligence)',
  summary:
    'Tìm kênh YouTube đáng làm recap (nhờ Gemini gợi ý hoặc tự thêm), xem danh sách video của kênh, lọc ra video mới và video chưa làm, rồi chọn vài video đưa sang Recap & Audio.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Gemini đã đăng nhập (chỉ cho tính năng “Gemini Quét Kênh”)',
      fixPage: 'Cài đặt',
      fixHint: 'Thêm kênh bằng @handle/link và quét video không cần Gemini; chỉ gợi ý kênh mới dùng Gemini.',
    },
  ],
  start: [
    {
      title: 'Chọn một kênh',
      do: 'Bấm một kênh trong danh sách (có kênh mẫu theo chủ đề và kênh bạn đã lưu). Chưa có kênh? Dùng “Thêm Kênh YouTube Mới” hoặc nhờ Gemini gợi ý.',
    },
    {
      title: 'Quét video của kênh',
      do: 'App quét nhanh danh sách video (không tốn quota Google API). Bấm quét lại bất cứ lúc nào để tìm video mới đăng.',
      result: 'Danh sách video kèm ngày đăng, thời lượng, lượt xem.',
    },
    {
      title: 'Lọc video đáng làm',
      do: 'Dùng các bộ lọc: Tất cả, Mới, Chưa làm, Đã làm, 5–18 phút (chuẩn recap), Lượt xem cao nhất. Mặc định là “Chưa làm” để video đã recap không che mất video mới.',
    },
    {
      title: 'Chọn video và đưa sang Recap & Audio',
      do: 'Tích chọn video (hoặc chọn tất cả) rồi bấm “Đưa vào Studio Recap ➔”, hoặc “Sao chép N link”.',
      result: 'Link sang trang Recap & Audio ở chế độ Hàng loạt.',
    },
  ],
  areas: [
    {
      id: 'kenh',
      name: 'Danh sách kênh, kênh đã lưu và thêm kênh',
      what: '“Lưu kênh vào yêu thích” / “Bỏ lưu kênh” để giữ kênh trong danh sách của bạn. “Thêm Kênh YouTube Mới” nhận @handle (ví dụ @MarkWiens) hoặc link kênh, rồi “Lưu & Quét Video”.',
    },
    {
      id: 'gemini-quet-kenh',
      name: 'Gemini Quét Kênh (gợi ý kênh)',
      what: 'Nhập yêu cầu bằng lời (ví dụ “Kênh review đồ ăn đường phố Châu Á hài hước”) hoặc bấm một chủ đề mẫu: Street Food Châu Á, Thử thách ăn khổng lồ, Ẩm thực độc lạ & Món cay, Bếp trưởng & Kỹ nghệ nấu ăn, Quán ăn huyền thoại US/EU, Buffet & Hải sản khổng lồ. Gemini trả về danh sách kênh phù hợp để bạn lưu hoặc quét.',
    },
    {
      id: 'loc-video',
      name: 'Bộ lọc và sắp xếp video',
      what: 'Tất cả: mọi video đã quét. Mới: video kênh vừa đăng kể từ lần quét trước và bạn chưa làm. Chưa làm: video chưa từng được tạo recap. Đã làm: video đã recap thành công (hiện ngày làm). 5–18 phút: độ dài chuẩn để recap. Lượt xem cao nhất: sắp theo lượt xem.',
      tip: 'Huy hiệu “Mới” chỉ có từ lần quét thứ hai của một kênh (lần quét đầu chỉ lập mốc) và hết hiệu lực sau 7 ngày.',
    },
    {
      id: 'ngay-dang',
      name: 'Ngày đăng',
      what: 'Ngày chính xác lấy từ nguồn cấp RSS của kênh (khoảng 15 video mới nhất). Các video cũ hơn chỉ có ngày xấp xỉ và được ghi rõ là “Ngày đăng xấp xỉ”.',
    },
    {
      id: 'tai-them',
      name: 'Tải thêm video cũ hơn',
      what: 'Mỗi lần hiện 30 video mới nhất. Bấm “Tải thêm 30 video cũ hơn” để xem tiếp. Nếu bạn đã làm hết video đã quét, app nhắc bấm “Tải thêm”.',
    },
    {
      id: 'chon-video',
      name: 'Chọn video và hành động hàng loạt',
      what: 'Tích từng video hoặc “Chọn tất cả video trong danh sách” / “Bỏ chọn tất cả”. Thanh dưới cùng hiện số video đã chọn với hai nút: “Sao chép N link” (đưa vào clipboard) và “Đưa vào Studio Recap ➔”.',
      tip: 'Recap & Audio nhận tối đa 10 link một lô.',
    },
  ],
  concepts: [
    { term: 'Quét nhanh', meaning: 'Lấy danh sách video của kênh trực tiếp từ YouTube, không dùng quota Google API.' },
    { term: 'Mới', meaning: 'Video xuất hiện lần đầu trong một lần quét sau lần quét đầu tiên của kênh và còn trong 7 ngày.' },
    { term: 'Đã làm', meaning: 'Video đã được tạo recap thành công trước đó (lấy từ lịch sử).' },
  ],
  problems: [
    {
      symptom: 'Làm mới nhưng không thấy video mới',
      cause: 'Kênh chưa đăng video mới, hoặc đây là lần quét đầu tiên (chỉ lập mốc).',
      fix: 'Thông báo “Chưa có video mới kể từ lần quét trước.” là bình thường. Quét lại sau khi kênh đăng; chọn “Tất cả” để xem toàn bộ video đã quét.',
    },
    {
      symptom: 'Bộ lọc “Chưa làm” trống',
      fix: 'Bạn đã làm hết video đã quét. Bấm “Tải thêm” để xem video cũ hơn, hoặc chuyển sang “Tất cả”.',
    },
    {
      symptom: 'Báo “Không tìm thấy kênh phù hợp” hoặc “Gemini không phản hồi”',
      fix: 'Đổi cách mô tả (cụ thể hơn) hoặc kiểm tra Gemini còn đăng nhập ở Cài đặt rồi thử lại.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Lỗi quét video” hoặc “Không tải được video kênh”',
      fix: 'YouTube có thể đang chặn hoặc link kênh sai. Kiểm tra lại @handle/link; nếu YouTube yêu cầu xác thực, đăng nhập YouTube qua Chrome ở Cài đặt → Gemini & YouTube.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Bấm “Đưa vào Studio Recap” báo phải tích chọn ít nhất 1 video',
      fix: 'Tích chọn ít nhất một video trước khi chuyển sang Recap & Audio.',
    },
  ],
  related: ['Recap & Audio', 'Cài đặt', 'Lịch sử'],
  changes: [
    { date: '2026-11-12', text: 'Làm mới kênh có huy hiệu “Mới”, ngày đăng chính xác từ RSS và bộ lọc “Chưa làm / Đã làm”; mặc định lọc “Chưa làm”.' },
  ],
}
