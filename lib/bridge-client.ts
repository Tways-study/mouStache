/** Extension-side client for the desktop bridge (see lib/bridge.ts). No logging: failures are expected (app not running). */
import { BRIDGE_DEFAULT_PORT, type BridgeCapture, type BridgePing } from './bridge';

export type BridgeStatus = 'connected' | 'not-running' | 'wrong-token' | 'error';

export interface BridgeTarget {
  port: number;
  token: string;
}

export const validPort = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 1024 && p <= 65535;

export const bridgeUrl = (port: number, path: string) => `http://127.0.0.1:${validPort(port) ? port : BRIDGE_DEFAULT_PORT}${path}`;

async function request(
  t: BridgeTarget,
  path: string,
  init: { method: 'GET' | 'POST'; body?: string },
  timeoutMs: number,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(bridgeUrl(t.port, path), {
      method: init.method,
      headers: {
        Authorization: `Bearer ${t.token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body,
      signal: ctl.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** "Test connection": GET /v1/ping with the configured token. */
export async function pingBridge(t: BridgeTarget, timeoutMs = 2000): Promise<{ status: BridgeStatus; version?: string }> {
  if (!t.token) return { status: 'wrong-token' };
  try {
    const res = await request(t, '/v1/ping', { method: 'GET' }, timeoutMs);
    if (res.status === 401) return { status: 'wrong-token' };
    if (!res.ok) return { status: 'error' };
    const body = (await res.json().catch(() => undefined)) as Partial<BridgePing> | undefined;
    return body?.app === 'mouStache' ? { status: 'connected', version: body.version } : { status: 'error' };
  } catch {
    return { status: 'not-running' };
  }
}

/** Send one capture. Resolves true only when the desktop app accepted it; never throws. */
export async function postCapture(t: BridgeTarget, capture: BridgeCapture, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await request(t, '/v1/capture', { method: 'POST', body: JSON.stringify(capture) }, timeoutMs);
    return res.ok;
  } catch {
    return false;
  }
}

export const statusText: Record<BridgeStatus, string> = {
  connected: 'Connected',
  'not-running': 'Not running: start the mouStache desktop app',
  'wrong-token': 'Wrong token: copy it again from the desktop app',
  error: 'The desktop app answered, but not as expected. Update both apps.',
};
