import type { GlobalShortcutLike } from './hotkeys';

/**
 * e2e stand-in for Electron's globalShortcut (MOUSTACHE_E2E=1): tests must never grab real system-wide
 * shortcuts from the developer's machine. It records registrations, can be told to refuse some accelerators
 * (to test conflict handling), and `press` runs a handler the way a key press would.
 */
export function createShortcutStub() {
  const handlers = new Map<string, () => void>();
  const refused = new Set<string>();
  const stub: GlobalShortcutLike = {
    register(accelerator, cb) {
      if (refused.has(accelerator) || handlers.has(accelerator)) return false;
      handlers.set(accelerator, cb);
      return true;
    },
    unregister(accelerator) {
      handlers.delete(accelerator);
    },
  };
  return {
    stub,
    registered: () => [...handlers.keys()].sort(),
    refuse: (accelerator: string) => void refused.add(accelerator),
    allow: (accelerator: string) => void refused.delete(accelerator),
    press: (accelerator: string) => handlers.get(accelerator)?.(),
  };
}
