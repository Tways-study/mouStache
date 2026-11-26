import { describe, expect, it, vi } from 'vitest';
import { choose, safeFence, wrapCodeBlock, type Content, type PasteFlowDeps } from './paste-flow';

function deps(over: Partial<PasteFlowDeps> = {}) {
  const order: string[] = [];
  const written: Content[] = [];
  const paste = vi.fn(async () => void order.push('paste'));
  const d: PasteFlowDeps = {
    platform: 'win32',
    fetchItem: async () => ({ kind: 'text', text: 'SELECT 1;' }),
    writeClipboard: (c) => void (order.push('write'), written.push(c)),
    hidePalette: () => void order.push('hide'),
    executor: { paste, dispose() {} },
    target: { name: 'Code', pid: 5, handle: '777' },
    canPaste: true,
    notify: vi.fn(),
    ...over,
  };
  return { d, order, written, paste };
}

describe('choose: paste', () => {
  it('writes the clipboard, hides the palette, THEN pastes into the remembered target', async () => {
    const t = deps();
    const r = await choose({ id: '1', mode: 'paste' }, t.d);
    expect(r).toEqual({ status: 'pasted', kind: 'text' });
    expect(t.order).toEqual(['write', 'hide', 'paste']);
    expect(t.written).toEqual([{ kind: 'text', text: 'SELECT 1;' }]);
    expect(t.paste).toHaveBeenCalledWith({ name: 'Code', pid: 5, handle: '777' });
  });

  it('pastes images too', async () => {
    const png = Buffer.from('png');
    const t = deps({ fetchItem: async () => ({ kind: 'image', png }) });
    expect(await choose({ id: '1', mode: 'paste' }, t.d)).toEqual({ status: 'pasted', kind: 'image' });
    expect(t.written[0]).toEqual({ kind: 'image', png });
  });

  it('pastes into whatever is in front when the target is unknown, but never into mouStache itself', async () => {
    const unknown = deps({ target: undefined });
    expect((await choose({ id: '1', mode: 'paste' }, unknown.d)).status).toBe('pasted');
    expect(unknown.paste).toHaveBeenCalledWith(undefined);

    const own = deps({ canPaste: false });
    expect((await choose({ id: '1', mode: 'paste' }, own.d)).status).toBe('copied');
    expect(own.paste).not.toHaveBeenCalled();
    expect(own.d.notify).toHaveBeenCalledWith('Copied, press Ctrl+V');
  });

  it('falls back to "Copied, press ..." when the keystroke helper fails', async () => {
    const t = deps();
    t.d.executor = { paste: async () => Promise.reject(new Error('no powershell')), dispose() {} };
    expect(await choose({ id: '1', mode: 'paste' }, t.d)).toEqual({ status: 'copied-paste-failed' });
    expect(t.d.notify).toHaveBeenCalledWith('Copied, press Ctrl+V');
  });
});

describe('choose: copy only (Shift+Enter)', () => {
  it('copies and hides but never sends a keystroke', async () => {
    const t = deps();
    expect(await choose({ id: '1', mode: 'copy' }, t.d)).toEqual({ status: 'copied', kind: 'text' });
    expect(t.order).toEqual(['write', 'hide']);
    expect(t.paste).not.toHaveBeenCalled();
    expect(t.d.notify).toHaveBeenCalledWith('Copied');
  });
});

describe('choose: paste as code block', () => {
  it('wraps text in a fenced block with the item language', async () => {
    const t = deps({ fetchItem: async () => ({ kind: 'text', text: 'SELECT 1;\n' }) });
    await choose({ id: '1', mode: 'code', fence: 'sql' }, t.d);
    expect(t.written).toEqual([{ kind: 'text', text: '```sql\nSELECT 1;\n```' }]);
    expect(t.paste).toHaveBeenCalled();
  });

  it('uses a longer fence when the text already contains one, and no label without a language', () => {
    expect(wrapCodeBlock('a ``` b')).toBe('````\na ``` b\n````');
    expect(wrapCodeBlock('print(1)', 'python')).toBe('```python\nprint(1)\n```');
  });

  it('only plain language labels can become the fence info string', () => {
    expect(safeFence('c++')).toBe('c++');
    expect(safeFence('csharp')).toBe('csharp');
    expect(safeFence('sql\n```\nrm -rf /')).toBeUndefined();
    expect(safeFence('x'.repeat(25))).toBeUndefined();
    expect(safeFence(5)).toBeUndefined();
    expect(wrapCodeBlock('x1', 'sql\n```evil')).toBe('```\nx1\n```');
  });

  it('leaves images alone in code mode', async () => {
    const png = Buffer.from('png');
    const t = deps({ fetchItem: async () => ({ kind: 'image', png }) });
    await choose({ id: '1', mode: 'code', fence: 'sql' }, t.d);
    expect(t.written[0]).toEqual({ kind: 'image', png });
  });
});

describe('choose: failures and macOS', () => {
  it('a missing item hides the palette and reports an error without touching the clipboard', async () => {
    const t = deps({ fetchItem: async () => undefined });
    expect((await choose({ id: 'x', mode: 'paste' }, t.d)).status).toBe('error');
    expect(t.written).toHaveLength(0);
    expect(t.order).toEqual(['hide']);
  });

  it('a clipboard write failure is reported and nothing is pasted', async () => {
    const t = deps({ writeClipboard: () => Promise.reject(new Error('busy')) });
    expect((await choose({ id: '1', mode: 'paste' }, t.d)).status).toBe('error');
    expect(t.paste).not.toHaveBeenCalled();
  });

  it('macOS without Accessibility: prompts once, copies, and tells the user to press the key', async () => {
    let prompted = false;
    const isTrusted = vi.fn((_p: boolean) => false);
    const t = deps({
      platform: 'darwin',
      accessibility: { isTrusted, wasPrompted: () => prompted, markPrompted: () => void (prompted = true) },
    });
    expect(await choose({ id: '1', mode: 'paste' }, t.d)).toEqual({ status: 'copied-no-permission' });
    expect(isTrusted.mock.calls).toEqual([[false], [true]]); // check silently, then ONE guided prompt
    expect(t.d.notify).toHaveBeenCalledWith('Copied, press ⌘V');
    expect(t.paste).not.toHaveBeenCalled();

    await choose({ id: '1', mode: 'paste' }, t.d);
    expect(isTrusted.mock.calls.filter(([p]) => p === true)).toHaveLength(1); // never prompts twice
  });

  it('macOS with Accessibility granted pastes normally', async () => {
    const t = deps({ platform: 'darwin', accessibility: { isTrusted: () => true, wasPrompted: () => true, markPrompted() {} } });
    expect((await choose({ id: '1', mode: 'paste' }, t.d)).status).toBe('pasted');
  });
});
