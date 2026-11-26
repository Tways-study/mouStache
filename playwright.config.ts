import { defineConfig } from '@playwright/test';

// E2E: loads the BUILT extension (.output/chrome-mv3) into Playwright's Chromium.
// Run with `npm run e2e` (builds first). Set HEADED=1 to watch it.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
