import { browser } from 'wxt/browser';
import { sendToTab } from '../messaging';

type Tab = { id?: number; windowId?: number; url?: string };

async function activeTab(tab?: Tab): Promise<Tab | undefined> {
  if (tab?.id !== undefined) return tab;
  const [t] = await browser.tabs.query({ active: true, currentWindow: true });
  return t;
}

async function openSidePanel(tab?: Tab): Promise<void> {
  try {
    if (tab?.windowId !== undefined) await browser.sidePanel.open({ windowId: tab.windowId });
    else if (tab?.id !== undefined) await browser.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.warn('[stash] sidePanel.open failed', e);
  }
}

async function inject(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] });
    return true;
  } catch {
    return false;
  }
}

/** Send `type` to the tab's content script; inject and retry once if it's missing. Returns success. */
async function sendWithInject(tabId: number, type: 'open-palette' | 'start-region-select'): Promise<boolean> {
  try {
    await sendToTab(tabId, { type });
    return true;
  } catch {
    /* content script missing */
  }
  if (!(await inject(tabId))) return false;
  try {
    await sendToTab(tabId, { type });
    return true;
  } catch {
    return false;
  }
}

/** Pages where content scripts can never run (browser UI, stores, PDF viewer, view-source...). */
export function isRestrictedUrl(url?: string): boolean {
  if (!url) return true; // no URL permission => cannot script it either
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return true;
  const h = u.hostname.toLowerCase();
  if (h === 'chromewebstore.google.com' || (h === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) return true;
  if (h === 'microsoftedge.microsoft.com' && u.pathname.startsWith('/addons')) return true;
  if (u.protocol !== 'file:' && /\.pdf$/i.test(u.pathname)) return true; // built-in PDF viewer
  return false;
}

/** Must be called synchronously (before any await) from the command handler to keep the user gesture. */
function openPanelNow(tab?: Tab): void {
  if (tab?.windowId === undefined) return;
  try {
    void browser.sidePanel.open({ windowId: tab.windowId }).catch((e: unknown) => {
      console.warn('[stash] sidePanel.open failed', e);
    });
  } catch (e) {
    console.warn('[stash] sidePanel.open failed', e);
  }
}

export async function openPalette(tabArg?: Tab): Promise<void> {
  if (tabArg && isRestrictedUrl(tabArg.url) && tabArg.windowId !== undefined) {
    openPanelNow(tabArg); // synchronous, before any await
    return;
  }
  const tab = await activeTab(tabArg);
  if (tab?.id === undefined) return;
  if (isRestrictedUrl(tab.url)) {
    await openSidePanel(tab);
    return;
  }
  if (await sendWithInject(tab.id, 'open-palette')) return;
  await openSidePanel(tab);
}

export async function startRegionCapture(tabArg?: Tab): Promise<void> {
  if (tabArg && isRestrictedUrl(tabArg.url) && tabArg.windowId !== undefined) {
    openPanelNow(tabArg);
    return;
  }
  const tab = await activeTab(tabArg);
  if (tab?.id === undefined) return;
  if (isRestrictedUrl(tab.url)) {
    await openSidePanel(tab);
    return;
  }
  await sendWithInject(tab.id, 'start-region-select');
}

export function handleCommand(command: string, tab?: Tab): Promise<void> {
  if (command === 'open-palette') return openPalette(tab);
  if (command === 'capture-region') return startRegionCapture(tab);
  return Promise.resolve();
}
