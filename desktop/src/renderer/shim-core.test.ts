import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAlarms,
  createChromeShim,
  createStorage,
  memoryKV,
  type Bus,
  type Changes,
  type Transport,
} from './shim-core';

/** Two "windows" sharing one local KV and one bus, like two renderers on the same origin. */
function twoWindows() {
  const local = memoryKV();
  const listeners: Array<{ owner: number; cb: (m: unknown) => void }> = [];
  const busFor = (owner: number): Bus => ({
    post: (m) => listeners.filter((l) => l.owner !== owner).forEach((l) => l.cb(structuredClone(m))),
    listen: (cb) => void listeners.push({ owner, cb }),
  });
  return {
    a: createStorage({ local, session: memoryKV() }, busFor(1)),
    b: createStorage({ local, session: memoryKV() }, busFor(2)),
  };
}

describe('chrome.storage shim', () => {
  it('get supports undefined, string, array and defaults-object forms', async () => {
    const { a } = twoWindows();
    await a.local.set({ x: 1, y: { n: 2 } });
    expect(await a.local.get('x')).toEqual({ x: 1 });
    expect(await a.local.get(['x', 'y', 'nope'])).toEqual({ x: 1, y: { n: 2 } });
    expect(await a.local.get({ x: 9, z: 'dflt' })).toEqual({ x: 1, z: 'dflt' });
    expect(await a.local.get()).toEqual({ x: 1, y: { n: 2 } });
    expect(await a.local.get(null)).toEqual({ x: 1, y: { n: 2 } });
  });

  it('stores copies, not references', async () => {
    const { a } = twoWindows();
    const obj = { n: 1 };
    await a.local.set({ k: obj });
    obj.n = 2;
    expect(await a.local.get('k')).toEqual({ k: { n: 1 } });
  });

  it('remove and clear delete keys; missing keys are ignored', async () => {
    const { a } = twoWindows();
    await a.local.set({ a: 1, b: 2, c: 3 });
    await a.local.remove(['a', 'missing']);
    expect(await a.local.get()).toEqual({ b: 2, c: 3 });
    await a.local.clear();
    expect(await a.local.get()).toEqual({});
  });

  it('local and session areas are separate namespaces', async () => {
    const { a } = twoWindows();
    await a.local.set({ k: 'local' });
    await a.session.set({ k: 'session' });
    expect((await a.local.get('k')).k).toBe('local');
    expect((await a.session.get('k')).k).toBe('session');
  });

  it('onChanged fires in the writer with old/new values and area name', async () => {
    const { a } = twoWindows();
    const seen: Array<[Changes, string]> = [];
    a.onChanged.addListener((c, area) => void seen.push([c, area]));
    await a.local.set({ 'stash:settings': { theme: 'dark' } });
    await a.local.set({ 'stash:settings': { theme: 'light' } });
    await a.local.remove('stash:settings');
    expect(seen).toEqual([
      [{ 'stash:settings': { oldValue: undefined, newValue: { theme: 'dark' } } }, 'local'],
      [{ 'stash:settings': { oldValue: { theme: 'dark' }, newValue: { theme: 'light' } } }, 'local'],
      [{ 'stash:settings': { oldValue: { theme: 'light' } } }, 'local'],
    ]);
  });

  it('onChanged does not fire for a write that changes nothing', async () => {
    const { a } = twoWindows();
    const cb = vi.fn();
    await a.local.set({ k: { v: 1 } });
    a.onChanged.addListener(cb);
    await a.local.set({ k: { v: 1 } });
    await a.local.remove('absent');
    expect(cb).not.toHaveBeenCalled();
  });

  it('local changes reach the other window; session changes do not', async () => {
    const { a, b } = twoWindows();
    const seen: Array<[Changes, string]> = [];
    b.onChanged.addListener((c, area) => void seen.push([c, area]));
    await a.local.set({ k: 1 });
    await a.session.set({ s: 1 });
    expect(seen).toEqual([[{ k: { oldValue: undefined, newValue: 1 } }, 'local']]);
    expect(await b.local.get('k')).toEqual({ k: 1 }); // shared backing store
  });

  it('removeListener stops delivery and a throwing listener does not break others', async () => {
    const { a } = twoWindows();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    const off = vi.fn();
    a.onChanged.addListener(() => {
      throw new Error('boom');
    });
    a.onChanged.addListener(good);
    a.onChanged.addListener(off);
    a.onChanged.removeListener(off);
    await a.local.set({ k: 1 });
    expect(good).toHaveBeenCalledOnce();
    expect(off).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('chrome.runtime shim (message routing)', () => {
  function shimWith(transport: Transport) {
    return createChromeShim({
      transport,
      bus: { post: () => undefined, listen: () => undefined },
      local: memoryKV(),
      session: memoryKV(),
      openExternal: vi.fn(),
    });
  }

  it('exposes an id so the panel runs in real (non-demo) mode', () => {
    const c = shimWith({ send: async () => undefined, onMessage: () => () => undefined });
    expect(c.runtime.id).toBe('mou-stache-desktop');
    expect(c.runtime.getManifest().version).toBeTruthy();
  });

  it('sendMessage goes through the transport and returns its response', async () => {
    const send = vi.fn(async (m: unknown) => ({ echoed: m }));
    const c = shimWith({ send, onMessage: () => () => undefined });
    await expect(c.runtime.sendMessage({ type: 'search', query: 'x', limit: 5 })).resolves.toEqual({
      echoed: { type: 'search', query: 'x', limit: 5 },
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('incoming broadcasts reach runtime.onMessage listeners', () => {
    let push: (m: unknown) => void = () => undefined;
    const c = shimWith({ send: async () => undefined, onMessage: (cb) => ((push = cb), () => undefined) });
    const l = vi.fn(() => false);
    c.runtime.onMessage.addListener(l);
    push({ type: 'items-changed' });
    expect(l).toHaveBeenCalledWith({ type: 'items-changed' }, {}, expect.any(Function));
  });

  it('connect returns an inert port; stubs referenced at import time exist', async () => {
    const c = shimWith({ send: async () => undefined, onMessage: () => () => undefined });
    const port = c.runtime.connect({ name: 'sidepanel' });
    expect(port.name).toBe('sidepanel');
    expect(() => port.disconnect()).not.toThrow();
    expect(await c.runtime.getContexts()).toEqual([]);
    expect(await c.tabs.query()).toEqual([]);
    await expect(c.tabs.captureVisibleTab()).rejects.toThrow(/desktop/);
    await expect(c.sidePanel.open()).resolves.toBeUndefined();
    await expect(c.action.setBadgeText()).resolves.toBeUndefined();
  });

  it('tabs.create opens the URL externally', async () => {
    const openExternal = vi.fn();
    const c = createChromeShim({
      transport: { send: async () => undefined, onMessage: () => () => undefined },
      bus: { post: () => undefined, listen: () => undefined },
      local: memoryKV(),
      session: memoryKV(),
      openExternal,
    });
    await c.tabs.create({ url: 'https://example.com' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });
});

describe('chrome.alarms shim', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the delay, then repeats every period', async () => {
    const alarms = createAlarms();
    const fired = vi.fn();
    alarms.onAlarm.addListener(fired);
    alarms.create('a', { delayInMinutes: 1, periodInMinutes: 10 });
    expect((await alarms.get('a'))?.name).toBe('a');
    vi.advanceTimersByTime(59_000);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(fired).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(fired).toHaveBeenCalledTimes(2);
    await alarms.clear('a');
    vi.advanceTimersByTime(60 * 60_000);
    expect(fired).toHaveBeenCalledTimes(2);
  });

  it('one-shot alarms are forgotten after firing', async () => {
    const alarms = createAlarms();
    alarms.create('once', { delayInMinutes: 1 });
    vi.advanceTimersByTime(60_000);
    expect(await alarms.get('once')).toBeUndefined();
  });
});
