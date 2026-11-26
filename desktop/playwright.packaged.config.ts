import { defineConfig } from '@playwright/test';

// Smoke test of the PACKAGED app (release-test/win-unpacked/mouStache.exe, built with test seams by `npm run desktop:pack:test`).
// Run with `npm run desktop:e2e:packaged`.
export default defineConfig({
  testDir: '../tests/desktop',
  testMatch: '**/packaged.e2e.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '../test-results/desktop-packaged',
});
