import { beforeEach, describe, expect, it, vi } from 'vitest';

let listener: ((...a: unknown[]) => unknown) | undefined;
const store: Record<string, unknown> = {};

vi.mock('wxt/browser', () => {
  const area = {
    get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
    set: async (v: Record<string, unknown>) => void Object.assign(store, v),
  };
  return {
    browser: {
      storage: { local: area, session: area },
      action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
      runtime: {
        sendMessage: async () => {
          throw new Error('none');
        },
        onMessage: { addListener: (l: (...a: unknown[]) => unknown) => void (listener = l) },
      },
      tabs: { sendMessage: async () => undefined },
    },
  };
});

import { addItem, db } from '../db';
import { registerMessageRouter } from './router';

beforeEach(async () => {
  await db.items.clear();
  registerMessageRouter();
});

describe('registerMessageRouter', () => {
  it('returns true and responds later via sendResponse (never a Promise)', async () => {
    const sendResponse = vi.fn();
    const ret = listener!({ type: 'search', query: '', limit: 10 }, {}, sendResponse);
    expect(ret).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(sendResponse.mock.calls[0]![0]).toEqual([]);
  });

  it('ignores unhandled and foreign messages synchronously', () => {
    const sr = vi.fn();
    expect(listener!({ type: 'items-changed' }, {}, sr)).toBe(false);
    expect(listener!('nope', {}, sr)).toBe(false);
    expect(sr).not.toHaveBeenCalled();
  });

  it('search returns truncated previews and omits text for secrets', async () => {
    await addItem({ kind: 'text', text: 'x'.repeat(5000), hash: 'a', via: 'copy' });
    await addItem({ kind: 'text', text: 'TOPSECRET', hash: 'b', via: 'copy', secret: true });
    const sendResponse = vi.fn();
    listener!({ type: 'search', query: '', limit: 10 }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    const out = sendResponse.mock.calls[0]![0] as { text?: string; secret: boolean }[];
    expect(out.find((i) => !i.secret)!.text).toHaveLength(600);
    expect(out.find((i) => i.secret)!.text).toBeUndefined();
  });
});
