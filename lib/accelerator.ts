/**
 * Global-shortcut accelerators (Electron syntax: "Alt+Shift+V"). Pure and shared: the desktop Settings field
 * validates what the user typed, and the main process validates again before registering anything.
 */

const MODIFIERS: Record<string, string> = {
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
};
const MOD_ORDER = ['CommandOrControl', 'Control', 'Command', 'Alt', 'AltGr', 'Shift', 'Super'];

const NAMED_KEYS: Record<string, string> = {
  space: 'Space', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert',
  enter: 'Enter', return: 'Enter', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', escape: 'Escape', esc: 'Escape', plus: 'Plus',
};
const PUNCTUATION = new Set(['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`']);

/** Combos that would hijack the OS or basic editing everywhere. */
const RESERVED = new Set([
  'Alt+F4', 'Alt+Tab', 'Control+Alt+Delete', 'Control+Shift+Escape', 'Super+L', 'Super+D',
  'CommandOrControl+C', 'CommandOrControl+V', 'CommandOrControl+X', 'CommandOrControl+A', 'CommandOrControl+Z',
  'CommandOrControl+Y', 'Control+C', 'Control+V', 'Control+X', 'Control+A', 'Control+Z',
  'Command+C', 'Command+V', 'Command+X', 'Command+A', 'Command+Z', 'Command+Q', 'Command+W', 'Command+Tab',
]);

export type AcceleratorResult = { ok: true; accelerator: string } | { ok: false; error: string };

function normalizeKey(raw: string): string | undefined {
  if (/^[a-z]$/i.test(raw)) return raw.toUpperCase();
  if (/^[0-9]$/.test(raw)) return raw;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase();
  if (PUNCTUATION.has(raw)) return raw;
  return NAMED_KEYS[raw.toLowerCase()];
}

export function validateAccelerator(input: unknown): AcceleratorResult {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, error: 'Enter a shortcut, for example Alt+Shift+V.' };
  if (input.length > 60) return { ok: false, error: 'That shortcut is too long.' };
  const parts = input.split('+').map((p) => p.trim());
  if (parts.some((p) => p === '')) return { ok: false, error: 'Write the plus key as "Plus", for example Ctrl+Plus.' };

  const mods = new Set<string>();
  let key: string | undefined;
  for (const p of parts) {
    const mod = MODIFIERS[p.toLowerCase()];
    if (mod) {
      if (mods.has(mod)) return { ok: false, error: `${mod} is listed twice.` };
      mods.add(mod);
      continue;
    }
    const k = normalizeKey(p);
    if (!k) return { ok: false, error: `"${p.slice(0, 20)}" is not a key mouStache can use.` };
    if (key) return { ok: false, error: 'Use exactly one key with the modifiers.' };
    key = k;
  }
  if (!key) return { ok: false, error: 'Add a key after the modifiers, for example Alt+Shift+V.' };
  const real = [...mods].filter((m) => m !== 'Shift');
  if (real.length === 0) return { ok: false, error: 'Include Ctrl, Alt, Cmd or Win so the shortcut does not break normal typing.' };

  const ordered = MOD_ORDER.filter((m) => mods.has(m));
  const accelerator = [...ordered, key].join('+');
  if (RESERVED.has(accelerator)) return { ok: false, error: `${accelerator} is reserved by the system or by copy and paste.` };
  return { ok: true, accelerator };
}

export interface KeyEventLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Build an accelerator string from a keydown (for a "press the shortcut" field). undefined while only modifiers are down. */
export function acceleratorFromKeyEvent(e: KeyEventLike, mac: boolean): string | undefined {
  let key: string | undefined;
  const code = e.code ?? '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key;
  else if (e.key === ' ') key = 'Space';
  else if (e.key === '+') key = 'Plus';
  else if (e.key.startsWith('Arrow')) key = e.key.slice(5);
  else if (['Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) key = e.key;
  else if (e.key.length === 1) key = normalizeKey(e.key);
  if (!key) return undefined;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.metaKey) mods.push(mac ? 'Command' : 'Super');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const ordered = MOD_ORDER.filter((m) => mods.includes(m));
  return [...ordered, key].join('+');
}
