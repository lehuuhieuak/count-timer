# Thiết kế Count Timer V1

## Mục tiêu và phạm vi đã thống nhất

Website tối giản cho nhiều người dùng, dữ liệu riêng, không có màn hình đăng nhập. Hai tính năng độc lập: đếm lên và đếm ngược. V1 chỉ có giao diện sáng.

- Server Debian 13, RAM 8 GB, đã có Docker, PostgreSQL và reverse proxy.
- Một ứng dụng Next.js + TypeScript chứa giao diện và backend/API, đóng gói Docker, kết nối PostgreSQL hiện có. Đây là lựa chọn công nghệ đề xuất trong kế hoạch.
- Không triển khai thêm PostgreSQL hoặc reverse proxy lên production.
- Không có tài khoản email, liên kết khôi phục/chuyển thiết bị, giao diện tối, báo cáo theo ngày, dự án hoặc nhóm trong V1.
- Mỗi hồ sơ trình duyệt nhận một danh tính ẩn danh qua cookie. Xóa cookie, đổi trình duyệt hoặc thiết bị sẽ không truy cập được dữ liệu cũ. Người dùng chung hồ sơ trình duyệt sẽ dùng chung dữ liệu.

## Nguồn giao diện triển khai

Giao diện chuẩn là hai file code.html đã chỉnh và shared/app.css trong docs/stitch-design/stitch_minimalist_count_timer/; không tự thiết kế lại.

screen.png là ảnh Stitch cũ; DESIGN.md gốc không được ghi đè giao diện đã chỉnh hoặc mở rộng phạm vi V1.

Đọc `m_l_n_count_timer/code.html`, `m_ng_c_count_timer/code.html`, `shared/app.css`, `shared/app.js` và README trong thư mục trên. Hai HTML chứa cùng hai panel, chỉ khác tab mở mặc định. Port thành một trang React, giữ màu sắc, typography, spacing, thẻ countdown, preset, form, nút và dialog. Chuẩn mobile là media query 640px trong app.css: header xếp dọc, đồng hồ co theo viewport, nút chính toàn chiều rộng, ẩn gợi ý Space. Không cần thêm thiết kế mobile từ Stitch.

Backend và hành vi production tuân theo spec này. Không chuyển sessionStorage, pagehide dừng trực tiếp, mốc thời gian trong bộ nhớ hoặc âm thanh không có claim của preview thành cơ chế production. Nhãn “Bản xem thử · Chưa kết nối server” được thay tại cùng vị trí bằng trạng thái request thật; footer lưu tạm được thay bằng ghi chú cookie ẩn danh. Không hiển thị Đã đồng bộ khi request chưa thành công.

Nghiệm thu giao diện phải đối chiếu ảnh render HTML đã chỉnh và ứng dụng ở desktop 1440×1000/mobile 390×844; kiểm tra thêm không tràn ngang ở 320/375/768px, gồm số giờ ba chữ số. Các khác biệt nội dung preview→production ở trên là có chủ đích.

## Giao diện và tương tác

Một trang có hai tab tính năng. Mỗi tab có đồng hồ lớn, nút Bắt đầu/Tạm dừng và gợi ý phím Space. Trên điện thoại dùng nút chạm. Không có bộ chuyển giao diện sáng/tối.

Space điều khiển tính năng đang xem: bắt đầu → tạm dừng → tiếp tục. Bỏ qua Space khi nhập liệu, trong vùng contenteditable, trên nút có hành vi bàn phím mặc định, trong hộp thoại hoặc khi sự kiện bàn phím đang lặp do giữ phím. Ngăn cuộn trang khi Space thực sự điều khiển đồng hồ.

### Đếm lên

- Bắt đầu từ 0, cộng liên tục qua nhiều ngày; không tự đặt lại khi qua nửa đêm.
- Tạm dừng giữ nguyên thời gian; tiếp tục từ số đã có. Không tính thời gian nghỉ.
- Nút Đặt lại mở xác nhận; xác nhận đưa về 0 và trạng thái dừng. Hủy không thay đổi dữ liệu.
- Không giới hạn hiển thị ở 24 giờ, ví dụ `125:03:09`.

### Đếm ngược

- Chọn nhanh 5, 15, 25, 50 phút, hoặc nhập giờ/phút/giây. Nhớ thời lượng lần trước.
- Tạm dừng giữ thời gian còn lại. Không cộng vào đếm lên.
- Về 0: dừng, đổi màu, hiện chữ Hết giờ và phát âm thanh ngắn nếu đã bật tiếng.
- Có nút bật/tắt âm thanh, ghi nhớ lựa chọn. Chỉ một tab được nhận quyền phát âm thanh cho mỗi lượt hoàn thành.

Các mặc định đề xuất để kế hoạch có thể thực thi: lần đầu chọn 25 phút, âm thanh bật; thời lượng tùy chỉnh từ 1 giây đến 99:59:59; thay thời lượng chỉ khi dừng, thay đổi bắt đầu một lượt mới; Space sau khi hết giờ chạy lại thời lượng đã chọn. Nút Đặt lại đưa về thời lượng đã chọn và dừng. Các mặc định này có thể chỉnh khi duyệt tài liệu.

## Nhiều tab, đóng trang và giới hạn trình duyệt

- Hai tính năng có thể chạy đồng thời. Chuyển tính năng, chuyển tab trình duyệt hoặc thu nhỏ cửa sổ không chủ động tạm dừng.
- Các tab trình duyệt dùng chung dữ liệu. Đóng một tab, kể cả tab cuối cùng, không dừng đồng hồ; timer chỉ tạm dừng khi người dùng gửi lệnh Tạm dừng.
- Khi mở lại sau thời gian không có tab hoạt động, đếm lên cộng toàn bộ thời gian đã trôi qua và đếm ngược tiếp tục đến 0.
- Trình duyệt có thể chặn thông báo rời trang, đóng tiến trình hoặc cho tab ngủ. Các tín hiệu presence chỉ phục vụ đồng bộ nhiều tab và dọn lease; chúng không được thay đổi trạng thái chạy/dừng của timer.

Thiết kế dự kiến: mỗi trang có `tabId` ngẫu nhiên mới, đăng ký khi mở và gửi heartbeat 15 giây/lần. Lease hết hạn sau 90 giây không có tín hiệu. `pagehide` gửi tín hiệu đóng bằng beacon theo best effort; không dùng `visibilitychange` để tạm dừng. Khi trang trở lại từ bộ nhớ điều hướng, đăng ký lại qua `pageshow`.

Server kiểm tra và dọn lease khi nhận heartbeat, truy vấn trạng thái hoặc lệnh điều khiển nhưng không dùng lease để tạm dừng timer. Nếu đếm ngược đã về 0 trong thời gian không có request, lần đọc, heartbeat, lệnh hoặc claim tiếp theo sẽ materialize trạng thái hoàn thành trước khi trả kết quả. Hàng database có thể chưa được cập nhật khi không có request, nhưng mọi lần đọc đều hòa giải trước khi trả kết quả.

Timeout là tham số phục vụ dọn presence và cần kiểm chứng trên trình duyệt thật; nó không ảnh hưởng elapsed/remaining của timer. Đồng hồ và âm thanh nền không được đảm bảo khi thiết bị ngủ. Không phát bù tiếng báo của lượt đã hết từ trước khi trang được mở lại.

## Tính thời gian, lưu dữ liệu và đồng bộ

Đồng hồ dùng thời gian tích lũy/còn lại tại một mốc và timestamp server bắt đầu chạy. Không cộng hoặc trừ 1 mỗi lần setInterval. Trình duyệt chỉ nội suy để hiển thị; đồng bộ lại sau khi lấy trạng thái mới hoặc quay lại trang.

PostgreSQL lưu:

| Bảng | Nội dung |
|---|---|
| `anonymous_users` | ID nội bộ, hash token ngẫu nhiên, thời điểm tạo |
| `timer_states` | Một hàng/người dùng: revision, hai đồng hồ độc lập, thời lượng chọn, âm thanh, run ID của đếm ngược, quyền báo hoàn thành |
| `browser_tabs` | user ID, tab ID, lần liên lạc cuối, trạng thái đóng |

Token cookie có ít nhất 32 byte ngẫu nhiên, HttpOnly, Secure trên HTTPS và SameSite=Lax. Backend suy ra user từ cookie, không nhận user ID làm quyền truy cập. Dùng thao tác cùng origin và kiểm tra Origin cho các request thay đổi dữ liệu. Database chỉ chứa hash token, không log token hoặc chuỗi kết nối.

Lệnh điều khiển ghi ngay. Heartbeat cập nhật lease, không ghi số đếm mỗi giây. Mỗi lệnh gửi revision dự kiến và trạng thái đích rõ ràng như start/pause, không gửi toggle. Transaction khóa hàng timer, kiểm tra revision và cập nhật nguyên tử; lệnh cũ trả 409 cùng snapshot mới để tránh hai tab ghi đè.

BroadcastChannel báo cho các tab cùng trình duyệt khi có thay đổi; server vẫn là nguồn dữ liệu chính. Fallback lấy snapshot định kỳ cùng heartbeat và khi focus nếu BroadcastChannel không hoạt động. Lượt hoàn thành có claim nguyên tử: chỉ một tab được cấp quyền báo tiếng. Nếu tab được cấp quyền đóng đột ngột hoặc trình duyệt chặn âm thanh, có thể không có tiếng; tránh phát trùng được ưu tiên.

## Lỗi và phản hồi

- Khi mất kết nối, hiện thông báo ngắn Chưa đồng bộ; không thông báo đã lưu nếu request thất bại.
- Khi kết nối lại, đọc snapshot từ server rồi cập nhật giao diện. V1 không tự phát lại hàng đợi thao tác offline; các nút thay đổi trạng thái bị khóa khi biết đang offline hoặc request trước còn chờ.
- Timeout sau khi gửi lệnh: đọc lại snapshot để biết lệnh đã được áp dụng hay chưa; không gửi lại thao tác đảo trạng thái.
- Request không hợp lệ trả 400, cookie sai trả 401, xung đột revision trả 409, database không sẵn sàng trả 503.
- Tôn trọng prefers-reduced-motion; báo hết giờ bằng chữ cùng màu, không chỉ dựa vào màu hoặc âm thanh.

## Triển khai

Docker image nhiều giai đoạn, chạy Next.js standalone bằng user không đặc quyền. Docker Compose chỉ định nghĩa ứng dụng production, dùng biến môi trường cho DATABASE_URL và APP_ORIGIN. Reverse proxy hiện có xử lý HTTPS. Kiểu kết nối proxy/container được quyết định khi biết proxy chạy trên host hay Docker.

Dùng database hoặc schema riêng và tài khoản quyền hạn phù hợp trong PostgreSQL hiện có. Migration chạy bằng lệnh chủ động, không tự sửa schema lúc mỗi container khởi động. Không ghi bí mật vào repository. Có readiness kiểm tra database và liveness kiểm tra tiến trình.

Chưa cần Redis hoặc worker. Khả năng chịu tải phụ thuộc CPU, tài nguyên còn trống và lượng người dùng đồng thời; RAM 8 GB không được dùng để suy ra con số người dùng cam kết.

## Tiêu chí nghiệm thu

1. Hai browser context riêng không đọc/ghi dữ liệu của nhau; cùng context nhiều tab thấy cùng trạng thái.
2. Space và nút bấm chạy/dừng/tiếp tục đúng; nhập thời lượng không kích hoạt timer ngoài ý muốn.
3. Đếm lên qua 24 giờ không reset. Đếm ngược không âm và không ảnh hưởng đếm lên.
4. Hai timer chạy đồng thời, chuyển tính năng hoặc ẩn tab không tự gửi pause.
5. Đóng hoặc để hết hạn mọi lease vẫn không dừng timer; mở lại phản ánh toàn bộ thời gian đã trôi qua.
6. Reload và khôi phục từ lịch sử trình duyệt không nhân đôi timer/lease hoặc tự khởi động một timer đã dừng.
7. Lệnh đồng thời được xử lý theo revision. Một lượt hết giờ có tối đa một claim âm thanh.
8. Mất mạng/database có thông báo đúng, không báo lưu thành công giả.
9. Image production chạy được, healthcheck hoạt động, migration và hướng dẫn reverse proxy được kiểm chứng trong môi trường thử nghiệm.

## Thông tin chỉ cần khi triển khai thật

Tên miền, loại/vị trí reverse proxy, cách PostgreSQL đang được triển khai, địa chỉ kết nối và quyền tạo schema. Không yêu cầu người dùng gửi mật khẩu trong hội thoại; nhập bằng biến môi trường tại server.
