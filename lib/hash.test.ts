import { describe, expect, it } from 'vitest';
import { hashBlob, hashText } from './hash';

describe('hash', () => {
  it('hashText matches known SHA-256 vector', async () => {
    expect(await hashText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashText is deterministic and 64 hex chars', async () => {
    const a = await hashText('hello');
    expect(a).toBe(await hashText('hello'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(await hashText('hello '));
  });

  it('hashBlob equals hashText for the same bytes', async () => {
    expect(await hashBlob(new Blob(['abc']))).toBe(await hashText('abc'));
  });
});
