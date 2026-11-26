import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractCopiedText, MAX_COPY_LENGTH } from './selection';
import { createDedupe, createRateLimit, debounce } from './debounce';
import { hasUserActivation, isSensitiveField } from './selection';
import { insertAtCursor } from './insert';
import { relativeTime, previewLine, hostname } from './labels';

beforeEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('extractCopiedText', () => {
  it('reads the document selection', () => {
    document.body.innerHTML = '<p id="p">hello world</p>';
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p')!);
    window.getSelection()!.addRange(range);
    expect(extractCopiedText()).toBe('hello world');
  });

  it('falls back to selected substring of a focused input', () => {
    document.body.innerHTML = '<input id="i" value="select * from t" />';
    const i = document.getElementById('i') as HTMLInputElement;
    i.focus();
    i.setSelectionRange(0, 6);
    const win = { document, getSelection: () => ({ toString: () => '' }) } as unknown as Window;
    expect(extractCopiedText(win)).toBe('select');
  });

  it('ignores password inputs, empty and oversized text', () => {
    document.body.innerHTML = '<input id="i" type="password" value="hunter2" />';
    const i = document.getElementById('i') as HTMLInputElement;
    i.focus();
    i.select();
    const win = { document, getSelection: () => ({ toString: () => 'hunter2' }) } as unknown as Window;
    expect(extractCopiedText(win)).toBeNull();

    document.body.innerHTML = '';
    expect(extractCopiedText()).toBeNull();

    const big = { document, getSelection: () => ({ toString: () => 'x'.repeat(MAX_COPY_LENGTH + 1) }) } as unknown as Window;
    expect(extractCopiedText(big)).toBeNull();
  });
});

describe('debounce / dedupe', () => {
  it('debounces trailing calls', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 80);
    d('a');
    d('b');
    vi.advanceTimersByTime(79);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
    vi.useRealTimers();
  });

  it('dedupes identical text within the window', () => {
    let t = 1000;
    const ok = createDedupe(1000, () => t);
    expect(ok('x')).toBe(true);
    t += 500;
    expect(ok('x')).toBe(false);
    expect(ok('y')).toBe(true);
    t += 1600;
    expect(ok('x')).toBe(true);
  });
});

describe('insertAtCursor', () => {
  it('inserts at the caret in a textarea and fires input', () => {
    document.body.innerHTML = '<textarea id="t">ab</textarea>';
    const t = document.getElementById('t') as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(1, 1);
    const onInput = vi.fn();
    t.addEventListener('input', onInput);
    expect(insertAtCursor(t, 'XY')).toBe(true);
    expect(t.value).toBe('aXYb');
    expect(t.selectionStart).toBe(3);
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('replaces the selection and refuses readonly/non-editable', () => {
    document.body.innerHTML = '<input id="i" value="hello" /><input id="r" readonly value="x" /><div id="d"></div>';
    const i = document.getElementById('i') as HTMLInputElement;
    i.setSelectionRange(0, 5);
    insertAtCursor(i, 'bye');
    expect(i.value).toBe('bye');
    expect(insertAtCursor(document.getElementById('r'), 'z')).toBe(false);
    expect(insertAtCursor(document.getElementById('d'), 'z')).toBe(false);
    expect(insertAtCursor(null, 'z')).toBe(false);
  });
});

describe('labels', () => {
  it('formats relative time', () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 10_000, now)).toBe('now');
    expect(relativeTime(now - 2 * 60_000, now)).toBe('2m');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d');
  });
  it('previews first non-empty line and hostnames', () => {
    expect(previewLine('\n\n  foo   bar\nbaz')).toBe('foo bar');
    expect(hostname('https://www.github.com/x')).toBe('github.com');
    expect(hostname('nope')).toBeUndefined();
  });
});

describe('createRateLimit', () => {
  it('allows max calls per window then drops, recovering later', () => {
    let t = 0;
    const ok = createRateLimit(10, 10_000, () => t);
    for (let i = 0; i < 10; i++) expect(ok()).toBe(true);
    expect(ok()).toBe(false);
    t = 10_001;
    expect(ok()).toBe(true);
  });
});

describe('isSensitiveField / hasUserActivation', () => {
  it('flags credential-like fields by name/id/autocomplete', () => {
    document.body.innerHTML = '<input id="a" name="otp-code"><input id="b" autocomplete="cc-number"><input id="c" name="q">';
    expect(isSensitiveField(document.getElementById('a'))).toBe(true);
    expect(isSensitiveField(document.getElementById('b'))).toBe(true);
    expect(isSensitiveField(document.getElementById('c'))).toBe(false);
    expect(isSensitiveField(null)).toBe(false);
  });
  it('treats missing userActivation as allowed', () => {
    expect(hasUserActivation({})).toBe(true);
    expect(hasUserActivation({ userActivation: { isActive: false } })).toBe(false);
    expect(hasUserActivation({ userActivation: { isActive: true } })).toBe(true);
  });
});
