/**
 * Mutual authentication for the extension -> desktop bridge. The pairing token NEVER goes over the wire.
 *
 *   1. client -> POST /v1/hello  {nonce: cn}                      (random, no secret)
 *      server -> {session, serverNonce: sn, proof, app, version}  proof = HMAC(token, "srv|cn|sn")
 *      The client checks the proof BEFORE sending anything else: a program squatting the port does not know the
 *      token, cannot produce it, and therefore never receives a capture (or any secret).
 *   2. key = HMAC(token, "key|cn|sn"). Every later request carries
 *        X-Mou-Session, X-Mou-Ts (ms), X-Mou-Seq (unique per session), X-Mou-Mac
 *        mac = HMAC(key, "METHOD|/path|ts|seq|sha256(body)")
 *      The server recomputes it in constant time, rejects stale timestamps and any (session, seq) it has seen.
 *
 * Pure WebCrypto: runs in the extension service worker, the Electron main process and Node tests.
 */

const enc = new TextEncoder();

export const HELLO_PATH = '/v1/hello';
export const HEADER_SESSION = 'x-mou-session';
export const HEADER_TS = 'x-mou-ts';
export const HEADER_SEQ = 'x-mou-seq';
export const HEADER_MAC = 'x-mou-mac';

/** Largest clock difference accepted between the extension and the app (same machine, so this is generous). */
export const MAX_SKEW_MS = 30_000;
export const SESSION_TTL_MS = 5 * 60_000;

const hex = (b: ArrayBuffer | Uint8Array): string =>
  Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return hex(b);
}

export const isHex = (s: unknown, len: number): s is string => typeof s === 'string' && s.length === len && /^[0-9a-f]+$/.test(s);

async function hmac(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const raw = typeof key === 'string' ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data) as BufferSource));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** Constant-time string comparison (always inspects every character of the longer input). */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** What the server proves in its hello answer: it knows the token, for THIS client nonce. */
export async function serverProof(token: string, clientNonce: string, serverNonce: string): Promise<string> {
  return hex(await hmac(token, `srv|${clientNonce}|${serverNonce}`));
}

/** Per-session MAC key. Never sent. */
export async function sessionKey(token: string, clientNonce: string, serverNonce: string): Promise<Uint8Array> {
  return hmac(token, `key|${clientNonce}|${serverNonce}`);
}

export interface SignedParts {
  method: string;
  path: string;
  ts: number;
  seq: number;
  bodySha256: string;
}

export async function requestMac(key: Uint8Array, p: SignedParts): Promise<string> {
  return hex(await hmac(key, `${p.method.toUpperCase()}|${p.path}|${p.ts}|${p.seq}|${p.bodySha256}`));
}

/** Headers for one signed request (the caller keeps `seq` unique per session). */
export async function signRequest(
  session: { id: string; key: Uint8Array },
  method: string,
  path: string,
  body: string | undefined,
  seq: number,
  now: number = Date.now(),
): Promise<Record<string, string>> {
  const bodySha256 = await sha256Hex(body ?? '');
  const mac = await requestMac(session.key, { method, path, ts: now, seq, bodySha256 });
  return { 'X-Mou-Session': session.id, 'X-Mou-Ts': String(now), 'X-Mou-Seq': String(seq), 'X-Mou-Mac': mac };
}
