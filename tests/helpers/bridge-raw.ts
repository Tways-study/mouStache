/**
 * Raw HTTP client for tests of the extension bridge (node:http, so Host / Origin / framing are fully controllable;
 * fetch forbids setting them). Implements the handshake with lib/bridge-auth the way the real extension client does.
 */
import { request } from 'node:http';
import { randomHex, serverProof, sessionKey, signRequest, constantTimeEqual } from '../../lib/bridge-auth';

let clock: () => number = () => Date.now();
/** Tests that fake the server's clock fake the client's too. */
export const setClock = (f: () => number): void => void (clock = f);

export interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json?: Record<string, unknown>;
}

export function rawCall(
  port: number,
  o: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer; chunks?: Buffer[] },
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: o.method ?? 'GET', path: o.path ?? '/', headers: o.headers ?? {} }, (res) => {
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

export interface RawSession {
  id: string;
  key: Uint8Array;
  nextSeq: number;
  /** false when the server's proof did not verify against `token` */
  serverVerified: boolean;
}

/** POST /v1/hello. Returns the raw response and, when it parses, a verified session. */
export async function rawHello(
  port: number,
  token: string,
  extra: { headers?: Record<string, string>; nonce?: string } = {},
): Promise<{ res: Res; session?: RawSession; nonce: string }> {
  const nonce = extra.nonce ?? randomHex(16);
  const res = await rawCall(port, {
    method: 'POST',
    path: '/v1/hello',
    headers: { 'Content-Type': 'application/json', ...(extra.headers ?? {}) },
    body: JSON.stringify({ nonce }),
  });
  const j = res.json as { session?: string; serverNonce?: string; proof?: string } | undefined;
  if (res.status !== 200 || !j?.session || !j.serverNonce || !j.proof) return { res, nonce };
  const expected = await serverProof(token, nonce, j.serverNonce);
  return {
    res,
    nonce,
    session: { id: j.session, key: await sessionKey(token, nonce, j.serverNonce), nextSeq: 1, serverVerified: constantTimeEqual(expected, j.proof) },
  };
}

/** A signed request on an existing session. `tweak` lets a test corrupt any header / the MAC inputs. */
export async function rawSigned(
  port: number,
  session: { id: string; key: Uint8Array; nextSeq: number },
  o: {
    method?: string;
    path?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
    seq?: number;
    ts?: number;
    signAs?: { method?: string; path?: string; body?: string };
    contentType?: string | false;
  } = {},
): Promise<Res> {
  const body = o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  const method = o.method ?? (body !== undefined ? 'POST' : 'GET');
  const path = o.path ?? (body !== undefined ? '/v1/capture' : '/v1/ping');
  const seq = o.seq ?? session.nextSeq++;
  const signed = await signRequest(session, o.signAs?.method ?? method, o.signAs?.path ?? path, o.signAs?.body ?? body, seq, o.ts ?? clock());
  const headers: Record<string, string> = { ...signed, ...(o.headers ?? {}) };
  if (body !== undefined && o.contentType !== false) headers['Content-Type'] = o.contentType ?? 'application/json';
  return rawCall(port, { method, path, headers, body });
}
