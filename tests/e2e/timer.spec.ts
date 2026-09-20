import { expect, test } from '@playwright/test';

import { createMockTimerStore, installTimerApi, makeSnapshot } from './fixtures/timer-snapshots';

test.describe('timer controls', () => {
  test.beforeEach(async ({ page }) => {
    await installTimerApi(page);
    await page.goto('/');
    await expect(page.getByRole('tabpanel', { name: 'Đếm lên' }).getByRole('button', { name: 'Bắt đầu', exact: true }))
      .toBeEnabled({ timeout: 10_000 });
  });

  test('uses Space for start, pause, and resume while inputs ignore it', async ({ page }) => {
    const upPanel = page.getByRole('tabpanel', { name: 'Đếm lên' });
    await expect(upPanel.getByRole('button', { name: 'Bắt đầu', exact: true })).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    await expect(upPanel.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(upPanel.getByRole('button', { name: 'Tiếp tục', exact: true })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(upPanel.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Đếm ngược', exact: true }).click();
    const seconds = page.getByRole('spinbutton', { name: 'Giây' });
    await seconds.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Bắt đầu', exact: true })).toBeVisible();
  });

  test('does not toggle repeatedly while Space is held', async ({ page }) => {
    const store = createMockTimerStore();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await installTimerApi(page, store);
    await page.goto('/');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.down('Space');
    await page.waitForTimeout(50);
    await page.keyboard.up('Space');
    await expect(page.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
    expect(store.timerPosts).toBe(1);
  });

  test('keeps the two timer features independent', async ({ page }) => {
    await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
    await page.getByRole('tab', { name: 'Đếm ngược', exact: true }).click();
    await page.getByRole('tabpanel').getByRole('button', { name: 'Bắt đầu', exact: true }).click();
    await page.getByRole('tab', { name: 'Đếm lên', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Đếm lên' }).getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Đếm ngược', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Đếm ngược' }).getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
  });

  test('supports presets, custom duration, reset confirmation, and sound', async ({ page }) => {
    await page.getByRole('tab', { name: 'Đếm ngược', exact: true }).click();
    await page.getByRole('button', { name: '5 phút', exact: true }).click();
    await expect(page.getByText('Thời lượng đã chọn: 00:05:00')).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Giờ' }).fill('1');
    await page.getByRole('spinbutton', { name: 'Phút' }).fill('2');
    await page.getByRole('spinbutton', { name: 'Giây' }).fill('3');
    await page.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    await expect(page.getByText('Thời lượng đã chọn: 01:02:03')).toBeVisible();
    await page.getByRole('button', { name: 'Âm thanh: Bật', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Âm thanh: Tắt', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Đếm lên', exact: true }).click();
    await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    await page.getByRole('button', { name: '↺ Đặt lại', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Xác nhận đặt lại', exact: true }).click();
    await expect(page.getByText('00:00:00').first()).toBeVisible();
  });

  test('keeps reset cancellation available and closes only after a successful reset', async ({ page }) => {
    const store = createMockTimerStore();
    await installTimerApi(page, store);
    const resetButton = page.getByRole('button', { name: '↺ Đặt lại', exact: true });
    await expect(resetButton).toBeEnabled({ timeout: 10_000 });
    await resetButton.click();
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByRole('button', { name: 'Hủy bỏ', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Xác nhận đặt lại', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Hủy bỏ', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText('Đã đồng bộ')).toBeVisible();

    await page.getByRole('button', { name: '↺ Đặt lại', exact: true }).click();
    store.failTimerPosts = true;
    await page.getByRole('button', { name: 'Xác nhận đặt lại', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Không thể đồng bộ thao tác đặt lại.')).toBeVisible();
    store.failTimerPosts = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText('Đã đồng bộ')).toBeVisible();
    await page.getByRole('button', { name: 'Xác nhận đặt lại', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});

test.describe('timer presence', () => {
  test('syncs same-context tabs and isolates separate contexts', async ({ browser }) => {
    const context = await browser.newContext();
    const store = createMockTimerStore(makeSnapshot());
    const first = await context.newPage();
    const second = await context.newPage();
    await installTimerApi(first, store);
    await installTimerApi(second, store);
    await first.goto('/');
    await second.goto('/');
    await expect(first.getByRole('tabpanel', { name: 'Đếm lên' }).getByRole('button', { name: 'Bắt đầu', exact: true }))
      .toBeEnabled({ timeout: 10_000 });
    await expect(second.getByRole('tabpanel', { name: 'Đếm lên' }).getByRole('button', { name: 'Bắt đầu', exact: true }))
      .toBeEnabled({ timeout: 10_000 });
    await first.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
    await expect(second.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
    await first.close();
    await expect(second.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
    await second.close();
    await context.close();

    const isolated = await browser.newContext();
    const other = await isolated.newPage();
    await installTimerApi(other, createMockTimerStore(makeSnapshot()));
    await other.goto('/');
    await expect(other.getByRole('button', { name: 'Bắt đầu', exact: true })).toBeVisible();
    await other.close();
    await isolated.close();
  });
});

test('renders long timers without horizontal overflow and keeps touch targets large', async ({ page }) => {
  await installTimerApi(page, createMockTimerStore(makeSnapshot({ up: { valueMs: 125 * 3_600_000 + 3 * 60_000 + 9_000, startedAtMs: null } })));
  await page.goto('/');
  for (const width of [320, 375, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['Đếm lên', 'Đếm ngược']) {
      await page.getByRole('tab', { name, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const primary = page.getByRole('tabpanel').getByRole('button', {
        name: /^(Bắt đầu|Bắt đầu lại|Tạm dừng|Tiếp tục)$/,
      });
      const box = await primary.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
});
