/** The slice of Settings the main process cares about, kept in sync by the engine window. Validates untrusted input. */
import { DEFAULT_SETTINGS, type BlipDuration, type BlipMode, type BlipPosition, type ReduceMotion, type Settings } from '@/lib/types';

export type PresenceSettings = Pick<
  Settings,
  | 'autoCapture'
  | 'skipSecrets'
  | 'blipMode'
  | 'blipPosition'
  | 'blipDuration'
  | 'menuBarCount'
  | 'pausedApps'
  | 'reduceMotion'
  | 'hotkeyPalette'
  | 'hotkeyScreenshot'
>;

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

export function parsePresence(raw: unknown): PresenceSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    autoCapture: typeof o['autoCapture'] === 'boolean' ? o['autoCapture'] : d.autoCapture,
    skipSecrets: typeof o['skipSecrets'] === 'boolean' ? o['skipSecrets'] : d.skipSecrets,
    menuBarCount: typeof o['menuBarCount'] === 'boolean' ? o['menuBarCount'] : d.menuBarCount,
    blipMode: pick<BlipMode>(o['blipMode'], ['off', 'tray', 'blip'], d.blipMode),
    blipPosition: pick<BlipPosition>(o['blipPosition'], ['bottom-right', 'bottom-left', 'top-right'], d.blipPosition),
    blipDuration: pick<BlipDuration>(o['blipDuration'], ['short', 'normal', 'long'], d.blipDuration),
    reduceMotion: pick<ReduceMotion>(o['reduceMotion'], ['system', 'on', 'off'], d.reduceMotion),
    // not validated here: the hotkey manager validates and reports a readable error
    hotkeyPalette: typeof o['hotkeyPalette'] === 'string' ? o['hotkeyPalette'].slice(0, 80) : d.hotkeyPalette,
    hotkeyScreenshot: typeof o['hotkeyScreenshot'] === 'string' ? o['hotkeyScreenshot'].slice(0, 80) : d.hotkeyScreenshot,
    pausedApps: Array.isArray(o['pausedApps'])
      ? o['pausedApps'].filter((x): x is string => typeof x === 'string').slice(0, 200)
      : d.pausedApps,
  };
}

export function createPresenceStore() {
  let current = parsePresence({});
  let received = false;
  const listeners = new Set<(s: PresenceSettings, first: boolean) => void>();
  return {
    get: () => current,
    /** True once the engine has sent real settings. */
    get ready() {
      return received;
    },
    update(raw: unknown) {
      const first = !received;
      received = true;
      current = parsePresence(raw);
      for (const l of listeners) l(current, first);
    },
    onChange(cb: (s: PresenceSettings, first: boolean) => void) {
      listeners.add(cb);
    },
  };
}
