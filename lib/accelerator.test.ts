import { describe, expect, it } from 'vitest';
import { acceleratorFromKeyEvent, validateAccelerator } from './accelerator';

describe('validateAccelerator', () => {
  it('accepts the defaults and normalises names and order', () => {
    expect(validateAccelerator('Alt+Shift+V')).toEqual({ ok: true, accelerator: 'Alt+Shift+V' });
    expect(validateAccelerator('shift+alt+s')).toEqual({ ok: true, accelerator: 'Alt+Shift+S' });
    expect(validateAccelerator('Ctrl+Alt+F12')).toEqual({ ok: true, accelerator: 'Control+Alt+F12' });
    expect(validateAccelerator('Cmd+Option+Space')).toEqual({ ok: true, accelerator: 'Command+Alt+Space' });
    expect(validateAccelerator('CmdOrCtrl+Shift+Plus')).toEqual({ ok: true, accelerator: 'CommandOrControl+Shift+Plus' });
    expect(validateAccelerator('Ctrl+Alt+/')).toEqual({ ok: true, accelerator: 'Control+Alt+/' });
  });

  it.each([
    ['', /Enter a shortcut/],
    ['   ', /Enter a shortcut/],
    ['V', /Include Ctrl, Alt/],
    ['Shift+V', /Include Ctrl, Alt/],
    ['Alt+Shift', /Add a key/],
    ['Alt+V+S', /exactly one key/],
    ['Alt+Alt+V', /twice/],
    ['Alt+', /Plus/],
    ['Ctrl++', /Plus/],
    ['Alt+Banana', /not a key/],
    ['Alt+F25', /not a key/],
  ])('rejects %j with a clear message', (input, msg) => {
    const r = validateAccelerator(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });

  it('rejects shortcuts that would hijack the system or copy/paste', () => {
    for (const bad of ['Alt+F4', 'Alt+Tab', 'Ctrl+C', 'CmdOrCtrl+V', 'Ctrl+Alt+Delete', 'Cmd+Q', 'Super+L']) {
      const r = validateAccelerator(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/reserved/);
    }
  });

  it('rejects non-strings and absurd input', () => {
    expect(validateAccelerator(undefined).ok).toBe(false);
    expect(validateAccelerator(42).ok).toBe(false);
    expect(validateAccelerator('Alt+' + 'x'.repeat(100)).ok).toBe(false);
  });
});

describe('acceleratorFromKeyEvent', () => {
  const ev = (o: Partial<Parameters<typeof acceleratorFromKeyEvent>[0]>) => ({
    key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o,
  });
  it('uses the physical key so Alt/Shift do not change the letter', () => {
    expect(acceleratorFromKeyEvent(ev({ key: 'V', code: 'KeyV', altKey: true, shiftKey: true }), false)).toBe('Alt+Shift+V');
    expect(acceleratorFromKeyEvent(ev({ key: '√', code: 'KeyV', altKey: true, shiftKey: true }), true)).toBe('Alt+Shift+V');
    expect(acceleratorFromKeyEvent(ev({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }), false)).toBe('Control+Shift+1');
  });
  it('maps meta per platform and named keys', () => {
    expect(acceleratorFromKeyEvent(ev({ key: ' ', code: 'Space', metaKey: true }), true)).toBe('Command+Space');
    expect(acceleratorFromKeyEvent(ev({ key: 'ArrowUp', ctrlKey: true, altKey: true }), false)).toBe('Control+Alt+Up');
    expect(acceleratorFromKeyEvent(ev({ key: 'F9', altKey: true }), false)).toBe('Alt+F9');
  });
  it('returns undefined while only modifiers are down', () => {
    expect(acceleratorFromKeyEvent(ev({ key: 'Alt', code: 'AltLeft', altKey: true }), false)).toBeUndefined();
    expect(acceleratorFromKeyEvent(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), false)).toBeUndefined();
  });
  it('round trips through validation', () => {
    const a = acceleratorFromKeyEvent(ev({ key: 'S', code: 'KeyS', altKey: true, shiftKey: true }), false)!;
    expect(validateAccelerator(a)).toEqual({ ok: true, accelerator: 'Alt+Shift+S' });
  });
});
