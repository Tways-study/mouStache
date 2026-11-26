/**
 * The extension -> desktop bridge: an HTTP server on 127.0.0.1 only. Electron-free (node:http only) so the whole
 * thing is unit- and integration-testable under plain Node. Wiring to the engine lives in bridge.ts.
 *
 * Every request must pass, in this order:
 *   Host is 127.0.0.1:<port> or localhost:<port>      (DNS-rebinding defence)
 *   not an OPTIONS/CORS preflight                      (403, and no CORS headers are ever sent)
 *   Origin absent or chrome-extension://<id>           (no web page can call this, even with the token)
 *   known route                                        (GET /v1/ping, POST /v1/capture)
 *   rate limit, then Authorization: Bearer <token>     (constant-time compare)
 *   Content-Type application/json, body within limits  (enforced while streaming)
 *   strict schema validation (lib/bridge.ts)
 * Error bodies are fixed short codes: no stack traces, no echo of the request, and captured content is never logged.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { BRIDGE_MAX_BODY, BRIDGE_PORT_TRIES, validateCapture, type BridgeCapture, type BridgePing } from '@/lib/bridge';

// ---------------------------------------------------------------- token

/** 32 random bytes, URL-safe. */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** Constant-time comparison (both sides hashed first so the lengths always match). */
export function tokensEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length > 0 && b.length > 0;
}

/** The pairing token lives in userData; created on first run, replaced on "Regenerate". */
export function createTokenStore(dir: string) {
  const file = join(dir, 'bridge-token.json');
  let token: string | undefined;
  const load = (): string => {
    try {
      const t = (JSON.parse(readFileSync(file, 'utf8')) as { token?: unknown }).token;
      if (typeof t === 'string' && t.length >= 32) return t;
    } catch {
      /* first run or unreadable: make a new one */
    }
    return save(newToken());
  };
  const save = (t: string): string => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ token: t }), { mode: 0o600 });
    return t;
  };
  return {
    get: (): string => (token ??= load()),
    /** Replace the token; the old one stops working immediately (the handler reads `get()` on every request). */
    regenerate: (): string => (token = save(newToken())),
    exists: () => existsSync(file),
  };
}

// ---------------------------------------------------------------- checks

export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** Only browser-extension origins. A web page's origin (http, https, file, null, ...) is never accepted. */
export function originAllowed(origin: string): boolean {
  return /^chrome-extension:\/\/[a-z]{32}$/.test(origin);
}

export function bearer(header: string | undefined): string | undefined {
  const m = /^Bearer ([A-Za-z0-9_-]{16,200})$/.exec(header ?? '');
  return m?.[1];
}

/** Token bucket per key. `now` is injectable for tests. */
export function createRateLimiter(o: { burst: number; perSecond: number; now?: () => number }) {
  const now = o.now ?? Date.now;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    allow(key: string): boolean {
      const t = now();
      const b = buckets.get(key) ?? { tokens: o.burst, at: t };
      b.tokens = Math.min(o.burst, b.tokens + ((t - b.at) / 1000) * o.perSecond);
      b.at = t;
      buckets.set(key, b);
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
  };
}

// ---------------------------------------------------------------- handler

export interface BridgeHandlerOptions {
  getToken(): string;
  /** The port the server is actually listening on (Host header must match it). */
  getPort(): number;
  version: string;
  /** Save a validated capture; resolves with the JSON the client gets back. Must not throw for "skipped". */
  onCapture(c: BridgeCapture): Promise<Record<string, unknown>>;
  now?: () => number;
  /** Authenticated requests per second (burst equals this). */
  ratePerSecond?: number;
  bodyTimeoutMs?: number;
}

const ERRORS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  408: 'timeout',
  413: 'too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
  500: 'internal',
};

function send(res: ServerResponse, status: number, body: Record<string, unknown> | undefined, extra: Record<string, string> = {}) {
  if (res.headersSent) return;
  const payload = JSON.stringify(body ?? { ok: false, error: ERRORS[status] ?? 'error' });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(payload);
}
const fail = (res: ServerResponse, status: number, code?: string, extra?: Record<string, string>) =>
  send(res, status, { ok: false, error: code ?? ERRORS[status] ?? 'error' }, extra);

type BodyResult = { ok: true; body: Buffer } | { ok: false; reason: 'too_large' | 'timeout' | 'aborted' };

/** Read the body, stopping as soon as `max` bytes are exceeded (the rest is never buffered). */
function readBody(req: IncomingMessage, max: number, timeoutMs: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (r: BodyResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onErr);
      req.off('aborted', onErr);
      resolve(r);
    };
    const onData = (c: Buffer) => {
      size += c.length;
      if (size > max) return finish({ ok: false, reason: 'too_large' });
      chunks.push(c);
    };
    const onEnd = () => finish({ ok: true, body: Buffer.concat(chunks) });
    const onErr = () => finish({ ok: false, reason: 'aborted' });
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onErr);
    req.on('aborted', onErr);
  });
}

export function createBridgeHandler(o: BridgeHandlerOptions) {
  const limiterAuthed = createRateLimiter({ burst: o.ratePerSecond ?? 30, perSecond: o.ratePerSecond ?? 30, now: o.now });
  const limiterAnon = createRateLimiter({ burst: 20, perSecond: 5, now: o.now }); // wrong/missing tokens
  const bodyTimeout = o.bodyTimeoutMs ?? 8000;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req.headers.host, o.getPort())) return fail(res, 403, 'bad_host');
    if (req.method === 'OPTIONS') return fail(res, 403, 'forbidden'); // CORS preflight: never answered, no CORS headers
    const origin = req.headers.origin;
    if (origin !== undefined && !originAllowed(origin)) return fail(res, 403, 'bad_origin');

    const path = (req.url ?? '').split('?')[0];
    const route = path === '/v1/ping' ? 'ping' : path === '/v1/capture' ? 'capture' : undefined;
    if (!route) return fail(res, 404);
    if ((route === 'ping' && req.method !== 'GET') || (route === 'capture' && req.method !== 'POST')) {
      return fail(res, 405, undefined, { Allow: route === 'ping' ? 'GET' : 'POST' });
    }

    const presented = bearer(req.headers.authorization);
    const authed = presented !== undefined && tokensEqual(presented, o.getToken());
    if (!(authed ? limiterAuthed : limiterAnon).allow(authed ? 'token' : 'anon')) {
      return fail(res, 429, undefined, { 'Retry-After': '1' });
    }
    if (!authed) return fail(res, 401);

    if (route === 'ping') {
      return send(res, 200, { ok: true, app: 'mouStache', version: o.version } satisfies BridgePing);
    }

    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json') return fail(res, 415);
    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > BRIDGE_MAX_BODY) {
      res.setHeader('Connection', 'close');
      fail(res, 413);
      res.once('finish', () => req.destroy());
      return;
    }

    const got = await readBody(req, BRIDGE_MAX_BODY, bodyTimeout);
    if (!got.ok) {
      if (got.reason === 'aborted') return void req.destroy();
      res.setHeader('Connection', 'close');
      fail(res, got.reason === 'too_large' ? 413 : 408);
      res.once('finish', () => req.destroy());
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(got.body.toString('utf8'));
    } catch {
      return fail(res, 400, 'bad_json');
    }
    const v = validateCapture(json);
    if (!v.ok) return fail(res, 400, v.error);

    try {
      send(res, 200, await o.onCapture(v.value));
    } catch {
      fail(res, 500); // generic: nothing about the capture or the failure leaks
    }
  }

  return (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res).catch(() => fail(res, 500));
  };
}

// ---------------------------------------------------------------- server

export interface RunningBridge {
  server: Server;
  /** The port it actually bound (may differ from the preferred one). */
  port: number;
  close(): Promise<void>;
}

export type BridgeListenError = { code: string; message: string };

/**
 * Listen on 127.0.0.1 ONLY. If the preferred port is taken, try the next few (`tries` in total). `port: 0` asks
 * the OS for a free one (tests). Rejects with {code,message} when nothing could be bound.
 */
export async function startBridgeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  opts: { port: number; tries?: number },
): Promise<RunningBridge> {
  const tries = opts.port === 0 ? 1 : (opts.tries ?? BRIDGE_PORT_TRIES);
  let lastCode = 'EADDRINUSE';
  for (let i = 0; i < tries; i++) {
    const port = opts.port === 0 ? 0 : opts.port + i;
    if (port > 65535) break;
    const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 5_000, keepAliveTimeout: 2_000 }, handler);
    server.maxHeadersCount = 40;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (e) {
      lastCode = (e as NodeJS.ErrnoException).code ?? 'ERROR';
      server.close();
      if (lastCode !== 'EADDRINUSE' && lastCode !== 'EACCES') break;
      continue;
    }
    const bound = (server.address() as { port: number }).port;
    server.on('error', () => undefined); // a later socket error must not crash the app
    return {
      server,
      port: bound,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  }
  throw {
    code: lastCode,
    message:
      lastCode === 'EADDRINUSE'
        ? `Ports ${opts.port}-${opts.port + tries - 1} are all in use. Close the other program or choose another port.`
        : `Could not listen on 127.0.0.1 (${lastCode}).`,
  } satisfies BridgeListenError;
}
