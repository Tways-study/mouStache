/** Global shortcuts: validated, registered, re-registered on change, with a clear error when the OS refuses. */
import { validateAccelerator } from '@/lib/accelerator';

export type HotkeyId = 'palette' | 'screenshot';

export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface HotkeyEntry {
  /** What the user asked for. */
  requested: string;
  /** What is actually registered right now (may be the previous working one after a failed change). */
  active?: string;
  ok: boolean;
  error?: string;
}
export type HotkeyStatus = Record<HotkeyId, HotkeyEntry>;
export type HotkeyConfig = Record<HotkeyId, string>;

const LABEL: Record<HotkeyId, string> = { palette: 'Quick palette', screenshot: 'Region screenshot' };

export function createHotkeys(gs: GlobalShortcutLike, handlers: Record<HotkeyId, () => void>) {
  const active: Partial<Record<HotkeyId, string>> = {};
  let status: HotkeyStatus = {
    palette: { requested: '', ok: false },
    screenshot: { requested: '', ok: false },
  };
  let lastConfig: string | undefined;

  const tryRegister = (acc: string, id: HotkeyId): boolean => {
    try {
      return gs.register(acc, handlers[id]);
    } catch {
      return false;
    }
  };

  function releaseAll() {
    for (const id of Object.keys(active) as HotkeyId[]) {
      try {
        gs.unregister(active[id]!);
      } catch {
        /* already gone */
      }
      delete active[id];
    }
  }

  return {
    /**
     * Register (or re-register) both shortcuts and return the per-shortcut result. Safe to call on every settings
     * push. On a change everything is released first (so two shortcuts can swap keys); a shortcut that cannot be
     * registered keeps its previous working key and reports why.
     */
    apply(cfg: HotkeyConfig): HotkeyStatus {
      const key = `${cfg.palette}\n${cfg.screenshot}`;
      if (key === lastConfig && status.palette.ok && status.screenshot.ok) return status;
      lastConfig = key;

      const prev = { ...active };
      releaseAll();
      const out = {} as HotkeyStatus;
      const claimed = new Map<string, HotkeyId>();
      for (const id of ['palette', 'screenshot'] as HotkeyId[]) {
        const requested = cfg[id];
        const fallback = (error: string): HotkeyEntry => {
          const old = prev[id];
          if (old && !claimed.has(old) && tryRegister(old, id)) {
            active[id] = old;
            claimed.set(old, id);
            return { requested, active: old, ok: false, error };
          }
          return { requested, ok: false, error };
        };
        const v = validateAccelerator(requested);
        if (!v.ok) {
          out[id] = fallback(v.error);
          continue;
        }
        const owner = claimed.get(v.accelerator);
        if (owner) {
          out[id] = fallback(`${v.accelerator} is already used by the ${LABEL[owner].toLowerCase()} shortcut.`);
          continue;
        }
        if (!tryRegister(v.accelerator, id)) {
          out[id] = fallback(
            `${v.accelerator} could not be registered. Another app or the system may already use it. Pick a different shortcut.`,
          );
          continue;
        }
        active[id] = v.accelerator;
        claimed.set(v.accelerator, id);
        out[id] = { requested, active: v.accelerator, ok: true };
      }
      status = out;
      return status;
    },
    status: () => status,
    unregisterAll() {
      releaseAll();
      lastConfig = undefined;
    },
  };
}

export type Hotkeys = ReturnType<typeof createHotkeys>;
