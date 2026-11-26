import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Security-review regressions against the built app: IPC least privilege per window role (F7), external links (F8),
// secrets written with the do-not-record formats and auto-cleared (F13), decompression-bomb guard (F18).
// Runs with the in-memory clipboard and the recording paste executor (see desktop/src/main/testing.ts): no real
// clipboard, no keystrokes, no real browser launch.

const ROOT = path.resolve('.');
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const CLEAR_MS = 1500;

let app: ElectronApplication;
let panel: Page;
let profile: string;

type Item = { id: string; kind: string; text?: string; secret: boolean };
type G = {
  __mouReady?: boolean;
  __mouTicks: () => string[];
  __mouOutcomes: () => string[];
  __mouPending: () => number;
  __mouPresence: () => Record<string, unknown>;
  __mouForeground: (a: unknown) => void;
  __mouFake: { writeText(t: string): void; snapshot(): { text: string; formats: string[]; hasImage: boolean } };
  __mouRegion: { start(): Promise<boolean>; window(): unknown };
  __mouPalette: { open(): Promise<void>; window: Electron.BrowserWindow };
};
const main = <T>(fn: (g: G) => T) =>
  app.evaluate((_e, f) => (new Function('g', `return (${f})(g)`) as (g: unknown) => unknown)(globalThis), fn.toString()) as Promise<T>;

const search = () =>
  panel.evaluate(
    () =>
      (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime.sendMessage({ type: 'search', query: '', limit: 200 }) as Promise<Item[]>,
  );

async function findPage(suffix: string): Promise<Page> {
  const find = () => app.windows().find((w) => w.url().endsWith(suffix));
  await expect.poll(() => !!find(), { timeout: 10_000 }).toBe(true);
  return find()!;
}

async function setSettings(partial: Record<string, unknown>) {
  await panel.evaluate(async (p) => {
    const c = (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>>; set(v: unknown): Promise<void> } } } }).chrome;
    const cur = ((await c.storage.local.get('stash:settings'))['stash:settings'] as object | undefined) ?? {};
    await c.storage.local.set({ 'stash:settings': { ...cur, ...p } });
  }, partial);
  for (const [k, v] of Object.entries(partial)) await expect.poll(async () => (await main((g) => g.__mouPresence()))[k], { timeout: 10_000 }).toEqual(v);
}

async function expectVerdict(expected: string, act: () => Promise<unknown>) {
  const before = (await main((g) => g.__mouOutcomes())).length;
  await act();
  await expect.poll(async () => (await main((g) => g.__mouOutcomes())).slice(before), { timeout: 15_000 }).toContain(expected);
  await expect.poll(() => main((g) => g.__mouPending()), { timeout: 15_000 }).toBe(0);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'moustache-e2e-sec-'));
  app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      MOUSTACHE_USER_DATA: profile,
      MOUSTACHE_E2E: '1',
      MOUSTACHE_NO_FIRST_RUN: '1',
      MOUSTACHE_FAKE_CLIPBOARD: '1',
      MOUSTACHE_BRIDGE_PORT: '0',
      MOUSTACHE_SECRET_CLEAR_MS: String(CLEAR_MS),
    },
  });
  panel = await findPage('/panel.html');
  await panel.waitForLoadState('domcontentloaded');
  await expect.poll(() => main((g) => g.__mouReady === true), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await main((g) => g.__mouTicks())).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await app.evaluate((_e, v) => (globalThis as unknown as G).__mouForeground(v), { name: 'FakeEditor', pid: 4242, handle: '777001' });
  // stub the OS "open link" so no browser is ever launched and we can see what main would have opened
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { __opened: string[] }).__opened = opened;
    (shell as unknown as { openExternal: (u: string) => Promise<void> }).openExternal = async (u: string) => void opened.push(u);
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

const opened = () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened.slice());

/** Everything a renderer could try on the privileged channels. */
const probe = (page: Page) =>
  page.evaluate(async () => {
    const api = window.mouDesktop!;
    const r = (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime;
    return {
      sendSave: await r.sendMessage({ type: 'save-text', text: 'injected-by-a-low-privilege-window-1', via: 'copy' }).catch(() => 'threw'),
      sendSearch: await r.sendMessage({ type: 'search', query: '', limit: 1 }).catch(() => 'threw'),
      setLogin: await api.setLoginItem(true).then(() => 'ok', () => 'threw'),
      getLogin: await api.getLoginItem().catch(() => 'threw'),
      bridge: await api.getBridgeInfo(),
      regen: await api.regenerateBridgeToken(),
      secret: await api.writeSecret('hello world 12345').catch(() => 'threw'),
      hotkeys: await api.getHotkeyStatus(),
    };
  });

test.describe('IPC least privilege by window role (F7)', () => {
  test('the blip pill can call nothing', async () => {
    const r = await probe(await findPage('/blip.html'));
    expect(r.sendSave).toBeUndefined();
    expect(r.sendSearch).toBeUndefined();
    expect(r.getLogin).toBe(false);
    expect(r.bridge).toBeUndefined();
    expect(r.regen).toBeUndefined();
    expect(r.secret).toBe(false);
    expect(r.hotkeys).toBeUndefined();
    expect((await search()).some((i) => i.text?.includes('injected-by-a-low-privilege-window'))).toBe(false);
    expect(await panel.evaluate(() => window.mouDesktop!.getLoginItem())).toBe(false); // setLogin(true) from the blip changed nothing
  });

  test('the palette can search, but cannot save, change login items, read the token or write secrets', async () => {
    const r = await probe(await findPage('/palette.html'));
    expect(Array.isArray(r.sendSearch)).toBe(true);
    expect(r.sendSave).toBeUndefined();
    expect(r.getLogin).toBe(false);
    expect(r.bridge).toBeUndefined();
    expect(r.regen).toBeUndefined();
    expect(r.secret).toBe(false);
    expect(r.hotkeys).toBeUndefined();
    expect((await search()).some((i) => i.text?.includes('injected-by-a-low-privilege-window'))).toBe(false);
  });

  test('the engine can broadcast but cannot request saves, login items or the token', async () => {
    const r = await probe(await findPage('/engine.html'));
    expect(r.sendSave).toBeUndefined();
    expect(r.sendSearch).toBeUndefined();
    expect(r.getLogin).toBe(false);
    expect(r.bridge).toBeUndefined();
    expect(r.secret).toBe(false);
  });

  test('the screenshot overlay can only finish or cancel a screenshot', async () => {
    expect(await main((g) => g.__mouRegion.start())).toBe(true);
    const page = await findPage('/region.html');
    const r = await probe(page);
    expect(r.sendSave).toBeUndefined();
    expect(r.sendSearch).toBeUndefined();
    expect(r.getLogin).toBe(false);
    expect(r.bridge).toBeUndefined();
    expect(r.secret).toBe(false);
    await page.keyboard.press('Escape').catch(() => undefined); // its own channel still works
    await expect.poll(() => main((g) => g.__mouRegion.window() === undefined), { timeout: 5_000 }).toBe(true);
  });

  test('the panel keeps what it needs (search, save, token, login item)', async () => {
    const r = await probe(panel);
    expect(Array.isArray(r.sendSearch)).toBe(true);
    expect(r.bridge).toMatchObject({ status: 'listening' });
    expect(r.hotkeys).toBeDefined();
    expect(r.getLogin).toBe(false);
    // setLoginItem(true) was just called by the probe from the panel: undo it so the test leaves the OS untouched
    await panel.evaluate(() => window.mouDesktop!.setLoginItem(false));
  });

  test('a low-privilege window cannot mark the clipboard as "mouStache wrote this" (the watcher still captures)', async () => {
    const text = 'copied by someone else, announced as own by the blip window';
    await (await findPage('/blip.html')).evaluate((t) => window.mouDesktop!.markOwnWrite({ text: t }), text);
    await expectVerdict('saved:text', async () => main((g) => g.__mouFake.writeText('copied by someone else, announced as own by the blip window')));
    expect((await search()).some((i) => i.text === text)).toBe(true); // had the mark been accepted, it would have been ignored
  });
});

test.describe('external links (F8)', () => {
  test('only the panel may open a link, http(s) only, capped in length, at most one per 2 s', async () => {
    const before = (await opened()).length;
    // another window: ignored
    expect(await (await findPage('/blip.html')).evaluate(() => window.mouDesktop!.openExternal('https://evil.example/from-blip'))).toBeUndefined();
    expect(await (await findPage('/palette.html')).evaluate(() => window.mouDesktop!.openExternal('https://evil.example/from-palette'))).toBeUndefined();
    // the panel: non-web schemes and over-long URLs are refused WITHOUT using up the rate-limit slot
    for (const bad of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-msdt:/x', 'https://example.com/' + 'a'.repeat(2100)]) {
      await panel.evaluate((u) => window.mouDesktop!.openExternal(u), bad);
    }
    expect((await opened()).length).toBe(before);
    // a good one goes through once, an immediate second one is rate limited
    await panel.evaluate(() => window.mouDesktop!.openExternal('https://example.com/first'));
    await panel.evaluate(() => window.mouDesktop!.openExternal('https://example.com/second-too-soon'));
    const got = (await opened()).slice(before);
    expect(got).toEqual(['https://example.com/first']);
  });
});

test.describe('secrets on the clipboard (F13)', () => {
  test('the palette writes a secret with the do-not-record formats and wipes it after the timeout', async () => {
    await setSettings({ skipSecrets: false });
    await expectVerdict('saved:text', async () => main((g) => g.__mouFake.writeText('AKIAIOSFODNN7EXAMPLE')));
    await setSettings({ skipSecrets: true });
    const item = (await search()).find((i) => i.secret);
    expect(item).toBeDefined();

    await main((g) => g.__mouPalette.open());
    await expect.poll(() => main((g) => g.__mouPalette.window.isVisible()), { timeout: 10_000 }).toBe(true);
    const page = await findPage('/palette.html');
    await page.locator('input').fill('AKIA');
    await expect(page.locator('[role=option]').first()).toContainText('secret hidden');
    await page.locator('input').press('Enter');

    await expect.poll(async () => (await main((g) => g.__mouFake.snapshot())).text, { timeout: 10_000 }).toBe(AWS_KEY);
    const snap = await main((g) => g.__mouFake.snapshot());
    if (process.platform === 'win32') {
      expect(snap.formats).toEqual(expect.arrayContaining(['ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard', 'Clipboard Viewer Ignore']));
    }
    // ...and it is gone after the timeout (nothing else was copied meanwhile)
    await expect.poll(async () => (await main((g) => g.__mouFake.snapshot())).text, { timeout: CLEAR_MS + 8_000 }).toBe('');
  });

  test('copying a secret item in the panel goes through main with the same protection and clear', async () => {
    const written = await panel.evaluate(() => navigator.clipboard.writeText('sk-ant-api03-abcdefghijklmnopqrstuvwxyz').then(() => 'ok', (e) => String(e)));
    expect(written).toBe('ok');
    const snap = await main((g) => g.__mouFake.snapshot());
    expect(snap.text).toBe('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    if (process.platform === 'win32') expect(snap.formats).toContain('CanUploadToCloudClipboard');
    await expect.poll(async () => (await main((g) => g.__mouFake.snapshot())).text, { timeout: CLEAR_MS + 8_000 }).toBe('');
  });
  // (an ordinary, non-secret copy in the panel still uses the browser clipboard API unchanged; testing it here would
  // write the developer's REAL clipboard, so that path is covered by the unchanged panel behaviour and unit tests.)
});

test.describe('decompression-bomb guard (F18)', () => {
  test('an own-write mark carrying a tiny PNG that claims 60000 x 60000 is ignored and the app stays healthy', async () => {
    const header = Array.from({ length: 33 }, () => 0);
    header.splice(0, 8, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    header.splice(8, 8, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52);
    header.splice(16, 8, 0, 0, 0xea, 0x60, 0, 0, 0xea, 0x60); // 60000 x 60000
    await panel.evaluate((bytes) => window.mouDesktop!.markOwnWrite({ png: new Uint8Array(bytes).buffer }), header);
    expect(Array.isArray(await search())).toBe(true); // main is alive and answering
  });
});
