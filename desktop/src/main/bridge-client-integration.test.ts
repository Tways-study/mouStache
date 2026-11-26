// @vitest-environment node
/**
 * The extension's real client (lib/bridge-client.ts, real fetch) against the real bridge server and against a real
 * squatter, all over actual sockets on 127.0.0.1. This is the end-to-end proof for the security review's F1.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BridgeCapture } from '@/lib/bridge';
import { randomHex } from '@/lib/bridge-auth';
import { _clearSessions, pingBridge, postCapture } from '@/lib/bridge-client';
import { createBridgeHandler, newToken, startBridgeServer, type RunningBridge } from './bridge-core';

const TEXT: BridgeCapture = { kind: 'text', text: 'SELECT name FROM students;', via: 'copy', source: { url: 'https://example.com/lab', title: 'Lab' } };

describe('real client <-> real bridge server', () => {
  let bridge: RunningBridge;
  let token = newToken();
  let port = 0;
  const captured: BridgeCapture[] = [];

  beforeAll(async () => {
    bridge = await startBridgeServer(
      createBridgeHandler({
        getToken: () => token,
        getPort: () => port,
        version: '1.2.3',
        onCapture: async (c) => {
          captured.push(c);
          return { ok: true, id: 'x' };
        },
      }),
      { port: 0 },
    );
    port = bridge.port;
  });
  afterAll(() => bridge.close());
  afterEach(() => {
    captured.length = 0;
    token = newToken();
    _clearSessions();
  });

  it('Test connection says Connected and reports the app version', async () => {
    expect(await pingBridge({ port, token })).toEqual({ status: 'connected', version: '1.2.3' });
  });

  it('delivers captures, reusing one session', async () => {
    expect(await postCapture({ port, token }, TEXT)).toBe('sent');
    expect(await postCapture({ port, token }, { ...TEXT, text: 'second one' })).toBe('sent');
    expect(captured.map((c) => (c.kind === 'text' ? c.text : ''))).toEqual(['SELECT name FROM students;', 'second one']);
    expect(captured[0]).toMatchObject({ source: { url: 'https://example.com/lab', title: 'Lab' } });
  });

  it('a client with the WRONG token refuses the server (cannot verify its proof): wrong token, nothing delivered', async () => {
    const wrong = newToken();
    expect((await pingBridge({ port, token: wrong })).status).toBe('wrong-token');
    expect(await postCapture({ port, token: wrong }, TEXT)).toBe('down');
    expect(captured).toEqual([]);
  });

  it('after the app regenerates its token, a client still holding the old one stops delivering at once', async () => {
    const old = token;
    expect(await postCapture({ port, token: old }, TEXT)).toBe('sent');
    token = newToken();
    expect(await postCapture({ port, token: old }, { ...TEXT, text: 'after regenerate' })).toBe('down');
    expect(captured.map((c) => (c.kind === 'text' ? c.text : ''))).toEqual(['SELECT name FROM students;']);
    expect(await postCapture({ port, token }, { ...TEXT, text: 'with the new token' })).toBe('sent');
  });
});

describe('real client <-> a program squatting the port (does not know the token)', () => {
  let squatter: Server;
  let port = 0;
  const requests: { method?: string; url?: string; headers: Record<string, unknown>; body: string }[] = [];
  const TOKEN = newToken();

  beforeAll(async () => {
    squatter = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, headers: { ...req.headers }, body: Buffer.concat(chunks).toString('utf8') });
        res.setHeader('Content-Type', 'application/json');
        // pretends to be mouStache; it cannot compute HMAC(token, ...) so the proof is made up
        res.end(JSON.stringify({ ok: true, app: 'mouStache', version: '9', session: randomHex(16), serverNonce: randomHex(16), proof: randomHex(32) }));
      });
    });
    await new Promise<void>((r) => squatter.listen(0, '127.0.0.1', r));
    port = (squatter.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => squatter.close(() => r())));
  afterEach(() => {
    requests.length = 0;
    _clearSessions();
  });

  it('never receives a capture body, any signature, or the token', async () => {
    const secretish: BridgeCapture = { kind: 'text', text: 'SELECT salary FROM payroll_squatter_target;', via: 'copy', source: { url: 'https://hr.example/pay', title: 'Payroll' } };
    expect(await postCapture({ port, token: TOKEN }, secretish)).toBe('down');
    expect((await pingBridge({ port, token: TOKEN })).status).toBe('wrong-token');

    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.url).toBe('/v1/hello'); // nothing but handshakes
      expect(Object.keys(r.headers).filter((h) => /^x-mou-|^authorization$/.test(h))).toEqual([]);
      expect(JSON.parse(r.body)).toEqual({ nonce: expect.stringMatching(/^[0-9a-f]{32}$/) });
    }
    const everything = JSON.stringify(requests);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('payroll_squatter_target');
    expect(everything).not.toContain('hr.example');
  });
});
