import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Phase 4: the extension -> desktop bridge, against the real built app. The app runs with MOUSTACHE_E2E=1 on a free
// port (MOUSTACHE_BRIDGE_PORT=0), an in-memory clipboard and a pinned foreground app. Requests go over real HTTP
// to the real server; the "extension" is just an HTTP client sending the same Origin an extension would.

const ROOT = path.resolve('.');
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const SQL = 'SELECT name, gpa FROM bridge_students WHERE gpa > 3.5;';
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';

let app: ElectronApplication;
let panel: Page;
let profile: string;
let port = 0;
let token = '';

type Item = { id: string; kind: string; text?: string; tags: string[]; secret: boolean; via: string; source?: { url?: string; title?: string; favicon?: string } };
type G = {
  __mouBlip: { shows: number; notifies: number; idle(): boolean; window: Electron.BrowserWindow };
  __mouPending: () => number;
  __mouTicks: () => string[];
  __mouOutcomes: () => string[];
  __mouPresence: () => Record<string, unknown>;
  __mouForeground: (a: unknown) => void;
  __mouFake: { writeText(t: string): void };
  __mouBridge: { port(): number | undefined };
  __mouReady?: boolean;
};
const main = <T>(fn: (g: G) => T) =>
  app.evaluate((_e, f) => (new Function('g', `return (${f})(g)`) as (g: unknown) => unknown)(globalThis), fn.toString()) as Promise<T>;

const search = () =>
  panel.evaluate(
    () =>
      (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime.sendMessage({
        type: 'search',
        query: '',
        limit: 200,
      }) as Promise<Item[]>,
  );
const outcomes = () => main((g) => g.__mouOutcomes());
const notifies = () => main((g) => g.__mouBlip.notifies);

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json?: Record<string, unknown>;
}
function http(o: { method?: string; path?: string; headers?: Record<string, string>; body?: unknown; auth?: string | false }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.auth !== false) headers['Authorization'] = `Bearer ${o.auth ?? token}`;
    const body = o.body === undefined ? undefined : JSON.stringify(o.body);
    if (body !== undefined) headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    const req = request({ host: '127.0.0.1', port, method: o.method ?? (body ? 'POST' : 'GET'), path: o.path ?? (body ? '/v1/capture' : '/v1/ping'), headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => {
        let json: Record<string, unknown> | undefined;
        try {
          json = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>;
        } catch {
          /* not json */
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
const capture = (body: unknown, extra: { headers?: Record<string, string>; auth?: string | false } = {}) =>
  http({ body, headers: { Origin: EXT_ORIGIN, ...(extra.headers ?? {}) }, auth: extra.auth });

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

const bridgeInfo = () =>
  panel.evaluate(() => window.mouDesktop!.getBridgeInfo()) as Promise<{ status: string; port?: number; token: string; error?: string; version: string } | undefined>;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'moustache-e2e-bridge-'));
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, MOUSTACHE_USER_DATA: profile, MOUSTACHE_E2E: '1', MOUSTACHE_NO_FIRST_RUN: '1', MOUSTACHE_FAKE_CLIPBOARD: '1', MOUSTACHE_BRIDGE_PORT: '0' },
  });
  panel = await findPage('/panel.html');
  await panel.waitForLoadState('domcontentloaded');
  await expect.poll(() => main((g) => g.__mouReady === true), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => main((g) => g.__mouBridge.port() !== undefined), { timeout: 10_000 }).toBe(true);
  const info = (await bridgeInfo())!;
  port = info.port!;
  token = info.token;
  await app.evaluate((_e, v) => (globalThis as unknown as G).__mouForeground(v), { name: 'FakeEditor', pid: 4242, handle: '777001' });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

test('status and token reach the panel window only, never another renderer', async () => {
  const info = await bridgeInfo();
  expect(info).toMatchObject({ status: 'listening', port, version: expect.any(String) });
  expect(info!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(info!.port).toBe(await main((g) => g.__mouBridge.port()));

  for (const suffix of ['/palette.html', '/blip.html', '/engine.html']) {
    const page = await findPage(suffix);
    const got = await page.evaluate(async () => {
      const api = window.mouDesktop;
      return { info: await api?.getBridgeInfo?.(), regen: await api?.regenerateBridgeToken?.() };
    });
    expect(got, suffix).toEqual({ info: undefined, regen: undefined });
  }
  expect((await bridgeInfo())!.token).toBe(token); // a stranger asking for a new token changed nothing
});

test('GET /v1/ping answers the extension over real HTTP', async () => {
  const r = await http({ headers: { Origin: EXT_ORIGIN } });
  expect(r.status).toBe(200);
  expect(r.json).toMatchObject({ ok: true, app: 'mouStache' });
  expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
});

test('an authenticated capture appears in the panel, tagged, with its page source (query and hash stripped)', async () => {
  const r = await capture({
    kind: 'text',
    text: SQL,
    via: 'copy',
    source: { url: 'https://example.com/lesson/3?session=SECRETSESSION#answers', title: 'Lesson 3', favicon: 'https://example.com/favicon.ico' },
  });
  expect(r.status).toBe(200);
  expect(r.json).toMatchObject({ ok: true, deduped: false });
  await expect.poll(async () => (await search()).some((i) => i.text === SQL), { timeout: 10_000 }).toBe(true);
  const item = (await search()).find((i) => i.text === SQL)!;
  expect(item.tags).toContain('sql');
  expect(item.via).toBe('copy');
  expect(item.source).toEqual({ url: 'https://example.com/lesson/3', title: 'Lesson 3', favicon: 'https://example.com/favicon.ico' });
  expect(JSON.stringify(await search())).not.toContain('SECRETSESSION');
  await expect(panel.getByText('SELECT name, gpa FROM bridge_students').first()).toBeVisible(); // live list
});

test('unauthenticated, wrong-token, wrong-origin, wrong-host and preflight requests are rejected and save nothing', async () => {
  const before = (await search()).length;
  const body = { kind: 'text', text: 'must-never-be-saved-12345' };
  expect((await capture(body, { auth: false })).status).toBe(401);
  expect((await capture(body, { auth: 'z'.repeat(43) })).status).toBe(401);
  expect((await capture(body, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  expect((await capture(body, { headers: { Origin: 'http://localhost:3000' } })).status).toBe(403);
  expect((await capture(body, { headers: { Host: `rebind.example:${port}` } })).status).toBe(403);
  const pre = await http({ method: 'OPTIONS', path: '/v1/capture', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  expect(pre.status).toBe(403);
  expect(Object.keys(pre.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
  expect((await capture(body, { headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
  expect((await capture({ kind: 'text', text: 'x', source: { url: 'javascript:alert(1)' } })).status).toBe(400);

  expect((await search()).length).toBe(before);
  expect((await search()).some((i) => i.text?.includes('must-never-be-saved'))).toBe(false);
});

test('a secret sent over the bridge is not saved, whatever via says, and shows nothing', async () => {
  const notifies0 = await notifies();
  for (const via of ['copy', 'context-menu']) {
    const r = await capture({ kind: 'text', text: AWS_KEY, via });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, skipped: 'secret' });
  }
  expect((await search()).some((i) => i.secret)).toBe(false);
  expect((await outcomes()).filter((o) => o === 'bridge-skipped:secret')).toHaveLength(2);
  expect(await notifies()).toBe(notifies0);
});

test('pause capture pauses the bridge too', async () => {
  await setSettings({ autoCapture: false });
  const r = await capture({ kind: 'text', text: 'sent while paused 98765' });
  expect(r.json).toEqual({ ok: true, skipped: 'paused' });
  expect((await search()).some((i) => i.text === 'sent while paused 98765')).toBe(false);
  await setSettings({ autoCapture: true });
  expect((await capture({ kind: 'text', text: 'sent after resume 98765' })).json).toMatchObject({ ok: true, deduped: false });
});

test('an image over the bridge is saved as an image item', async () => {
  const png = 'data:image/png;base64,' + (await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(8 * 8 * 4, 90), { width: 8, height: 8 }).toPNG().toString('base64')));
  const r = await capture({ kind: 'image', dataUrl: png, via: 'screenshot', source: { url: 'https://example.com/shot', title: 'Shot' } });
  expect(r.status).toBe(200);
  await expect.poll(async () => (await search()).filter((i) => i.kind === 'image').length, { timeout: 10_000 }).toBe(1);
  expect((await search()).find((i) => i.kind === 'image')).toMatchObject({ via: 'screenshot', source: { url: 'https://example.com/shot' } });
});

test('watcher first, then the extension: the source is merged and there is no second blip or tray flash', async () => {
  const text = 'ls -la /var/log/bridge-watcher-first';
  const out0 = (await outcomes()).length;
  await main((g) => g.__mouFake.writeText('ls -la /var/log/bridge-watcher-first'));
  await expect.poll(async () => (await outcomes()).slice(out0), { timeout: 15_000 }).toContain('saved:text');
  await expect.poll(() => main((g) => g.__mouPending()), { timeout: 10_000 }).toBe(0);
  const first = (await search()).find((i) => i.text === text)!;
  expect(first.source).toEqual({ title: 'FakeEditor' }); // the OS watcher only knows the app

  const n0 = await notifies();
  const r = await capture({ kind: 'text', text, via: 'copy', source: { url: 'https://example.com/guide?utm=1', title: 'Linux guide' } });
  expect(r.json).toMatchObject({ ok: true, deduped: true, id: first.id });
  expect((await outcomes()).at(-1)).toBe('bridge-saved:dup');

  const merged = (await search()).find((i) => i.text === text)!;
  expect(merged.id).toBe(first.id);
  expect(merged.source).toEqual({ url: 'https://example.com/guide', title: 'Linux guide' });
  expect((await search()).filter((i) => i.text === text)).toHaveLength(1);
  expect(await notifies()).toBe(n0); // no feedback for the duplicate
});

test('extension first, then the watcher sees the same copy: still only one blip', async () => {
  const text = 'git log --oneline bridge-extension-first';
  const n0 = await notifies();
  const r = await capture({ kind: 'text', text, via: 'copy', source: { url: 'https://example.com/git', title: 'Git book' } });
  expect(r.json).toMatchObject({ ok: true, deduped: false });
  expect(await notifies()).toBe(n0 + 1); // a genuinely new item gets its feedback

  const out0 = (await outcomes()).length;
  await main((g) => g.__mouFake.writeText('git log --oneline bridge-extension-first'));
  await expect.poll(async () => (await outcomes()).slice(out0), { timeout: 15_000 }).toContain('saved:text');
  await expect.poll(() => main((g) => g.__mouPending()), { timeout: 10_000 }).toBe(0);
  expect((await search()).filter((i) => i.text === text)).toHaveLength(1);
  expect((await search()).find((i) => i.text === text)!.source).toMatchObject({ url: 'https://example.com/git', title: 'Git book' }); // watcher's app name did not displace it
  expect(await notifies()).toBe(n0 + 1); // the watcher's dedupe within seconds is silent
});

test('Settings > Browser extension shows status and a masked token; Show reveals it; Regenerate invalidates the old one at once', async () => {
  await panel.evaluate(() => window.dispatchEvent(new CustomEvent('stash:open-settings')));
  await expect(panel.getByText('Browser extension', { exact: true })).toBeVisible();
  await expect(panel.getByText(`Listening on 127.0.0.1:${port}`)).toBeVisible();
  const code = panel.getByTestId('bridge-token');
  await expect(code).toHaveText('•'.repeat(24));
  await panel.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(code).toHaveText(token);

  const oldToken = token;
  await panel.getByRole('button', { name: 'Regenerate token' }).click();
  await panel.getByRole('button', { name: 'New token' }).click();
  await expect.poll(async () => (await bridgeInfo())!.token, { timeout: 5_000 }).not.toBe(oldToken);
  token = (await bridgeInfo())!.token;
  await expect(code).toHaveText(token);

  expect((await http({ auth: oldToken })).status).toBe(401); // the old token is dead immediately
  expect((await capture({ kind: 'text', text: 'old token capture' }, { auth: oldToken })).status).toBe(401);
  expect((await http({ auth: token })).status).toBe(200);
  expect((await search()).some((i) => i.text === 'old token capture')).toBe(false);
});

test('the port setting round-trips to the app and the server stays up (e2e runs on an OS-chosen port)', async () => {
  // re-binding to a specific port is covered by bridge-core's port tests; here e2e pins the port via env
  await setSettings({ bridgePort: 50321 });
  expect((await main((g) => g.__mouPresence()))['bridgePort']).toBe(50321);
  expect((await http({})).status).toBe(200); // the server is still up
});
