import type { StashItem, TagGroup } from '@/lib/types';
import { itemGroup } from '@/lib/content/labels';

// ───────── date bucketing ─────────
export type DateBucket = 'Today' | 'Yesterday' | 'This week' | 'Earlier';
export const BUCKET_ORDER: DateBucket[] = ['Today', 'Yesterday', 'This week', 'Earlier'];

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dateBucket(ts: number, now: number = Date.now()): DateBucket {
  const today = startOfDay(now);
  if (ts >= today) return 'Today';
  const d = new Date(today);
  d.setDate(d.getDate() - 1);
  if (ts >= d.getTime()) return 'Yesterday';
  d.setDate(d.getDate() - 5); // up to 6 days back = "this week"
  if (ts >= d.getTime()) return 'This week';
  return 'Earlier';
}

export interface Section<T> {
  key: string;
  title: string;
  items: T[];
}

/** Pinned first, then date buckets (items keep their incoming order). Empty sections are dropped. */
export function sectionize<T extends Pick<StashItem, 'pinned' | 'createdAt'>>(
  items: T[],
  now: number = Date.now(),
): Section<T>[] {
  const out: Section<T>[] = [];
  const pinned = items.filter((i) => i.pinned);
  if (pinned.length) out.push({ key: 'pinned', title: 'Pinned', items: pinned });
  const buckets = new Map<DateBucket, T[]>();
  for (const i of items) {
    if (i.pinned) continue;
    const b = dateBucket(i.createdAt, now);
    const arr = buckets.get(b) ?? [];
    arr.push(i);
    buckets.set(b, arr);
  }
  for (const b of BUCKET_ORDER) {
    const arr = buckets.get(b);
    if (arr?.length) out.push({ key: b, title: b, items: arr });
  }
  return out;
}

// ───────── filters ─────────
export type FilterId = 'all' | 'pinned' | TagGroup;
export const FILTER_GROUPS: TagGroup[] = ['code', 'prompt', 'image', 'link', 'network', 'error', 'data'];

type FilterItem = Pick<StashItem, 'pinned' | 'kind' | 'tags'>;

export function matchesFilter(item: FilterItem, f: FilterId): boolean {
  if (f === 'all') return true;
  if (f === 'pinned') return item.pinned;
  return itemGroup(item) === f;
}

export function countFilters(items: FilterItem[]): Record<FilterId, number> {
  const c: Record<string, number> = { all: items.length, pinned: 0 };
  for (const g of [...FILTER_GROUPS, 'other']) c[g] = 0;
  for (const i of items) {
    if (i.pinned) c.pinned = (c.pinned ?? 0) + 1;
    const g = itemGroup(i);
    c[g] = (c[g] ?? 0) + 1;
  }
  return c as Record<FilterId, number>;
}

// ───────── code helpers ─────────
export function markdownFence(text: string, lang?: string): string {
  const body = text.replace(/\s+$/, '');
  let fence = '```';
  while (body.includes(fence)) fence += '`';
  return `${fence}${lang ?? ''}\n${body}\n${fence}`;
}

export function formatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/** Map a mouStache lang/tag to a Shiki grammar id (undefined = render plain). */
export function shikiLang(item: Pick<StashItem, 'lang' | 'tags'>): string | undefined {
  const map: Record<string, string> = {
    python: 'python', javascript: 'javascript', typescript: 'typescript', java: 'java', c: 'c', cpp: 'cpp',
    csharp: 'csharp', sql: 'sql', html: 'html', css: 'css', bash: 'shellscript', command: 'shellscript',
    powershell: 'powershell', json: 'json', yaml: 'yaml', go: 'go', rust: 'rust', php: 'php',
  };
  for (const c of [item.lang, ...item.tags]) if (c && map[c]) return map[c];
  return undefined;
}

/** Fence label for markdown ("shellscript" -> "bash"). */
export function fenceLang(item: Pick<StashItem, 'lang' | 'tags'>): string | undefined {
  const l = shikiLang(item);
  return l === 'shellscript' ? 'bash' : l;
}

/** Split text into literal/variable parts for `{{var}}` prompt placeholders. */
export function splitVariables(text: string): { text: string; variable: boolean }[] {
  const out: { text: string; variable: boolean }[] = [];
  const re = /\{\{\s*[\w.-]+\s*\}\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx), variable: false });
    out.push({ text: m[0], variable: true });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), variable: false });
  return out;
}

export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9#+_.-]/g, '')
    .slice(0, 24);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function exportFilename(now: number = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `moustache-export-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** Mirrors lib/db.ts listItems query matching (used for demo mode). */
export function matchesQuery(i: StashItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [i.text, i.lang, i.source?.url, i.source?.title, ...i.tags].some((f) => f?.toLowerCase().includes(q));
}
