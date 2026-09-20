import { expect, test } from '@playwright/test';

import { installTimerApi, createMockTimerStore, visualSnapshots } from './fixtures/timer-snapshots';

test.describe('visual states from fixed snapshots', () => {
  test('renders count-up zero, long, and running states', async ({ page }) => {
    await installTimerApi(page, createMockTimerStore(visualSnapshots.upZero));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await expect(page.getByText('00:00:00').first()).toBeVisible();
    await page.screenshot({ path: 'docs/verification/ui/app-desktop-up-zero.png', fullPage: true });
    await page.getByRole('tab', { name: 'Đếm ngược', exact: true }).click();
    await page.screenshot({ path: 'docs/verification/ui/app-desktop-down-default.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Đếm lên', exact: true }).click();
    await page.screenshot({ path: 'docs/verification/ui/app-mobile-up-zero.png', fullPage: true });
    await page.getByRole('tab', { name: 'Đếm ngược', exact: true }).click();
    await page.screenshot({ path: 'docs/verification/ui/app-mobile-down-default.png', fullPage: true });

    const store = createMockTimerStore(visualSnapshots.upLong);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await installTimerApi(page, store);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await expect(page.getByText('125:03:09').first()).toBeVisible();
    await page.screenshot({ path: 'docs/verification/ui/app-desktop-up-long.png', fullPage: true });
  });

  test('renders countdown paused, ended, sound off, validation, and sync-error states', async ({ page }) => {
    const store = createMockTimerStore(visualSnapshots.downPaused);
    await installTimerApi(page, store);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Đếm ngược', exact: true }).click();
    await expect(page.getByText('Thời lượng đã chọn: 00:25:00')).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Giây' }).fill('0');
    await page.getByRole('spinbutton', { name: 'Phút' }).fill('0');
    await page.getByRole('spinbutton', { name: 'Giờ' }).fill('0');
    await page.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    await expect(page.locator('p.error')).toHaveText('Nhập thời lượng từ 1 giây đến 99:59:59.');
    await page.getByRole('button', { name: 'Âm thanh: Bật', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Âm thanh: Tắt', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'docs/verification/ui/app-mobile-validation.png', fullPage: true });
  });

  test('rounds a running 500ms countdown up before completion', async ({ page }) => {
    const now = Date.now();
    const store = createMockTimerStore({
      ...visualSnapshots.downTwentyFive,
      serverNowMs: now,
      down: { valueMs: 500, startedAtMs: now },
    });
    await installTimerApi(page, store);
    await page.clock.install({ time: now });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Đếm ngược', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Đếm ngược' }).getByText('00:00:01', { exact: true })).toBeVisible();
    await expect(page.getByText('Hết giờ')).toBeHidden();
    store.snapshot = { ...store.snapshot, down: { valueMs: 0, startedAtMs: null }, completedRunId: store.snapshot.downRunId };
    await page.clock.runFor(500);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('tabpanel', { name: 'Đếm ngược' }).getByText('00:00:00', { exact: true })).toBeVisible();
    await expect(page.getByText('Hết giờ')).toBeVisible();
  });
});

test('dialog focus returns through native cancel behavior', async ({ page }) => {
  await installTimerApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: '↺ Đặt lại', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hủy bỏ', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Bắt đầu', exact: true })).toBeVisible();
});

test('font fallback remains within a narrow viewport for long hours', async ({ page }) => {
  await page.route('**/*.{woff,woff2,ttf,otf}', (route) => route.abort());
  await installTimerApi(page, createMockTimerStore(visualSnapshots.upLong));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
