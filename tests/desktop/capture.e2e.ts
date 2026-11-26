import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Phase 2: system clipboard capture + ambient presence (tray, blip). Drives the BUILT app; the clipboard is
// written from the Electron main process, exactly like another app would write it.
//
// Determinism rules (no fixed sleeps, no item counts as proof of "nothing happened"):
//  - the foreground app is PINNED through a test hook (a developer's real foreground window changes mid-run);
//  - every negative assertion first waits for the main process to log the specific tick result / capture outcome
//    for THAT copy ("secret", "concealed", "paused-app", ...), then asserts nothing was saved or shown;
//  - every test starts from a quiesced app (pipeline idle, no pill showing or queued) and default settings.

const ROOT = path.resolve('.');
const SQL = 'SELECT name, gpa FROM students WHERE gpa > 3.5 ORDER BY gpa DESC;';
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const EDITOR = 'FakeEditor';
const DEFAULT_PAUSED = ['1Password', 'Bitwarden', 'KeePass', 'LastPass', 'Dashlane'];

let app: ElectronApplication;
let panel: Page;
let profile: string;

type Item = { id: string; kind: string; text?: string; tags: string[]; secret: boolean; source?: { title?: string } };
type G = {
  __mouBlip: { window: Electron.BrowserWindow; flags: { ignoreMouseEvents: boolean }; shows: number; idle(): boolean };
  __mouTray: () => { state: string; tooltip: string };
  __mouPending: () => number;
  __mouTicks: () => string[];
  __mouOutcomes: () => string[];
  __mouPresence: () => Record<string, unknown>;
  __mouForeground: (a: { name: string; pid?: number } | undefined | 'real') => void;
  __mouReady?: boolean;
};

const main = <T>(fn: (g: G) => T) => app.evaluate((_e, f) => (new Function('g', `return (${f})(g)`) as (g: unknown) => unknown)(globalThis), fn.toString()) as Promise<T>;

const search = (limit = 200) =>
  panel.evaluate(
    (n) =>
      (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime.sendMessage({
        type: 'search',
        query: '',
        limit: n,
      }) as Promise<Item[]>,
    limit,
  );
const hasText = async (t: string) => (await search()).some((i) => i.text === t);
const imageCount = async () => (await search()).filter((i) => i.kind === 'image').length;

async function findPage(suffix: string): Promise<Page> {
  const find = () => app.windows().find((w) => w.url().endsWith(suffix));
  await expect.poll(() => !!find(), { timeout: 10_000 }).toBe(true);
  return find()!;
}

// The OS clipboard is shared with everything else on the machine, so this suite drives an in-memory stand-in
// (MOUSTACHE_FAKE_CLIPBOARD=1); clipboard-real.e2e.ts covers the real Electron clipboard.
const fake = <A>(fn: (c: Fake, a: A) => void, arg: A) =>
  app.evaluate((_e, v) => (new Function('g', 'a', `(${v.fn})(g.__mouFake, a)`) as (g: unknown, a: unknown) => void)(globalThis, v.arg), { fn: fn.toString(), arg });
type Fake = { writeText(t: string): void; writeConcealed(t: string): void; writeImage(s: number): void };
const writeText = (text: string) => fake((c, t) => c.writeText(t), text);
const writeConcealed = (text: string) => fake((c, t) => c.writeConcealed(t), text);
const writeImage = (shade: number) => fake((c, s) => c.writeImage(s), shade);

const blipVisible = () => main((g) => g.__mouBlip.window.isVisible());
const blipShows = () => main((g) => g.__mouBlip.shows);
const tray = () => main((g) => g.__mouTray());
const ticks = () => main((g) => g.__mouTicks());
const outcomes = () => main((g) => g.__mouOutcomes());
const presence = () => main((g) => g.__mouPresence());
const pin = (a: { name: string; pid?: number } | undefined | 'real') =>
  app.evaluate((_e, v) => (globalThis as unknown as G).__mouForeground(v), a);

/** Write via `act`, then wait until main logs a NEW entry equal to `expected` (a specific verdict for that copy). */
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
  // engine -> main push: wait for main to actually hold the new values
  for (const [k, v] of Object.entries(partial)) await expect.poll(async () => (await presence())[k], { timeout: 10_000 }).toEqual(v);
}

/** Pipeline idle, no pill visible or queued. */
async function quiesce() {
  await expect.poll(() => main((g) => g.__mouPending()), { timeout: 15_000 }).toBe(0);
  await expect.poll(() => main((g) => g.__mouBlip.idle()), { timeout: 15_000 }).toBe(true);
  await expect.poll(blipVisible, { timeout: 15_000 }).toBe(false);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'moustache-e2e-cap-'));
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, MOUSTACHE_USER_DATA: profile, MOUSTACHE_E2E: '1', MOUSTACHE_NO_FIRST_RUN: '1', MOUSTACHE_FAKE_CLIPBOARD: '1' },
  });
  panel = await findPage('/panel.html');
  await panel.waitForLoadState('domcontentloaded');
  // the watcher starts once the engine has pushed its settings; its baseline tick is logged
  await expect.poll(() => main((g) => g.__mouReady === true), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await ticks()).length, { timeout: 15_000 }).toBeGreaterThan(0); // baseline (or empty) tick ran
});

test.beforeEach(async () => {
  await pin({ name: EDITOR });
  await setSettings({ autoCapture: true, blipMode: 'blip', blipDuration: 'normal', pausedApps: DEFAULT_PAUSED });
  await quiesce();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

test('text copied in another app is captured, tagged, attributed to the app, and deduped', async () => {
  await writeText(SQL);
  await expect.poll(() => hasText(SQL), { timeout: 15_000 }).toBe(true);
  const item = (await search()).find((i) => i.text === SQL)!;
  expect(item.tags).toContain('sql');
  expect(item.secret).toBe(false);
  expect(item.source?.title).toBe(EDITOR);
  await expect(panel.getByText('SELECT name, gpa FROM students').first()).toBeVisible();

  await quiesce();
  await expectVerdict('outcomes', 'saved:text', () => writeText('docker run -d -p 8080:80 nginx'));
  await quiesce();
  await expectVerdict('outcomes', 'saved:text', () => writeText(SQL)); // same SQL again: deduped, moved to top
  await expect.poll(async () => (await search())[0]?.text, { timeout: 15_000 }).toBe(SQL);
  expect((await search()).filter((i) => i.text === SQL)).toHaveLength(1);
});

test('an image copied in another app is captured; identical pixels are not captured twice', async () => {
  const base = await imageCount();
  await expectVerdict('outcomes', 'saved:image', () => writeImage(90));
  await expect.poll(imageCount, { timeout: 15_000 }).toBe(base + 1);
  expect((await search()).find((i) => i.kind === 'image')!.tags).toContain('image');
  await quiesce();

  await writeImage(90); // identical pixels: not a change
  await expectVerdict('outcomes', 'saved:image', () => writeImage(200));
  await expect.poll(imageCount, { timeout: 15_000 }).toBe(base + 2);
});

test('the blip never takes focus, is click-through, shows the type but not the content, and hides itself', async () => {
  const shows0 = await blipShows();
  await writeText('ls -la /home/student/private-notes');
  await expect.poll(blipVisible, { timeout: 15_000 }).toBe(true);

  const info = await app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as unknown as G;
    const w = g.__mouBlip.window;
    return {
      focusable: w.isFocusable(),
      focused: w.isFocused(),
      anyFocusIsBlip: BrowserWindow.getFocusedWindow() === w,
      ignoreMouseEvents: g.__mouBlip.flags.ignoreMouseEvents,
      alwaysOnTop: w.isAlwaysOnTop(),
    };
  });
  expect(info).toEqual({ focusable: false, focused: false, anyFocusIsBlip: false, ignoreMouseEvents: true, alwaysOnTop: true });

  const blip = await findPage('/blip.html');
  await expect(blip.getByTestId('blip-text')).toHaveText('Saved · Command');
  const body = await blip.locator('body').innerText();
  expect(body).not.toContain('private-notes');
  expect(body).not.toContain('ls -la');

  await expect.poll(blipVisible, { timeout: 10_000 }).toBe(false); // fade out, then the window is hidden
  expect((await blipShows()) - shows0).toBe(1);
});

test('a burst coalesces into one pill', async () => {
  await setSettings({ blipDuration: 'long' });
  const shows0 = await blipShows();
  await expectVerdict('outcomes', 'saved:text', () => writeText('burst one alpha'));
  await expect.poll(blipVisible, { timeout: 15_000 }).toBe(true);
  await expectVerdict('outcomes', 'saved:text', () => writeText('burst two beta'));
  await expectVerdict('outcomes', 'saved:text', () => writeText('burst three gamma'));
  const blip = await findPage('/blip.html');
  await expect(blip.getByTestId('blip-text')).toHaveText(/^Saved · [23] items$/);
  expect((await blipShows()) - shows0).toBe(1);
});

test('tray tooltip reports the count and the last type, never content', async () => {
  await expectVerdict('outcomes', 'saved:text', () => writeText('pwd'));
  await expect
    .poll(async () => (await tray()).tooltip, { timeout: 10_000 })
    .toMatch(/^mouStache · \d+ items · last: [A-Za-z ]+, (just now|\d+ min ago)$/);
  expect((await tray()).tooltip).not.toContain('pwd');
});

test('secrets (API keys) are never saved and produce no blip', async () => {
  const shows0 = await blipShows();
  await expectVerdict('outcomes', 'skipped:secret', () => writeText(AWS_KEY));
  expect(await hasText(AWS_KEY)).toBe(false);
  expect(await blipShows()).toBe(shows0);
  expect(await blipVisible()).toBe(false);
});

test('concealed clipboard entries (password managers) are never saved and produce no blip', async () => {
  const shows0 = await blipShows();
  await expectVerdict('ticks', 'concealed', () => writeConcealed('hunter2-from-a-password-manager'));
  expect((await search()).some((i) => i.text?.includes('hunter2'))).toBe(false);
  expect(await blipShows()).toBe(shows0);
  expect(await blipVisible()).toBe(false);
});

test('copies mouStache marks as its own are ignored', async () => {
  const text = 'written by the mouStache panel itself';
  const shows0 = await blipShows();
  await expectVerdict('ticks', 'own-write', async () => {
    await panel.evaluate((t) => window.mouDesktop!.markOwnWrite({ text: t }), text);
    await writeText(text);
  });
  expect(await hasText(text)).toBe(false);
  expect(await blipShows()).toBe(shows0);
});

test('Tray only mode saves without a blip; Off is silent too', async () => {
  const shows0 = await blipShows();
  await setSettings({ blipMode: 'tray' });
  await expectVerdict('outcomes', 'saved:text', () => writeText('tray only copy one'));
  expect(await hasText('tray only copy one')).toBe(true);

  await setSettings({ blipMode: 'off' });
  await expectVerdict('outcomes', 'saved:text', () => writeText('silent copy two'));
  expect(await hasText('silent copy two')).toBe(true);

  expect(await blipShows()).toBe(shows0);
  expect(await blipVisible()).toBe(false);
  await expect.poll(async () => (await tray()).state, { timeout: 5_000 }).toBe('idle');
});

test('Pause capture stops saving and shows paused; resuming does not capture what was copied meanwhile', async () => {
  await setSettings({ autoCapture: false });
  await expect.poll(async () => (await tray()).state, { timeout: 5_000 }).toBe('paused');
  expect((await tray()).tooltip).toContain('Paused');

  // a few paused ticks run after the copy, none of which may capture it
  const t0 = (await ticks()).length;
  await writeText('copied while paused');
  await expect.poll(async () => (await ticks()).slice(t0).filter((r) => r === 'paused').length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  expect(await hasText('copied while paused')).toBe(false);

  // resume: the first tick is a baseline, so the paused-time copy is still not captured
  await expectVerdict('ticks', 'baseline', () => setSettings({ autoCapture: true }));
  expect(await hasText('copied while paused')).toBe(false);
  await expectVerdict('outcomes', 'saved:text', () => writeText('copied after resume'));
  expect(await hasText('copied after resume')).toBe(true);
});

test('copies made while a paused app is in front are never saved and show nothing', async () => {
  // default list entry "1Password" matches the window's app name
  await pin({ name: '1Password 7 - Password Manager' });
  const shows1 = await blipShows();
  await expectVerdict('outcomes', 'skipped:paused-app', () => writeText('copied from the password manager window'));
  expect(await hasText('copied from the password manager window')).toBe(false);
  expect(await blipShows()).toBe(shows1);
  expect(await blipVisible()).toBe(false);

  // the user edits the list: 1Password is no longer paused, so the same app now gets captured
  await setSettings({ pausedApps: ['SomeOtherApp'] });
  await expectVerdict('outcomes', 'saved:text', () => writeText('now this one is saved'));
  expect(await hasText('now this one is saved')).toBe(true);
  await quiesce();

  // a custom entry matches a different app
  await setSettings({ pausedApps: [EDITOR] });
  await pin({ name: EDITOR });
  const shows2 = await blipShows();
  await expectVerdict('outcomes', 'skipped:paused-app', () => writeText('copied while a custom paused app is in front'));
  expect(await hasText('copied while a custom paused app is in front')).toBe(false);
  expect(await blipShows()).toBe(shows2);
  expect(await blipVisible()).toBe(false);
});

test('real foreground-app detection reports a process name (Windows)', async () => {
  test.skip(process.platform !== 'win32', 'verified on Windows only');
  await pin('real');
  await expectVerdict('outcomes', 'saved:text', () => writeText('attributed by the real detector'));
  const item = (await search()).find((i) => i.text === 'attributed by the real detector')!;
  expect(item.source?.title).toBeTruthy();
  expect(item.source?.title).not.toBe(EDITOR);
});

test('a text over the size cap is skipped', async () => {
  await expectVerdict('ticks', 'too-large', () => writeText('x'.repeat(520_000)));
  expect((await search()).some((i) => (i.text?.length ?? 0) > 100_000)).toBe(false);
});

test.describe('first run', () => {
  test('points at the tray once, and only once', async () => {
    const p = mkdtempSync(path.join(tmpdir(), 'moustache-e2e-first-'));
    const env = { ...process.env, MOUSTACHE_USER_DATA: p, MOUSTACHE_E2E: '1', MOUSTACHE_FAKE_CLIPBOARD: '1' };
    delete (env as Record<string, unknown>)['MOUSTACHE_NO_FIRST_RUN'];
    const pill = (a: ElectronApplication) =>
      a.evaluate(() => (globalThis as unknown as G).__mouBlip?.window.isVisible() ?? false);
    const ready = (a: ElectronApplication) => a.evaluate(() => (globalThis as unknown as G).__mouReady === true);
    try {
      const a1 = await electron.launch({ args: [ROOT], env });
      await expect.poll(() => ready(a1), { timeout: 20_000 }).toBe(true);
      await expect.poll(() => pill(a1), { timeout: 10_000 }).toBe(true);
      const blip = a1.windows().find((w) => w.url().endsWith('/blip.html'))!;
      await expect(blip.getByTestId('blip-text')).toContainText(/lives in your (tray|menu bar)/);
      expect(existsSync(path.join(p, 'first-run.json'))).toBe(true);
      await a1.close();

      const a2 = await electron.launch({ args: [ROOT], env });
      await expect.poll(() => ready(a2), { timeout: 20_000 }).toBe(true);
      // the hint is announced synchronously with the watcher start, so "ready" already implies it would be showing
      expect(await pill(a2)).toBe(false);
      expect(await a2.evaluate(() => (globalThis as unknown as G).__mouBlip.shows)).toBe(0);
      await a2.close();
    } finally {
      rmSync(p, { recursive: true, force: true });
    }
  });
});
