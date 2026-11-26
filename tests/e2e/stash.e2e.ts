import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

declare const chrome: any; // evaluated inside the extension service worker / extension pages

const EXT = path.resolve('.output/chrome-mv3');
const SITE = 'https://stash-e2e.test';
const VAULT = 'https://vault.bitwarden.com'; // on mouStache's default paused-sites list

const SQL = 'SELECT name, gpa FROM students WHERE gpa > 3.5 ORDER BY gpa DESC;';
const DOCKER = 'docker run -d -p 8080:80 nginx';
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const PING = 'ping 8.8.8.8 -n 4';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>mouStache e2e</title></head><body style="font:16px sans-serif;padding:24px">
<h1>Subnetting lab notes</h1>
<p id="sql">${SQL}</p>
<p id="aws">${AWS_KEY}</p>
<p id="ping">${PING}</p>
<p id="pw">correct-horse-battery-staple</p>
<button id="copybtn" onclick="navigator.clipboard.writeText('${DOCKER}')">Copy command</button>
<textarea id="ta" rows="3" cols="50" aria-label="notes"></textarea>
</body></html>`;

interface DbItem {
  id: string; kind: string; text?: string; tags: string[]; lang?: string; secret: boolean;
  pinned: boolean; via: string; hasThumb: boolean; sourceUrl?: string;
}

type Shared = { ctx: BrowserContext; sw: Worker; extId: string; errors: string[] };
const test = base.extend<object, Shared>({
  errors: [async ({}, use) => { await use([]); }, { scope: 'worker' }],
  ctx: [async ({ errors }, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'stash-e2e-'));
    const ctx = await chromium.launchPersistentContext(dir, {
      channel: 'chromium',
      headless: !process.env.HEADED,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    ctx.on('weberror', (e) => errors.push(`${e.page()?.url() ?? 'sw'}: ${e.error().message}`));
    await ctx.route((u) => ['stash-e2e.test', 'vault.bitwarden.com'].includes(u.hostname), (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
    await use(ctx);
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }, { scope: 'worker' }],
  sw: [async ({ ctx }, use) => {
    await use(ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker')));
  }, { scope: 'worker' }],
  extId: [async ({ sw }, use) => { await use(new URL(sw.url()).host); }, { scope: 'worker' }],
});

test.describe.configure({ mode: 'serial' });

/** Read every stored item straight from IndexedDB inside the service worker. */
const dbItems = (sw: Worker): Promise<DbItem[]> =>
  sw.evaluate(() => new Promise<DbItem[]>((resolve, reject) => {
    const open = indexedDB.open('stash');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('items')) { db.close(); return resolve([]); }
      const q = db.transaction('items').objectStore('items').getAll();
      q.onerror = () => reject(q.error);
      q.onsuccess = () => {
        db.close();
        resolve(q.result.map((i: any) => ({
          id: i.id, kind: i.kind, text: i.text, tags: i.tags, lang: i.lang, secret: i.secret,
          pinned: i.pinned, via: i.via, hasThumb: !!i.thumbBlob, sourceUrl: i.source?.url,
        })));
      };
    };
  }));

const hasText = (items: DbItem[], t: string) => items.some((i) => i.text === t);

async function openSite(ctx: BrowserContext, origin = SITE): Promise<Page> {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await ctx.newPage();
  await page.goto(`${origin}/`);
  await page.waitForTimeout(800); // let the content script + MAIN-world hook attach
  return page;
}
async function copyParagraph(page: Page, id: string) {
  await page.locator(`#${id}`).selectText();
  await page.keyboard.press('Control+C');
}
async function openPanel(ctx: BrowserContext, extId: string): Promise<Page> {
  // No grantPermissions here: extension pages get clipboardRead/Write from the manifest.
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 400, height: 800 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  return panel;
}
const card = (panel: Page, text: string) => panel.locator('[data-card]', { hasText: text }).first();

test('extension loads with the expected manifest, icons and shortcuts', async ({ ctx, sw, extId }) => {
  const m = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(m.name).toBe('mouStache');
  expect(m.minimum_chrome_version).toBe('116');
  expect(m.commands['open-palette'].suggested_key.default).toBe('Alt+Shift+V');
  expect(m.commands['capture-region'].suggested_key.default).toBe('Alt+Shift+S');
  expect(m.permissions).not.toContain('offscreen');
  expect(m.action.default_icon['16']).toBe('icon/16.png');

  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  for (const size of [16, 32, 48, 128]) {
    const ok = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return r.ok && (r.headers.get('content-type') ?? '').includes('image/png');
    }, `chrome-extension://${extId}/icon/${size}.png`);
    expect(ok, `icon ${size}`).toBe(true);
  }
  expect(await page.locator('link[rel="icon"]').count()).toBeGreaterThanOrEqual(1);
  await page.close();
});

test('copying text on a web page saves it, tags it as SQL, and bumps the badge', async ({ ctx, sw }) => {
  expect(await sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
  const page = await openSite(ctx);
  await copyParagraph(page, 'sql');
  await expect.poll(async () => hasText(await dbItems(sw), SQL)).toBe(true);
  const item = (await dbItems(sw)).find((i) => i.text === SQL)!;
  expect(item.kind).toBe('text');
  expect(item.tags).toContain('sql');
  expect(item.via).toBe('copy');
  expect(item.sourceUrl).toBe(`${SITE}/`); // query/hash stripped, origin+path kept
  await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('1');
  await page.close();
});

test('a site Copy button (programmatic clipboard write) is captured via the MAIN-world hook', async ({ ctx, sw }) => {
  const page = await openSite(ctx);
  await page.locator('#copybtn').click();
  await expect.poll(async () => hasText(await dbItems(sw), DOCKER)).toBe(true);
  expect((await dbItems(sw)).find((i) => i.text === DOCKER)!.tags).toContain('command');
  await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('2');
  await page.close();
});

test('secrets are skipped, and re-copying the same text dedupes instead of duplicating', async ({ ctx, sw }) => {
  const page = await openSite(ctx);
  await copyParagraph(page, 'aws'); // secret -> must be skipped on auto-capture
  await page.waitForTimeout(1200); // past the content script's 1s identical-text window
  await copyParagraph(page, 'sql'); // duplicate -> dedupe
  await page.waitForTimeout(1200);
  await copyParagraph(page, 'ping'); // marker proves the pipeline kept processing after the above
  await expect.poll(async () => hasText(await dbItems(sw), PING)).toBe(true);
  const items = await dbItems(sw);
  expect(items.some((i) => (i.text ?? '').includes('AKIA'))).toBe(false);
  expect(items.filter((i) => i.text === SQL)).toHaveLength(1);
  await page.close();
});

test('copies on default-paused sites (password-manager vaults) are not saved', async ({ ctx, sw }) => {
  const vault = await openSite(ctx, VAULT);
  await copyParagraph(vault, 'pw');
  await vault.waitForTimeout(1500);
  await vault.close();
  const page = await openSite(ctx);
  await page.locator('#copybtn').click(); // dedupes docker, still exercises the pipeline
  await page.waitForTimeout(1200);
  expect((await dbItems(sw)).some((i) => i.text === 'correct-horse-battery-staple')).toBe(false);
  await page.close();
});

test('forged copy events and hook messages from a page with no user gesture are ignored', async ({ ctx, sw }) => {
  const before = (await dbItems(sw)).length;
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE });
  const page = await ctx.newPage();
  // Page script fires on a timer after load, once the navigation's transient user activation
  // (~5s) has expired. Playwright's page.evaluate() runs WITH activation, so it can't test this case.
  await page.addInitScript(() => {
    setTimeout(() => {
      for (let i = 0; i < 30; i++) {
        document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true })); // untrusted event
        window.postMessage({ source: 'stash-hook', text: `forged-${i}` }, '*');
      }
      (window as unknown as { __active: boolean }).__active = navigator.userActivation.isActive;
    }, 6000);
  });
  await page.goto(`${SITE}/`);
  await page.waitForTimeout(7500);
  expect(await page.evaluate(() => (window as unknown as { __active: boolean }).__active), 'test fidelity: no activation').toBe(false);
  const after = await dbItems(sw);
  expect(after.some((i) => (i.text ?? '').startsWith('forged-'))).toBe(false);
  expect(after.length).toBe(before);
  await page.close();
});

test('even after a real click, forged hook messages are rate-limited to 10 per 10s per page', async ({ ctx, sw }) => {
  const page = await openSite(ctx);
  await page.evaluate(() => { // evaluate() carries user activation, like a script running right after a user click
    for (let i = 0; i < 30; i++) window.postMessage({ source: 'stash-hook', text: `burst-${i}` }, '*');
  });
  await page.waitForTimeout(1500);
  const burst = (await dbItems(sw)).filter((i) => (i.text ?? '').startsWith('burst-')).length;
  expect(burst).toBeGreaterThan(0); // residual risk: indistinguishable from a legitimate Copy button...
  expect(burst).toBeLessThanOrEqual(10); // ...but bounded, so it can't evict the user's history
  await page.close();
});

test('side panel lists captures live, searches, and copies back to the clipboard', async ({ ctx, extId }) => {
  const panel = await openPanel(ctx, extId);
  await expect(card(panel, 'SELECT name, gpa FROM students')).toBeVisible();
  await expect(card(panel, DOCKER)).toBeVisible();
  await expect(card(panel, PING)).toBeVisible();

  const search = panel.getByRole('textbox', { name: 'Search your mouStache' });
  await search.fill('docker');
  await expect(panel.locator('[data-card]')).toHaveCount(1);
  await expect(card(panel, DOCKER)).toBeVisible();
  await search.fill('zzz-no-such-item');
  await expect(panel.locator('[data-card]')).toHaveCount(0);
  await search.fill('');
  await expect(card(panel, 'SELECT name, gpa FROM students')).toBeVisible();

  // live update: a new capture appears without reloading the panel
  const page = await openSite(ctx);
  await page.locator('#copybtn').evaluate(() => navigator.clipboard.writeText('traceroute -m 15 1.1.1.1'));
  await expect(card(panel, 'traceroute -m 15 1.1.1.1')).toBeVisible();
  await page.close();

  // click a card -> text lands on the system clipboard
  await panel.bringToFront();
  await card(panel, DOCKER).click();
  await expect.poll(() => panel.evaluate(() => navigator.clipboard.readText())).toBe(DOCKER);
  await panel.close();
});

test('pin, delete with undo, and delete commit', async ({ ctx, sw, extId }) => {
  const panel = await openPanel(ctx, extId);
  const row = card(panel, PING);
  await row.hover();
  await row.getByRole('button', { name: 'Pin' }).first().click();
  await expect.poll(async () => (await dbItems(sw)).find((i) => i.text === PING)?.pinned).toBe(true);

  await row.hover();
  await row.getByRole('button', { name: 'Unpin' }).first().click();
  await expect.poll(async () => (await dbItems(sw)).find((i) => i.text === PING)?.pinned).toBe(false);

  // delete -> undo restores
  await row.hover();
  await row.getByRole('button', { name: 'Delete' }).first().click();
  await expect(card(panel, PING)).toHaveCount(0);
  await panel.getByRole('button', { name: 'Undo' }).click();
  await expect(card(panel, PING)).toBeVisible();
  expect(hasText(await dbItems(sw), PING)).toBe(true);

  // delete again, let the 4s undo window lapse -> gone from IndexedDB
  await card(panel, PING).hover();
  await card(panel, PING).getByRole('button', { name: 'Delete' }).first().click();
  await expect.poll(async () => hasText(await dbItems(sw), PING), { timeout: 10_000 }).toBe(false);
  await panel.close();
});

test('quick palette: opens on the page, searches, and pastes into the focused field', async ({ ctx, sw }) => {
  const page = await openSite(ctx);
  await page.locator('#ta').focus();
  await sw.evaluate(async (origin) => {
    const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
    await chrome.tabs.sendMessage(tab.id, { type: 'open-palette' });
  }, SITE);
  await page.waitForTimeout(600);
  // The palette's shadow root must be closed: no element on the page exposes a readable shadowRoot.
  expect(await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => (e as HTMLElement).shadowRoot).length)).toBe(0);
  await page.keyboard.type('docker');
  await page.waitForTimeout(700); // debounce + background search round-trip
  await page.keyboard.press('Enter');
  await expect(page.locator('#ta')).toHaveValue(/docker run -d -p 8080:80 nginx/);
  await page.close();
});

test('screenshot capture saves an image with a thumbnail', async ({ ctx, sw, extId }) => {
  const panel = await openPanel(ctx, extId);
  await panel.bringToFront();
  const res = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'capture-visible' }));
  expect(res.ok, JSON.stringify(res)).toBe(true);
  await expect.poll(async () => (await dbItems(sw)).some((i) => i.kind === 'image' && i.hasThumb && i.tags.includes('screenshot'))).toBe(true);
  await expect(panel.locator('[data-card] img').first()).toBeVisible();
  await panel.close();
});

test('settings: theme switches live, and Export JSON downloads a valid mouStache file', async ({ ctx, extId }) => {
  const panel = await openPanel(ctx, extId);
  await panel.getByRole('button', { name: 'Settings' }).click();
  await panel.getByRole('radiogroup', { name: /theme/i }).getByRole('radio', { name: /dark/i }).click();
  await expect(panel.locator('html')).toHaveAttribute('data-theme', 'dark');
  await panel.getByRole('radiogroup', { name: /theme/i }).getByRole('radio', { name: /system/i }).click();

  const [download] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: /Export JSON/ }).click(),
  ]);
  const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(file.app).toBe('stash');
  expect(file.items.length).toBeGreaterThanOrEqual(3);
  expect(JSON.stringify(file)).not.toContain('AKIA');
  await panel.close();
});

test('desktop bridge: when paired, a page copy is forwarded to 127.0.0.1 (token, stripped URL, never a secret) and Test connection reports the status', async ({ ctx, sw, extId }) => {
  const TOKEN = 'e2e-bridge-token-0123456789abcdefghijklmnopqrstuv';
  const seen: { method: string; url: string; auth?: string; origin?: string; host?: string; body: string }[] = [];
  const stub = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, origin: req.headers.origin, host: req.headers.host, body: Buffer.concat(chunks).toString('utf8') });
      const authed = req.headers.authorization === `Bearer ${TOKEN}`;
      res.setHeader('Content-Type', 'application/json');
      if (!authed) { res.statusCode = 401; return void res.end('{"ok":false,"error":"unauthorized"}'); }
      res.end(req.url === '/v1/ping' ? '{"ok":true,"app":"mouStache","version":"0.0.0-stub"}' : '{"ok":true,"id":"stub"}');
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const port = (stub.address() as { port: number }).port;
  const captures = () => seen.filter((r) => r.method === 'POST' && r.url === '/v1/capture').map((r) => ({ ...r, json: JSON.parse(r.body) }));
  const setBridge = (patch: object) =>
    sw.evaluate(async (p) => {
      const cur = (await chrome.storage.local.get('stash:settings'))['stash:settings'] ?? {};
      await chrome.storage.local.set({ 'stash:settings': { ...cur, ...p } });
    }, patch);

  try {
    // 1. bridge off (the default): copying forwards nothing
    const page = await openSite(ctx);
    await copyParagraph(page, 'pw');
    await expect.poll(async () => hasText(await dbItems(sw), 'correct-horse-battery-staple')).toBe(true);
    await page.waitForTimeout(500);
    expect(seen).toEqual([]);

    // 2. paired: a normal copy is forwarded with the token and the page source, minus query/hash
    await setBridge({ bridgeEnabled: true, bridgeToken: TOKEN, bridgePort: port });
    await page.waitForTimeout(1200); // past the content script's identical-text window
    await copyParagraph(page, 'ping');
    await expect.poll(() => captures().some((c) => c.json.text === PING)).toBe(true);
    const sent = captures().find((c) => c.json.text === PING)!;
    expect(sent.auth).toBe(`Bearer ${TOKEN}`);
    expect(sent.origin).toMatch(/^chrome-extension:\/\/[a-p]{32}$/);
    expect(sent.host).toBe(`127.0.0.1:${port}`);
    expect(sent.json).toMatchObject({ kind: 'text', text: PING, via: 'copy', source: { url: `${SITE}/` } });
    expect(sent.body).not.toContain('?');

    // 3. a secret is skipped locally and therefore never forwarded; the pipeline keeps going afterwards
    await page.waitForTimeout(1200);
    await copyParagraph(page, 'aws');
    await page.waitForTimeout(1200);
    await copyParagraph(page, 'sql'); // marker: proves forwarding kept working after the secret
    await expect.poll(() => captures().some((c) => c.json.text === SQL)).toBe(true);
    expect(seen.map((r) => r.body).join('\n')).not.toContain(AWS_KEY);
    expect(seen.map((r) => r.body).join('\n')).not.toContain('AKIA');
    await page.close();

    // 4. Settings > Desktop app: Test connection says Connected / Wrong token / Not running
    const panel = await openPanel(ctx, extId);
    await panel.getByRole('button', { name: 'Settings' }).click();
    const status = panel.getByTestId('bridge-status');
    await panel.getByRole('button', { name: 'Test connection' }).click();
    await expect(status).toHaveText('Connected');
    await panel.getByLabel('Desktop app pairing token').fill('definitely-the-wrong-token-xxxxxxxxxxxxxxxxxx');
    await panel.getByLabel('Desktop app pairing token').blur();
    await panel.getByRole('button', { name: 'Test connection' }).click();
    await expect(status).toContainText('Wrong token');
    await panel.getByLabel('Desktop app pairing token').fill(TOKEN);
    await panel.getByLabel('Desktop app pairing token').blur();
    await new Promise<void>((r) => stub.close(() => r())); // the desktop app "quits"
    await panel.getByRole('button', { name: 'Test connection' }).click();
    await expect(status).toContainText('Not running');
    await panel.close();
  } finally {
    await setBridge({ bridgeEnabled: false, bridgeToken: '' });
    if (stub.listening) await new Promise<void>((r) => stub.close(() => r()));
  }
});

test('no uncaught errors were thrown anywhere during the run', async ({ errors }) => {
  expect(errors, errors.join('\n')).toEqual([]);
});
