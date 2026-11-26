import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeBridge } from '../../tests/helpers/fake-bridge-fetch';

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

import { _clearSessions } from '../bridge-client';
import { _resetForward, BACKOFF_MS, forwardImage, forwardText, sanitizeSource } from './forward';

const KEY = 'stash:settings';
const TOKEN = 'k'.repeat(43);
const paired = (over: Record<string, unknown> = {}) => (store[KEY] = { bridgeEnabled: true, bridgeToken: TOKEN, bridgePort: 47821, ...over });
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const up = (o: Partial<Parameters<typeof createFakeBridge>[0]> = {}) => {
  const b = createFakeBridge({ token: TOKEN, ...o });
  fetchMock.mockImplementation(b.fetch);
  return b;
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  fetchMock.mockReset();
  _resetForward();
  _clearSessions();
});
afterEach(() => vi.useRealTimers());

describe('forwarding local saves to the desktop app', () => {
  it('posts text with the page source (already stripped) after a handshake, and never sends the token', async () => {
    paired();
    const b = up();
    forwardText('SELECT 1;', { url: 'https://example.com/page', title: 'Example' }, 'copy');
    await settle();
    expect(b.captures()).toHaveLength(1);
    expect(b.captures()[0]!.json).toEqual({ kind: 'text', text: 'SELECT 1;', via: 'copy', source: { url: 'https://example.com/page', title: 'Example' } });
    expect(b.captures()[0]!.url).toBe('http://127.0.0.1:47821/v1/capture');
    expect(b.wire()).not.toContain(TOKEN);
  });

  it('uses the configured port', async () => {
    paired({ bridgePort: 50000 });
    const b = up();
    forwardText('x1', undefined, 'copy');
    await settle();
    expect(b.captures()[0]!.url).toBe('http://127.0.0.1:50000/v1/capture');
  });

  it('forwards images as data URLs', async () => {
    paired();
    const b = up();
    forwardImage(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), undefined, 'screenshot');
    await new Promise((r) => setTimeout(r, 40));
    await settle();
    const c = b.captures()[0]!;
    expect(c.json).toMatchObject({ kind: 'image', via: 'screenshot' });
    expect(String(c.json['dataUrl'])).toMatch(/^data:image\/png;base64,/);
  });

  it('does nothing when the bridge is disabled or unpaired (extension behaves as before)', async () => {
    forwardText('x1', undefined, 'copy'); // default settings
    paired({ bridgeEnabled: false });
    forwardText('x1', undefined, 'copy');
    paired({ bridgeToken: '' });
    forwardText('x1', undefined, 'copy');
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never forwards a via it does not know, nor an oversized image', async () => {
    paired();
    forwardText('x1', undefined, 'import');
    forwardImage(new Blob([new Uint8Array(11_000_000)]), undefined, 'copy');
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a squatter on the port (answers hello but cannot prove the token) gets no capture and no token; the extension backs off', async () => {
    paired();
    const squatter = up({ squatter: true });
    forwardText('SELECT * FROM payroll;', { url: 'https://hr.example/p', title: 'HR' }, 'copy');
    await settle();
    expect(squatter.captures()).toEqual([]);
    expect(squatter.seen.map((r) => r.path)).toEqual(['/v1/hello']);
    expect(squatter.wire()).not.toContain(TOKEN);
    expect(squatter.wire()).not.toContain('payroll');
    forwardText('more', undefined, 'copy'); // backed off: not even another hello
    await settle();
    expect(squatter.seen).toHaveLength(1);
  });

  it('a desktop app that is not running never throws, never logs, and backs off instead of retrying', async () => {
    paired();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    forwardText('one1', undefined, 'copy');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) forwardText('more' + i, undefined, 'copy');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
  });

  it('tries again after the back-off', async () => {
    paired();
    fetchMock.mockRejectedValueOnce(new TypeError('down'));
    forwardText('one1', undefined, 'copy');
    await settle();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + BACKOFF_MS + 1000);
    const b = up();
    forwardText('two2', undefined, 'copy');
    await settle();
    vi.useRealTimers();
    expect(b.captures()).toHaveLength(1);
  });

  it('a refused single capture (400/413/415...) is DROPPED without backing off the whole bridge (F6)', async () => {
    paired();
    const b = up({ captureStatus: 413 });
    forwardText('too big for the app', undefined, 'copy');
    await settle();
    expect(b.captures()).toHaveLength(1);
    forwardText('the next copy is still sent', undefined, 'copy');
    await settle();
    expect(b.captures()).toHaveLength(2); // no 30 s global back-off after a mere refusal
  });

  it('an outage (5xx) still backs off', async () => {
    paired();
    const b = up({ captureStatus: 503 });
    forwardText('one1', undefined, 'copy');
    await settle();
    forwardText('two2', undefined, 'copy');
    await settle();
    expect(b.captures()).toHaveLength(1);
  });
});

describe('sanitizeSource (F6: fit the bridge limits before sending)', () => {
  it('strips query and hash, keeps http(s) only, caps the title at 300', () => {
    expect(sanitizeSource({ url: 'https://example.com/a/b?token=SECRET#frag', title: 'T'.repeat(500), favicon: 'https://example.com/f.ico' })).toEqual({
      url: 'https://example.com/a/b',
      title: 'T'.repeat(300),
      favicon: 'https://example.com/f.ico',
    });
  });

  it('omits non-http(s) URLs and over-long URLs instead of failing the whole capture', () => {
    expect(sanitizeSource({ url: 'chrome://settings', title: 'Settings' })).toEqual({ title: 'Settings' });
    expect(sanitizeSource({ url: 'file:///C:/secret.txt' })).toBeUndefined();
    expect(sanitizeSource({ url: 'javascript:alert(1)', title: 'x' })).toEqual({ title: 'x' });
    expect(sanitizeSource({ url: 'https://a.com/' + 'x'.repeat(2100), title: 'ok' })).toEqual({ title: 'ok' });
  });

  it('drops data: favicons and over-long favicon URLs, keeps plain http(s) ones', () => {
    expect(sanitizeSource({ title: 'T', favicon: 'data:image/png;base64,' + 'A'.repeat(30_000) })).toEqual({ title: 'T' });
    expect(sanitizeSource({ title: 'T', favicon: 'data:image/png;base64,AAAA' })).toEqual({ title: 'T' });
    expect(sanitizeSource({ title: 'T', favicon: 'https://a.com/' + 'x'.repeat(2100) })).toEqual({ title: 'T' });
    expect(sanitizeSource({ favicon: 'http://a.com/f.ico' })).toEqual({ favicon: 'http://a.com/f.ico' });
  });

  it('returns undefined when nothing usable is left', () => {
    expect(sanitizeSource(undefined)).toBeUndefined();
    expect(sanitizeSource({})).toBeUndefined();
    expect(sanitizeSource({ url: '', title: '', favicon: '' })).toBeUndefined();
  });

  it('forwarded captures use the sanitised source', async () => {
    paired();
    const b = up();
    forwardText('x1', { url: 'chrome://newtab', title: 'T'.repeat(400), favicon: 'data:image/png;base64,AAAA' }, 'copy');
    await settle();
    expect(b.captures()[0]!.json['source']).toEqual({ title: 'T'.repeat(300) });
  });
});
