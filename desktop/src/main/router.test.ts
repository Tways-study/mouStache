import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineClient, isBroadcast, isSafeExternalUrl, routeMessage } from './router';

describe('isBroadcast', () => {
  it('flags fan-out messages only', () => {
    expect(isBroadcast({ type: 'items-changed' })).toBe(true);
    expect(isBroadcast({ type: 'show-toast', text: 'x' })).toBe(true);
    expect(isBroadcast({ type: 'search' })).toBe(false);
    expect(isBroadcast(null)).toBe(false);
    expect(isBroadcast('items-changed')).toBe(false);
  });
});

describe('routeMessage', () => {
  it('broadcasts go to the other windows and never to the engine', async () => {
    const broadcast = vi.fn();
    const request = vi.fn();
    await expect(routeMessage({ type: 'items-changed' }, { engine: { request }, broadcast })).resolves.toBeUndefined();
    expect(broadcast).toHaveBeenCalledWith({ type: 'items-changed' });
    expect(request).not.toHaveBeenCalled();
  });

  it('everything else is answered by the engine', async () => {
    const broadcast = vi.fn();
    const request = vi.fn(async () => [{ id: '1' }]);
    await expect(routeMessage({ type: 'search', query: '', limit: 5 }, { engine: { request }, broadcast })).resolves.toEqual([
      { id: '1' },
    ]);
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('engine client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('queues requests until the engine is ready, then correlates replies by id', async () => {
    const posted: Array<[number, unknown]> = [];
    const c = createEngineClient((id, msg) => void posted.push([id, msg]));
    const p1 = c.request({ type: 'search' });
    const p2 = c.request({ type: 'copy-item' });
    expect(posted).toHaveLength(0);
    c.markReady();
    expect(posted.map((p) => p[1])).toEqual([{ type: 'search' }, { type: 'copy-item' }]);
    // answer out of order
    c.settle(posted[1]![0], 'second');
    c.settle(posted[0]![0], 'first');
    await expect(p1).resolves.toBe('first');
    await expect(p2).resolves.toBe('second');
  });

  it('ignores unknown/duplicate replies', () => {
    const c = createEngineClient(() => undefined);
    expect(c.settle(99, 'x')).toBe(false);
  });

  it('times out with an error result instead of hanging', async () => {
    const c = createEngineClient(() => undefined, 1000);
    c.markReady();
    const p = c.request({ type: 'search' });
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toEqual({ ok: false, error: expect.stringContaining('timed out') });
  });

  it('reset fails in-flight requests and waits for the next ready', async () => {
    const posted: number[] = [];
    const c = createEngineClient((id) => void posted.push(id));
    c.markReady();
    const inflight = c.request({ type: 'search' });
    c.reset();
    await expect(inflight).resolves.toEqual({ ok: false, error: expect.stringContaining('restarted') });
    const next = c.request({ type: 'search' });
    expect(posted).toHaveLength(1);
    c.markReady();
    expect(posted).toHaveLength(2);
    c.settle(posted[1]!, 'ok');
    await expect(next).resolves.toBe('ok');
  });
});

describe('isSafeExternalUrl', () => {
  it('allows only http(s)', () => {
    expect(isSafeExternalUrl('https://example.com/x')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
    expect(isSafeExternalUrl('file:///c:/windows/system32/calc.exe')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl(42)).toBe(false);
  });
});
