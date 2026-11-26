import { browser } from 'wxt/browser';
import { deleteOlderThan } from '../db';
import { getSettings } from '../settings';
import { broadcastItemsChanged } from './broadcast';

export const CLEANUP_ALARM = 'stash-cleanup';
const DAY_MS = 86_400_000;

/** Delete unpinned items older than the configured age. Returns how many were removed. */
export async function runCleanup(now = Date.now()): Promise<number> {
  const { autoCleanupDays } = await getSettings();
  if (!autoCleanupDays || autoCleanupDays <= 0) return 0;
  const n = await deleteOlderThan(autoCleanupDays * DAY_MS, true, { now });
  if (n > 0) await broadcastItemsChanged();
  return n;
}

/** Daily alarm + a run at startup. Listeners must be registered synchronously from the service worker's top level. */
export function registerCleanup(): void {
  const run = () => runCleanup().catch((e) => console.warn('[stash] cleanup', e));
  try {
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === CLEANUP_ALARM) void run();
    });
    void browser.alarms
      .get(CLEANUP_ALARM)
      .then((existing) => {
        if (!existing) browser.alarms.create(CLEANUP_ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
      })
      .catch(() => undefined);
  } catch (e) {
    console.warn('[stash] alarms unavailable', e);
  }
  void run();
}
