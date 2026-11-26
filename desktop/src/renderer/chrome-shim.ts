/**
 * Side-effect module: installs a `chrome` shim on globalThis. Must be the FIRST import of every
 * desktop renderer entry, because `wxt/browser` captures `globalThis.chrome` at module-evaluation time.
 * Without the preload bridge (plain browser, demo screenshots) it does nothing.
 */
import { createChromeShim, type Transport } from './shim-core';

declare const __APP_VERSION__: string | undefined;

function install(): void {
  const api = window.mouDesktop;
  if (!api) return;

  const transport: Transport = { send: (m) => api.send(m), onMessage: (cb) => api.onMessage(cb) };
  const channel = new BroadcastChannel('stash-shim');
  const shim = createChromeShim({
    transport,
    bus: {
      post: (m) => channel.postMessage(m),
      listen: (cb) => channel.addEventListener('message', (e) => cb(e.data)),
    },
    local: localStorage,
    session: sessionStorage,
    openExternal: (url) => void api.openExternal(url),
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined,
  });

  try {
    Object.defineProperty(globalThis, 'chrome', { value: shim, configurable: true, writable: true });
  } catch {
    (globalThis as { chrome?: unknown }).chrome = shim;
  }
}

install();
