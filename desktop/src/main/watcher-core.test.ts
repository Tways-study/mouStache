import { describe, expect, it, vi } from 'vitest';
import {
  bytesKey,
  createOwnWriteGuard,
  createWatcherCore,
  isConcealed,
  isPausedApp,
  textKey,
  type Capture,
  type ClipboardReader,
} from './watcher-core';

/** A fake clipboard the tests mutate between ticks. */
function fakeClipboard() {
  const st = { text: '', formats: new Set<string>(), buffers: new Map<string, Buffer>(), image: undefined as string | undefined };
  const reader: ClipboardReader = {
    hasFormat: async (f) => st.formats.has(f),
    readBuffer: async (f) => st.buffers.get(f),
    readText: async () => st.text,
    hasImage: async () => st.image !== undefined,
    readImage: async () => (st.image === undefined ? undefined : { key: bytesKey(2, 2, Buffer.from(st.image)), png: () => Buffer.from('PNG:' + st.image) }),
  };
  return { st, reader };
}

function setup(over: { paused?: () => boolean; maxTextBytes?: number } = {}) {
  const cb = fakeClipboard();
  const captured: Capture[] = [];
  const guard = createOwnWriteGuard();
  const core = createWatcherCore({
    reader: cb.reader,
    guard,
    isPaused: over.paused ?? (() => false),
    onCapture: (c) => void captured.push(c),
    maxTextBytes: over.maxTextBytes,
  });
  return { ...cb, captured, guard, core };
}

describe('change detection', () => {
  it('the first tick is a baseline: existing clipboard content is not captured', async () => {
    const t = setup();
    t.st.text = 'already here';
    expect(await t.core.tick()).toBe('baseline');
    expect(t.captured).toHaveLength(0);
  });

  it('captures a new text once, then reports unchanged', async () => {
    const t = setup();
    await t.core.tick();
    t.st.text = 'SELECT 1;';
    expect(await t.core.tick()).toBe('captured');
    expect(await t.core.tick()).toBe('unchanged');
    expect(t.captured).toEqual([{ kind: 'text', text: 'SELECT 1;' }]);
  });

  it('captures a different text, and the same text again after something else', async () => {
    const t = setup();
    await t.core.tick();
    for (const x of ['a', 'b', 'a']) {
      t.st.text = x;
      await t.core.tick();
    }
    expect(t.captured.map((c) => (c.kind === 'text' ? c.text : ''))).toEqual(['a', 'b', 'a']);
  });

  it('captures images, preferring text when both are present', async () => {
    const t = setup();
    await t.core.tick();
    t.st.image = 'pixels-1';
    expect(await t.core.tick()).toBe('captured');
    expect(t.captured[0]).toMatchObject({ kind: 'image' });
    t.st.text = 'cell text';
    await t.core.tick();
    expect(t.captured[1]).toEqual({ kind: 'text', text: 'cell text' });
    t.st.image = 'pixels-1';
    expect(await t.core.tick()).toBe('unchanged');
  });

  it('a different image is a new capture; identical pixels are not', async () => {
    const t = setup();
    await t.core.tick();
    t.st.image = 'one';
    await t.core.tick();
    t.st.image = 'one';
    expect(await t.core.tick()).toBe('unchanged');
    t.st.image = 'two';
    expect(await t.core.tick()).toBe('captured');
  });

  it('ignores whitespace-only text and an empty clipboard', async () => {
    const t = setup();
    await t.core.tick();
    t.st.text = '  \n ';
    expect(await t.core.tick()).toBe('empty');
    expect(t.captured).toHaveLength(0);
  });
});

describe('pause', () => {
  it('does not read or capture while paused, and re-baselines on resume', async () => {
    let paused = false;
    const t = setup({ paused: () => paused });
    await t.core.tick();
    paused = true;
    t.st.text = 'copied while paused';
    expect(await t.core.tick()).toBe('paused');
    paused = false;
    expect(await t.core.tick()).toBe('baseline'); // not captured retroactively
    expect(t.captured).toHaveLength(0);
    t.st.text = 'after resume';
    expect(await t.core.tick()).toBe('captured');
  });
});

describe('own-write guard', () => {
  it('ignores a clipboard write mouStache marked, once', async () => {
    const t = setup();
    await t.core.tick();
    t.guard.mark(textKey('from the panel'));
    t.st.text = 'from the panel';
    expect(await t.core.tick()).toBe('own-write');
    expect(t.captured).toHaveLength(0);
    // the user later copies the same text on purpose: that counts
    t.st.text = 'other';
    await t.core.tick();
    t.st.text = 'from the panel';
    expect(await t.core.tick()).toBe('captured');
  });

  it('treats CRLF and LF text as the same write', async () => {
    const t = setup();
    await t.core.tick();
    t.guard.mark(textKey('a\nb'));
    t.st.text = 'a\r\nb';
    expect(await t.core.tick()).toBe('own-write');
  });

  it('marks expire', async () => {
    let now = 0;
    const g = createOwnWriteGuard(() => now, 1000);
    g.mark('k');
    now = 1001;
    expect(g.consume('k')).toBe(false);
  });

  it('guards images by pixel fingerprint', async () => {
    const t = setup();
    await t.core.tick();
    t.guard.mark(bytesKey(2, 2, Buffer.from('mine')));
    t.st.image = 'mine';
    expect(await t.core.tick()).toBe('own-write');
  });
});

describe('concealed entries', () => {
  it.each([
    'org.nspasteboard.ConcealedType',
    'org.nspasteboard.TransientType',
    'ExcludeClipboardContentFromMonitorProcessing',
  ])('never captures when %s is present, and never reads the content', async (fmt) => {
    const t = setup();
    const read = vi.spyOn(t.reader, 'readText');
    await t.core.tick();
    t.st.text = 'hunter2-from-password-manager';
    t.st.formats.add(fmt);
    expect(await t.core.tick()).toBe('concealed');
    expect(await t.core.tick()).toBe('unchanged');
    expect(t.captured).toHaveLength(0);
    expect(read).toHaveBeenCalledTimes(1); // only the baseline tick read text
  });

  it('CanIncludeInClipboardHistory = 0 is concealed; 1 is not', async () => {
    const zero = Buffer.alloc(4);
    const one = Buffer.alloc(4);
    one.writeUInt32LE(1, 0);
    const mk = (b: Buffer) => ({ hasFormat: async (f: string) => f === 'CanIncludeInClipboardHistory', readBuffer: async () => b });
    expect(await isConcealed(mk(zero))).toBe(true);
    expect(await isConcealed(mk(one))).toBe(false);
  });

  it('captures again once the concealed flag is gone', async () => {
    const t = setup();
    await t.core.tick();
    t.st.text = 'secret';
    t.st.formats.add('org.nspasteboard.ConcealedType');
    await t.core.tick();
    t.st.formats.clear();
    t.st.text = 'normal copy';
    expect(await t.core.tick()).toBe('captured');
  });
});

describe('size cap', () => {
  it('skips text over the cap and keeps working afterwards', async () => {
    const t = setup({ maxTextBytes: 10 });
    await t.core.tick();
    t.st.text = 'x'.repeat(11);
    expect(await t.core.tick()).toBe('too-large');
    t.st.text = 'ok';
    expect(await t.core.tick()).toBe('captured');
    expect(t.captured).toEqual([{ kind: 'text', text: 'ok' }]);
  });

  it('counts bytes, not characters', async () => {
    const t = setup({ maxTextBytes: 5 });
    await t.core.tick();
    t.st.text = 'ééé'; // 6 bytes
    expect(await t.core.tick()).toBe('too-large');
  });

  it('defaults to about 500 KB', async () => {
    const t = setup();
    await t.core.tick();
    t.st.text = 'a'.repeat(499_000);
    expect(await t.core.tick()).toBe('captured');
    t.st.text = 'a'.repeat(500_001);
    expect(await t.core.tick()).toBe('too-large');
  });
});

describe('isPausedApp', () => {
  const list = ['1Password', 'Bitwarden', 'KeePass', 'LastPass', 'Dashlane'];
  it('matches by case-insensitive substring and strips .exe', async () => {
    expect(isPausedApp('1Password', list)).toBe(true);
    expect(isPausedApp('1password.exe', list)).toBe(true);
    expect(isPausedApp('1Password 7 - Password Manager', list)).toBe(true);
    expect(isPausedApp('KeePassXC', list)).toBe(true);
    expect(isPausedApp('bitwarden', list)).toBe(true);
  });
  it('does not match other apps, unknown apps or empty entries', async () => {
    expect(isPausedApp('Code', list)).toBe(false);
    expect(isPausedApp('WindowsTerminal', list)).toBe(false);
    expect(isPausedApp(undefined, list)).toBe(false);
    expect(isPausedApp('Code', ['', '  '])).toBe(false);
  });
});

describe('overlapping / out-of-order polls (regression: a stale read must never be captured)', () => {
  /** A reader whose text reads are resolved by the test, in any order. */
  function controllable() {
    const reads: Array<(v: string) => void> = [];
    const concealed = { value: false };
    const reader: ClipboardReader = {
      hasFormat: async () => concealed.value,
      readBuffer: async () => undefined,
      readText: () => new Promise<string>((res) => reads.push(res)),
      hasImage: async () => false,
      readImage: async () => undefined,
    };
    const captured: Capture[] = [];
    const core = createWatcherCore({ reader, guard: createOwnWriteGuard(), isPaused: () => false, onCapture: (c) => void captured.push(c) });
    return { reads, concealed, core, captured };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('an older poll that finishes late is ignored, so the previous clipboard content is not captured', async () => {
    const t = controllable();
    const baseline = t.core.tick();
    await flush();
    t.reads[0]!('old content from before'); // baseline sees the old content
    expect(await baseline).toBe('baseline');

    const slow = t.core.tick(); // started before the copy...
    await flush();
    const fast = t.core.tick(); // ...and a newer poll that sees the new copy
    await flush();
    t.reads[2]!('new copy'); // newer poll finishes first
    expect(await fast).toBe('captured');
    t.reads[1]!('old content from before'); // the older read completes late with stale data
    expect(await slow).toBe('unchanged');
    expect(t.captured).toEqual([{ kind: 'text', text: 'new copy' }]); // captured exactly once, never the old text
  });

  it('a copy that turns concealed between the first check and the read is dropped, not saved', async () => {
    const t = controllable();
    const baseline = t.core.tick();
    await flush();
    t.reads[0]!('');
    await baseline;
    const p = t.core.tick();
    await flush();
    t.concealed.value = true; // the password manager flags the clipboard while we are reading it
    t.reads[1]!('hunter2');
    expect(await p).toBe('concealed');
    expect(t.captured).toHaveLength(0);
  });
});

describe('more "do not record" signals (security review F12)', () => {
  const reader = (has: string[], zero: string[] = [], one: string[] = []) => ({
    hasFormat: async (f: string) => has.includes(f) || zero.includes(f) || one.includes(f),
    readBuffer: async (f: string) => {
      const b = Buffer.alloc(4);
      if (one.includes(f)) b.writeUInt32LE(1, 0);
      return zero.includes(f) || one.includes(f) ? b : undefined;
    },
  });

  it.each(['Clipboard Viewer Ignore', 'org.nspasteboard.AutoGeneratedType', 'org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType', 'ExcludeClipboardContentFromMonitorProcessing'])(
    'presence of %s means concealed',
    async (f) => {
      expect(await isConcealed(reader([f]))).toBe(true);
    },
  );

  it('CanUploadToCloudClipboard = 0 means concealed; = 1 does not', async () => {
    expect(await isConcealed(reader([], ['CanUploadToCloudClipboard']))).toBe(true);
    expect(await isConcealed(reader([], [], ['CanUploadToCloudClipboard']))).toBe(false);
  });

  it('CanIncludeInClipboardHistory = 0 still means concealed (and 1 does not)', async () => {
    expect(await isConcealed(reader([], ['CanIncludeInClipboardHistory']))).toBe(true);
    expect(await isConcealed(reader([], [], ['CanIncludeInClipboardHistory']))).toBe(false);
  });

  it('an ordinary clipboard is not concealed', async () => {
    expect(await isConcealed(reader([]))).toBe(false);
  });

  it('the watcher skips a copy carrying any of the new formats and never reads its text', async () => {
    for (const fmt of ['Clipboard Viewer Ignore', 'org.nspasteboard.AutoGeneratedType']) {
      const t = setup();
      const read = vi.spyOn(t.reader, 'readText');
      await t.core.tick();
      t.st.text = 'something-secret';
      t.st.formats.add(fmt);
      expect(await t.core.tick()).toBe('concealed');
      expect(t.captured).toHaveLength(0);
      expect(read).toHaveBeenCalledTimes(1);
    }
  });
});
