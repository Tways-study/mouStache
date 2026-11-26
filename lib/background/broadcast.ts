import { browser } from 'wxt/browser';

/** Notify extension pages (side panel etc.) that items changed. */
export async function broadcastItemsChanged(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'items-changed' });
  } catch {
    /* "Receiving end does not exist" when nothing is listening */
  }
}
