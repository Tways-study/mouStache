// Regenerates docs/screenshots/desktop-*.png from the BUILT desktop app (run `npm run desktop:build:test` first: it needs the test seams).
//   npm run desktop:screenshots
// Safety: a throwaway userData dir, MOUSTACHE_E2E=1 with the in-memory fake clipboard (the real clipboard is never read),
// a pinned fake foreground app, and the pictures are page captures of mouStache's own windows (the real screen is never
// captured). All data below is made up. The bridge token is generated fresh in the throwaway profile and stays masked.
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('.');
const OUT = path.resolve('docs/screenshots');
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), 'moustache-shots-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(100);
  }
  throw new Error('timed out waiting for ' + what);
}

const app = await electron.launch({
  args: [ROOT],
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

try {
  const page = (suffix) => app.windows().find((w) => w.url().endsWith(suffix));
  const panel = await until(() => page('/panel.html'), 'panel window');
  await panel.waitForLoadState('domcontentloaded');
  await until(() => app.evaluate(() => globalThis.__mouReady === true), 'app ready');
  await app.evaluate(() => globalThis.__mouForeground({ name: 'Code' }));
  await panel.emulateMedia({ colorScheme: 'light' });

  const send = (m) => panel.evaluate((msg) => globalThis.chrome.runtime.sendMessage(msg), m);
  const settings = (partial) =>
    panel.evaluate(async (p) => {
      const c = globalThis.chrome.storage.local;
      const cur = (await c.get('stash:settings'))['stash:settings'] ?? {};
      await c.set({ 'stash:settings': { ...cur, ...p } });
    }, partial);

  // ---- made-up history (oldest first, so the newest ends up on top) ----
  const demo = [
    ['git rebase -i HEAD~3', 'Terminal'],
    ['docker run --rm -p 8080:80 -v "$PWD":/usr/share/nginx/html:ro nginx:alpine', 'Terminal'],
    ['https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API', 'Chrome'],
    ['{\n  "name": "demo-service",\n  "version": "1.4.2",\n  "private": true\n}', 'Code'],
    ['def fizzbuzz(n):\n    return "Fizz" * (n % 3 == 0) + "Buzz" * (n % 5 == 0) or str(n)', 'Cursor'],
    ['TypeError: Cannot read properties of undefined (reading \'map\')\n    at renderList (app.js:42:18)', 'Code'],
    ['SELECT c.name, COUNT(*) AS orders\nFROM customers c JOIN orders o ON o.customer_id = c.id\nGROUP BY c.name\nORDER BY orders DESC;', 'DataGrip'],
  ];
  for (const [text, app_] of demo) {
    await app.evaluate((_e, a) => globalThis.__mouForeground({ name: a }), app_);
    const saved = () => app.evaluate(() => globalThis.__mouOutcomes().filter((o) => o === 'saved:text').length);
    const before = await saved();
    await app.evaluate((_e, t) => globalThis.__mouFake.writeText(t), text);
    await until(async () => (await saved()) > before && (await app.evaluate(() => globalThis.__mouPending())) === 0, 'capture of ' + text.slice(0, 12));
    await sleep(450);
  }
  await app.evaluate(() => globalThis.__mouForeground({ name: 'Code' }));
  await settings({ blipMode: 'blip', blipDuration: 'long' });
  await sleep(1500); // let the list and any pill settle
  await panel.getByText('git rebase').first().waitFor();

  // ---- panel, light and dark ----
  await panel.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await panel.screenshot({ path: path.join(OUT, 'desktop-panel.png') });
  await panel.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  await panel.screenshot({ path: path.join(OUT, 'desktop-panel-dark.png') });
  await panel.emulateMedia({ colorScheme: 'light' });
  await sleep(300);

  // ---- settings: Presence, Browser extension (token stays masked: we never press Show) ----
  const openSettings = async (heading) => {
    await panel.evaluate(() => window.dispatchEvent(new CustomEvent('stash:open-settings')));
    const h = panel.getByText(heading, { exact: true }).first();
    await h.waitFor();
    await h.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await sleep(500);
  };
  await openSettings('Presence');
  await panel.screenshot({ path: path.join(OUT, 'desktop-settings-presence.png') });
  await openSettings('Browser extension');
  const token = panel.getByTestId('bridge-token');
  if (!/^•+$/.test((await token.textContent()) ?? '')) throw new Error('token is not masked, refusing to take the screenshot');
  await panel.screenshot({ path: path.join(OUT, 'desktop-settings-extension.png') });

  // ---- palette ----
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'mouStache')?.hide());
  await app.evaluate(() => globalThis.__mouPalette.open());
  const palette = await until(() => page('/palette.html'), 'palette window');
  await palette.getByText('git rebase').first().waitFor();
  await palette.addStyleTag({ content: 'html,body{background:#e8ebf2 !important}' });
  await sleep(500);
  await palette.screenshot({ path: path.join(OUT, 'desktop-palette.png') });
  await app.evaluate(({ BrowserWindow }, _) => BrowserWindow.getAllWindows().forEach((w) => w.getTitle() !== 'mouStache' && w.webContents.getURL().endsWith('/palette.html') && w.hide()));

  // ---- blip pill (a new copy while no mouStache window has focus) ----
  const blip = await until(() => page('/blip.html'), 'blip window');
  await blip.addStyleTag({ content: 'html,body{background:#e8ebf2 !important}' });
  await until(() => app.evaluate(() => globalThis.__mouBlip.idle()), 'blip idle');
  await app.evaluate(() => globalThis.__mouFake.writeText('SELECT * FROM students WHERE gpa > 3.5;'));
  await until(() => app.evaluate(() => globalThis.__mouBlip.window.isVisible()), 'blip visible');
  await sleep(450); // past the fade-in
  const cdp = await blip.context().newCDPSession(blip);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 44, deviceScaleFactor: 3, mobile: false }).catch(() => {});
  await blip.screenshot({ path: path.join(OUT, 'desktop-blip.png') });

  console.log('desktop screenshots written to docs/screenshots/desktop-*.png');
} finally {
  await app.close().catch(() => {});
  rmSync(profile, { recursive: true, force: true });
}
