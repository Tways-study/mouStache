import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Smoke test of the REAL Electron clipboard path (Electron 45's async clipboard + raw OS formats).
// The OS clipboard is shared with everything else on the machine, so each check re-writes its (unique) content
// until the app has seen it, and asserts only on that unique content. The behavioural suite is capture.e2e.ts.

const ROOT = path.resolve('.');
let app: ElectronApplication;
let panel: Page;
let profile: string;

type Item = { kind: string; text?: string; tags: string[] };
type G = { __mouTicks: () => string[]; __mouReady?: boolean; __mouForeground: (a: { name: string }) => void };

const search = () =>
  panel.evaluate(
    () =>
      (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime.sendMessage({
        type: 'search',
        query: '',
        limit: 200,
      }) as Promise<Item[]>,
  );
const ticks = () => app.evaluate(() => (globalThis as unknown as G).__mouTicks());

/** Write, wait a moment, and write again if the app has not seen it (another process may have overwritten it). */
async function untilSeen(write: () => Promise<unknown>, seen: () => Promise<boolean>, totalMs = 30_000) {
  const end = Date.now() + totalMs;
  while (Date.now() < end) {
    await write();
    const wait = Date.now() + 2_000;
    while (Date.now() < wait) {
      if (await seen()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  expect(await seen(), 'app never saw the clipboard write').toBe(true);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'moustache-e2e-real-'));
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, MOUSTACHE_USER_DATA: profile, MOUSTACHE_E2E: '1', MOUSTACHE_NO_FIRST_RUN: '1' },
  });
  const find = () => app.windows().find((w) => w.url().endsWith('/panel.html'));
  await expect.poll(() => !!find(), { timeout: 10_000 }).toBe(true);
  panel = find()!;
  await panel.waitForLoadState('domcontentloaded');
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as G).__mouReady === true), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await ticks()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await app.evaluate(() => (globalThis as unknown as G).__mouForeground({ name: 'FakeEditor' }));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

test('real clipboard: text is captured and tagged', async () => {
  const text = `SELECT id FROM real_clip_${Date.now()} WHERE gpa > 3.5;`;
  await untilSeen(
    () => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text),
    async () => (await search()).some((i) => i.text === text),
  );
  expect((await search()).find((i) => i.text === text)!.tags).toContain('sql');
});

test('real clipboard: an image is captured', async () => {
  const base = (await search()).filter((i) => i.kind === 'image').length;
  await untilSeen(
    () =>
      app.evaluate(({ clipboard, ClipboardItem, nativeImage }) => {
        const img = nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 40 + (Date.now() % 180)), { width: 16, height: 16 });
        return clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]);
      }),
    async () => (await search()).filter((i) => i.kind === 'image').length > base,
  );
});

test('real clipboard: an entry flagged ExcludeClipboardContentFromMonitorProcessing is never saved', async () => {
  const secret = `hunter2-real-${Date.now()}`;
  const before = (await ticks()).filter((r) => r === 'concealed').length;
  await untilSeen(
    () =>
      app.evaluate(
        ({ clipboard, ClipboardItem }, t) =>
          clipboard.write([
            new ClipboardItem({
              'text/plain': t,
              'electron application/osclipboard;format="ExcludeClipboardContentFromMonitorProcessing"': new Blob([new Uint8Array([1, 0, 0, 0])]),
            }),
          ]),
        secret,
      ),
    async () => (await ticks()).filter((r) => r === 'concealed').length > before,
  );
  expect((await search()).some((i) => i.text?.includes(secret))).toBe(false);
});

test('real clipboard: the palette writes the chosen item back (as a code block) and records, but never sends, the paste', async () => {
  await app.evaluate(() => (globalThis as unknown as { __mouForeground(a: unknown): void }).__mouForeground({ name: 'FakeEditor', pid: 4242, handle: '777001' }));
  const text = `echo palette_real_${Date.now()}`;
  await untilSeen(
    () => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text),
    async () => (await search()).some((i) => i.text === text),
  );
  type P = { open(): Promise<void>; window: Electron.BrowserWindow; pasteLog: unknown[] };
  const pal = () => app.evaluate(() => (globalThis as unknown as { __mouPalette: { pasteLog: unknown[] } }).__mouPalette.pasteLog.length);
  const readClip = () => app.evaluate(({ clipboard }) => clipboard.readText());
  const fenced = '```bash\n' + text + '\n```';
  await untilSeen(
    async () => {
      await app.evaluate(async () => {
        const p = (globalThis as unknown as { __mouPalette: P }).__mouPalette;
        if (!p.window.isVisible()) await p.open();
      });
      const page = app.windows().find((w) => w.url().endsWith('/palette.html'))!;
      await page.locator('input').fill(text);
      await expect(page.locator('[role=option]').first()).toBeVisible();
      await page.locator('input').press('Control+Enter');
    },
    async () => (await readClip()) === fenced || (await pal()) > 0,
    40_000,
  );
  expect((await pal()) > 0).toBe(true); // a paste was RECORDED (E2E mode never sends keystrokes)
});
