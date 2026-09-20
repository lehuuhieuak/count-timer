# Task 1 report — Đồng hồ thuần và khung ứng dụng chạy được

## Kết quả

Đã tạo shell Next.js TypeScript có thể build/chạy cùng timer engine độc lập. Trang ban đầu dùng token và bố cục header/tablist của giao diện tham chiếu, không hiển thị số timer mẫu hoặc trạng thái đồng bộ khi chưa có backend.

Các file tham chiếu trong `docs/` được giữ nguyên. Regression của tham chiếu đã chạy thành công: 8/8 test pass từ `node docs/stitch-design/stitch_minimalist_count_timer/shared/timer.test.cjs`.

## TDD evidence

### RED

Sau khi tạo cấu hình Vitest và test mong muốn, đã chạy:

```text
npm run test:unit -- tests/unit/engine.test.ts tests/unit/format.test.ts
```

Kết quả thất bại như mong đợi vì hai module hành vi chưa tồn tại:

```text
Cannot find module '../../src/features/timer/engine'
Cannot find module '../../src/features/timer/format'
Test Files  2 failed (2)
```

### GREEN

Sau khi cài đặt tối thiểu `types.ts`, `engine.ts`, và `format.ts`, đã chạy lại cùng lệnh:

```text
Test Files  2 passed (2)
Tests  10 passed (10)
```

Các test phủ các phép tính count-up/countdown, clamp countdown, trạng thái pause, pause/resume, reset, countdown hết giờ bắt đầu lại với run ID mới, chặn đổi duration khi đang chạy, giới hạn duration và formatter trên 24 giờ/giá trị không hợp lệ.

## Các thay đổi

- Tạo Next.js 16.3.4, React 19.2.8, TypeScript, ESLint và Vitest; lockfile npm được tạo.
- Thêm scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test:unit`.
- Thêm `Timer`, `Snapshot`, `Command`, và `TimerKind` theo hợp đồng kế hoạch.
- Thêm `readValue`: chỉ tính delta không âm, count-up cộng delta và countdown clamp ở 0; dữ liệu thời gian không finite hoặc âm bị từ chối.
- Thêm `applyCommand`: pause chốt giá trị, start giữ giá trị/mốc, countdown hết giờ khởi động lại từ duration với run ID mới, reset dừng, và `set-duration` kiểm tra khoảng 1 giây–99:59:59 và từ chối khi countdown chạy.
- Thêm `formatDuration` cho giờ không giới hạn 24 giờ.
- Thêm shell ứng dụng chỉ gồm brand/header/tablist, với token màu và breakpoint 640px được port từ CSS tham chiếu.
- Cấu hình lint bỏ qua `docs/**` vì đây là các file tham chiếu do người dùng cung cấp, không phải source của ứng dụng.

## Xác minh

Đã chạy thành công:

```text
node docs/stitch-design/stitch_minimalist_count_timer/shared/timer.test.cjs
npm run test:unit -- tests/unit/engine.test.ts tests/unit/format.test.ts
npm run typecheck
npm run lint
npm run build
```

`next build` hoàn tất với route static `/`. Ứng dụng production đã được chạy cục bộ trên port 3001 và response được kiểm tra: chỉ có `Count Timer`, `Đếm lên`, `Đếm ngược`; không có `00:00:00`, `Đang tải`, hoặc `Đã đồng bộ`.

## Self-review

- `applyCommand` trả snapshot mới và không mutate input snapshot/timer lồng nhau.
- Không có sessionStorage, fake backend response, fake connection label, hay dữ liệu timer mẫu trong shell Task 1.
- Không thay đổi bất kỳ file nào dưới `docs/`.
- API/backend, UI controls, đồng bộ đa tab, âm thanh, và giao diện timer đầy đủ vẫn thuộc các task sau.
