import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Phase 3: global palette, paste, code-block paste, region screenshot, global shortcuts.
//
// SAFETY: nothing here presses a real global shortcut or sends a real keystroke. The app runs with
// MOUSTACHE_E2E=1, which swaps in (a) a recording paste executor (commands are built and logged, never sent),
// (b) a stub for globalShortcut, (c) an in-memory clipboard, (d) a synthetic screen image, and (e) a pinned
// foreground app. "Pressing" the hotkey calls the registered handler through the stub.

const ROOT = path.resolve('.');
const SQL = 'SELECT name FROM students WHERE gpa > 3.5;';
const DOCKER = 'docker run -d -p 8080:80 nginx';
const PY = 'def add(a, b):\n    return a + b\nprint(add(1, 2))';
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const TARGET = { name: 'FakeEditor', pid: 4242, handle: '777001' };

let app: ElectronApplication;
let panel: Page;
let profile: string;

type Item = { id: string; kind: string; text?: string; tags: string[]; lang?: string; secret: boolean; via: string; width?: number };
type Rec = { platform: string; target?: { name?: string; handle?: string }; command: { line?: string } };
type G = {
  __mouBlip: { window: Electron.BrowserWindow; shows: number };
  __mouPending: () => number;
  __mouTicks: () => string[];
  __mouOutcomes: () => string[];
  __mouPresence: () => Record<string, unknown>;
  __mouForeground: (a: unknown) => void;
  __mouFake: { writeText(t: string): void; writeImage(s: number): void; snapshot(): { text: string; hasImage: boolean } };
  __mouGS: { registered(): string[]; refuse(a: string): void; allow(a: string): void; press(a: string): void };
  __mouHotkeyStatus: () => Record<string, { ok: boolean; active?: string; error?: string }>;
  __mouPalette: {
    open(): Promise<void>;
    window: Electron.BrowserWindow;
    pasteLog: Rec[];
    notifications: string[];
    flags: { skipTaskbar: boolean; frameless: boolean; windowType: string };
    last(): { target?: { name?: string; handle?: string }; canPaste: boolean };
  };
  __mouRegion: { start(b?: unknown): Promise<boolean>; window(): Electron.BrowserWindow | undefined };
  __mouReady?: boolean;
};

const main = <T>(fn: (g: G) => T) =>
  app.evaluate((_e, f) => (new Function('g', `return (${f})(g)`) as (g: unknown) => unknown)(globalThis), fn.toString()) as Promise<T>;

const search = (query = '') =>
  panel.evaluate(
    (q) =>
      (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime.sendMessage({
        type: 'search',
        query: q,
        limit: 200,
      }) as Promise<Item[]>,
    query,
  );

async function findPage(suffix: string): Promise<Page> {
  const find = () => app.windows().find((w) => w.url().endsWith(suffix));
  await expect.poll(() => !!find(), { timeout: 10_000 }).toBe(true);
  return find()!;
}

const fakeCall = (name: 'writeText' | 'writeImage', arg: string | number) =>
  app.evaluate((_e, v) => (globalThis as unknown as G).__mouFake[v.name as 'writeText'](v.arg as never), { name, arg });
const ticks = () => main((g) => g.__mouTicks());
const outcomes = () => main((g) => g.__mouOutcomes());
const pasteLog = () => main((g) => g.__mouPalette.pasteLog);
const notifications = () => main((g) => g.__mouPalette.notifications);
const clip = () => main((g) => g.__mouFake.snapshot());
const paletteVisible = () => main((g) => g.__mouPalette.window.isVisible());
const pin = (a: unknown) => app.evaluate((_e, v) => (globalThis as unknown as G).__mouForeground(v), a);

async function expectVerdict(kind: 'ticks' | 'outcomes', expected: string, act: () => Promise<unknown>) {
  const get = kind === 'ticks' ? ticks : outcomes;
  const before = (await get()).length;
  await act();
  await expect.poll(async () => (await get()).slice(before), { timeout: 15_000 }).toContain(expected);
  await expect.poll(() => main((g) => g.__mouPending()), { timeout: 15_000 }).toBe(0);
}

async function setSettings(partial: Record<string, unknown>) {
  await panel.evaluate(async (p) => {
    const c = (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>>; set(v: unknown): Promise<void> } } } }).chrome;
    const cur = ((await c.storage.local.get('stash:settings'))['stash:settings'] as object | undefined) ?? {};
    await c.storage.local.set({ 'stash:settings': { ...cur, ...p } });
  }, partial);
  for (const [k, v] of Object.entries(partial)) await expect.poll(async () => (await main((g) => g.__mouPresence()))[k], { timeout: 10_000 }).toEqual(v);
}

async function openPalette(): Promise<Page> {
  await main((g) => g.__mouPalette.open());
  await expect.poll(paletteVisible, { timeout: 10_000 }).toBe(true);
  const page = await findPage('/palette.html');
  await expect(page.locator('input')).toBeVisible();
  return page;
}

async function hidePalette() {
  await main((g) => void (g.__mouPalette.window.isVisible() && g.__mouPalette.window.hide()));
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'moustache-e2e-pal-'));
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, MOUSTACHE_USER_DATA: profile, MOUSTACHE_E2E: '1', MOUSTACHE_NO_FIRST_RUN: '1', MOUSTACHE_FAKE_CLIPBOARD: '1' },
  });
  const find = () => app.windows().find((w) => w.url().endsWith('/panel.html'));
  await expect.poll(() => !!find(), { timeout: 10_000 }).toBe(true);
  panel = find()!;
  await panel.waitForLoadState('domcontentloaded');
  await expect.poll(() => main((g) => g.__mouReady === true), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await ticks()).length, { timeout: 15_000 }).toBeGreaterThan(0);

  await pin(TARGET);
  await setSettings({ skipSecrets: false }); // so a secret item exists to test masking
  for (const t of [SQL, DOCKER, PY, AWS_KEY]) {
    await expectVerdict('outcomes', 'saved:text', () => fakeCall('writeText', t));
  }
  await setSettings({ skipSecrets: true });
  await expectVerdict('outcomes', 'saved:image', () => fakeCall('writeImage', 120));
  expect((await search()).filter((i) => i.secret)).toHaveLength(1); // the API key is stored flagged secret (its text is never sent to the UI)
});

test.beforeEach(async () => {
  await pin(TARGET);
  await hidePalette();
  await main((g) => void (g.__mouPalette.pasteLog.length = 0, g.__mouPalette.notifications.length = 0));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

test('the palette opens centred, on top, focusable, out of the taskbar, and remembers the app you came from', async () => {
  const page = await openPalette();
  const info = await main((g) => {
    const w = g.__mouPalette.window;
    return { onTop: w.isAlwaysOnTop(), focusable: w.isFocusable(), bounds: w.getBounds(), flags: g.__mouPalette.flags, last: g.__mouPalette.last() };
  });
  expect(info.onTop).toBe(true);
  expect(info.focusable).toBe(true);
  expect(info.flags).toMatchObject({ skipTaskbar: true, frameless: true });
  expect(info.bounds).toMatchObject({ width: 640, height: 440 });
  expect(info.last).toEqual({ target: { name: TARGET.name, pid: TARGET.pid, handle: TARGET.handle }, canPaste: true });
  await expect(page.locator('input')).toHaveAttribute('placeholder', /Search your mouStache/);
  await expect(page.locator('[role=option]').first()).toBeVisible();
  // footer hints, platform aware, include the desktop-only code block action
  await expect(page.locator('body')).toContainText('code block');
  await expect(page.locator('body')).toContainText('copy');
});

test('search, Enter: the item lands on the clipboard and a paste is recorded for the remembered window (nothing real is typed)', async () => {
  const page = await openPalette();
  await page.locator('input').fill('students');
  await expect(page.locator('[role=option]').first()).toContainText('SELECT name FROM students');
  const beforeTicks = (await ticks()).length;
  await page.locator('input').press('Enter');

  await expect.poll(paletteVisible, { timeout: 10_000 }).toBe(false);
  await expect.poll(async () => (await clip()).text, { timeout: 10_000 }).toBe(SQL);
  await expect.poll(async () => (await pasteLog()).length, { timeout: 10_000 }).toBe(1);
  const rec = (await pasteLog())[0]!;
  expect(rec.target).toMatchObject({ name: TARGET.name, handle: TARGET.handle });
  expect(rec.command).toEqual({ line: `PASTE ${TARGET.handle}` });
  expect(await notifications()).toEqual([]); // a plain paste is silent

  // mouStache's own write is not captured again
  await expect.poll(async () => (await ticks()).slice(beforeTicks), { timeout: 10_000 }).toContain('own-write');
  expect((await search()).filter((i) => i.text === SQL)).toHaveLength(1);
});

test('Shift+Enter copies without any paste', async () => {
  const page = await openPalette();
  await page.locator('input').fill('docker');
  await expect(page.locator('[role=option]').first()).toContainText('docker run');
  await page.locator('input').press('Shift+Enter');
  await expect.poll(async () => (await clip()).text, { timeout: 10_000 }).toBe(DOCKER);
  await expect.poll(paletteVisible, { timeout: 10_000 }).toBe(false);
  expect(await pasteLog()).toEqual([]);
  await expect.poll(notifications, { timeout: 5_000 }).toEqual(['Copied']);
});

test('Ctrl+Enter pastes as a fenced code block with the item language', async () => {
  const page = await openPalette();
  await page.locator('input').fill('add(1');
  await expect(page.locator('[role=option]').first()).toContainText('def add');
  await page.locator('input').press('Control+Enter');
  await expect.poll(async () => (await clip()).text, { timeout: 10_000 }).toBe('```python\n' + PY + '\n```');
  await expect.poll(async () => (await pasteLog()).length, { timeout: 10_000 }).toBe(1);

  const p2 = await openPalette();
  await p2.locator('input').fill('students');
  await expect(p2.locator('[role=option]').first()).toContainText('SELECT');
  await p2.locator('input').press('Control+Enter');
  await expect.poll(async () => (await clip()).text, { timeout: 10_000 }).toBe('```sql\n' + SQL + '\n```');

  const p3 = await openPalette();
  await p3.locator('input').fill('docker');
  await expect(p3.locator('[role=option]').first()).toContainText('docker run');
  await p3.locator('input').press('Control+Enter');
  await expect.poll(async () => (await clip()).text, { timeout: 10_000 }).toBe('```bash\n' + DOCKER + '\n```');
  expect((await pasteLog()).length).toBe(3);
});

test('secrets are masked in the palette but still paste', async () => {
  const page = await openPalette();
  await page.locator('input').fill('AKIA');
  const row = page.locator('[role=option]').first();
  await expect(row).toContainText('secret hidden');
  expect(await page.locator('body').innerText()).not.toContain(AWS_KEY);
  await page.locator('input').press('Enter');
  await expect.poll(async () => (await clip()).text, { timeout: 10_000 }).toBe(AWS_KEY);
  await expect.poll(async () => (await pasteLog()).length, { timeout: 10_000 }).toBe(1);
});

test('an image item is written back as an image and pasted', async () => {
  const page = await openPalette();
  await page.locator('input').press('Control+4'); // Images filter
  // wait for the FILTERED list (exactly the one image): the unfiltered list also has the image first, and a mouse
  // resting over another row would otherwise make Enter pick that row
  await expect(page.locator('[role=option]')).toHaveCount(1);
  await expect(page.locator('[role=option]').first()).toContainText('Image');
  await page.locator('input').press('Enter');
  await expect.poll(async () => (await clip()).hasImage, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await pasteLog()).length, { timeout: 10_000 }).toBe(1);
});

test('Escape and click-away (blur) hide the palette without pasting', async () => {
  const page = await openPalette();
  await page.locator('input').press('Escape');
  await expect.poll(paletteVisible, { timeout: 5_000 }).toBe(false);

  await openPalette();
  // the OS sends `blur` when another window takes focus; windows in a test run may never be focused, so emit it
  await main((g) => void g.__mouPalette.window.emit('blur'));
  await expect.poll(paletteVisible, { timeout: 5_000 }).toBe(false);
  expect(await pasteLog()).toEqual([]);

  // pressing the hotkey while it is open closes it again
  await openPalette();
  await main((g) => g.__mouPalette.open());
  await expect.poll(paletteVisible, { timeout: 5_000 }).toBe(false);
});

test('opened from mouStache itself, it copies but never pastes into itself', async () => {
  const ownPid = await app.evaluate(() => process.pid);
  await pin({ name: 'mouStache', pid: ownPid });
  const page = await openPalette();
  expect((await main((g) => g.__mouPalette.last())).canPaste).toBe(false);
  await page.locator('input').fill('docker');
  await expect(page.locator('[role=option]').first()).toContainText('docker run');
  await page.locator('input').press('Enter');
  await expect.poll(async () => (await clip()).text, { timeout: 10_000 }).toBe(DOCKER);
  expect(await pasteLog()).toEqual([]);
  await expect.poll(notifications, { timeout: 5_000 }).toEqual(['Copied, press Ctrl+V']);
});

test('global shortcuts: registered through the stub, re-registered on change, errors shown in Settings', async () => {
  expect(await main((g) => g.__mouGS.registered())).toEqual(['Alt+Shift+S', 'Alt+Shift+V']);
  // "pressing" the registered palette shortcut opens the palette
  await main((g) => g.__mouGS.press('Alt+Shift+V'));
  await expect.poll(paletteVisible, { timeout: 10_000 }).toBe(true);
  await hidePalette();

  await setSettings({ hotkeyPalette: 'Control+Alt+P' });
  await expect.poll(() => main((g) => g.__mouGS.registered()), { timeout: 5_000 }).toEqual(['Alt+Shift+S', 'Control+Alt+P']);
  await main((g) => g.__mouGS.press('Control+Alt+P'));
  await expect.poll(paletteVisible, { timeout: 10_000 }).toBe(true);
  await hidePalette();

  // a shortcut the OS refuses: the old one keeps working and Settings explains why
  await main((g) => g.__mouGS.refuse('Control+Alt+K'));
  await panel.evaluate(() => window.dispatchEvent(new CustomEvent('stash:open-settings')));
  const field = panel.getByLabel('Quick palette shortcut');
  await expect(field).toBeVisible();
  await field.focus();
  await panel.keyboard.press('Control+Alt+K');
  await expect(panel.getByRole('alert')).toContainText('could not be registered', { timeout: 8_000 });
  const st = await main((g) => g.__mouHotkeyStatus());
  expect(st['palette']).toMatchObject({ ok: false, active: 'Control+Alt+P' });
  expect(await main((g) => g.__mouGS.registered())).toContain('Control+Alt+P');

  // an invalid combination is rejected in the field itself and nothing is saved
  await field.focus();
  await panel.keyboard.press('v');
  await expect(panel.getByRole('alert')).toContainText('Include Ctrl, Alt, Cmd or Win');
  expect((await main((g) => g.__mouPresence()))['hotkeyPalette']).toBe('Control+Alt+K');

  // reset to the default
  await panel.getByRole('button', { name: 'Reset' }).first().click();
  await expect.poll(() => main((g) => g.__mouGS.registered()), { timeout: 8_000 }).toEqual(['Alt+Shift+S', 'Alt+Shift+V']);
  await main((g) => g.__mouGS.allow('Control+Alt+K'));
});

test('region screenshot: drag a rectangle over the frozen display and an image item is saved (blip says Image)', async () => {
  const before = (await search()).filter((i) => i.kind === 'image').length;
  const shows0 = await main((g) => g.__mouBlip.shows);
  expect(await main((g) => g.__mouRegion.start())).toBe(true);
  const page = await findPage('/region.html');
  await expect(page.getByText('Drag to capture')).toBeVisible();

  await expectVerdict('outcomes', 'saved:image', async () => {
    await page.mouse.move(60, 50);
    await page.mouse.down();
    await page.mouse.move(180, 120, { steps: 4 });
    await page.mouse.move(260, 190, { steps: 4 });
    await page.mouse.up();
  });

  await expect.poll(async () => (await search()).filter((i) => i.kind === 'image').length, { timeout: 10_000 }).toBe(before + 1);
  const shot = (await search()).filter((i) => i.kind === 'image' && i.via === 'screenshot');
  expect(shot).toHaveLength(1);
  expect(shot[0]!.tags).toEqual(expect.arrayContaining(['image', 'screenshot']));
  expect(shot[0]!.width ?? 0).toBeGreaterThan(0);

  // the overlay is gone and the blip said "Saved · Image"
  await expect.poll(() => main((g) => g.__mouRegion.window() === undefined), { timeout: 5_000 }).toBe(true);
  await expect.poll(() => main((g) => g.__mouBlip.shows), { timeout: 10_000 }).toBe(shows0 + 1);
  const blip = await findPage('/blip.html');
  await expect(blip.getByTestId('blip-text')).toHaveText('Saved · Image');
});

test('region screenshot: Escape cancels and saves nothing', async () => {
  const before = (await search()).filter((i) => i.kind === 'image').length;
  const outcomes0 = (await outcomes()).length;
  expect(await main((g) => g.__mouRegion.start())).toBe(true);
  const page = await findPage('/region.html');
  // a key pressed before the overlay's React tree has mounted is lost (seen on slow CI runners), so keep pressing until it closes
  await expect
    .poll(async () => {
      await page.keyboard.press('Escape').catch(() => undefined); // the overlay closes itself mid-press
      return main((g) => g.__mouRegion.window() === undefined);
    }, { timeout: 15_000 })
    .toBe(true);
  expect((await search()).filter((i) => i.kind === 'image').length).toBe(before);
  expect((await outcomes()).length).toBe(outcomes0);
});
