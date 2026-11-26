/** Platform helpers so hints show the keys people actually press (⌘ on macOS, Ctrl on Windows/Linux). */

interface NavigatorWithUAData extends Navigator {
  userAgentData?: { platform?: string };
}

export function detectMac(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  const platform = (nav as NavigatorWithUAData).userAgentData?.platform || nav.platform || '';
  return /mac|iphone|ipad/i.test(platform);
}

export const isMac = detectMac();

/** Key names used in hints. "Mod" = the primary shortcut key: ⌘ on macOS, Ctrl elsewhere. */
const MAC_SYMBOLS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Del: '⌫', Enter: '↩', Esc: '⎋' };

/** Label for one key in a hint, per platform. */
export function keyLabel(key: string, mac: boolean = isMac): string {
  if (key === 'Mod') return mac ? '⌘' : 'Ctrl';
  return mac ? (MAC_SYMBOLS[key] ?? key) : key;
}

/** A combo as a compact string, e.g. "Alt+Shift+V" or "⌥⇧V". */
export function comboText(keys: string[], mac: boolean = isMac): string {
  const parts = keys.map((k) => keyLabel(k, mac));
  return mac ? parts.join('') : parts.join('+');
}

/** Key combo that puts a region screenshot on the clipboard, for the "paste screenshots" hint. */
export const SCREENSHOT_TO_CLIPBOARD: string[] = isMac ? ['Mod', 'Ctrl', 'Shift', '4'] : ['Win', 'Shift', 'S'];
