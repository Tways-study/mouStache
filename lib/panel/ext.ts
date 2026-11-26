import { browser } from 'wxt/browser';

/** True when running as a real extension page (not a static preview). */
export function hasExtension(): boolean {
  try {
    return !!browser?.runtime?.id;
  } catch {
    return false;
  }
}

/** Demo mode seeds in-memory sample items; used for static previews and screenshots. */
export const isDemo: boolean = (() => {
  try {
    return (
      location.protocol === 'file:' || new URLSearchParams(location.search).get('demo') === '1' || !hasExtension()
    );
  } catch {
    return true;
  }
})();

/** Keep the service worker's badge reset while the panel is open. */
export function connectPanel(): () => void {
  if (!hasExtension()) return () => {};
  let stopped = false;
  let port: ReturnType<typeof browser.runtime.connect> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  const open = () => {
    if (stopped) return;
    try {
      const p = browser.runtime.connect({ name: 'sidepanel' });
      port = p;
      p.onDisconnect.addListener(() => {
        port = null;
        if (stopped) return;
        // the service worker was restarted: reconnect so it knows the panel is still open
        timer = setTimeout(open, Math.min(5000, 250 * 2 ** attempt++));
      });
    } catch {
      /* extension context gone */
    }
  };
  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      port?.disconnect();
    } catch {
      /* already gone */
    }
  };
}

export function onItemsChanged(cb: () => void): () => void {
  if (!hasExtension()) return () => {};
  const listener = (m: unknown) => {
    if (typeof m === 'object' && m !== null && (m as { type?: string }).type === 'items-changed') cb();
    return false; // never responds
  };
  try {
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  } catch {
    return () => {};
  }
}

export async function activeTabHost(): Promise<string | undefined> {
  try {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return undefined;
    const u = new URL(tab.url);
    if (!/^https?:$/.test(u.protocol)) return undefined;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function openShortcutsPage(): void {
  try {
    void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  } catch {
    /* not available */
  }
}

export function appVersion(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return '0.1.0';
  }
}

export function openUrl(url: string): void {
  try {
    if (hasExtension()) {
      void browser.tabs.create({ url });
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, '_blank', 'noopener');
}
