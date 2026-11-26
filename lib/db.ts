import Dexie, { type Table } from 'dexie';
import { blobToArrayBuffer, hashBlob, hashText } from './hash';
import type { ItemKind, StashItem, StashSource } from './types';

class StashDB extends Dexie {
  items!: Table<StashItem, string>;
  constructor() {
    super('stash');
    this.version(1).stores({
      items: 'id, hash, createdAt, pinned, kind, *tags',
    });
  }
}

export const db = new StashDB();

// another tab/context upgraded the schema: release the connection so the upgrade can proceed
db.on('versionchange', () => {
  db.close();
  try {
    // extension pages reload to reopen; a service worker has no location.reload and reopens lazily
    if (typeof document !== 'undefined') globalThis.location?.reload?.();
  } catch {
    /* ignore */
  }
});

/** Fields the caller supplies; id/createdAt/updatedAt/pinned/secret/tags have defaults. */
export type NewItemInput = Omit<StashItem, 'id' | 'createdAt' | 'updatedAt' | 'pinned' | 'secret' | 'tags'> &
  Partial<Pick<StashItem, 'id' | 'createdAt' | 'updatedAt' | 'pinned' | 'secret' | 'tags'>>;

export type AddItemResult = StashItem & { deduped?: boolean };

export async function addItem(input: NewItemInput): Promise<AddItemResult> {
  const now = Date.now();
  return db.transaction('rw', db.items, async () => {
  const existing = await db.items.where('hash').equals(input.hash).first();
  if (existing) {
    const bumped: StashItem = { ...existing, createdAt: now, updatedAt: now };
    await db.items.put(bumped);
    return { ...bumped, deduped: true };
  }
  const item: StashItem = {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    tags: input.tags ?? [],
    pinned: input.pinned ?? false,
    secret: input.secret ?? false,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  await db.items.add(item);
  return { ...item, deduped: false };
  });
}

export function getItem(id: string): Promise<StashItem | undefined> {
  return db.items.get(id);
}

export interface ListOptions {
  query?: string;
  tag?: string;
  kind?: ItemKind;
  pinnedFirst?: boolean;
  limit?: number;
  offset?: number;
}

/** Newest first. `query` matches text, lang, tags, source url/title (case-insensitive substring). */
export async function listItems(opts: ListOptions = {}): Promise<StashItem[]> {
  const { query, tag, kind, pinnedFirst = false, limit, offset = 0 } = opts;
  const q = query?.trim().toLowerCase();
  const filtered = !!(kind || tag || q);
  const base = () => db.items.orderBy('createdAt').reverse();

  if (!filtered && !pinnedFirst) {
    let c = base().offset(offset);
    if (limit !== undefined) c = c.limit(limit);
    return c.toArray();
  }

  const matches = (i: StashItem) => {
    if (kind && i.kind !== kind) return false;
    if (tag && !i.tags.includes(tag)) return false;
    if (q && ![i.text, i.lang, i.source?.url, i.source?.title, ...i.tags].some((f) => f?.toLowerCase().includes(q))) {
      return false;
    }
    return true;
  };
  const want = limit === undefined ? undefined : offset + limit;

  if (!pinnedFirst) {
    let c = base().filter(matches);
    if (want !== undefined) c = c.limit(want);
    return (await c.toArray()).slice(offset);
  }
  // pinned first (createdAt-desc within each group): all pinned matches, then enough unpinned to fill the page
  const pinned = await base().filter((i) => i.pinned && matches(i)).toArray();
  let rest: StashItem[] = [];
  if (want === undefined || want > pinned.length) {
    let c = base().filter((i) => !i.pinned && matches(i));
    if (want !== undefined) c = c.limit(want - pinned.length);
    rest = await c.toArray();
  }
  const all = [...pinned, ...rest];
  return limit === undefined ? all.slice(offset) : all.slice(offset, offset + limit);
}

export async function updateItem(id: string, patch: Partial<Omit<StashItem, 'id'>>): Promise<StashItem | undefined> {
  const n = await db.items.update(id, { ...patch, updatedAt: Date.now() });
  return n ? db.items.get(id) : undefined;
}

export function deleteItem(id: string): Promise<void> {
  return db.items.delete(id);
}

export async function clearAll(keepPinned = false): Promise<void> {
  if (!keepPinned) return db.items.clear();
  await db.items.filter((i) => !i.pinned).delete();
}

export function countItems(): Promise<number> {
  return db.items.count();
}

export interface OlderThanOptions {
  keepPinned?: boolean;
  kind?: ItemKind;
  /** Clock override for tests. */
  now?: number;
}

function olderThan(ageMs: number, { keepPinned = true, kind, now = Date.now() }: OlderThanOptions) {
  const cutoff = now - ageMs;
  return db.items
    .where('createdAt')
    .below(cutoff)
    .filter((i) => !(keepPinned && i.pinned) && (!kind || i.kind === kind));
}

/** How many items `deleteOlderThan` would remove. */
export function countOlderThan(ageMs: number, opts: OlderThanOptions = {}): Promise<number> {
  return olderThan(ageMs, opts).count();
}

/** Delete items created more than `ageMs` ago. Pinned items are kept unless `keepPinned` is false. Returns the count. */
export async function deleteOlderThan(ageMs: number, keepPinned = true, opts: Omit<OlderThanOptions, 'keepPinned'> = {}): Promise<number> {
  if (!(ageMs > 0)) return 0;
  const ids = await olderThan(ageMs, { ...opts, keepPinned }).primaryKeys();
  if (ids.length) await db.items.bulkDelete(ids);
  return ids.length;
}

/** Delete the oldest unpinned items beyond `max` total. Returns number deleted. */
export async function enforceMaxItems(max: number): Promise<number> {
  const total = await db.items.count();
  if (total <= max) return 0;
  const excess = total - max;
  const victims = await db.items
    .orderBy('createdAt')
    .filter((i) => !i.pinned)
    .limit(excess)
    .primaryKeys();
  await db.items.bulkDelete(victims);
  return victims.length;
}

// ---------- export / import ----------

export type ExportedItem = Omit<StashItem, 'imageBlob' | 'thumbBlob'> & {
  imageDataUrl?: string;
  thumbDataUrl?: string;
};
export interface StashExport {
  app: 'stash';
  version: 1;
  exportedAt: number;
  items: ExportedItem[];
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blobToArrayBuffer(blob));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('Invalid data URL');
  const meta = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  const isB64 = meta.endsWith(';base64');
  const mime = (isB64 ? meta.slice(0, -7) : meta).split(';')[0] || 'application/octet-stream';
  const bin = isB64 ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportAll(): Promise<StashExport> {
  const items = await db.items.orderBy('createdAt').toArray();
  const out: ExportedItem[] = [];
  for (const { imageBlob, thumbBlob, ...rest } of items) {
    const e: ExportedItem = { ...rest };
    if (imageBlob) e.imageDataUrl = await blobToDataUrl(imageBlob);
    if (thumbBlob) e.thumbDataUrl = await blobToDataUrl(thumbBlob);
    out.push(e);
  }
  return { app: 'stash', version: 1, exportedAt: Date.now(), items: out };
}

const KINDS: readonly ItemKind[] = ['text', 'image', 'link'];
const VIAS: readonly StashItem['via'][] = ['copy', 'context-menu', 'screenshot', 'paste', 'import'];
const MAX_IMPORT_TEXT = 200_000;

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function httpUrl(v: unknown): string | undefined {
  const s = str(v, 2000);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : undefined;
  } catch {
    return undefined;
  }
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Validate & coerce one untrusted exported item. Returns null when unusable. Never keeps the incoming id. */
export async function sanitizeImportedItem(raw: unknown): Promise<StashItem | null> {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as ItemKind)) return null;
  const now = Date.now();
  const createdAt = finiteOr(r.createdAt, now);
  const tags = Array.isArray(r.tags)
    ? r.tags.filter((t): t is string => typeof t === 'string').slice(0, 20).map((t) => t.slice(0, 40))
    : [];
  const item: StashItem = {
    id: crypto.randomUUID(),
    kind: kind as ItemKind,
    tags,
    pinned: r.pinned === true,
    secret: r.secret === true,
    hash: '',
    createdAt,
    updatedAt: finiteOr(r.updatedAt, createdAt),
    via: VIAS.includes(r.via as StashItem['via']) ? (r.via as StashItem['via']) : 'import',
  };
  const text = str(r.text, MAX_IMPORT_TEXT);
  if (text !== undefined) item.text = text;
  const lang = str(r.lang, 40);
  if (lang) item.lang = lang;
  const mime = str(r.mime, 100);
  if (mime) item.mime = mime;
  if (typeof r.width === 'number' && Number.isFinite(r.width)) item.width = r.width;
  if (typeof r.height === 'number' && Number.isFinite(r.height)) item.height = r.height;
  if (typeof r.source === 'object' && r.source !== null) {
    const s = r.source as Record<string, unknown>;
    const source: StashSource = {};
    const url = httpUrl(s.url);
    if (url) source.url = url;
    const title = str(s.title, 2000);
    if (title) source.title = title;
    const favicon = httpUrl(s.favicon);
    if (favicon) source.favicon = favicon;
    if (source.url || source.title || source.favicon) item.source = source;
  }
  const imgUrl = typeof r.imageDataUrl === 'string' && r.imageDataUrl.startsWith('data:image/') ? r.imageDataUrl : undefined;
  const thumbUrl = typeof r.thumbDataUrl === 'string' && r.thumbDataUrl.startsWith('data:image/') ? r.thumbDataUrl : undefined;
  if (imgUrl) item.imageBlob = dataUrlToBlob(imgUrl);
  if (thumbUrl) item.thumbBlob = dataUrlToBlob(thumbUrl);
  if (item.kind === 'image' && !item.imageBlob) return null;
  if (item.kind !== 'image' && !item.text) return null;
  const hash = str(r.hash, 200);
  item.hash = hash || (item.kind === 'image' ? await hashBlob(item.imageBlob!) : await hashText(item.text!));
  return item;
}

/** Merge items from an export; validates each item, skips malformed ones and hashes already present. */
export async function importAll(json: StashExport | string): Promise<{ imported: number; skipped: number }> {
  const data: StashExport = typeof json === 'string' ? JSON.parse(json) : json;
  if (data?.app !== 'stash' || !Array.isArray(data.items)) throw new Error('Not a mouStache export');
  let imported = 0;
  let skipped = 0;
  for (const raw of data.items) {
    try {
      const item = await sanitizeImportedItem(raw);
      if (!item || (await db.items.where('hash').equals(item.hash).first())) {
        skipped++;
        continue;
      }
      await db.items.add(item);
      imported++;
    } catch {
      skipped++;
    }
  }
  return { imported, skipped };
}
