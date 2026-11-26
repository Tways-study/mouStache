import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('.');

let app: ElectronApplication;
let profile: string;
const errors: string[] = [];

async function panelPage(): Promise<Page> {
  const find = () => app.windows().find((w) => w.url().endsWith('/panel.html'));
  for (let i = 0; i < 100 && !find(); i++) await new Promise((r) => setTimeout(r, 100));
  const p = find();
  if (!p) throw new Error('panel window not found');
  return p;
}

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'moustache-e2e-'));
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, MOUSTACHE_USER_DATA: profile, MOUSTACHE_SHOW_PANEL: '1', MOUSTACHE_NO_FIRST_RUN: '1' },
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

test('panel renders the real (non-demo) UI against the engine', async () => {
  const panel = await panelPage();
  panel.on('pageerror', (e) => errors.push(String(e)));
  await panel.waitForLoadState('domcontentloaded');

  // header + onboarding/empty state
  await expect(panel.getByText('mouStache').first()).toBeVisible();
  await expect(panel.locator('body')).toContainText(/is clean-shaven/);

  // real mode: the shim gives chrome.runtime an id, so the app is not in demo mode
  expect(await panel.evaluate(() => (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id)).toBe(
    'mou-stache-desktop',
  );
  expect(panel.url().startsWith('moustache://app/')).toBe(true);

  // panel -> main -> engine round trip returns a real (empty) search result
  const res = await panel.evaluate(() =>
    (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime.sendMessage({
      type: 'search',
      query: '',
      limit: 10,
    }),
  );
  expect(res).toEqual([]);

  expect(errors).toEqual([]);
});

test('a saved item reaches the live list through engine -> main -> panel broadcast', async () => {
  const panel = await panelPage();
  const text = 'SELECT name FROM students WHERE gpa > 3.5;';
  const saved = await panel.evaluate(
    (t) =>
      (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<{ ok: boolean }> } } }).chrome.runtime.sendMessage({
        type: 'save-text',
        text: t,
        via: 'copy',
      }),
    text,
  );
  expect(saved.ok).toBe(true);
  await expect(panel.getByText('SELECT name FROM students').first()).toBeVisible();
  await expect(panel.locator('body')).not.toContainText('is clean-shaven');
});

test('window is configured securely and closing hides instead of quitting', async () => {
  const panel = await panelPage();
  // no node in the renderer
  expect(await panel.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  expect(await panel.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');

  const title = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'mouStache')?.getTitle(),
  );
  expect(title).toBe('mouStache');

  const visibleAfterClose = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'mouStache')!;
    w.close();
    return w.isVisible() || w.isDestroyed();
  });
  expect(visibleAfterClose).toBe(false);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(4); // panel + engine + blip + palette alive
});
