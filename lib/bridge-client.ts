/**
 * Extension-side client for the desktop bridge (see lib/bridge.ts and lib/bridge-auth.ts).
 *
 * The pairing token is never sent. Every connection starts with a handshake in which the SERVER proves it knows the
 * token; if it cannot (a different program squatting the port, a wrong token) the client stops right there: no
 * capture, no token, nothing but a random nonce ever leaves. No logging: failures are expected (app not running).
 */
import { BRIDGE_DEFAULT_PORT, type BridgeCapture, type BridgePing } from './bridge';
import {
  HELLO_PATH,
  SESSION_TTL_MS,
  constantTimeEqual,
  isHex,
  randomHex,
  serverProof,
  sessionKey,
  sha256Hex,
  signRequest,
} from './bridge-auth';

export type BridgeStatus = 'connected' | 'not-running' | 'wrong-token' | 'error';
/** sent = accepted; dropped = the app understood and refused THIS capture (not an outage); down = unreachable / not our app. */
export type SendResult = 'sent' | 'dropped' | 'down';

export interface BridgeTarget {
  port: number;
  token: string;
}

export const validPort = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 1024 && p <= 65535;

export const bridgeUrl = (port: number, path: string) => `http://127.0.0.1:${validPort(port) ? port : BRIDGE_DEFAULT_PORT}${path}`;

interface Session {
  id: string;
  key: Uint8Array;
  nextSeq: number;
  expiresAt: number;
}

/** In-memory only (a restarted service worker simply shakes hands again). Keyed by port + a digest of the token. */
const sessions = new Map<string, Session>();
const cacheKey = async (t: BridgeTarget) => `${t.port}|${await sha256Hex(t.token)}`;
/** Test helper. */
export function _clearSessions(): void {
  sessions.clear();
}

type Handshake = { ok: true; session: Session } | { ok: false; why: 'not-running' | 'bad-server' | 'error' };

async function handshake(t: BridgeTarget, signal: AbortSignal): Promise<Handshake> {
  const cn = randomHex(16);
  let res: Response;
  try {
    res = await fetch(bridgeUrl(t.port, HELLO_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // deliberately NO Authorization header
      body: JSON.stringify({ nonce: cn }),
      signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
  } catch {
    return { ok: false, why: 'not-running' };
  }
  if (!res.ok) return { ok: false, why: 'bad-server' };
  const body = (await res.json().catch(() => undefined)) as
    | { app?: unknown; session?: unknown; serverNonce?: unknown; proof?: unknown }
    | undefined;
  if (!body || body.app !== 'mouStache' || !isHex(body.session, 32) || !isHex(body.serverNonce, 32) || !isHex(body.proof, 64)) {
    return { ok: false, why: 'bad-server' };
  }
  // The decisive step: only the real app (which knows the token) can produce this value for OUR nonce.
  const expected = await serverProof(t.token, cn, body.serverNonce);
  if (!constantTimeEqual(expected, body.proof)) return { ok: false, why: 'bad-server' };
  return {
    ok: true,
    session: { id: body.session, key: await sessionKey(t.token, cn, body.serverNonce), nextSeq: 1, expiresAt: Date.now() + SESSION_TTL_MS - 15_000 },
  };
}

async function getSession(t: BridgeTarget, signal: AbortSignal, fresh = false): Promise<Handshake> {
  const k = await cacheKey(t);
  const cached = sessions.get(k);
  if (!fresh && cached && cached.expiresAt > Date.now()) return { ok: true, session: cached };
  sessions.delete(k);
  const h = await handshake(t, signal);
  if (h.ok) sessions.set(k, h.session);
  return h;
}

async function signed(t: BridgeTarget, s: Session, method: 'GET' | 'POST', path: string, body: string | undefined, signal: AbortSignal): Promise<Response> {
  const seq = s.nextSeq++;
  const headers = await signRequest(s, method, path, body, seq);
  return fetch(bridgeUrl(t.port, path), {
    method,
    headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body,
    signal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
}

/** Runs `fn` under one overall deadline. */
async function withDeadline<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fn(ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** "Test connection": handshake (server must prove the token) then a signed GET /v1/ping. */
export async function pingBridge(t: BridgeTarget, timeoutMs = 2500): Promise<{ status: BridgeStatus; version?: string }> {
  if (!t.token) return { status: 'wrong-token' };
  return withDeadline(timeoutMs, async (signal) => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const h = await getSession(t, signal, attempt > 0);
        if (!h.ok) return { status: h.why === 'not-running' ? 'not-running' : h.why === 'bad-server' ? 'wrong-token' : 'error' } as const;
        const res = await signed(t, h.session, 'GET', '/v1/ping', undefined, signal);
        if (res.status === 401) {
          sessions.delete(await cacheKey(t)); // expired session: shake hands again once
          continue;
        }
        if (!res.ok) return { status: 'error' } as const;
        const body = (await res.json().catch(() => undefined)) as Partial<BridgePing> | undefined;
        return body?.app === 'mouStache' ? ({ status: 'connected', version: body.version } as const) : ({ status: 'error' } as const);
      }
      return { status: 'error' } as const;
    } catch {
      return { status: 'not-running' } as const;
    }
  });
}

/** Send one capture. Never throws. */
export async function postCapture(t: BridgeTarget, capture: BridgeCapture, timeoutMs = 1500): Promise<SendResult> {
  if (!t.token) return 'down';
  const body = JSON.stringify(capture);
  return withDeadline(timeoutMs, async (signal): Promise<SendResult> => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const h = await getSession(t, signal, attempt > 0);
        if (!h.ok) return 'down'; // not running, or NOT the mouStache app: nothing sensitive has been sent
        const res = await signed(t, h.session, 'POST', '/v1/capture', body, signal);
        if (res.status === 401) {
          sessions.delete(await cacheKey(t));
          continue;
        }
        if (res.ok) return 'sent';
        // the app is there and refused this one capture (bad request, too large, ...): not an outage
        if (res.status >= 400 && res.status < 500 && res.status !== 403 && res.status !== 429) return 'dropped';
        return 'down';
      }
      return 'down';
    } catch {
      sessions.delete(await cacheKey(t));
      return 'down';
    }
  });
}

export const statusText: Record<BridgeStatus, string> = {
  connected: 'Connected',
  'not-running': 'Not running: start the mouStache desktop app',
  'wrong-token': 'Wrong token, or that port is not the mouStache app. Copy the token again from the desktop app.',
  error: 'The desktop app answered, but not as expected. Update both apps.',
};
