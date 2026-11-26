import { describe, expect, it } from 'vitest';
import type { StashItem } from '@/lib/types';
import {
  buildOffsets, estimateRowHeight, findRowAt, flattenRows, isSectionCollapsed, navIdsOf, scrollTargetFor,
  stickyHeaderIndex, visibleRange, type ListRow,
} from './virtual';

const item = (id: string, extra: Partial<StashItem> = {}): StashItem => ({
  id, kind: 'text', text: id, tags: [], pinned: false, secret: false, hash: id, createdAt: 0, updatedAt: 0, via: 'copy', ...extra,
});

describe('offsets', () => {
  const offsets = buildOffsets([10, 20, 30, 40]);
  it('builds cumulative tops', () => expect(offsets).toEqual([0, 10, 30, 60, 100]));
  it('finds the row at a position (binary search, clamped)', () => {
    expect(findRowAt(offsets, -5)).toBe(0);
    expect(findRowAt(offsets, 0)).toBe(0);
    expect(findRowAt(offsets, 9.9)).toBe(0);
    expect(findRowAt(offsets, 10)).toBe(1);
    expect(findRowAt(offsets, 59)).toBe(2);
    expect(findRowAt(offsets, 60)).toBe(3);
    expect(findRowAt(offsets, 9999)).toBe(3);
    expect(findRowAt([0], 5)).toBe(-1);
  });
  it('is fast on 5,000 rows', () => {
    const big = buildOffsets(Array.from({ length: 5000 }, () => 40));
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) findRowAt(big, (i * 37) % 200_000);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('visibleRange', () => {
  const offsets = buildOffsets(Array.from({ length: 100 }, () => 50));
  it('covers the viewport plus overscan', () => {
    expect(visibleRange(offsets, 0, 200, 2)).toEqual({ start: 0, end: 7 });
    expect(visibleRange(offsets, 1000, 200, 2)).toEqual({ start: 18, end: 27 });
  });
  it('clamps at the end and handles empty lists', () => {
    expect(visibleRange(offsets, 4900, 400, 3).end).toBe(100);
    expect(visibleRange([0], 0, 400)).toEqual({ start: 0, end: 0 });
  });
});

describe('sections -> rows', () => {
  const many = Array.from({ length: 51 }, (_, i) => item(`e${i}`));
  const sections = [
    { key: 'Today', title: 'Today', items: [item('a'), item('b')] },
    { key: 'Earlier', title: 'Earlier', items: many },
  ];
  it('collapses a big Earlier by default but not a small one', () => {
    expect(isSectionCollapsed('Earlier', 51, {})).toBe(true);
    expect(isSectionCollapsed('Earlier', 50, {})).toBe(false);
    expect(isSectionCollapsed('Today', 500, {})).toBe(false);
  });
  it('explicit choice beats the default and searching expands all', () => {
    expect(isSectionCollapsed('Earlier', 51, { Earlier: false })).toBe(false);
    expect(isSectionCollapsed('Today', 2, { Today: true })).toBe(true);
    expect(isSectionCollapsed('Today', 2, { Today: true }, true)).toBe(false);
    expect(isSectionCollapsed('Earlier', 51, {}, true)).toBe(false);
  });
  it('flattens with collapsed sections reduced to their header', () => {
    const rows = flattenRows(sections, {});
    expect(rows.map((r) => r.key)).toEqual(['h:Today', 'i:a', 'i:b', 'h:Earlier']);
    expect(navIdsOf(rows)).toEqual(['a', 'b']);
    const open = flattenRows(sections, { Earlier: false });
    expect(open).toHaveLength(2 + 2 + 51);
    expect(navIdsOf(open).at(-1)).toBe('e50');
  });
});

describe('sticky header + scroll target', () => {
  const rows: ListRow[] = [
    { type: 'header', key: 'h:A', sectionKey: 'A', title: 'A', count: 2, collapsed: false },
    { type: 'item', key: 'i:1', item: item('1') },
    { type: 'item', key: 'i:2', item: item('2') },
    { type: 'header', key: 'h:B', sectionKey: 'B', title: 'B', count: 1, collapsed: false },
    { type: 'item', key: 'i:3', item: item('3') },
  ];
  const offsets = buildOffsets([36, 100, 100, 36, 100]); // header B at 236
  it('shows no sticky copy while the first header is still inline', () => {
    expect(stickyHeaderIndex(rows, offsets, 0)).toBe(-1);
  });
  it('pins the section that has scrolled past', () => {
    expect(stickyHeaderIndex(rows, offsets, 50)).toBe(0);
    expect(stickyHeaderIndex(rows, offsets, 235)).toBe(0);
    expect(stickyHeaderIndex(rows, offsets, 240)).toBe(3);
  });
  it('computes the minimal scroll to reveal a row under the sticky header', () => {
    expect(scrollTargetFor(offsets, 1, 0, 600, 34, 8)).toBeNull(); // visible
    expect(scrollTargetFor(offsets, 1, 120, 600, 34, 8)).toBe(36 - 34 - 8 < 0 ? 0 : 36 - 34 - 8); // above -> up
    expect(scrollTargetFor(offsets, 4, 0, 200, 34, 8)).toBe(272 + 100 - 8 + 8 - 200); // below -> down
  });
});

describe('estimates', () => {
  it('compact rows are far shorter than comfortable ones', () => {
    const row: ListRow = { type: 'item', key: 'i:x', item: item('x', { text: 'line one\nline two\nline three\nline four' }) };
    expect(estimateRowHeight(row, 'compact')).toBeLessThan(40);
    expect(estimateRowHeight(row, 'comfortable')).toBeGreaterThan(80);
  });
  it('scales with text size and handles images', () => {
    const t: ListRow = { type: 'item', key: 'i:t', item: item('t', { text: 'a\nb\nc' }) };
    expect(estimateRowHeight(t, 'comfortable', 1.2)).toBeGreaterThan(estimateRowHeight(t, 'comfortable', 1));
    const img: ListRow = { type: 'item', key: 'i:i', item: item('i', { kind: 'image', text: undefined }) };
    expect(estimateRowHeight(img, 'comfortable')).toBeGreaterThan(150);
  });
});
