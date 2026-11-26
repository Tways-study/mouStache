import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BRIDGE_MAX_BODY, type BridgeCapture } from '@/lib/bridge';
import {
  bearer,
  createBridgeHandler,
  createRateLimiter,
  createTokenStore,
  hostAllowed,
  newToken,
  originAllowed,
  startBridgeServer,
  tokensEqual,
  type RunningBridge,
} from './bridge-core';

const TOKEN = newToken();
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: Record<string, unknown> | undefined;
}

/** Raw HTTP so tests control Host / Origin / framing exactly (fetch forbids setting those). */
function call(
  port: number,
  o: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer; auth?: string | false; chunks?: Buffer[] },
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.auth !== false) headers['Authorization'] = `Bearer ${o.auth ?? TOKEN}`;
    const req = request({ host: '127.0.0.1', port, method: o.method ?? 'GET', path: o.path ?? '/v1/ping', headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        let json: Record<string, unknown> | undefined;
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (o.chunks) {
      for (const c of o.chunks) req.write(c);
      req.end();
    } else req.end(o.body);
  });
}

const postJson = (port: number, body: unknown, headers: Record<string, string> = {}) =>
  call(port, { method: 'POST', path: '/v1/capture', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('pure helpers', () => {
  it('hostAllowed accepts only loopback names with the exact port', () => {
    expect(hostAllowed('127.0.0.1:47821', 47821)).toBe(true);
    expect(hostAllowed('localhost:47821', 47821)).toBe(true);
    for (const bad of [undefined, '', 'evil.com', 'evil.com:47821', '127.0.0.1', 'localhost', '127.0.0.1:1', '127.0.0.1.evil.com:47821', '[::1]:47821', '0.0.0.0:47821', '127.0.0.1:47821, evil.com']) {
      expect(hostAllowed(bad, 47821), String(bad)).toBe(false);
    }
  });

  it('originAllowed accepts only chrome-extension origins', () => {
    expect(originAllowed(EXT_ORIGIN)).toBe(true);
    for (const bad of ['https://evil.com', 'http://localhost:3000', 'http://127.0.0.1:47821', 'null', 'file://', 'chrome-extension://', 'chrome-extension://short', EXT_ORIGIN + '.evil.com', EXT_ORIGIN + '/', 'moz-extension://abcdefghijklmnopabcdefghijklmnop', '']) {
      expect(originAllowed(bad), bad).toBe(false);
    }
  });

  it('bearer extracts a well-formed token only', () => {
    expect(bearer(`Bearer ${TOKEN}`)).toBe(TOKEN);
    for (const bad of [undefined, '', 'Bearer', 'Bearer ', `bearer ${TOKEN}`, `Basic ${TOKEN}`, TOKEN, 'Bearer short', `Bearer ${TOKEN} extra`, 'Bearer a b']) {
      expect(bearer(bad as string | undefined), String(bad)).toBeUndefined();
    }
  });

  it('tokensEqual is exact, case sensitive, and never true for empty values', () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
    expect(tokensEqual(TOKEN, TOKEN + 'x')).toBe(false);
    expect(tokensEqual(TOKEN, TOKEN.toUpperCase())).toBe(TOKEN === TOKEN.toUpperCase());
    expect(tokensEqual('', '')).toBe(false);
    expect(tokensEqual(TOKEN, '')).toBe(false);
  });

  it('tokens are 32 random bytes, URL-safe, and unique', () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });

  it('rate limiter: burst, refill over time, independent keys', () => {
    let now = 0;
    const l = createRateLimiter({ burst: 3, perSecond: 3, now: () => now });
    expect([l.allow('a'), l.allow('a'), l.allow('a'), l.allow('a')]).toEqual([true, true, true, false]);
    expect(l.allow('b')).toBe(true);
    now = 400; // 1.2 tokens back
    expect(l.allow('a')).toBe(true);
    expect(l.allow('a')).toBe(false);
    now = 10_000; // never more than the burst
    expect([l.allow('a'), l.allow('a'), l.allow('a'), l.allow('a')]).toEqual([true, true, true, false]);
  });
});

describe('token store', () => {
  const dirs: string[] = [];
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'mou-token-'));
    dirs.push(d);
    return d;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('creates a token on first use and keeps it across restarts', () => {
    const d = dir();
    const s1 = createTokenStore(d);
    expect(s1.exists()).toBe(false);
    const t = s1.get();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createTokenStore(d).get()).toBe(t);
    expect(JSON.parse(readFileSync(join(d, 'bridge-token.json'), 'utf8')).token).toBe(t);
  });

  it('regenerate replaces the token immediately and persists it', () => {
    const d = dir();
    const s = createTokenStore(d);
    const old = s.get();
    const fresh = s.regenerate();
    expect(fresh).not.toBe(old);
    expect(s.get()).toBe(fresh);
    expect(createTokenStore(d).get()).toBe(fresh);
  });

  it('a corrupted file is replaced rather than trusted', () => {
    const d = dir();
    const s = createTokenStore(d);
    s.get();
    rmSync(join(d, 'bridge-token.json'));
    writeFileSync(join(d, 'bridge-token.json'), '{"token":"short"}');
    expect(createTokenStore(d).get()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('bridge server (real HTTP on an ephemeral 127.0.0.1 port)', () => {
  let bridge: RunningBridge;
  let now = 1_000_000;
  let token = TOKEN;
  const captured: BridgeCapture[] = [];
  let behaviour: (c: BridgeCapture) => Promise<Record<string, unknown>> = async () => ({ ok: true, id: 'abc', deduped: false });
  let port = 0;
  const logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));

  beforeAll(async () => {
    const handler = createBridgeHandler({
      getToken: () => token,
      getPort: () => port,
      version: '9.9.9',
      now: () => now,
      ratePerSecond: 5,
      bodyTimeoutMs: 300,
      onCapture: async (c) => {
        captured.push(c);
        return behaviour(c);
      },
    });
    bridge = await startBridgeServer(handler, { port: 0 });
    port = bridge.port;
  });
  afterAll(async () => {
    await bridge.close();
    logSpies.forEach((s) => s.mockRestore());
  });
  afterEach(() => {
    captured.length = 0;
    token = TOKEN;
    now += 60_000; // refill the rate limiter between tests
    behaviour = async () => ({ ok: true, id: 'abc', deduped: false });
  });

  it('binds 127.0.0.1 only', () => {
    expect((bridge.server.address() as { address: string }).address).toBe('127.0.0.1');
  });

  it('GET /v1/ping with the token answers with the app name and version', async () => {
    const r = await call(port, {});
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, app: 'mouStache', version: '9.9.9' });
  });

  it('accepts Host localhost:<port>, an absent Origin and a chrome-extension Origin', async () => {
    expect((await call(port, { headers: { Host: `localhost:${port}` } })).status).toBe(200);
    expect((await call(port, { headers: { Origin: EXT_ORIGIN } })).status).toBe(200);
  });

  describe('authentication', () => {
    it.each([
      ['no Authorization header', false as const],
      ['a wrong token', 'x'.repeat(43)],
      ['a token that is one character off', TOKEN.slice(0, -1) + (TOKEN.endsWith('A') ? 'B' : 'A')],
      ['a too-short token', 'abc'],
    ])('rejects %s with 401 and a generic body', async (_n, auth) => {
      const r = await call(port, { auth });
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ ok: false, error: 'unauthorized' });
    });

    it('does not accept the token from the query string or a different scheme', async () => {
      expect((await call(port, { auth: false, path: `/v1/ping?token=${TOKEN}` })).status).toBe(401);
      expect((await call(port, { auth: false, headers: { Authorization: `Basic ${TOKEN}` } })).status).toBe(401);
    });

    it('a regenerated token invalidates the old one immediately', async () => {
      expect((await call(port, {})).status).toBe(200);
      token = newToken();
      expect((await call(port, {})).status).toBe(401);
      expect((await call(port, { auth: token })).status).toBe(200);
    });

    it('rejects an unauthenticated capture without reading or saving anything', async () => {
      const r = await call(port, { method: 'POST', path: '/v1/capture', auth: false, headers: { 'Content-Type': 'application/json' }, body: '{"kind":"text","text":"x1"}' });
      expect(r.status).toBe(401);
      expect(captured).toHaveLength(0);
    });
  });

  describe('Host header (DNS-rebinding defence)', () => {
    it.each(['evil.com', 'evil.com:80', `evil.com:${0}`, '127.0.0.1', 'localhost', '127.0.0.1:1', '127.0.0.1.evil.com', '0.0.0.0'])('rejects Host %s with 403 even with a valid token', async (h) => {
      const host = h.endsWith(':0') ? `evil.com:${port}` : h;
      const r = await call(port, { headers: { Host: host } });
      expect(r.status).toBe(403);
      expect(r.json).toEqual({ ok: false, error: 'bad_host' });
    });
    it('also rejects a capture sent to a rebound hostname', async () => {
      const r = await postJson(port, { kind: 'text', text: 'x1' }, { Host: `rebind.example:${port}` });
      expect(r.status).toBe(403);
      expect(captured).toHaveLength(0);
    });
  });

  describe('Origin', () => {
    it.each(['https://evil.com', 'http://localhost:3000', `http://127.0.0.1:${0}`, 'null', 'file://', 'chrome-extension://short', 'moz-extension://abcdefghijklmnopabcdefghijklmnop'])(
      'rejects Origin %s even with a valid token',
      async (o) => {
        const origin = o.endsWith(':0') ? 'http://127.0.0.1:1234' : o;
        const r = await postJson(port, { kind: 'text', text: 'x1' }, { Origin: origin });
        expect(r.status).toBe(403);
        expect(r.json).toEqual({ ok: false, error: 'bad_origin' });
        expect(captured).toHaveLength(0);
      },
    );
  });

  describe('CORS', () => {
    it('answers a preflight with 403 and no CORS headers at all', async () => {
      const r = await call(port, {
        method: 'OPTIONS',
        path: '/v1/capture',
        headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      expect(r.status).toBe(403);
      expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
    });
    it('rejects a preflight even from the extension origin and with a valid token', async () => {
      const r = await call(port, { method: 'OPTIONS', path: '/v1/capture', headers: { Origin: EXT_ORIGIN } });
      expect(r.status).toBe(403);
      expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
    });
    it('never sends CORS headers on any response (success, error, or not found)', async () => {
      for (const r of [await call(port, {}), await call(port, { auth: false }), await call(port, { path: '/nope' }), await postJson(port, { kind: 'text', text: 'x1' }, { Origin: EXT_ORIGIN })]) {
        expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
        expect(r.headers['cache-control']).toBe('no-store');
        expect(r.headers['x-content-type-options']).toBe('nosniff');
      }
    });
  });

  describe('routing', () => {
    it('unknown paths are 404 and wrong methods are 405', async () => {
      expect((await call(port, { path: '/' })).status).toBe(404);
      expect((await call(port, { path: '/v1/other' })).status).toBe(404);
      expect((await call(port, { path: '/v1/capture' })).status).toBe(405);
      expect((await call(port, { method: 'POST', path: '/v1/ping', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(405);
      expect((await call(port, { method: 'DELETE', path: '/v1/capture' })).status).toBe(405);
    });
  });

  describe('POST /v1/capture', () => {
    it('saves a valid text capture and returns what the engine says', async () => {
      behaviour = async () => ({ ok: true, id: 'item-1', deduped: true });
      const r = await postJson(port, { kind: 'text', text: 'SELECT 1;', via: 'copy' }, { Origin: EXT_ORIGIN });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true, id: 'item-1', deduped: true });
      expect(captured).toEqual([{ kind: 'text', text: 'SELECT 1;', via: 'copy' }]);
    });

    it('accepts an image capture', async () => {
      const r = await postJson(port, { kind: 'image', dataUrl: PNG, via: 'screenshot' });
      expect(r.status).toBe(200);
      expect(captured[0]).toMatchObject({ kind: 'image', via: 'screenshot' });
    });

    it('strips query and hash from the page URL before the engine ever sees it', async () => {
      await postJson(port, { kind: 'text', text: 'x1', source: { url: 'https://example.com/a?access_token=SECRET#frag', title: 'T' } });
      expect(captured[0]).toMatchObject({ source: { url: 'https://example.com/a', title: 'T' } });
      expect(JSON.stringify(captured)).not.toContain('SECRET');
    });

    it('rejects a non-http(s) source URL', async () => {
      for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'data:text/html,x']) {
        const r = await postJson(port, { kind: 'text', text: 'x1', source: { url } });
        expect(r.status, url).toBe(400);
        expect(r.json).toEqual({ ok: false, error: 'bad_source' });
      }
      expect(captured).toHaveLength(0);
    });

    it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/json', ''])('rejects Content-Type %j with 415', async (ct) => {
      const r = await call(port, { method: 'POST', path: '/v1/capture', headers: ct ? { 'Content-Type': ct } : {}, body: '{"kind":"text","text":"x1"}' });
      expect(r.status).toBe(415);
      expect(captured).toHaveLength(0);
    });

    it('accepts application/json with a charset', async () => {
      const r = await call(port, { method: 'POST', path: '/v1/capture', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"kind":"text","text":"x1"}' });
      expect(r.status).toBe(200);
    });

    it.each([['{not json', 'bad_json'], ['', 'bad_json'], ['[1,2]', 'bad_body'], ['"text"', 'bad_body'], ['null', 'bad_body']])('invalid JSON %j -> 400 %s', async (body, code) => {
      const r = await call(port, { method: 'POST', path: '/v1/capture', headers: { 'Content-Type': 'application/json' }, body });
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ ok: false, error: code });
    });

    it.each([
      [{ kind: 'video' }, 'bad_kind'],
      [{ kind: 'text' }, 'bad_text'],
      [{ kind: 'text', text: 'x', extra: 1 }, 'unknown_field'],
      [{ kind: 'text', text: 'x', via: 'drag' }, 'bad_via'],
      [{ kind: 'image', dataUrl: 'data:text/html;base64,PGI+' }, 'bad_image'],
      [{ kind: 'text', text: 'a'.repeat(1_000_001) }, 'text_too_large'],
    ])('bad schema %j -> 400 %s', async (body, code) => {
      const r = await postJson(port, body);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ ok: false, error: code });
      expect(captured).toHaveLength(0);
    });

    it('413 when Content-Length already exceeds the limit (the body is never read)', async () => {
      const r = await call(port, {
        method: 'POST',
        path: '/v1/capture',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(BRIDGE_MAX_BODY + 1) },
      }).catch((e: NodeJS.ErrnoException) => ({ status: 0, text: String(e.code) }) as Res);
      expect([413, 0]).toContain(r.status); // the server may close the socket right after answering
      expect(captured).toHaveLength(0);
    });

    it('stops reading a streamed (chunked) body once the limit is exceeded and saves nothing', async () => {
      const chunk = Buffer.alloc(1_000_000, 0x61);
      const chunks = Array.from({ length: 18 }, () => chunk); // 18 MB > 15 MB, no Content-Length
      const r = await call(port, { method: 'POST', path: '/v1/capture', headers: { 'Content-Type': 'application/json' }, chunks }).catch((e: NodeJS.ErrnoException) => ({ status: 0, text: String(e.code) }) as Res);
      expect([413, 0]).toContain(r.status);
      expect(captured).toHaveLength(0);
    });

    it('408 for a client that promises a body and never sends it', async () => {
      const status = await new Promise<number>((resolve) => {
        const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/capture', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': '100' } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', () => resolve(0));
        req.write('{"kind"'); // ...and stalls
      });
      expect([408, 0]).toContain(status);
      expect(captured).toHaveLength(0);
    });
  });

  describe('rate limiting', () => {
    it('answers 429 after the burst, then recovers as time passes', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) statuses.push((await call(port, {})).status);
      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses.slice(5)).toEqual([429, 429, 429]);
      const limited = await call(port, {});
      expect(limited.json).toEqual({ ok: false, error: 'rate_limited' });
      expect(limited.headers['retry-after']).toBe('1');
      now += 1000;
      expect((await call(port, {})).status).toBe(200);
    });

    it('a flood of wrong tokens is limited separately and does not lock out the real client', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 30; i++) statuses.push((await call(port, { auth: 'y'.repeat(43) })).status);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      expect(statuses.filter((s) => s === 401).length).toBeGreaterThan(0);
      expect((await call(port, {})).status).toBe(200);
    });
  });

  describe('errors and logging', () => {
    it('an engine failure returns a fixed generic body: no message, no stack, no echo of the content', async () => {
      behaviour = async () => {
        throw new Error('database exploded while saving TOPSECRET-content at C:\\Users\\victim\\file.ts:12');
      };
      const r = await postJson(port, { kind: 'text', text: 'TOPSECRET-content' });
      expect(r.status).toBe(500);
      expect(r.text).toBe('{"ok":false,"error":"internal"}');
    });

    it('never logs captured content, tokens or errors', async () => {
      behaviour = async () => {
        throw new Error('boom');
      };
      await postJson(port, { kind: 'text', text: 'TOPSECRET-content', source: { url: 'https://a.com/?q=TOPSECRET' } });
      await postJson(port, { kind: 'text', text: 'TOPSECRET-content' }, { Origin: 'https://evil.com' });
      await call(port, { auth: TOKEN + 'x' });
      for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
    });

    it('no response ever contains the token', async () => {
      const all = [await call(port, {}), await call(port, { auth: false }), await call(port, { path: '/nope' }), await postJson(port, { kind: 'bad' })];
      for (const r of all) expect(r.text).not.toContain(TOKEN);
    });
  });
});

describe('startBridgeServer port handling', () => {
  const noop = () => undefined;
  const open: Server[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  const blocker = () =>
    new Promise<{ server: Server; port: number }>((resolve) => {
      const server = createServer(noop);
      open.push(server);
      server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
    });

  it('falls back to the next port when the preferred one is taken, and reports the one it used', async () => {
    const b = await blocker();
    const bridge = await startBridgeServer(noop, { port: b.port, tries: 4 });
    expect(bridge.port).toBeGreaterThan(b.port);
    expect(bridge.port).toBeLessThan(b.port + 4);
    await bridge.close();
  });

  it('rejects with a clear error when every candidate is taken', async () => {
    const b = await blocker();
    await expect(startBridgeServer(noop, { port: b.port, tries: 1 })).rejects.toMatchObject({
      code: 'EADDRINUSE',
      message: expect.stringContaining('in use'),
    });
  });

  it('port 0 lets the OS pick a free port', async () => {
    const bridge = await startBridgeServer(noop, { port: 0 });
    expect(bridge.port).toBeGreaterThan(1023);
    await bridge.close();
  });
});
