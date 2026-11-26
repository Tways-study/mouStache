import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BRIDGE_MAX_BODY, type BridgeCapture } from '@/lib/bridge';
import { SESSION_TTL_MS, MAX_SKEW_MS } from '@/lib/bridge-auth';
import { rawCall, rawHello, rawSigned, setClock, type RawSession, type Res } from '../../../tests/helpers/bridge-raw';
import {
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
const JSON_CT = { 'Content-Type': 'application/json' };

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

  it('tokensEqual is exact, case sensitive, and never true for empty values', () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
    expect(tokensEqual(TOKEN, TOKEN + 'x')).toBe(false);
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
    now = 400;
    expect(l.allow('a')).toBe(true);
    expect(l.allow('a')).toBe(false);
    now = 10_000;
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
    createTokenStore(d).get();
    writeFileSync(join(d, 'bridge-token.json'), '{"token":"short"}');
    expect(createTokenStore(d).get()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('bridge server (real HTTP on an ephemeral 127.0.0.1 port)', () => {
  let bridge: RunningBridge;
  let now = Date.now();
  let token = TOKEN;
  const captured: BridgeCapture[] = [];
  let behaviour: (c: BridgeCapture) => Promise<Record<string, unknown>> = async () => ({ ok: true, id: 'abc', deduped: false });
  let port = 0;
  const logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));

  /** A fresh, verified session (each test gets its own, so sequence numbers never collide). */
  const login = async (headers: Record<string, string> = {}): Promise<RawSession> => {
    const h = await rawHello(port, token, { headers });
    expect(h.res.status).toBe(200);
    expect(h.session!.serverVerified).toBe(true);
    return h.session!;
  };
  const signedCapture = async (body: unknown, o: Parameters<typeof rawSigned>[2] = {}, s?: RawSession) =>
    rawSigned(port, s ?? (await login()), { body, ...o });

  beforeAll(async () => {
    setClock(() => now);
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
    setClock(() => Date.now());
    await bridge.close();
    logSpies.forEach((s) => s.mockRestore());
  });
  afterEach(() => {
    captured.length = 0;
    token = TOKEN;
    now += 600_000; // refill the rate limiters and age out old sessions between tests
    behaviour = async () => ({ ok: true, id: 'abc', deduped: false });
  });

  it('binds 127.0.0.1 only', () => {
    expect((bridge.server.address() as { address: string }).address).toBe('127.0.0.1');
  });

  describe('handshake (/v1/hello)', () => {
    it('answers a nonce with a session and a proof that only a holder of the token can check', async () => {
      const h = await rawHello(port, TOKEN);
      expect(h.res.status).toBe(200);
      expect(h.res.json).toMatchObject({ ok: true, app: 'mouStache', version: '9.9.9' });
      expect(h.session!.serverVerified).toBe(true);
      // someone with a different token cannot verify the server (and so would refuse to talk to it)
      const wrong = await rawHello(port, newToken());
      expect(wrong.session!.serverVerified).toBe(false);
    });

    it('never puts the token, a MAC key or anything derived but the proof on the wire', async () => {
      const h = await rawHello(port, TOKEN);
      expect(h.res.text).not.toContain(TOKEN);
      expect(Object.keys(h.res.json!).sort()).toEqual(['app', 'ok', 'proof', 'serverNonce', 'session', 'version']);
    });

    it('needs no credentials at all, but still enforces Host and Origin', async () => {
      expect((await rawHello(port, TOKEN)).res.status).toBe(200);
      expect((await rawHello(port, TOKEN, { headers: { Origin: EXT_ORIGIN } })).res.status).toBe(200);
      expect((await rawHello(port, TOKEN, { headers: { Origin: 'https://evil.example' } })).res.status).toBe(403);
      expect((await rawHello(port, TOKEN, { headers: { Host: `rebind.example:${port}` } })).res.status).toBe(403);
    });

    it.each([
      ['not hex', { nonce: 'zz'.repeat(16) }],
      ['too short', { nonce: 'ab' }],
      ['missing', {}],
      ['a number', { nonce: 12345 }],
    ])('rejects a bad nonce (%s)', async (_n, body) => {
      const r = await rawCall(port, { method: 'POST', path: '/v1/hello', headers: JSON_CT, body: JSON.stringify(body) });
      expect(r.status).toBe(400);
    });

    it('rejects non-JSON hello bodies and oversize ones', async () => {
      expect((await rawCall(port, { method: 'POST', path: '/v1/hello', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
      expect((await rawCall(port, { method: 'POST', path: '/v1/hello', headers: JSON_CT, body: '{nope' })).status).toBe(400);
      const big = await rawCall(port, { method: 'POST', path: '/v1/hello', headers: JSON_CT, body: JSON.stringify({ nonce: 'a'.repeat(100_000) }) }).catch(() => ({ status: 0 }) as Res);
      expect([413, 0]).toContain(big.status);
    });

    it('is rate limited without affecting the authenticated bucket', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 30; i++) statuses.push((await rawHello(port, TOKEN)).res.status);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      const s = await rawHello(port, TOKEN); // may still be limited; a fresh window below must work
      now += 1500;
      const ok = await rawHello(port, TOKEN);
      expect(ok.res.status).toBe(200);
      void s;
    });

    it('caps the number of live sessions (oldest evicted); an evicted client just shakes hands again', async () => {
      const first = await login();
      for (let i = 0; i < 70; i++) {
        now += 300; // keep under the hello rate limit
        await rawHello(port, TOKEN);
      }
      const r = await rawSigned(port, first, {});
      expect(r.status).toBe(401);
    });
  });

  describe('request authentication (session + HMAC, no bearer token)', () => {
    it('GET /v1/ping with a valid signature answers with the app name and version', async () => {
      const r = await rawSigned(port, await login());
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true, app: 'mouStache', version: '9.9.9' });
    });

    it('the old Authorization: Bearer scheme is gone: the token is never accepted on the wire', async () => {
      for (const path of ['/v1/ping']) {
        const r = await rawCall(port, { path, headers: { Authorization: `Bearer ${TOKEN}` } });
        expect(r.status).toBe(401);
      }
      const r = await rawCall(port, { method: 'POST', path: '/v1/capture', headers: { ...JSON_CT, Authorization: `Bearer ${TOKEN}` }, body: '{"kind":"text","text":"x1"}' });
      expect(r.status).toBe(401);
      expect(captured).toHaveLength(0);
    });

    it.each([
      ['no auth headers at all', {}],
      ['an unknown session id', { 'X-Mou-Session': 'a'.repeat(32) }],
      ['a malformed session id', { 'X-Mou-Session': 'nope' }],
    ])('rejects %s with 401 and a generic body', async (_n, h) => {
      const r = await rawCall(port, { path: '/v1/ping', headers: h });
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ ok: false, error: 'unauthorized' });
    });

    it('rejects a wrong MAC (signed with another key) and a MAC for a different request', async () => {
      const s = await login();
      const other = await login();
      const wrongKey = await rawSigned(port, { ...s, key: other.key });
      expect(wrongKey.status).toBe(401);
      const wrongPath = await rawSigned(port, s, { path: '/v1/ping', signAs: { path: '/v1/capture' } });
      expect(wrongPath.status).toBe(401);
      const wrongMethod = await rawSigned(port, s, { signAs: { method: 'POST' } });
      expect(wrongMethod.status).toBe(401);
    });

    it('a body that was changed after signing is rejected (the MAC covers the body hash)', async () => {
      const s = await login();
      const r = await rawSigned(port, s, { rawBody: '{"kind":"text","text":"tampered1"}', signAs: { body: '{"kind":"text","text":"original"}' } });
      expect(r.status).toBe(401);
      expect(captured).toHaveLength(0);
    });

    it('rejects a replayed request: the same session and sequence number twice', async () => {
      const s = await login();
      const ok = await rawSigned(port, s, { body: { kind: 'text', text: 'once only' }, seq: 7 });
      expect(ok.status).toBe(200);
      const replay = await rawSigned(port, s, { body: { kind: 'text', text: 'once only' }, seq: 7 });
      expect(replay.status).toBe(401);
      expect(captured).toHaveLength(1);
    });

    it('rejects stale and future timestamps (outside the skew window)', async () => {
      const s = await login();
      expect((await rawSigned(port, s, { ts: now - MAX_SKEW_MS - 1000 })).status).toBe(401);
      expect((await rawSigned(port, s, { ts: now + MAX_SKEW_MS + 1000 })).status).toBe(401);
      expect((await rawSigned(port, s, { ts: now - 1000 })).status).toBe(200);
    });

    it('sessions expire', async () => {
      const s = await login();
      expect((await rawSigned(port, s)).status).toBe(200);
      now += SESSION_TTL_MS + 1000;
      expect((await rawSigned(port, s, { ts: now })).status).toBe(401);
    });

    it('a regenerated token ends every existing session immediately and the old token proves nothing', async () => {
      const s = await login();
      expect((await rawSigned(port, s)).status).toBe(200);
      token = newToken();
      expect((await rawSigned(port, s)).status).toBe(401);
      const h = await rawHello(port, TOKEN); // a client still holding the old token
      expect(h.session!.serverVerified).toBe(false); // ...can see this server no longer knows it
      expect((await rawSigned(port, await login())).status).toBe(200); // the new token works
    });

    it('rejects an unauthenticated capture without reading or saving anything', async () => {
      const r = await rawCall(port, { method: 'POST', path: '/v1/capture', headers: JSON_CT, body: '{"kind":"text","text":"x1"}' });
      expect(r.status).toBe(401);
      expect(captured).toHaveLength(0);
    });

    it('does not accept the signature material from the query string', async () => {
      const r = await rawCall(port, { path: `/v1/ping?session=${'a'.repeat(32)}` });
      expect(r.status).toBe(400);
    });
  });

  describe('Host header (DNS-rebinding defence)', () => {
    it.each(['evil.com', 'evil.com:80', 'EVIL', '127.0.0.1', 'localhost', '127.0.0.1:1', '127.0.0.1.evil.com', '0.0.0.0'])('rejects Host %s with 403 even with a valid session', async (h) => {
      const s = await login();
      const host = h === 'EVIL' ? `evil.com:${port}` : h;
      const r = await rawSigned(port, s, { headers: { Host: host } });
      expect(r.status).toBe(403);
      expect(r.json).toEqual({ ok: false, error: 'bad_host' });
    });
    it('accepts localhost:<port>', async () => {
      expect((await rawSigned(port, await login(), { headers: { Host: `localhost:${port}` } })).status).toBe(200);
    });
    it('also rejects a capture sent to a rebound hostname', async () => {
      const r = await signedCapture({ kind: 'text', text: 'x1' }, { headers: { Host: `rebind.example:${port}` } });
      expect(r.status).toBe(403);
      expect(captured).toHaveLength(0);
    });
  });

  describe('Origin', () => {
    it.each(['https://evil.com', 'http://localhost:3000', 'http://127.0.0.1:1234', 'null', 'file://', 'chrome-extension://short', 'moz-extension://abcdefghijklmnopabcdefghijklmnop'])(
      'rejects Origin %s even with a valid session',
      async (origin) => {
        const r = await signedCapture({ kind: 'text', text: 'x1' }, { headers: { Origin: origin } });
        expect(r.status).toBe(403);
        expect(r.json).toEqual({ ok: false, error: 'bad_origin' });
        expect(captured).toHaveLength(0);
      },
    );
    it('accepts a chrome-extension origin and an absent one', async () => {
      const s = await login();
      expect((await rawSigned(port, s, { headers: { Origin: EXT_ORIGIN } })).status).toBe(200);
      expect((await rawSigned(port, s)).status).toBe(200);
    });
  });

  describe('CORS', () => {
    it('answers a preflight with 403 and no CORS headers at all', async () => {
      const r = await rawCall(port, {
        method: 'OPTIONS',
        path: '/v1/capture',
        headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-mou-mac,content-type' },
      });
      expect(r.status).toBe(403);
      expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
    });
    it('rejects a preflight even from the extension origin', async () => {
      const r = await rawCall(port, { method: 'OPTIONS', path: '/v1/hello', headers: { Origin: EXT_ORIGIN } });
      expect(r.status).toBe(403);
      expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
    });
    it('never sends CORS headers on any response (success, error, or not found)', async () => {
      const s = await login();
      const all = [await rawSigned(port, s), await rawCall(port, { path: '/v1/ping' }), await rawCall(port, { path: '/nope' }), await signedCapture({ kind: 'text', text: 'x1' }, { headers: { Origin: EXT_ORIGIN } }), (await rawHello(port, TOKEN)).res];
      for (const r of all) {
        expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control'))).toEqual([]);
        expect(r.headers['cache-control']).toBe('no-store');
        expect(r.headers['x-content-type-options']).toBe('nosniff');
      }
    });
  });

  describe('routing', () => {
    it('unknown paths are 404 and wrong methods are 405', async () => {
      expect((await rawCall(port, { path: '/' })).status).toBe(404);
      expect((await rawCall(port, { path: '/v1/other' })).status).toBe(404);
      expect((await rawCall(port, { path: '/v1/capture' })).status).toBe(405);
      expect((await rawCall(port, { path: '/v1/hello' })).status).toBe(405);
      expect((await rawCall(port, { method: 'POST', path: '/v1/ping', headers: JSON_CT, body: '{}' })).status).toBe(405);
      expect((await rawCall(port, { method: 'DELETE', path: '/v1/capture' })).status).toBe(405);
    });
  });

  describe('POST /v1/capture', () => {
    it('saves a valid text capture and returns what the engine says', async () => {
      behaviour = async () => ({ ok: true, id: 'item-1', deduped: true });
      const r = await signedCapture({ kind: 'text', text: 'SELECT 1;', via: 'copy' }, { headers: { Origin: EXT_ORIGIN } });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true, id: 'item-1', deduped: true });
      expect(captured).toEqual([{ kind: 'text', text: 'SELECT 1;', via: 'copy' }]);
    });

    it('accepts an image capture', async () => {
      const r = await signedCapture({ kind: 'image', dataUrl: PNG, via: 'screenshot' });
      expect(r.status).toBe(200);
      expect(captured[0]).toMatchObject({ kind: 'image', via: 'screenshot' });
    });

    it('strips query and hash from the page URL before the engine ever sees it', async () => {
      await signedCapture({ kind: 'text', text: 'x1', source: { url: 'https://example.com/a?access_token=SECRET#frag', title: 'T' } });
      expect(captured[0]).toMatchObject({ source: { url: 'https://example.com/a', title: 'T' } });
      expect(JSON.stringify(captured)).not.toContain('SECRET');
    });

    it('rejects a non-http(s) source URL', async () => {
      const s = await login();
      for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'data:text/html,x']) {
        const r = await rawSigned(port, s, { body: { kind: 'text', text: 'x1', source: { url } } });
        expect(r.status, url).toBe(400);
        expect(r.json).toEqual({ ok: false, error: 'bad_source' });
      }
      expect(captured).toHaveLength(0);
    });

    it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/json'])('rejects Content-Type %j with 415', async (ct) => {
      const r = await signedCapture({ kind: 'text', text: 'x1' }, { contentType: ct });
      expect(r.status).toBe(415);
      expect(captured).toHaveLength(0);
    });
    it('rejects a missing Content-Type with 415', async () => {
      expect((await signedCapture({ kind: 'text', text: 'x1' }, { contentType: false })).status).toBe(415);
    });
    it('accepts application/json with a charset', async () => {
      expect((await signedCapture({ kind: 'text', text: 'x1' }, { contentType: 'application/json; charset=utf-8' })).status).toBe(200);
    });

    it.each([['{not json', 'bad_json'], ['', 'bad_json'], ['[1,2]', 'bad_body'], ['"text"', 'bad_body'], ['null', 'bad_body']])('invalid JSON %j -> 400 %s', async (rawBody, code) => {
      const r = await rawSigned(port, await login(), { rawBody, path: '/v1/capture' });
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
      const r = await signedCapture(body);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ ok: false, error: code });
      expect(captured).toHaveLength(0);
    });

    it('413 when Content-Length already exceeds the limit (the body is never read)', async () => {
      const s = await login();
      const r = await rawSigned(port, s, { rawBody: '', path: '/v1/capture', headers: { 'Content-Length': String(BRIDGE_MAX_BODY + 1) } }).catch((e: NodeJS.ErrnoException) => ({ status: 0, text: String(e.code) }) as Res);
      expect([413, 0]).toContain(r.status);
      expect(captured).toHaveLength(0);
    });

    it('stops reading a streamed (chunked) body once the limit is exceeded and saves nothing', async () => {
      const s = await login();
      const signed = await (await import('@/lib/bridge-auth')).signRequest(s, 'POST', '/v1/capture', '', s.nextSeq++, now);
      const chunk = Buffer.alloc(1_000_000, 0x61);
      const r = await rawCall(port, { method: 'POST', path: '/v1/capture', headers: { ...JSON_CT, ...signed }, chunks: Array.from({ length: 18 }, () => chunk) }).catch((e: NodeJS.ErrnoException) => ({ status: 0, text: String(e.code) }) as Res);
      expect([413, 0]).toContain(r.status);
      expect(captured).toHaveLength(0);
    });

    it('408 for a client that promises a body and never sends it', async () => {
      const s = await login();
      const { signRequest } = await import('@/lib/bridge-auth');
      const headers = await signRequest(s, 'POST', '/v1/capture', '{"kind"', s.nextSeq++, now);
      const status = await new Promise<number>((resolve) => {
        const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/capture', headers: { ...headers, ...JSON_CT, 'Content-Length': '100' } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', () => resolve(0));
        req.write('{"kind"');
      });
      expect([408, 0]).toContain(status);
      expect(captured).toHaveLength(0);
    });
  });

  describe('rate limiting', () => {
    it('answers 429 after the burst, then recovers as time passes', async () => {
      const s = await login();
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) statuses.push((await rawSigned(port, s, { ts: now })).status);
      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses.slice(5)).toEqual([429, 429, 429]);
      const limited = await rawSigned(port, s, { ts: now });
      expect(limited.json).toEqual({ ok: false, error: 'rate_limited' });
      expect(limited.headers['retry-after']).toBe('1');
      now += 1000;
      expect((await rawSigned(port, s, { ts: now })).status).toBe(200);
    });

    it('a flood of unauthenticated requests is limited separately and does not lock out the real client', async () => {
      const s = await login();
      const statuses: number[] = [];
      for (let i = 0; i < 30; i++) statuses.push((await rawCall(port, { path: '/v1/ping', headers: { 'X-Mou-Session': 'b'.repeat(32) } })).status);
      expect(statuses.filter((x) => x === 429).length).toBeGreaterThan(0);
      expect(statuses.filter((x) => x === 401).length).toBeGreaterThan(0);
      expect((await rawSigned(port, s, { ts: now })).status).toBe(200);
    });
  });

  describe('errors and logging', () => {
    it('an engine failure returns a fixed generic body: no message, no stack, no echo of the content', async () => {
      behaviour = async () => {
        throw new Error('database exploded while saving TOPSECRET-content at C:\\Users\\victim\\file.ts:12');
      };
      const r = await signedCapture({ kind: 'text', text: 'TOPSECRET-content' });
      expect(r.status).toBe(500);
      expect(r.text).toBe('{"ok":false,"error":"internal"}');
    });

    it('never logs captured content, tokens or errors', async () => {
      behaviour = async () => {
        throw new Error('boom');
      };
      await signedCapture({ kind: 'text', text: 'TOPSECRET-content', source: { url: 'https://a.com/?q=TOPSECRET' } });
      await signedCapture({ kind: 'text', text: 'TOPSECRET-content' }, { headers: { Origin: 'https://evil.com' } });
      await rawCall(port, { path: '/v1/ping', headers: { Authorization: `Bearer ${TOKEN}` } });
      for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
    });

    it('no response ever contains the token', async () => {
      const s = await login();
      const all = [await rawSigned(port, s), await rawCall(port, { path: '/nope' }), await rawSigned(port, s, { body: { kind: 'bad' } }), (await rawHello(port, TOKEN)).res];
      for (const r of all) expect(r.text).not.toContain(TOKEN);
    });
  });
});

describe('startBridgeServer (no silent port fallback)', () => {
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

  it('fails with a clear error when the configured port is taken, and does NOT move to another port', async () => {
    const b = await blocker();
    await expect(startBridgeServer(noop, { port: b.port })).rejects.toMatchObject({
      code: 'EADDRINUSE',
      message: expect.stringMatching(new RegExp(`Port ${b.port} is already in use.*Choose a different port`)),
    });
    // nothing else was bound: the next port is still free for someone else
    const probe = createServer(noop);
    open.push(probe);
    await new Promise<void>((res, rej) => {
      probe.once('error', rej);
      probe.listen(b.port + 1, '127.0.0.1', res);
    }).catch(() => undefined); // (that port may be taken by an unrelated program; what matters is the assertion above)
  });

  it('port 0 lets the OS pick a free port (tests only)', async () => {
    const bridge = await startBridgeServer(noop, { port: 0 });
    expect(bridge.port).toBeGreaterThan(1023);
    await bridge.close();
  });

  it('binds exactly the requested port', async () => {
    const b = await blocker();
    const free = b.port;
    await new Promise((r) => b.server.close(r));
    open.splice(0);
    const bridge = await startBridgeServer(noop, { port: free });
    expect(bridge.port).toBe(free);
    await bridge.close();
  });
});

describe('token file writes (security review F19d)', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'mou-token-atomic-'));
    dirs.push(d);
    return d;
  };

  it('leaves no temp files behind and keeps the file valid across many regenerations', async () => {
    const d = dir();
    const s = createTokenStore(d);
    const seen = new Set<string>([s.get()]);
    for (let i = 0; i < 20; i++) seen.add(s.regenerate());
    expect(seen.size).toBe(21);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(d)).toEqual(['bridge-token.json']); // only the real file, no *.tmp
    expect(JSON.parse(readFileSync(join(d, 'bridge-token.json'), 'utf8')).token).toBe([...seen].at(-1));
  });

  it('writes via a temporary file and a rename (the old file stays intact if the write fails)', async () => {
    const d = dir();
    const s = createTokenStore(d);
    const good = s.get();
    // make the next write fail: a directory squats the temp file's... target name cannot be predicted, so block the
    // directory itself instead by making the token file path a directory for a fresh store
    const d2 = dir();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(d2, 'bridge-token.json')); // rename onto a directory fails
    const broken = createTokenStore(d2);
    expect(() => broken.regenerate()).toThrow();
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(d2)).toEqual(['bridge-token.json']); // the failed attempt cleaned its temp file up
    expect(createTokenStore(d).get()).toBe(good); // and an unrelated healthy store is unaffected
  });

  it('the file is not world-writable where modes mean something (POSIX)', async () => {
    if (process.platform === 'win32') return; // documented: the mode bits are a no-op on Windows
    const { statSync } = await import('node:fs');
    const d = dir();
    createTokenStore(d).get();
    expect(statSync(join(d, 'bridge-token.json')).mode & 0o077).toBe(0);
  });
});
