import { describe, expect, it, vi } from 'vitest';
import {
  createSessionSaver, EMPTY_SESSION, loadSession, pushRecent, sanitizeSession, saveSession, type SessionBackend,
} from './session';

function memoryBackend(): SessionBackend & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, JSON.parse(JSON.stringify(v))) };
}

describe('sanitizeSession', () => {
  it('returns defaults for junk', () => {
    expect(sanitizeSession(undefined)).toEqual(EMPTY_SESSION);
    expect(sanitizeSession('x')).toEqual(EMPTY_SESSION);
    expect(sanitizeSession({ filter: 4, query: {}, scrollTop: -5, collapsed: 'no' })).toEqual(EMPTY_SESSION);
  });
  it('keeps valid fields and drops non-boolean collapsed entries', () => {
    const s = sanitizeSession({ filter: 'code', query: 'nmap', scrollTop: 420, collapsed: { Earlier: true, Today: 'x', Yesterday: false } });
    expect(s).toEqual({ filter: 'code', query: 'nmap', scrollTop: 420, collapsed: { Earlier: true, Yesterday: false } });
  });
});

describe('load/save', () => {
  it('round-trips through a backend', async () => {
    const b = memoryBackend();
    await saveSession({ filter: 'link', query: 'q', scrollTop: 10, collapsed: { Earlier: false } }, b);
    expect(await loadSession(b)).toEqual({ filter: 'link', query: 'q', scrollTop: 10, collapsed: { Earlier: false } });
  });
  it('survives a throwing backend and a missing backend', async () => {
    const bad: SessionBackend = { get: async () => { throw new Error('nope'); }, set: async () => { throw new Error('nope'); } };
    expect(await loadSession(bad)).toEqual(EMPTY_SESSION);
    await expect(saveSession(EMPTY_SESSION, bad)).resolves.toBeUndefined();
    expect(await loadSession(null)).toEqual(EMPTY_SESSION);
  });
  it('debounces saver writes and merges patches', async () => {
    vi.useFakeTimers();
    const b = memoryBackend();
    const saver = createSessionSaver(100, b);
    saver.init({ ...EMPTY_SESSION });
    saver.update({ scrollTop: 1 });
    saver.update({ scrollTop: 2, query: 'a' });
    expect(b.data.size).toBe(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(await loadSession(b)).toMatchObject({ scrollTop: 2, query: 'a', filter: 'all' });
    vi.useRealTimers();
  });
});

describe('pushRecent', () => {
  it('puts newest first, dedupes case-insensitively, caps at 6', () => {
    let l: string[] = [];
    for (const q of ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg']) l = pushRecent(l, q);
    expect(l).toEqual(['gg', 'ff', 'ee', 'dd', 'cc', 'bb']);
    expect(pushRecent(l, 'DD')).toEqual(['DD', 'gg', 'ff', 'ee', 'cc', 'bb']);
  });
  it('ignores blank and one-character queries', () => {
    expect(pushRecent(['xx'], '  ')).toEqual(['xx']);
    expect(pushRecent(['xx'], 'a')).toEqual(['xx']);
  });
});
