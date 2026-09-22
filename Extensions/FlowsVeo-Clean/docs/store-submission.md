# Hồ sơ đăng Chrome Web Store — bản nháp

Trạng thái: đã xác minh ZIP, chưa upload và chưa gửi duyệt.

Gói: `release/FlowsVeo-Clean-v1.0.10.zip` (243020 bytes).

SHA-256: `2d6b53b34ca6b2b1876f437a0c64e13060e2953a37be5b624790602f1290626d`.

SHA-256 là checksum đối chiếu, không che mã và không phải file cần upload lên Store. Upload ZIP runtime; không upload toàn bộ thư mục source. ZIP đã đối chiếu với build từ source hiện tại.

## Mô tả đề xuất

FlowsVeo Clean kết nối Google Flow trong trình duyệt với ứng dụng tương thích đang chạy trên máy tính của bạn.

Tiện ích hỗ trợ chuyển yêu cầu tạo ảnh/video, tải nội dung tham chiếu, tạo và chuyển project, theo dõi trạng thái kết nối và gửi kết quả về ứng dụng. Popup cung cấp thông tin tài khoản, credits và các tùy chọn làm mới phiên/cache.

Để hoạt động, bạn cần mở Google Flow, đăng nhập bằng tài khoản của mình và chạy ứng dụng có bridge localhost tương thích. Tiện ích không phải sản phẩm độc lập cung cấp dịch vụ tạo video khi không có ứng dụng kết nối.

Tiện ích đọc dữ liệu phiên đăng nhập, gồm cookie và token xác thực khi có, cùng thông tin tài khoản và chuyển tới bridge localhost của ứng dụng bạn kết nối. Các thao tác tạo nội dung gửi prompt và nội dung tham chiếu tới dịch vụ Google Flow. Chức năng đồng bộ cookie cho tích hợp voice cũng có trong bản này. Chỉ dùng với ứng dụng mà bạn tin cậy.

## Quyền hiện tại và lý do sử dụng

| Quyền | Hành vi thực tế cần mô tả |
| --- | --- |
| `alarms` | Heartbeat và watchdog cho kết nối bridge |
| `browsingData` | Xóa dữ liệu/cache của labs.google theo thao tác hoặc cấu hình hiện tại |
| `cookies` | Đọc cookie phiên đăng nhập để đồng bộ tài khoản/voice với bridge; xóa cookie trong luồng refresh hiện tại |
| `tabs` | Tìm, mở, chọn, reload và chuyển tab/project Google Flow |
| `scripting` | Chạy các hàm đã đóng gói trong tab Flow để thực hiện yêu cầu và đọc trạng thái |
| `storage` | Lưu cấu hình, fingerprint, thống kê và một số dữ liệu phiên đăng nhập trên máy |
| localhost / 127.0.0.1 | Kết nối ứng dụng trên máy người dùng qua HTTP loopback |
| labs.google / flow.google.com | Thao tác trong phiên Google Flow của người dùng |
| *.google.com / *.googleapis.com | Đọc cookie Google và truy cập các API được luồng hiện tại sử dụng |

Các wildcard Google đang rộng; không mặc định chúng sẽ được Store chấp nhận. Nếu reviewer yêu cầu giảm quyền hoặc thu hẹp tính năng, xử lý bằng một thay đổi có regression test riêng, không sửa logic bản ổn định âm thầm.

## Privacy: dữ kiện cần khai báo

- Email/thông tin tài khoản, tier và credits.
- Cookie và access token khi lấy được; không khai là không xử lý thông tin xác thực.
- URL/tab ID của tab Flow, project/media ID, prompt và nội dung tham chiếu trong các tác vụ liên quan.
- Fingerprint instance, user agent và thông tin kết nối/log hoạt động.
- Dữ liệu gửi tới bridge localhost; nội dung cần xử lý gửi tới Google Flow. Chính sách của ứng dụng nhận dữ liệu phía bridge phải được mô tả riêng.
- Có lưu một số dữ liệu trong `chrome.storage.local`; không khai là mọi dữ liệu chỉ tồn tại trong RAM.

Chủ tài khoản cần cung cấp URL privacy policy công khai, thông tin liên hệ và xác nhận các tuyên bố về sử dụng/chia sẻ/lưu giữ/xóa dữ liệu. Không tự chứng nhận các mục Limited Use khi chưa có thông tin của nhà phát hành. Bản nháp này không thay thế privacy policy.

## Thông tin còn thiếu để nộp

- Tài khoản Developer Dashboard đã đăng ký và đăng nhập trong môi trường có thể thao tác.
- Xác định đăng mới hay cập nhật; nếu cập nhật, item ID/URL hiện có.
- Tên nhà phát hành, thông tin hỗ trợ và URL privacy policy.
- Ảnh giao diện và tài sản listing đáp ứng yêu cầu Dashboard.
- Cách reviewer cài/chạy ứng dụng bridge tương thích và kiểm tra chức năng; không cung cấp tài khoản cá nhân/cookie/token thật trong tài liệu công khai.
- Thiết lập phân phối phù hợp với lựa chọn của nhà phát hành.

## Tài liệu chính thức đã đối chiếu

- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/program-policies/code-readability

Sau upload, hoàn thiện listing/privacy/distribution/test instructions rồi Submit for Review. Upload/gửi duyệt không đồng nghĩa extension đã được duyệt hoặc đã public.
