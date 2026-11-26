// The shim MUST be evaluated first: `wxt/browser` reads globalThis.chrome when it is imported.
import './chrome-shim';
import { registerCleanup } from '@/lib/background/cleanup';
import { handleMessage } from '@/lib/background/router';
import { countItems, db, listItems } from '@/lib/db';
import { isStashMessage } from '@/lib/messaging';
import { getSettings, onSettingsChanged, setSettings } from '@/lib/settings';
import type { Settings } from '@/lib/types';
import type { DesktopStats } from '../shared/api';
import { typeLabel } from '../shared/labels';

async function stats(): Promise<DesktopStats> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const [count, today, [newest]] = await Promise.all([
    countItems(),
    db.items.where('createdAt').aboveOrEqual(midnight.getTime()).count(),
    listItems({ limit: 1 }),
  ]);
  return { count, today, last: newest ? { label: typeLabel(newest), at: newest.createdAt } : undefined };
}

/** Requests that only exist on desktop (the tray asks for these); everything else is the extension's router. */
async function answer(msg: unknown): Promise<unknown> {
  const type = (msg as { type?: unknown } | null)?.type;
  if (type === 'desktop:stats') return stats();
  if (type === 'desktop:set-settings') {
    const partial = (msg as { partial?: unknown }).partial;
    return typeof partial === 'object' && partial !== null ? setSettings(partial as Partial<Settings>) : undefined;
  }
  return isStashMessage(msg) ? handleMessage(msg, {}) : undefined;
}

const api = window.mouDesktop;
if (api) {
  // main needs the presence/capture settings (blip mode, pause, paused apps...); push now and on every change
  void getSettings().then((s) => {
    api.pushSettings(s);
    onSettingsChanged((next) => api.pushSettings(next));
    api.serveEngine(answer);
  });
}

// chrome.alarms is implemented on timers in the shim, so the daily auto-cleanup works unchanged.
registerCleanup();
