import type { Section } from './helpers';
import type { Density, StashItem } from '@/lib/types';

// ───────── rows ─────────
export type ListRow =
  | { type: 'header'; key: string; sectionKey: string; title: string; count: number; collapsed: boolean }
  | { type: 'item'; key: string; item: StashItem };

/** Earlier is collapsed by default once it holds more than this many items. */
export const EARLIER_COLLAPSE_AT = 50;

/** Explicit user choice wins; otherwise a big "Earlier" section starts collapsed. Searching expands everything. */
export function isSectionCollapsed(
  sectionKey: string,
  count: number,
  explicit: Record<string, boolean>,
  searching = false,
): boolean {
  if (searching) return false;
  const e = explicit[sectionKey];
  if (e !== undefined) return e;
  return sectionKey === 'Earlier' && count > EARLIER_COLLAPSE_AT;
}

/** Sections -> flat header/item rows (collapsed sections keep only their header). */
export function flattenRows(
  sections: Section<StashItem>[],
  explicit: Record<string, boolean>,
  searching = false,
): ListRow[] {
  const rows: ListRow[] = [];
  for (const s of sections) {
    const collapsed = isSectionCollapsed(s.key, s.items.length, explicit, searching);
    rows.push({ type: 'header', key: `h:${s.key}`, sectionKey: s.key, title: s.title, count: s.items.length, collapsed });
    if (!collapsed) for (const item of s.items) rows.push({ type: 'item', key: `i:${item.id}`, item });
  }
  return rows;
}

export function navIdsOf(rows: ListRow[]): string[] {
  const ids: string[] = [];
  for (const r of rows) if (r.type === 'item') ids.push(r.item.id);
  return ids;
}

// ───────── geometry ─────────
/** Gap between rows is part of each row's measured height. */
export const ROW_GAP = 8;
export const COMPACT_GAP = 3;
export const HEADER_ESTIMATE = 36;

/** Cumulative tops: offsets[i] is row i's top, offsets[n] the total height. */
export function buildOffsets(heights: number[]): number[] {
  const out = new Array<number>(heights.length + 1);
  out[0] = 0;
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i]! + heights[i]!;
  return out;
}

/** Index of the row containing y (clamped to [0, n-1]); -1 for an empty list. */
export function findRowAt(offsets: number[], y: number): number {
  const n = offsets.length - 1;
  if (n <= 0) return -1;
  if (y <= 0) return 0;
  if (y >= offsets[n]!) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface VisibleRange {
  /** First rendered row. */
  start: number;
  /** One past the last rendered row. */
  end: number;
}

/** Rows intersecting [top, top+viewport] plus `overscan` rows each side. */
export function visibleRange(offsets: number[], top: number, viewport: number, overscan = 6): VisibleRange {
  const n = offsets.length - 1;
  if (n <= 0) return { start: 0, end: 0 };
  const first = findRowAt(offsets, top);
  const last = findRowAt(offsets, top + viewport);
  return { start: Math.max(0, first - overscan), end: Math.min(n, last + 1 + overscan) };
}

/**
 * The section header that should be pinned under the page header: the last header at or above `top`
 * whose inline copy has scrolled out of view (so it is not drawn twice). -1 when none.
 */
export function stickyHeaderIndex(rows: ListRow[], offsets: number[], top: number): number {
  let found = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.type !== 'header') continue;
    if (offsets[i]! <= top + 0.5) found = i;
    else break;
  }
  if (found >= 0 && offsets[found]! >= top - 0.5) return -1;
  return found;
}

/** Scroll position (list-relative) that brings a row fully into view, or null when it already is. */
export function scrollTargetFor(
  offsets: number[],
  index: number,
  top: number,
  viewport: number,
  stickyH: number,
  gap: number,
  pad = 8,
): number | null {
  const rowTop = offsets[index];
  const rowEnd = offsets[index + 1];
  if (rowTop === undefined || rowEnd === undefined) return null;
  const rowBottom = rowEnd - gap;
  if (rowTop - stickyH - pad < top) {
    const t = Math.max(0, rowTop - stickyH - pad);
    return t === top ? null : t;
  }
  if (rowBottom + pad > top + viewport) return Math.max(0, rowBottom + pad - viewport);
  return null;
}

/** Initial guess before a row is measured. Close enough that scroll anchoring rarely has to correct. */
export function estimateRowHeight(row: ListRow, density: Density, scale = 1): number {
  if (row.type === 'header') return HEADER_ESTIMATE;
  if (density === 'compact') return Math.round(32 * scale) + COMPACT_GAP;
  const it = row.item;
  let h: number;
  if (it.kind === 'image') h = 12 + 140 + 8 + 20 + 10;
  else {
    const text = it.text ?? '';
    const lines = Math.min(5, text.split('\n').length);
    if (it.kind === 'link') h = 12 + 36 + 8 + 20 + 10;
    else if (text.includes('\n') || text.length > 80) h = 12 + Math.min(3, Math.max(lines, Math.ceil(text.length / 48))) * 18 * scale + 8 + 20 + 10;
    else h = 12 + 18 * scale + 8 + 20 + 10;
  }
  return Math.round(h) + ROW_GAP;
}
