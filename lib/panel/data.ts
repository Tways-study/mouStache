import {
  clearAll, countItems, countOlderThan, dataUrlToBlob, deleteItem, deleteOlderThan, exportAll, importAll, listItems,
  updateItem, type StashExport,
} from '@/lib/db';
import { getSettings, onSettingsChanged, setSettings } from '@/lib/settings';
import { send, type SaveResult } from '@/lib/messaging';
import { DEFAULT_SETTINGS, type Settings, type StashItem } from '@/lib/types';
import { isDemo, onItemsChanged } from './ext';
import { matchesQuery } from './helpers';

/**
 * Single data seam for the panel. In a real extension it talks to Dexie directly (reads/edits) and
 * the background (new captures). In demo mode (static preview) everything lives in memory.
 */

let demoItems: StashItem[] | null = null;
function demoSettingsFromUrl(): Settings {
  const base: Settings = { ...DEFAULT_SETTINGS, pausedHosts: ['bank.example.com'] };
  try {
    const p = new URLSearchParams(location.search);
    const pick = <T extends string>(k: string, allowed: readonly T[]): T | undefined => {
      const v = p.get(k);
      return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
    };
    return {
      ...base,
      theme: pick('theme', ['system', 'light', 'dark'] as const) ?? base.theme,
      textSize: pick('text', ['small', 'default', 'large', 'xlarge'] as const) ?? base.textSize,
      density: pick('density', ['comfortable', 'compact'] as const) ?? base.density,
      reduceMotion: pick('motion', ['system', 'on', 'off'] as const) ?? base.reduceMotion,
    };
  } catch {
    return base;
  }
}
let demoSettings: Settings = demoSettingsFromUrl();
const demoListeners = new Set<() => void>();
const demoSettingsListeners = new Set<(s: Settings) => void>();
const notifyDemo = () => demoListeners.forEach((l) => l());

async function ensureDemo(): Promise<StashItem[]> {
  if (!demoItems) {
    const params = new URLSearchParams(location.search);
    const demo = await import('./demo');
    demoItems =
      params.get('empty') === '1'
        ? []
        : params.get('many') === '1'
          ? await demo.buildManyDemoItems()
          : await demo.buildDemoItems();
  }
  return demoItems;
}

export async function fetchItems(query: string): Promise<StashItem[]> {
  if (isDemo) {
    const all = await ensureDemo();
    return all.filter((i) => matchesQuery(i, query)).sort((a, b) => b.createdAt - a.createdAt);
  }
  return listItems({ query });
}

export function subscribeItems(cb: () => void): () => void {
  // the panel never receives its own runtime.sendMessage, so local mutations notify via the same set
  const off = onLocalChange(cb);
  if (isDemo) return off;
  const offRemote = onItemsChanged(cb);
  return () => {
    off();
    offRemote();
  };
}

/** Subscribe to mutations made from this panel (Dexie writes, clear, import). */
export function onLocalChange(cb: () => void): () => void {
  demoListeners.add(cb);
  return () => {
    demoListeners.delete(cb);
  };
}

export async function patchItem(id: string, patch: Partial<Omit<StashItem, 'id'>>): Promise<void> {
  if (isDemo) {
    const all = await ensureDemo();
    demoItems = all.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i));
    notifyDemo();
    return;
  }
  await updateItem(id, patch);
  notifyDemo();
}

export async function removeItem(id: string): Promise<void> {
  if (isDemo) {
    demoItems = (await ensureDemo()).filter((i) => i.id !== id);
    notifyDemo();
    return;
  }
  await deleteItem(id);
  notifyDemo();
}

export async function restoreItem(item: StashItem): Promise<void> {
  // used only if a commit raced an undo; re-insert
  if (isDemo) {
    demoItems = [...(await ensureDemo()), item];
    notifyDemo();
  }
}

export async function clearHistory(keepPinned: boolean): Promise<void> {
  if (isDemo) {
    demoItems = (await ensureDemo()).filter((i) => keepPinned && i.pinned);
    notifyDemo();
    return;
  }
  await clearAll(keepPinned);
  notifyDemo();
  try {
    await send({ type: 'items-changed' });
  } catch {
    /* ignore */
  }
}

export async function exportJson(): Promise<string> {
  if (isDemo) return JSON.stringify({ app: 'stash', version: 1, exportedAt: Date.now(), items: [] });
  const data: StashExport = await exportAll();
  return JSON.stringify(data, null, 2);
}

export async function importJson(text: string): Promise<{ imported: number; skipped: number }> {
  if (isDemo) return { imported: 0, skipped: 0 };
  const r = await importAll(text);
  notifyDemo();
  try {
    await send({ type: 'items-changed' });
  } catch {
    /* ignore */
  }
  return r;
}

// ───────── storage + cleanup ─────────
const DAY = 86_400_000;
export const SCREENSHOT_CLEANUP_DAYS = 30;

/** "mouStache is using N items · ~X MB". `bytes` is the extension's whole storage estimate when the browser offers one. */
export async function getStorageInfo(): Promise<{ count: number; bytes?: number }> {
  const count = isDemo ? (await ensureDemo()).length : await countItems();
  let bytes: number | undefined;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage && !isDemo) bytes = est.usage;
  } catch {
    /* not available */
  }
  return { count, bytes };
}

/** Unpinned images older than 30 days. */
export async function countOldImages(): Promise<number> {
  if (isDemo) {
    const cutoff = Date.now() - SCREENSHOT_CLEANUP_DAYS * DAY;
    return (await ensureDemo()).filter((i) => i.kind === 'image' && !i.pinned && i.createdAt < cutoff).length;
  }
  return countOlderThan(SCREENSHOT_CLEANUP_DAYS * DAY, { kind: 'image' });
}

export async function deleteOldImages(): Promise<number> {
  if (isDemo) {
    const cutoff = Date.now() - SCREENSHOT_CLEANUP_DAYS * DAY;
    const all = await ensureDemo();
    const keep = all.filter((i) => !(i.kind === 'image' && !i.pinned && i.createdAt < cutoff));
    demoItems = keep;
    notifyDemo();
    return all.length - keep.length;
  }
  const n = await deleteOlderThan(SCREENSHOT_CLEANUP_DAYS * DAY, true, { kind: 'image' });
  notifyDemo();
  try {
    await send({ type: 'items-changed' });
  } catch {
    /* ignore */
  }
  return n;
}

// ───────── settings ─────────
export async function loadSettings(): Promise<Settings> {
  if (isDemo) return demoSettings;
  try {
    return await getSettings();
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  if (isDemo) {
    demoSettings = { ...demoSettings, ...partial };
    demoSettingsListeners.forEach((l) => l(demoSettings));
    return demoSettings;
  }
  return setSettings(partial);
}

export function subscribeSettings(cb: (s: Settings) => void): () => void {
  if (isDemo) {
    demoSettingsListeners.add(cb);
    return () => demoSettingsListeners.delete(cb);
  }
  return onSettingsChanged(cb);
}

// ───────── new captures ─────────
async function demoAdd(partial: Partial<StashItem> & Pick<StashItem, 'kind'>): Promise<SaveResult> {
  const all = await ensureDemo();
  const now = Date.now();
  const item: StashItem = {
    id: `demo-new-${now}`,
    tags: [],
    pinned: false,
    secret: false,
    hash: `h-${now}`,
    createdAt: now,
    updatedAt: now,
    via: 'paste',
    ...partial,
  };
  if (item.kind === 'text' && item.text) {
    const { classify } = await import('@/lib/classify');
    const c = classify(item.text);
    item.tags = c.tags;
    item.lang = c.lang;
    item.secret = c.secret;
  }
  demoItems = [item, ...all];
  notifyDemo();
  return { ok: true, id: item.id };
}

export async function saveText(text: string): Promise<SaveResult> {
  if (isDemo) return demoAdd({ kind: 'text', text });
  return send({ type: 'save-text', text, via: 'paste' });
}

export async function saveImage(dataUrl: string): Promise<SaveResult> {
  if (isDemo) {
    const blob = dataUrlToBlob(dataUrl);
    return demoAdd({ kind: 'image', imageBlob: blob, thumbBlob: blob, mime: blob.type, tags: ['image'] });
  }
  return send({ type: 'save-image', dataUrl, via: 'paste' });
}

export async function captureVisibleTab(): Promise<SaveResult> {
  if (isDemo) return { ok: false, error: 'Screenshots need the extension' };
  return send({ type: 'capture-visible' });
}

export async function resetBadge(): Promise<void> {
  if (isDemo) return;
  try {
    await send({ type: 'badge-reset' });
  } catch {
    /* ignore */
  }
}

/** Human message for a SaveResult. */
export function describeSave(r: SaveResult | undefined, what: string): string {
  if (!r) return `Saved ${what}`;
  if (r.ok && r.deduped) return 'Already in mouStache — moved to top';
  if (r.ok) return `Saved ${what}`;
  switch (r.skipped) {
    case 'paused':
      return 'Capture is paused on this site';
    case 'secret':
      return 'Skipped — looks like a secret';
    case 'disabled':
      return 'Auto-capture is off';
    case 'empty':
      return 'Nothing to save';
    default:
      return r.error ?? `Couldn't save ${what}`;
  }
}
