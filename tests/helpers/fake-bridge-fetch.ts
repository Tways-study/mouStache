/**
 * An in-memory stand-in for the desktop bridge, shaped like `fetch`, that speaks the real handshake/HMAC protocol
 * (lib/bridge-auth). Used by the extension-side unit tests; records every request so tests can assert exactly what
 * was (and was not) sent.
 */
import { MAX_SKEW_MS, randomHex, requestMac, serverProof, sessionKey, sha256Hex, constantTimeEqual } from '../../lib/bridge-auth';

export interface Seen {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface FakeBridgeOptions {
  /** the token the "app" knows */
  token: string;
  /** what POST /v1/capture answers once authenticated */
  captureStatus?: number;
  /** answer hello with app:'mouStache' and a proof that is WRONG (a squatter that does not know the token) */
  squatter?: boolean;
  /** make every request fail like a closed port */
  down?: boolean;
  /** make the next signed request fail with 401 once (a lost session) */
  loseSessionOnce?: boolean;
}

export function createFakeBridge(o: FakeBridgeOptions) {
  const seen: Seen[] = [];
  const sessions = new Map<string, { key: Uint8Array; used: Set<number> }>();
  const state = { loseSession: !!o.loseSessionOnce };

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    if (o.down) throw new TypeError('Failed to fetch');
    const url = String(input);
    const path = new URL(url).pathname;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const body = typeof init.body === 'string' ? init.body : '';
    seen.push({ method: init.method ?? 'GET', url, path, headers, body });

    if (path === '/v1/hello') {
      const nonce = (JSON.parse(body) as { nonce: string }).nonce;
      const serverNonce = randomHex(16);
      const session = randomHex(16);
      sessions.set(session, { key: await sessionKey(o.token, nonce, serverNonce), used: new Set() });
      const proof = o.squatter ? randomHex(32) : await serverProof(o.token, nonce, serverNonce);
      return json(200, { ok: true, app: 'mouStache', version: '0.0.0-fake', session, serverNonce, proof });
    }

    if (state.loseSession) {
      state.loseSession = false;
      sessions.clear();
    }
    const s = sessions.get(headers['x-mou-session'] ?? '');
    if (!s) return json(401, { ok: false, error: 'unauthorized' });
    const ts = Number(headers['x-mou-ts']);
    const seq = Number(headers['x-mou-seq']);
    const expected = await requestMac(s.key, { method: init.method ?? 'GET', path, ts, seq, bodySha256: await sha256Hex(body) });
    if (!constantTimeEqual(expected, headers['x-mou-mac'] ?? '') || Math.abs(Date.now() - ts) > MAX_SKEW_MS || s.used.has(seq)) {
      return json(401, { ok: false, error: 'unauthorized' });
    }
    s.used.add(seq);
    if (path === '/v1/ping') return json(200, { ok: true, app: 'mouStache', version: '0.0.0-fake' });
    return json(o.captureStatus ?? 200, o.captureStatus && o.captureStatus >= 400 ? { ok: false, error: 'bad_request' } : { ok: true, id: 'fake' });
  };

  return {
    fetch: fetchImpl,
    seen,
    hellos: () => seen.filter((r) => r.path === '/v1/hello'),
    captures: () => seen.filter((r) => r.path === '/v1/capture').map((r) => ({ ...r, json: JSON.parse(r.body || '{}') as Record<string, unknown> })),
    /** every byte the client ever sent, for "the token never appears" assertions */
    wire: () => JSON.stringify(seen),
  };
}
