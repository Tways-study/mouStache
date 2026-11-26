/**
 * The extension -> desktop bridge: an HTTP server on 127.0.0.1 only. Electron-free (node:http only) so the whole
 * thing is unit- and integration-testable under plain Node. Wiring to the engine lives in bridge.ts.
 *
 * The pairing token never crosses the wire. A client first POSTs a random nonce to /v1/hello and gets back a
 * session plus HMAC(token, "srv|nonce|serverNonce"), which proves THIS server knows the token (a program squatting
 * the port cannot). Every other request carries a session id, a timestamp, a unique sequence number and an HMAC over
 * (method, path, timestamp, sequence, sha256(body)) made with a per-session key derived from the token. See
 * lib/bridge-auth.ts for the exact construction.
 *
 * Every request must pass, in this order:
 *   Host is 127.0.0.1:<port> or localhost:<port>      (DNS-rebinding defence)
 *   not an OPTIONS/CORS preflight                      (403, and no CORS headers are ever sent)
 *   Origin absent or chrome-extension://<id>           (no web page can call this)
 *   known route                                        (POST /v1/hello, GET /v1/ping, POST /v1/capture)
 *   rate limit; live session, fresh timestamp, unused sequence (BEFORE any body is read)
 *   Content-Type application/json, body within limits  (enforced while streaming)
 *   MAC verified in constant time, then strict schema validation (lib/bridge.ts)
 * Error bodies are fixed short codes: no stack traces, no echo of the request, and captured content is never logged.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { BRIDGE_MAX_BODY, validateCapture, type BridgeCapture, type BridgePing } from '@/lib/bridge';
import {
  HEADER_MAC,
  HEADER_SEQ,
  HEADER_SESSION,
  HEADER_TS,
  HELLO_PATH,
  MAX_SKEW_MS,
  SESSION_TTL_MS,
  constantTimeEqual,
  isHex,
  randomHex,
  requestMac,
  serverProof,
  sessionKey,
  sha256Hex,
} from '@/lib/bridge-auth';

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
  /**
   * Atomic: write a temp file then rename it over the old one, so a crash never leaves a half-written token.
   * File mode 0600 is applied best-effort (it protects the file on macOS/Linux; on Windows chmod only toggles the
   * read-only bit, so the real protection there is the per-user profile folder's ACL).
   */
  const save = (t: string): string => {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ token: t }), { mode: 0o600 });
      try {
        chmodSync(tmp, 0o600);
      } catch {
        /* best effort */
      }
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
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

interface Session {
  key: Uint8Array;
  /** The token this session was derived from: a regenerated token ends every older session immediately. */
  token: string;
  expiresAt: number;
  usedSeq: Set<number>;
}
const MAX_SESSIONS = 64;
const MAX_SEQS_PER_SESSION = 4096;
const HELLO_BODY_MAX = 512;
const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return typeof v === 'string' ? v : undefined;
};

export function createBridgeHandler(o: BridgeHandlerOptions) {
  const now = o.now ?? Date.now;
  const limiterAuthed = createRateLimiter({ burst: o.ratePerSecond ?? 30, perSecond: o.ratePerSecond ?? 30, now: o.now });
  const limiterAnon = createRateLimiter({ burst: 20, perSecond: 5, now: o.now }); // hello + anything without a live session
  const bodyTimeout = o.bodyTimeoutMs ?? 8000;
  const sessions = new Map<string, Session>();

  const prune = () => {
    const t = now();
    for (const [id, s] of sessions) if (s.expiresAt <= t) sessions.delete(id);
    while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string); // oldest first
  };

  /** Cheap checks done BEFORE the body is read: a live session for the current token, fresh timestamp, unused sequence. */
  function precheck(req: IncomingMessage): { session: Session; id: string; ts: number; seq: number; mac: string } | undefined {
    const id = header(req, HEADER_SESSION);
    const tsRaw = header(req, HEADER_TS);
    const seqRaw = header(req, HEADER_SEQ);
    const mac = header(req, HEADER_MAC);
    if (!isHex(id, 32) || !isHex(mac, 64) || !tsRaw || !seqRaw || !/^\d{1,15}$/.test(tsRaw) || !/^\d{1,9}$/.test(seqRaw)) return undefined;
    const session = sessions.get(id);
    if (!session || session.expiresAt <= now()) return undefined;
    if (!tokensEqual(session.token, o.getToken())) return undefined; // token regenerated since the handshake
    const ts = Number(tsRaw);
    const seq = Number(seqRaw);
    if (Math.abs(now() - ts) > MAX_SKEW_MS) return undefined;
    if (seq < 1 || session.usedSeq.has(seq)) return undefined; // replay
    return { session, id, ts, seq, mac };
  }

  async function hello(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json') return fail(res, 415);
    const got = await readBody(req, HELLO_BODY_MAX, bodyTimeout);
    if (!got.ok) {
      if (got.reason === 'aborted') return void req.destroy();
      res.setHeader('Connection', 'close');
      fail(res, got.reason === 'too_large' ? 413 : 408);
      res.once('finish', () => req.destroy());
      return;
    }
    let nonce: unknown;
    try {
      nonce = (JSON.parse(got.body.toString('utf8')) as { nonce?: unknown }).nonce;
    } catch {
      return fail(res, 400, 'bad_json');
    }
    if (!isHex(nonce, 32)) return fail(res, 400, 'bad_nonce');
    const token = o.getToken();
    const serverNonce = randomHex(16);
    const id = randomHex(16);
    prune();
    sessions.set(id, { key: await sessionKey(token, nonce, serverNonce), token, expiresAt: now() + SESSION_TTL_MS, usedSeq: new Set() });
    send(res, 200, {
      ok: true,
      app: 'mouStache',
      version: o.version,
      session: id,
      serverNonce,
      proof: await serverProof(token, nonce, serverNonce),
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req.headers.host, o.getPort())) return fail(res, 403, 'bad_host');
    if (req.method === 'OPTIONS') return fail(res, 403, 'forbidden'); // CORS preflight: never answered, no CORS headers
    const origin = req.headers.origin;
    if (origin !== undefined && !originAllowed(origin)) return fail(res, 403, 'bad_origin');

    const url = req.url ?? '';
    const path = url.split('?')[0];
    const route = path === HELLO_PATH ? 'hello' : path === '/v1/ping' ? 'ping' : path === '/v1/capture' ? 'capture' : undefined;
    if (!route) return fail(res, 404);
    const want = route === 'ping' ? 'GET' : 'POST';
    if (req.method !== want) return fail(res, 405, undefined, { Allow: want });
    if (url.includes('?')) return fail(res, 400); // nothing in the query string is ever meaningful (and the MAC covers the path only)

    if (route === 'hello') {
      if (!limiterAnon.allow('anon')) return fail(res, 429, undefined, { 'Retry-After': '1' });
      return hello(req, res);
    }

    // rate limit first (separate buckets: junk cannot starve the real client), then the cheap session checks
    const pre = precheck(req);
    if (!(pre ? limiterAuthed : limiterAnon).allow(pre ? 'token' : 'anon')) return fail(res, 429, undefined, { 'Retry-After': '1' });
    if (!pre) return fail(res, 401);

    let body: Buffer = Buffer.alloc(0);
    if (route === 'capture') {
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
      body = got.body;
    }

    // verify the MAC in constant time (the sequence number is only burnt by a request that authenticates)
    const expected = await requestMac(pre.session.key, { method: req.method ?? '', path: path ?? '', ts: pre.ts, seq: pre.seq, bodySha256: await sha256Hex(body) });
    if (!constantTimeEqual(expected, pre.mac) || pre.session.usedSeq.has(pre.seq)) return fail(res, 401);
    if (pre.session.usedSeq.size >= MAX_SEQS_PER_SESSION) {
      sessions.delete(pre.id); // a very chatty session must shake hands again
      return fail(res, 401);
    }
    pre.session.usedSeq.add(pre.seq);

    if (route === 'ping') return send(res, 200, { ok: true, app: 'mouStache', version: o.version } satisfies BridgePing);

    let json: unknown;
    try {
      json = JSON.parse(body.toString('utf8'));
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
  /** The port it bound (always the one that was asked for, or the OS's choice for port 0 in tests). */
  port: number;
  close(): Promise<void>;
}

export type BridgeListenError = { code: string; message: string };

/**
 * Listen on 127.0.0.1 ONLY, on exactly the requested port. There is deliberately NO fallback to another port: a
 * program squatting the configured port must produce a visible error, not silently move the app (and the extension's
 * view of it) somewhere else. `port: 0` asks the OS for a free port (tests only). Rejects with {code,message}.
 */
export async function startBridgeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  opts: { port: number },
): Promise<RunningBridge> {
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 5_000, keepAliveTimeout: 2_000 }, handler);
  server.maxHeadersCount = 40;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port: opts.port, host: '127.0.0.1', exclusive: true }, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? 'ERROR';
    server.close();
    throw {
      code,
      message:
        code === 'EADDRINUSE'
          ? `Port ${opts.port} is already in use by another program. Choose a different port here and in the extension (Settings > Desktop app).`
          : code === 'EACCES'
            ? `Port ${opts.port} is not allowed on this computer. Choose a different port here and in the extension.`
            : `Could not listen on 127.0.0.1:${opts.port} (${code}).`,
    } satisfies BridgeListenError;
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
