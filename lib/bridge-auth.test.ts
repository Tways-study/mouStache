import { describe, expect, it } from 'vitest';
import { constantTimeEqual, isHex, randomHex, requestMac, serverProof, sessionKey, sha256Hex, signRequest } from './bridge-auth';

const TOKEN = 'T'.repeat(43);
const CN = 'a'.repeat(32);
const SN = 'b'.repeat(32);

describe('bridge-auth primitives', () => {
  it('randomHex gives distinct hex strings of the right length', () => {
    const a = randomHex(16);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(16)).not.toBe(a);
    expect(isHex(a, 32)).toBe(true);
    expect(isHex(a, 31)).toBe(false);
    expect(isHex('ZZ'.repeat(16), 32)).toBe(false);
    expect(isHex(5, 32)).toBe(false);
  });

  it('sha256Hex matches the known digest', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('the server proof depends on the token and on BOTH nonces (no replaying an old proof)', async () => {
    const p = await serverProof(TOKEN, CN, SN);
    expect(p).toMatch(/^[0-9a-f]{64}$/);
    expect(await serverProof(TOKEN, CN, SN)).toBe(p);
    expect(await serverProof('U'.repeat(43), CN, SN)).not.toBe(p);
    expect(await serverProof(TOKEN, 'c'.repeat(32), SN)).not.toBe(p);
    expect(await serverProof(TOKEN, CN, 'c'.repeat(32))).not.toBe(p);
  });

  it('the proof never contains or reveals the token', async () => {
    expect(await serverProof(TOKEN, CN, SN)).not.toContain(TOKEN);
  });

  it('the session key differs from the proof and per session', async () => {
    const k1 = await sessionKey(TOKEN, CN, SN);
    const k2 = await sessionKey(TOKEN, CN, 'c'.repeat(32));
    expect(k1).toHaveLength(32);
    expect(Buffer.from(k1).toString('hex')).not.toBe(await serverProof(TOKEN, CN, SN));
    expect(Buffer.from(k1).equals(Buffer.from(k2))).toBe(false);
  });

  it('the request MAC binds method, path, timestamp, sequence and body', async () => {
    const key = await sessionKey(TOKEN, CN, SN);
    const base = { method: 'POST', path: '/v1/capture', ts: 1000, seq: 1, bodySha256: await sha256Hex('{"a":1}') };
    const mac = await requestMac(key, base);
    expect(await requestMac(key, { ...base })).toBe(mac);
    expect(await requestMac(key, { ...base, method: 'GET' })).not.toBe(mac);
    expect(await requestMac(key, { ...base, path: '/v1/ping' })).not.toBe(mac);
    expect(await requestMac(key, { ...base, ts: 1001 })).not.toBe(mac);
    expect(await requestMac(key, { ...base, seq: 2 })).not.toBe(mac);
    expect(await requestMac(key, { ...base, bodySha256: await sha256Hex('{"a":2}') })).not.toBe(mac);
    expect(await requestMac(await sessionKey('U'.repeat(43), CN, SN), base)).not.toBe(mac);
  });

  it('signRequest emits the four headers and never the key or token', async () => {
    const key = await sessionKey(TOKEN, CN, SN);
    const h = await signRequest({ id: 'sess', key }, 'POST', '/v1/capture', '{"x":1}', 7, 5000);
    expect(Object.keys(h).sort()).toEqual(['X-Mou-Mac', 'X-Mou-Seq', 'X-Mou-Session', 'X-Mou-Ts']);
    expect(h['X-Mou-Session']).toBe('sess');
    expect(h['X-Mou-Ts']).toBe('5000');
    expect(h['X-Mou-Seq']).toBe('7');
    expect(JSON.stringify(h)).not.toContain(TOKEN);
    expect(h['X-Mou-Mac']).toBe(await requestMac(key, { method: 'POST', path: '/v1/capture', ts: 5000, seq: 7, bodySha256: await sha256Hex('{"x":1}') }));
  });

  it('constantTimeEqual compares exactly, including length', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('abc', '')).toBe(false);
  });
});
