import { describe, expect, it, vi } from 'vitest';
import { SECRET_CLEAR_MS, secretFormats, withSecretClear, type ClipboardPrimitives, type TimerApi } from './secret-clipboard';
import { isConcealed } from './watcher-core';

/** A clipboard + manual timers so the 30 s clear can be driven deterministically. */
function setup(ttlMs?: number) {
  const st = { text: '', formats: new Set<string>(), cleared: 0 };
  const base: ClipboardPrimitives = {
    writeText: (t) => void ((st.text = t), st.formats.clear()),
    writeSecretText: (t) => void ((st.text = t), (st.formats = new Set(Object.keys(secretFormats('win32'))))),
    writePng: () => void ((st.text = ''), st.formats.clear()),
    readText: () => st.text,
    clear: () => void ((st.text = ''), st.formats.clear(), st.cleared++),
  };
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let now = 0;
  let nextId = 1;
  const api: TimerApi = {
    set: (fn, ms) => {
      const t = { id: nextId++, at: now + ms, fn };
      timers.push(t);
      return t.id;
    },
    clear: (id) => void timers.splice(0, timers.length, ...timers.filter((t) => t.id !== id)),
  };
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  return { st, out: withSecretClear(base, { ttlMs, timers: api }), advance, pending: () => timers.length };
}

describe('secret formats', () => {
  it('Windows: excludes from monitors, history and cloud sync, and viewers', () => {
    const f = secretFormats('win32');
    expect(Object.keys(f).sort()).toEqual(['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard', 'Clipboard Viewer Ignore', 'ExcludeClipboardContentFromMonitorProcessing']);
    expect([...f['CanIncludeInClipboardHistory']!]).toEqual([0, 0, 0, 0]);
    expect([...f['CanUploadToCloudClipboard']!]).toEqual([0, 0, 0, 0]);
  });
  it('macOS: the ConcealedType marker; other platforms: nothing', () => {
    expect(Object.keys(secretFormats('darwin'))).toEqual(['org.nspasteboard.ConcealedType']);
    expect(secretFormats('linux')).toEqual({});
  });
  it('what we write is exactly what our own watcher treats as concealed (so it can never re-capture its own secret)', async () => {
    const win = secretFormats('win32');
    const reader = {
      hasFormat: async (f: string) => f in win,
      readBuffer: async (f: string) => (win[f] ? Buffer.from(win[f]!) : undefined),
    };
    expect(await isConcealed(reader)).toBe(true);
    const mac = secretFormats('darwin');
    expect(await isConcealed({ hasFormat: async (f) => f in mac, readBuffer: async () => undefined })).toBe(true);
  });
});

describe('auto-clear of secrets on the clipboard', () => {
  it('clears after the default 30 s if the clipboard still holds the secret', async () => {
    const t = setup();
    await t.out.writeSecretText('AKIAIOSFODNN7EXAMPLE');
    expect(t.st.text).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(t.st.formats.has('CanUploadToCloudClipboard')).toBe(true);
    await t.advance(SECRET_CLEAR_MS - 1);
    expect(t.st.text).toBe('AKIAIOSFODNN7EXAMPLE');
    await t.advance(1);
    expect(t.st.text).toBe('');
    expect(t.st.cleared).toBe(1);
  });

  it('does NOT clear if the user has copied something else in the meantime', async () => {
    const t = setup(1000);
    await t.out.writeSecretText('sk-secret-value-123456');
    t.st.text = 'something the user copied later';
    await t.advance(1000);
    expect(t.st.text).toBe('something the user copied later');
    expect(t.st.cleared).toBe(0);
  });

  it('treats CRLF and LF as the same value', async () => {
    const t = setup(1000);
    await t.out.writeSecretText('line1\nline2 secret');
    t.st.text = 'line1\r\nline2 secret';
    await t.advance(1000);
    expect(t.st.cleared).toBe(1);
  });

  it('a newer secret write restarts the countdown', async () => {
    const t = setup(1000);
    await t.out.writeSecretText('first-secret-value');
    await t.advance(800);
    await t.out.writeSecretText('second-secret-value');
    await t.advance(800);
    expect(t.st.text).toBe('second-secret-value'); // the first timer must not have wiped it early
    await t.advance(200);
    expect(t.st.text).toBe('');
    expect(t.pending()).toBe(0);
  });

  it('an ordinary write supersedes a pending clear (nothing left to wipe, nothing wiped by mistake)', async () => {
    const t = setup(1000);
    await t.out.writeSecretText('a-secret-value-1');
    await t.out.writeText('ordinary text');
    expect(t.pending()).toBe(0);
    await t.advance(5000);
    expect(t.st.text).toBe('ordinary text');
    expect(t.st.cleared).toBe(0);
  });

  it('an ordinary write has no secret formats', async () => {
    const t = setup();
    await t.out.writeText('hello');
    expect(t.st.formats.size).toBe(0);
  });

  it('a clipboard that throws while clearing never breaks anything', async () => {
    const t = setup(500);
    const bad: ClipboardPrimitives = { ...t.out, readText: () => Promise.reject(new Error('busy')) };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const guard = withSecretClear(bad, { ttlMs: 10, timers: { set: (fn) => void fn(), clear: () => undefined } });
    await expect(guard.writeSecretText('x-secret-12345')).resolves.toBeUndefined();
    logged.mockRestore();
  });
});
