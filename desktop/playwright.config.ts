import { defineConfig } from '@playwright/test';

// Desktop e2e: launches the BUILT Electron app (desktop/out). Run with `npm run desktop:e2e`.
export default defineConfig({
  testDir: '../tests/desktop',
  testMatch: '**/*.e2e.ts',
  testIgnore: '**/packaged.e2e.ts', // needs a packaged build: npm run desktop:e2e:packaged
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '../test-results/desktop',
});
