import { expect, test } from '@playwright/test';

test('persists real cookie identity, syncs same-context tabs, and isolates a fresh context', async ({ browser }) => {
  test.setTimeout(30_000);
  const sharedContext = await browser.newContext();
  const first = await sharedContext.newPage();
  const second = await sharedContext.newPage();
  await first.goto('/');
  await expect(first.getByText('Đã đồng bộ')).toBeVisible();
  await second.goto('/');
  await expect(first.getByText('Đã đồng bộ')).toBeVisible();
  await expect(second.getByText('Đã đồng bộ')).toBeVisible();

  const sharedCookies = await sharedContext.cookies();
  expect(sharedCookies.filter((cookie) => cookie.name === 'count_timer_token')).toHaveLength(1);
  await first.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await second.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(second.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
  await sharedContext.close();

  const isolatedContext = await browser.newContext();
  const isolatedPage = await isolatedContext.newPage();
  await isolatedPage.goto('/');
  await expect(isolatedPage.getByText('Đã đồng bộ')).toBeVisible();
  await expect(isolatedPage.getByRole('button', { name: 'Bắt đầu', exact: true })).toBeVisible();
  const isolatedCookies = await isolatedContext.cookies();
  expect(isolatedCookies.find((cookie) => cookie.name === 'count_timer_token')?.value)
    .not.toBe(sharedCookies.find((cookie) => cookie.name === 'count_timer_token')?.value);
  await isolatedContext.close();
});
