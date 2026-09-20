import { expect, test } from '@playwright/test';

import { createMockTimerStore, installTimerApi } from './fixtures/timer-snapshots';

test('shows pending without claiming the command was saved', async ({ page }) => {
  const store = createMockTimerStore();
  store.holdTimerPosts = true;
  await installTimerApi(page, store);
  await page.goto('/');
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await expect(page.getByText('Đang lưu')).toBeVisible();
  await expect(page.getByText('Đã đồng bộ')).toBeHidden();
  store.releaseTimerPosts();
  await expect(page.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
});

test('shows unsynced after 503 and reports synced only after a successful read', async ({ page }) => {
  const store = createMockTimerStore();
  store.failTimerPosts = true;
  await installTimerApi(page, store);
  await page.goto('/');
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await expect(page.getByText('Chưa đồng bộ')).toBeVisible();
  await expect(page.getByText('Đã đồng bộ')).toBeHidden();
  store.failTimerPosts = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Đã đồng bộ')).toBeVisible();
});

test('does not pause when the document becomes hidden', async ({ page }) => {
  const store = createMockTimerStore();
  await installTimerApi(page, store);
  await page.goto('/');
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  const timerPostsBeforeVisibility = store.timerPosts;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(store.timerPosts).toBe(timerPostsBeforeVisibility);
});
