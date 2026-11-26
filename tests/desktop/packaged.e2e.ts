import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Smoke test of the PACKAGED app (electron-builder `--dir` output), not desktop/out run through `electron .`.
 * Build it first: `npm run desktop:pack`, then `npm run desktop:e2e:packaged`.
 * Override the executable with MOUSTACHE_PACKAGED_EXE. Uses a throwaway profile and the in-memory fake clipboard,
 * so it never touches the real clipboard, never sends keystrokes and never installs anything.
 */
const EXE =
  process.env['MOUSTACHE_PACKAGED_EXE'] ??
  (process.platform === 'win32'
    ? path.resolve('release/win-unpacked/mouStache.exe')
    : process.platform === 'darwin'
      ? path.resolve(`release/mac${process.arch === 'arm64' ? '-arm64' : ''}/mouStache.app/Contents/MacOS/mouStache`)
      : path.resolve('release/linux-unpacked/moustache'));

type G = {
  __mouReady?: boolean;
  __mouOutcomes: () => string[];
  __mouTray: () => { state: string; tooltip: string; paused: boolean };
  __mouFake: { writeText(t: string): void };
};
const main = <T>(fn: (g: G) => T) =>
  app.evaluate((_e, f) => (new Function('g', `return (${f})(g)`) as (g: unknown) => unknown)(globalThis), fn.toString()) as Promise<T>;

let app: ElectronApplication;
let panel: Page;
let profile: string;
const pageErrors: string[] = [];

async function findPage(suffix: string): Promise<Page> {
  const find = () => app.windows().find((w) => w.url().endsWith(suffix));
  await expect.poll(() => !!find(), { timeout: 20_000 }).toBe(true);
  return find()!;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!existsSync(EXE)) throw new Error(`Packaged app not found at ${EXE}. Run "npm run desktop:pack" first.`);
  profile = mkdtempSync(path.join(tmpdir(), 'moustache-e2e-packaged-'));
  app = await electron.launch({
    executablePath: EXE,
    env: {
      ...process.env,
      MOUSTACHE_USER_DATA: profile,
      MOUSTACHE_E2E: '1',
      MOUSTACHE_FAKE_CLIPBOARD: '1',
      MOUSTACHE_NO_FIRST_RUN: '1',
      MOUSTACHE_SHOW_PANEL: '1',
      MOUSTACHE_BRIDGE_PORT: '0',
    },
  });
  panel = await findPage('/panel.html');
  panel.on('pageerror', (e) => pageErrors.push(String(e)));
  await panel.waitForLoadState('domcontentloaded');
  await expect.poll(() => main((g) => g.__mouReady === true), { timeout: 20_000 }).toBe(true);
});

test.afterAll(async () => {
  await app?.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

test('is the packaged build: asar, not a dev checkout', async () => {
  const info = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, appPath: a.getAppPath(), exe: process.execPath, version: a.getVersion() }));
  expect(info.packaged).toBe(true);
  expect(info.appPath.endsWith('app.asar')).toBe(true);
  expect(path.basename(info.exe).toLowerCase()).toMatch(/^moustache/); // productName from electron-builder
  expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
});

test('panel renders the real UI from moustache://, never file://', async () => {
  await expect(panel.getByText('mouStache').first()).toBeVisible();
  await expect(panel.locator('body')).toContainText(/is clean-shaven/);
  expect(panel.url().startsWith('moustache://app/')).toBe(true);
  expect(await panel.evaluate(() => (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id)).toBe('mou-stache-desktop');

  const urls = app.windows().map((w) => w.url());
  expect(urls.length).toBeGreaterThanOrEqual(4); // engine, panel, blip, palette
  for (const u of urls) expect(u.startsWith('moustache://app/'), u).toBe(true);
});

test('moustache:// serves bundled pages and assets, and unknown paths are refused', async () => {
  const res = await panel.evaluate(async () => {
    const page = await fetch('moustache://app/palette.html');
    const logo = await fetch('moustache://app/logo.svg');
    const missing = await fetch('moustache://app/does-not-exist.html');
    const escape = await fetch('moustache://app/../package.json').catch(() => undefined);
    return {
      page: [page.status, (await page.text()).includes('<div id=')],
      logo: [logo.status, logo.headers.get('content-type')],
      missing: missing.status,
      escape: escape ? escape.status : 'blocked',
    };
  });
  expect(res.page[0]).toBe(200);
  expect(res.logo[0]).toBe(200);
  expect(res.missing).toBeGreaterThanOrEqual(400);
  expect(res.escape === 'blocked' || (typeof res.escape === 'number' && res.escape >= 400)).toBe(true);
});

test('a text copy is saved by the engine and shows in the panel', async () => {
  const text = 'SELECT name FROM students WHERE gpa > 3.5;';
  await main((g) => g.__mouFake.writeText('SELECT name FROM students WHERE gpa > 3.5;'));
  await expect.poll(() => main((g) => g.__mouOutcomes()), { timeout: 15_000 }).toContain('saved:text');
  await expect(panel.getByText('SELECT name FROM students').first()).toBeVisible();
  const items = await panel.evaluate(
    () =>
      (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<{ text?: string }[]> } } }).chrome.runtime.sendMessage({
        type: 'search',
        query: '',
        limit: 10,
      }),
  );
  expect(items.map((i) => i.text)).toContain(text);
});

test('tray resources were bundled and the tray model loaded', async () => {
  // every frame the tray code can ask for must exist inside app.asar (tray.ts reads them from disk at runtime)
  const missing = await app.evaluate(({ app: a }) => {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const dir = path.join(a.getAppPath(), 'desktop', 'resources', 'tray');
    const names: string[] = [];
    for (const state of ['idle', 'curl', 'paused', 'attention']) {
      for (const sfx of ['', '@2x']) {
        names.push(`onlight-${state}${sfx}.png`, `ondark-${state}${sfx}.png`, `mac-${state}Template${sfx}.png`);
      }
    }
    return names.filter((n) => !fs.existsSync(path.join(dir, n)));
  });
  expect(missing).toEqual([]);

  const t = await main((g) => g.__mouTray());
  expect(['idle', 'captured']).toContain(t.state);
  expect(t.tooltip).toMatch(/^mouStache/);
  expect(t.tooltip).toMatch(/1 item|items/);
});

test('window is hardened and nothing threw in the renderer', async () => {
  expect(await panel.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  expect(await panel.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');
  expect(pageErrors).toEqual([]);
});
