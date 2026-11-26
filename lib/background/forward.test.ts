import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (v: Record<string, unknown>) => void Object.assign(store, v),
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { _resetForward, BACKOFF_MS, forwardImage, forwardText } from './forward';

const KEY = 'stash:settings';
const paired = (over: Record<string, unknown> = {}) => (store[KEY] = { bridgeEnabled: true, bridgeToken: 'tok', bridgePort: 47821, ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));
const ok = () => new Response('{"ok":true}', { status: 200 });

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  fetchMock.mockReset();
  _resetForward();
});
afterEach(() => vi.useRealTimers());

describe('forwarding local saves to the desktop app', () => {
  it('posts text with the token and the (already stripped) page source', async () => {
    paired();
    fetchMock.mockResolvedValue(ok());
    forwardText('SELECT 1;', { url: 'https://example.com/page', title: 'Example' }, 'copy');
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:47821/v1/capture');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ kind: 'text', text: 'SELECT 1;', via: 'copy', source: { url: 'https://example.com/page', title: 'Example' } });
  });

  it('uses the configured port', async () => {
    paired({ bridgePort: 50000 });
    fetchMock.mockResolvedValue(ok());
    forwardText('x1', undefined, 'copy');
    await flush();
    await flush();
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:50000/v1/capture');
  });

  it('forwards images as data URLs', async () => {
    paired();
    fetchMock.mockResolvedValue(ok());
    forwardImage(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), undefined, 'screenshot');
    await new Promise((r) => setTimeout(r, 30));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({ kind: 'image', via: 'screenshot' });
    expect(body.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('does nothing when the bridge is disabled or unpaired (extension behaves as before)', async () => {
    forwardText('x1', undefined, 'copy'); // default settings
    paired({ bridgeEnabled: false });
    forwardText('x1', undefined, 'copy');
    paired({ bridgeToken: '' });
    forwardText('x1', undefined, 'copy');
    await flush();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never forwards a via it does not know, nor an oversized image', async () => {
    paired();
    forwardText('x1', undefined, 'import');
    forwardImage(new Blob([new Uint8Array(11_000_000)]), undefined, 'copy');
    await flush();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a desktop app that is not running never throws, never logs, and backs off instead of retrying', async () => {
    paired();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    forwardText('one1', undefined, 'copy');
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) forwardText('more' + i, undefined, 'copy'); // a burst of copies while it is down
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); // backed off: no storm
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
  });

  it('tries again after the back-off', async () => {
    paired();
    fetchMock.mockRejectedValueOnce(new TypeError('down'));
    forwardText('one1', undefined, 'copy');
    await flush();
    await flush();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + BACKOFF_MS + 1000);
    fetchMock.mockResolvedValueOnce(ok());
    forwardText('two2', undefined, 'copy');
    await flush();
    await flush();
    vi.useRealTimers();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a rejected token (401) also backs off; the local save is untouched either way', async () => {
    paired({ bridgeToken: 'old' });
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    forwardText('one1', undefined, 'copy');
    await flush();
    await flush();
    forwardText('two2', undefined, 'copy');
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a hung desktop app is cut off by the 1.5 s timeout (the request is aborted)', async () => {
    paired();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_u: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise(() => undefined);
    });
    forwardText('one1', undefined, 'copy');
    await flush();
    await flush();
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false); // armed, not yet fired
  });
});
