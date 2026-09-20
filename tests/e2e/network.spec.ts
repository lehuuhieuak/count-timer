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
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Đã đồng bộ')).toBeHidden();
  store.releaseTimerPosts();
  await expect(page.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
});

test('reopens the lease on pageshow and applies a heartbeat snapshot', async ({ page }) => {
  const now = Date.now();
  const store = createMockTimerStore();
  await installTimerApi(page, store);
  await page.clock.install({ time: now });
  await page.goto('/');
  store.snapshot = {
    ...store.snapshot,
    revision: 1,
    serverNowMs: now,
    up: { valueMs: 0, startedAtMs: now },
  };
  await page.clock.fastForward(15_000);
  await expect(page.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect.poll(() => store.tabActions.filter((action) => action === 'open')).toHaveLength(2);
});

test('reads the authoritative snapshot once after a command timeout', async ({ page }) => {
  const store = createMockTimerStore();
  store.holdTimerPosts = true;
  await installTimerApi(page, store);
  await page.clock.install({ time: Date.now() });
  await page.goto('/');
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await expect(page.getByText('Đang lưu')).toBeVisible();
  await page.clock.fastForward(8_001);
  store.releaseTimerPosts();
  await expect(page.getByText('Đã đồng bộ')).toBeVisible();
  expect(store.timerGets).toBeGreaterThan(0);
});

test('does not let an older focus read overwrite a newer command response', async ({ page }) => {
  const store = createMockTimerStore();
  store.holdTimerGets = true;
  await installTimerApi(page, store);
  await page.goto('/');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
  store.releaseTimerGets();
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

test('claims an expired run seen at bootstrap and retries a transient alarm failure', async ({ page }) => {
  const now = Date.now();
  const store = createMockTimerStore({
    ...createMockTimerStore().snapshot,
    serverNowMs: now,
    down: { valueMs: 500, startedAtMs: now - 1_000 },
  });
  store.failAlarmPosts = true;
  await installTimerApi(page, store);
  await page.clock.install({ time: now });
  await page.goto('/');
  await expect.poll(() => store.alarmPosts).toBe(1);

  store.failAlarmPosts = false;
  store.snapshot = {
    ...store.snapshot,
    revision: 1,
    down: { valueMs: 0, startedAtMs: null },
    completedRunId: store.snapshot.downRunId,
  };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => store.alarmPosts).toBe(2);
});

test('does not claim a historical completed snapshot at bootstrap', async ({ page }) => {
  const base = createMockTimerStore().snapshot;
  const store = createMockTimerStore({
    ...base,
    down: { valueMs: 0, startedAtMs: null },
    completedRunId: base.downRunId,
  });
  await installTimerApi(page, store);
  await page.goto('/');
  await page.waitForTimeout(50);
  expect(store.alarmPosts).toBe(0);
});
