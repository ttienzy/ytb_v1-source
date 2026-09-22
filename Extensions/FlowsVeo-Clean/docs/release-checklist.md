# Phát hành và quay lui

## Trước khi đổi bản đang chạy

1. Kiểm tra các thay đổi của người dùng; không reset checkout hay sửa file không thuộc extension.
2. Khi bản đang load đã ổn, `npm run snapshot` tạo bản sao runtime/test và SHA-256 trong `.local/snapshots/<timestamp>/`. Không upload `.local` vì snapshot có thể chứa config cũ.
3. Chạy `npm run verify`. Kiểm tra browser report đã pass và ghi nhận giới hạn fixture-only.
4. Kiểm tra Google Flow thật trong một đợt có tài khoản/test quota phù hợp: tài khoản, multi-tab, nhiều video đồng thời, reference image/video, recovery, voice. Browser fixture không xác nhận API Google hiện tại hay thay cho bước này.
5. Đợi các job kết thúc. Chỉ bật một bản extension trên bridge. Reload đường dẫn hiện tại hoặc nạp `dist/release` khi chuyển bản có chủ đích.

## Store

Chỉ upload ZIP trong `release/`, không ZIP cả package. Manifest ở root ZIP. Không source map/test/docs/node_modules. Kiểm tra thêm nội dung khai báo quyền và dữ liệu cho đợt Store riêng. Minify không bảo đảm giấu logic hoặc bảo đảm được Store duyệt.

Chuyển từ unpacked sang Store có thể đổi extension ID, nên storage/config không tự chuyển. Thiết lập lại port/cấu hình cần thiết; không giả định trạng thái instance cũ vẫn còn. Nâng cấp Store giữ cùng ID cần kiểm tra khôi phục settings.

Không có script tự commit, push hoặc publish. Không tự reload browser của người dùng.

## Quay lui

Snapshot ban đầu 1.0.9 được giữ trong `.local/snapshots/2026-09-22T15-17-30-351Z/` tại workspace triển khai. Đối chiếu `snapshot.json` trước khi dùng. Có thể load snapshot trên profile thử nghiệm, không bật cùng bản mới trên bridge thật.

Để quay lại cùng ID unpacked/cấu hình hiện tại: chờ job kết thúc, sao lưu runtime mới, kiểm tra đúng thư mục extension rồi phục hồi **các file runtime cụ thể** từ snapshot về đường dẫn Load unpacked cũ và reload. Không ghi đè `src/`, không xóa toàn workspace, không dùng git reset. Sau đó không chạy build source mới nếu muốn tiếp tục chạy bản cũ.

Quay lui Store cần đóng bản logic cũ với version cao hơn version đã phát hành; không giả định có thể hạ version trực tiếp. Snapshot runtime không phải bản phục hồi toàn bộ môi trường phát triển.
