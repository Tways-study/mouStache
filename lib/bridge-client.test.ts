import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeBridge } from '../tests/helpers/fake-bridge-fetch';
import { _clearSessions, bridgeUrl, pingBridge, postCapture, validPort } from './bridge-client';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const TOKEN = 'k'.repeat(43);
const T = { port: 47821, token: TOKEN };
const TEXT = { kind: 'text', text: 'hi', via: 'copy' } as const;

beforeEach(() => _clearSessions());
afterEach(() => fetchMock.mockReset());

describe('bridge client', () => {
  it('only ever talks to 127.0.0.1', () => {
    expect(bridgeUrl(47821, '/v1/ping')).toBe('http://127.0.0.1:47821/v1/ping');
    expect(bridgeUrl(99 as number, '/v1/ping')).toBe('http://127.0.0.1:47821/v1/ping');
    expect(validPort(47821)).toBe(true);
    expect(validPort(80)).toBe(false);
    expect(validPort('47821')).toBe(false);
  });

  describe('Test connection (ping)', () => {
    it('shakes hands, verifies the server, then pings with a signature: Connected', async () => {
      const b = createFakeBridge({ token: TOKEN });
      fetchMock.mockImplementation(b.fetch);
      expect(await pingBridge(T)).toEqual({ status: 'connected', version: '0.0.0-fake' });
      expect(b.seen.map((r) => r.path)).toEqual(['/v1/hello', '/v1/ping']);
      expect(b.seen[0]!.headers['authorization']).toBeUndefined(); // the hello carries no credentials
      expect(b.seen[1]!.headers['x-mou-mac']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('a server that cannot prove it knows the token is reported as wrong token / not mouStache, and gets nothing more', async () => {
      const b = createFakeBridge({ token: TOKEN, squatter: true });
      fetchMock.mockImplementation(b.fetch);
      expect((await pingBridge(T)).status).toBe('wrong-token');
      expect(b.seen.map((r) => r.path)).toEqual(['/v1/hello']); // no signed request was ever made
    });

    it('a different token on the app side is the same "wrong token" result', async () => {
      const b = createFakeBridge({ token: 'z'.repeat(43) });
      fetchMock.mockImplementation(b.fetch);
      expect((await pingBridge(T)).status).toBe('wrong-token');
      expect(b.seen).toHaveLength(1);
    });

    it('not running (connection refused)', async () => {
      fetchMock.mockImplementation(createFakeBridge({ token: TOKEN, down: true }).fetch);
      expect((await pingBridge(T)).status).toBe('not-running');
    });

    it('something else on the port (not the mouStache hello shape) is not accepted', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ hello: 'someone else' }), { status: 200 }));
      expect((await pingBridge(T)).status).toBe('wrong-token');
      fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
      expect((await pingBridge(T)).status).toBe('wrong-token');
    });

    it('no token entered: no network at all', async () => {
      expect((await pingBridge({ port: 47821, token: '' })).status).toBe('wrong-token');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('the token is never on the wire', async () => {
      const b = createFakeBridge({ token: TOKEN });
      fetchMock.mockImplementation(b.fetch);
      await pingBridge(T);
      expect(b.wire()).not.toContain(TOKEN);
    });
  });

  describe('postCapture', () => {
    it('sends nothing but a nonce before the server proves itself; then one signed POST', async () => {
      const b = createFakeBridge({ token: TOKEN });
      fetchMock.mockImplementation(b.fetch);
      expect(await postCapture(T, TEXT)).toBe('sent');
      expect(b.seen.map((r) => r.path)).toEqual(['/v1/hello', '/v1/capture']);
      expect(JSON.parse(b.seen[0]!.body)).toEqual({ nonce: expect.stringMatching(/^[0-9a-f]{32}$/) });
      expect(b.captures()[0]!.json).toEqual(TEXT);
      const init = fetchMock.mock.calls[1]![1] as RequestInit;
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('error');
      expect(b.wire()).not.toContain(TOKEN);
    });

    it('reuses the session for later captures (one handshake, increasing sequence numbers)', async () => {
      const b = createFakeBridge({ token: TOKEN });
      fetchMock.mockImplementation(b.fetch);
      await postCapture(T, TEXT);
      await postCapture(T, { ...TEXT, text: 'two' });
      await postCapture(T, { ...TEXT, text: 'three' });
      expect(b.hellos()).toHaveLength(1);
      expect(b.captures().map((c) => c.headers['x-mou-seq'])).toEqual(['1', '2', '3']);
    });

    it('SQUATTER: a program on the port that answers hello as "mouStache" with a wrong proof never receives a capture or the token', async () => {
      const squatter = createFakeBridge({ token: TOKEN, squatter: true });
      fetchMock.mockImplementation(squatter.fetch);
      const secretish = { kind: 'text', text: 'SELECT secret_column FROM payroll;', via: 'copy', source: { url: 'https://intranet.example/hr', title: 'HR' } } as const;
      expect(await postCapture(T, secretish)).toBe('down');
      expect(squatter.captures()).toEqual([]);
      expect(squatter.seen).toHaveLength(1); // only the hello
      expect(squatter.seen[0]!.path).toBe('/v1/hello');
      const wire = squatter.wire();
      expect(wire).not.toContain(TOKEN);
      expect(wire).not.toContain('payroll');
      expect(wire).not.toContain('intranet.example');
      expect(JSON.stringify(squatter.seen[0]!.headers)).not.toMatch(/authorization|x-mou-mac/i);
    });

    it('a squatter that replays a proof it recorded earlier (for another nonce) is rejected too', async () => {
      const real = createFakeBridge({ token: TOKEN });
      fetchMock.mockImplementation(real.fetch);
      await pingBridge(T);
      const recorded = await (async () => {
        // capture what the real app answered to the first hello
        const r = await real.fetch(bridgeUrl(47821, '/v1/hello'), { method: 'POST', body: JSON.stringify({ nonce: 'a'.repeat(32) }) });
        return (await r.json()) as Record<string, unknown>;
      })();
      _clearSessions();
      const replayer = vi.fn(async () => new Response(JSON.stringify(recorded), { status: 200 }));
      fetchMock.mockImplementation(replayer);
      expect(await postCapture(T, TEXT)).toBe('down');
      expect(replayer).toHaveBeenCalledOnce(); // hello only
    });

    it('a lost session (app restarted) is renegotiated once, transparently', async () => {
      const b = createFakeBridge({ token: TOKEN, loseSessionOnce: true });
      fetchMock.mockImplementation(b.fetch);
      await postCapture(T, TEXT); // establishes the session... then the "app" forgets it
      // loseSessionOnce triggers on the next signed request, i.e. the first capture: it must re-handshake and still deliver
      expect(b.hellos().length).toBe(2);
      expect(b.captures().filter((c) => c.json['text'] === 'hi')).toHaveLength(2); // rejected once (401), then accepted
    });

    it.each([400, 404, 413, 415, 422])('a %d answer drops THIS capture (the app is up): "dropped", not an outage', async (status) => {
      fetchMock.mockImplementation(createFakeBridge({ token: TOKEN, captureStatus: status }).fetch);
      expect(await postCapture(T, TEXT)).toBe('dropped');
    });

    it.each([403, 429, 500, 503])('a %d answer counts as down (back off)', async (status) => {
      fetchMock.mockImplementation(createFakeBridge({ token: TOKEN, captureStatus: status }).fetch);
      expect(await postCapture(T, TEXT)).toBe('down');
    });

    it('not running, no token, and a thrown fetch never throw', async () => {
      fetchMock.mockImplementation(createFakeBridge({ token: TOKEN, down: true }).fetch);
      expect(await postCapture(T, TEXT)).toBe('down');
      expect(await postCapture({ port: 47821, token: '' }, TEXT)).toBe('down');
      fetchMock.mockRejectedValue(new Error('boom'));
      expect(await postCapture(T, TEXT)).toBe('down');
    });

    it('times out instead of hanging', async () => {
      fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
      expect(await postCapture(T, TEXT, 30)).toBe('down');
    });
  });
});
