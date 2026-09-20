import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: process.env.CI ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:34100',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'TEST_DATABASE_URL=postgresql://count_timer_test:test_password@127.0.0.1:55432/count_timer_test npm run db:migrate:test && APP_ORIGIN=http://127.0.0.1:34100 DATABASE_URL=postgresql://count_timer_test:test_password@127.0.0.1:55432/count_timer_test npm run dev -- --hostname 127.0.0.1 --port 34100',
    url: 'http://127.0.0.1:34100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
