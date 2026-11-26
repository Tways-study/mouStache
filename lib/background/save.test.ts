import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
const badgeCalls: string[] = [];
const sendTab = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock('wxt/browser', () => {
  const area = {
    get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
    set: async (v: Record<string, unknown>) => void Object.assign(store, v),
  };
  return {
    browser: {
      storage: { local: area, session: area },
      action: {
        setBadgeText: async ({ text }: { text: string }) => void badgeCalls.push(text),
        setBadgeBackgroundColor: async () => undefined,
      },
      runtime: { sendMessage: async () => { throw new Error('Receiving end does not exist'); } },
      tabs: { sendMessage: (...a: unknown[]) => sendTab(...a) },
    },
  };
});

let secret = false;
vi.mock('../classify', () => ({
  classify: (t: string) => ({ tags: ['x'], secret: secret && t.includes('SECRET'), group: 'other' }),
  tagGroup: () => 'other',
}));

import { db, countItems } from '../db';
import { _setOpenPanels, getUnseen } from './badge';
import { isPausedHost, isSingleUrl, saveImage, saveText, stripUrl } from './save';
import { DEFAULT_SETTINGS } from '../types';

const SETTINGS_KEY = 'stash:settings';

beforeEach(async () => {
  await db.items.clear();
  for (const k of Object.keys(store)) delete store[k];
  badgeCalls.length = 0;
  sendTab.mockClear();
  secret = false;
  _setOpenPanels(0);
});

describe('saveText', () => {
  it('skips empty text', async () => {
    expect(await saveText('   \n', undefined, 'copy')).toMatchObject({ ok: true, skipped: 'empty' });
    expect(await countItems()).toBe(0);
  });

  it('skips copy when autoCapture disabled but context-menu still saves', async () => {
    store[SETTINGS_KEY] = { autoCapture: false };
    expect(await saveText('hello', undefined, 'copy')).toMatchObject({ skipped: 'disabled' });
    expect((await saveText('hello', undefined, 'context-menu')).skipped).toBeUndefined();
  });

  it('skips paused hosts (including subdomains)', async () => {
    store[SETTINGS_KEY] = { pausedHosts: ['bank.com'] };
    const r = await saveText('hello', { url: 'https://www.bank.com/x' }, 'copy');
    expect(r.skipped).toBe('paused');
    expect(await countItems()).toBe(0);
  });

  it('skips secrets on copy, saves them on context-menu with secret flag', async () => {
    secret = true;
    expect((await saveText('SECRET key', undefined, 'copy')).skipped).toBe('secret');
    const r = await saveText('SECRET key', undefined, 'context-menu');
    expect(r.ok).toBe(true);
    const item = await db.items.get(r.id!);
    expect(item?.secret).toBe(true);
  });

  it('detects links vs text', async () => {
    const a = await saveText('  https://example.com/a?b=1  ', undefined, 'copy');
    const b = await saveText('see https://example.com', undefined, 'copy');
    expect((await db.items.get(a.id!))?.kind).toBe('link');
    expect((await db.items.get(b.id!))?.kind).toBe('text');
  });

  it('increments badge once; dedupe does not increment', async () => {
    const a = await saveText('same', undefined, 'copy');
    expect(a.deduped).toBe(false);
    expect(await getUnseen()).toBe(1);
    const b = await saveText('same', undefined, 'copy');
    expect(b.deduped).toBe(true);
    expect(await getUnseen()).toBe(1);
    expect(badgeCalls).toEqual(['1']);
  });

  it('does not increment while side panel open', async () => {
    _setOpenPanels(1);
    await saveText('abc', undefined, 'copy');
    expect(await getUnseen()).toBe(0);
  });

  it('toasts the sender tab', async () => {
    await saveText('abc', undefined, 'copy', 7);
    expect(sendTab).toHaveBeenCalledWith(7, { type: 'show-toast', text: 'Saved to mouStache' });
    await saveText('abc', undefined, 'copy', 7);
    expect(sendTab).toHaveBeenLastCalledWith(7, { type: 'show-toast', text: 'Already in mouStache — moved to top' });
  });

  it('caps text length', async () => {
    const r = await saveText('a'.repeat(250_000), undefined, 'copy');
    expect((await db.items.get(r.id!))?.text?.length).toBe(200_000);
  });
});

describe('helpers', () => {
  it('isSingleUrl', () => {
    expect(isSingleUrl('https://a.com')).toBe(true);
    expect(isSingleUrl('a.com')).toBe(false);
    expect(isSingleUrl('https://a.com b')).toBe(false);
    expect(isSingleUrl('javascript:alert(1)')).toBe(false);
  });
  it('isPausedHost', () => {
    expect(isPausedHost('a.b.com', ['b.com'])).toBe(true);
    expect(isPausedHost('notb.com', ['b.com'])).toBe(false);
    expect(isPausedHost(undefined, ['b.com'])).toBe(false);
  });
});

describe('privacy defaults', () => {
  it('ships password-manager hosts as paused by default (with subdomains)', () => {
    expect(DEFAULT_SETTINGS.pausedHosts).toContain('1password.com');
    expect(isPausedHost('my.1password.com', DEFAULT_SETTINGS.pausedHosts)).toBe(true);
    expect(isPausedHost('accounts.google.com', DEFAULT_SETTINGS.pausedHosts)).toBe(true);
    expect(isPausedHost('example.com', DEFAULT_SETTINGS.pausedHosts)).toBe(false);
  });
  it('strips query and hash from stored source urls', async () => {
    expect(stripUrl('https://a.com/p?token=1#x')).toBe('https://a.com/p');
    await saveText('some text', { url: 'https://a.com/p?token=1#x' }, 'context-menu');
    const [it1] = await db.items.toArray();
    expect(it1!.source?.url).toBe('https://a.com/p');
  });
});

describe('saveImage refuses non-raster images (security review F11)', () => {
  it.each(['image/svg+xml', 'text/html', 'application/pdf'])('rejects %s and stores nothing', async (type) => {
    const r = await saveImage(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], { type }), undefined, 'copy');
    expect(r).toMatchObject({ ok: false, error: 'Unsupported image type' });
    expect(await countItems()).toBe(0);
  });
  it('rejects an SVG data URL too', async () => {
    const r = await saveImage('data:image/svg+xml;base64,PHN2Zy8+', undefined, 'copy');
    expect(r.ok).toBe(false);
    expect(await countItems()).toBe(0);
  });
});
