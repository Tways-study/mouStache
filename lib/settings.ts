import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'stash:settings';

export async function getSettings(): Promise<Settings> {
  const res = await browser.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...((res[KEY] as Partial<Settings> | undefined) ?? {}) };
}

export async function setSettings(partial: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...partial };
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...((changes[KEY].newValue as Partial<Settings>) ?? {}) });
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
