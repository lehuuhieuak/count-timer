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

## Fix round 1

### Review findings verified

- **Expired running countdown:** reproduced. A `start` command at 7000 on `{ valueMs: 5000, startedAtMs: 1000 }` returned the stale `{ startedAtMs: 1000 }` timer instead of beginning the supplied new run.
- **Finite invariant:** reproduced. `readValue({ valueMs: Number.MAX_VALUE, startedAtMs: 0 }, 'up', Number.MAX_VALUE)` returned `Infinity`; pausing could therefore store `Infinity`.
- **Clean-checkout typecheck:** the reported failure did **not** reproduce. After removing the generated `.next` directory, `npm run typecheck` (`tsc --noEmit` at that point) exited successfully. The script nevertheless now explicitly runs `next typegen` before `tsc`, so route declarations are deterministically generated and checked instead of relying on absent generated imports being tolerated.

### TDD RED/GREEN

New engine tests were added before changing the engine, then run with:

```text
npm run test:unit -- tests/unit/engine.test.ts
```

RED result:

```text
Test Files  1 failed (1)
Tests  2 failed | 9 passed (11)
```

The failures were `Infinity` instead of `Number.MAX_VALUE`, and the expired countdown retaining `startedAtMs: 1000` rather than resetting to 7000. The test suite also proves an active, non-expired countdown keeps its timestamp and existing run ID.

GREEN result after the minimal engine change:

```text
Test Files  1 passed (1)
Tests  11 passed (11)
```

For the typecheck review, the pre-change clean-state command was:

```text
rm -rf .next
npm run typecheck
```

It passed, so there was no typecheck RED failure to fix. After updating the script, its verification was:

```text
npm run typecheck
Generating route types...
✓ Types generated successfully
```

### Changed files

- `src/features/timer/engine.ts`: saturates count-up arithmetic at `Number.MAX_VALUE`; a start command restarts a countdown whenever its calculated remaining value is zero, including when it expired while marked running.
- `tests/unit/engine.test.ts`: adds regression coverage for overflow saturation, expired-running restart, and preserving a non-expired running countdown.
- `package.json`: makes `typecheck` run `next typegen && tsc --noEmit`.

### Full validation

The following commands passed after the fixes:

```text
npm run test:unit -- tests/unit/engine.test.ts tests/unit/format.test.ts
npm run typecheck
npm run lint
npm run build
```

### Self-review

- Saturation preserves a finite, non-negative value and is applied before a pause snapshot can store the calculated count-up value.
- Countdown restart uses `readValue`, so it handles both stopped-zero and elapsed-to-zero timers; a non-expired running timer remains an idempotent start.
- The typecheck change strengthens generation without changing `tsconfig` or excluding any source errors.
- No `docs/` files were modified.

## Fix round 2

### Finding and hypothesis

The reference test was rerun before editing and reproduced the reported failure:

```text
node docs/stitch-design/stitch_minimalist_count_timer/shared/timer.test.cjs
tests 8
pass 1
fail 7
TypeError: create is not a function
TypeError: format is not a function
```

The root `package.json` had `"type": "module"`. That makes the preserved `docs/.../shared/timer.js` ESM by extension, while its `.cjs` reference test loads it with `require()`. The reference file is intentionally CommonJS and was not changed.

### Minimal fix and GREEN evidence

Removed only the root `"type": "module"` field. Explicit `.mjs` files remain ESM for future Node scripts, and the existing Next/Vitest TypeScript configuration remains usable.

After the change:

```text
node docs/stitch-design/stitch_minimalist_count_timer/shared/timer.test.cjs
tests 8
pass 8
fail 0
```

### Full validation

The following commands passed:

```text
node docs/stitch-design/stitch_minimalist_count_timer/shared/timer.test.cjs
npm run test:unit -- tests/unit/engine.test.ts tests/unit/format.test.ts
npm run lint
npm run typecheck
npm run build
```

Task 1 unit tests: 13/13 passed. Typecheck generated Next route types and completed. The production build completed and prerendered `/`.

Vitest emitted its existing Vite advisory that `vitest.config.ts` contains ESM syntax while the package defaults to CommonJS; the current test command completed successfully. It is a future-loader advisory, not a validation failure, and changing the config file was outside this minimal compatibility fix.

### Changed files and self-review

- `package.json`: removed the package-level module mode that altered the semantics of the read-only reference `.js` file.
- This report: appended fix-round 2 evidence.

The fix preserves CommonJS resolution for the supplied reference test without modifying any file under `docs/`. Next’s ESM config remains explicitly named `eslint.config.mjs`; TypeScript and the Next build continue to pass.
