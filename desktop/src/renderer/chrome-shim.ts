/**
 * Side-effect module: installs a `chrome` shim on globalThis. Must be the FIRST import of every
 * desktop renderer entry, because `wxt/browser` captures `globalThis.chrome` at module-evaluation time.
 * Without the preload bridge (plain browser, demo screenshots) it does nothing.
 */
import { classify } from '@/lib/classify';
import { createChromeShim, type Transport } from './shim-core';

declare const __APP_VERSION__: string | undefined;

/**
 * Tell main about our own clipboard writes BEFORE they happen, so the watcher does not capture them again
 * (same idea as isStashWriting in lib/content/clipboard.ts).
 */
function guardOwnClipboardWrites(api: NonNullable<Window['mouDesktop']>): void {
  const cb = navigator.clipboard;
  if (!cb) return;
  const writeText = cb.writeText.bind(cb);
  const write = cb.write.bind(cb);
  Object.defineProperty(cb, 'writeText', {
    configurable: true,
    value: async (text: string) => {
      // a secret goes through main: do-not-record formats + auto-clear (the web API cannot set those)
      if (classify(text).secret && (await api.writeSecret(text).catch(() => false))) return;
      api.markOwnWrite({ text });
      return writeText(text);
    },
  });
  Object.defineProperty(cb, 'write', {
    configurable: true,
    value: async (items: ClipboardItems) => {
      for (const item of items) {
        if (item.types.includes('image/png')) api.markOwnWrite({ png: await (await item.getType('image/png')).arrayBuffer() });
        else if (item.types.includes('text/plain')) api.markOwnWrite({ text: await (await item.getType('text/plain')).text() });
      }
      return write(items);
    },
  });
}

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
    guardOwnClipboardWrites(api);
  } catch {
    /* no clipboard API in this window */
  }

  try {
    Object.defineProperty(globalThis, 'chrome', { value: shim, configurable: true, writable: true });
  } catch {
    (globalThis as { chrome?: unknown }).chrome = shim;
  }
}

install();
