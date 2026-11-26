import { browser } from 'wxt/browser';
import { getSettings } from '../settings';

const KEY = 'stash:unseen';
const COLOR = '#0A84FF';

let openPanels = 0;

type Area = { get(k: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> };

function area(): Area {
  return ((browser.storage as unknown as { session?: Area }).session ?? browser.storage.local) as Area;
}

export async function getUnseen(): Promise<number> {
  try {
    const r = await area().get(KEY);
    const n = r[KEY];
    return typeof n === 'number' ? n : 0;
  } catch {
    return 0;
  }
}

async function setUnseen(n: number): Promise<void> {
  try {
    await area().set({ [KEY]: n });
  } catch {
    /* ignore */
  }
  try {
    await browser.action.setBadgeText({ text: n <= 0 ? '' : n > 99 ? '99+' : String(n) });
    if (n > 0) await browser.action.setBadgeBackgroundColor({ color: COLOR });
  } catch {
    /* ignore */
  }
}

/** After a service-worker restart the in-memory port count is lost; ask the browser instead (Chrome 116+). */
async function hasSidePanelContext(): Promise<boolean> {
  try {
    const rt = browser.runtime as unknown as {
      getContexts?: (f: { contextTypes: string[] }) => Promise<unknown[]>;
    };
    if (!rt.getContexts) return false;
    return (await rt.getContexts({ contextTypes: ['SIDE_PANEL'] })).length > 0;
  } catch {
    return false;
  }
}

/** Increment unseen count (no-op while the side panel is open). Returns the new count. */
export async function incrementUnseen(): Promise<number> {
  if (openPanels > 0) return 0;
  if (!(await getSettings()).badgeCount) return 0; // quiet mode
  if (await hasSidePanelContext()) return 0;
  const n = (await getUnseen()) + 1;
  await setUnseen(n);
  return n;
}

export async function resetBadge(): Promise<void> {
  await setUnseen(0);
}

export function isPanelOpen(): boolean {
  return openPanels > 0;
}

/** Quiet mode: clear any badge already showing when the count is switched off. */
export function registerBadgeSettings(): void {
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      const next = changes['stash:settings']?.newValue as { badgeCount?: boolean } | undefined;
      if (area === 'local' && next && next.badgeCount === false) void resetBadge();
    });
  } catch {
    /* storage events unavailable */
  }
}

/** Track side panel connections (port name 'sidepanel'). */
export function registerPanelPorts(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidepanel') return;
    openPanels++;
    void resetBadge();
    port.onDisconnect.addListener(() => {
      openPanels = Math.max(0, openPanels - 1);
    });
  });
}

/** Test helper. */
export function _setOpenPanels(n: number): void {
  openPanels = n;
}
