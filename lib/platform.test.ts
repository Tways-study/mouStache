import { describe, expect, it } from 'vitest';
import { comboText, detectMac, keyLabel } from './platform';

describe('platform hints', () => {
  it('detects macOS from userAgentData or navigator.platform', () => {
    expect(detectMac({ platform: 'MacIntel' } as Navigator)).toBe(true);
    expect(detectMac({ platform: '', userAgentData: { platform: 'macOS' } } as unknown as Navigator)).toBe(true);
    expect(detectMac({ platform: 'Win32' } as Navigator)).toBe(false);
    expect(detectMac(undefined)).toBe(false);
  });

  it('maps keys per platform', () => {
    expect(keyLabel('Mod', true)).toBe('⌘');
    expect(keyLabel('Mod', false)).toBe('Ctrl');
    expect(keyLabel('Alt', true)).toBe('⌥');
    expect(keyLabel('V', true)).toBe('V');
    expect(keyLabel('Win', false)).toBe('Win');
  });

  it('formats combos', () => {
    expect(comboText(['Alt', 'Shift', 'V'], true)).toBe('⌥⇧V');
    expect(comboText(['Alt', 'Shift', 'V'], false)).toBe('Alt+Shift+V');
    expect(comboText(['Mod', 'V'], true)).toBe('⌘V');
    expect(comboText(['Mod', 'V'], false)).toBe('Ctrl+V');
  });
});
