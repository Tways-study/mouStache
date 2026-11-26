import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Density } from '@/lib/types';
import {
  buildOffsets, COMPACT_GAP, estimateRowHeight, findRowAt, ROW_GAP, scrollTargetFor, stickyHeaderIndex, visibleRange,
  type ListRow,
} from './virtual';

/** Height of the pinned section header drawn under the page header. */
export const STICKY_H = 34;
const OVERSCAN = 6;

export interface VirtualView {
  start: number;
  end: number;
  /** Row index of the header to pin, or -1. */
  sticky: number;
  /** Height of the page header above the list (sticky top offset). */
  listTop: number;
}

interface Options {
  scrollerRef: RefObject<HTMLElement>;
  listRef: RefObject<HTMLElement>;
  rows: ListRow[];
  density: Density;
  scale: number;
  /** Scroll back to the top when this changes (new query / filter). */
  resetKey: string;
  initialScrollTop?: number;
  onRestored?: () => void;
}

/**
 * Windowing with measured row heights. Rows are absolutely positioned at cumulative offsets; unmeasured
 * rows use an estimate, and the scroll position is anchored to the first visible row so late
 * measurements (or items arriving above) never make the list jump.
 */
export function useVirtualRows({ scrollerRef, listRef, rows, density, scale, resetKey, initialScrollTop, onRestored }: Options) {
  const heights = useRef(new Map<string, number>());
  const [ver, setVer] = useState(0);
  const metric = `${density}|${scale}`;
  const lastMetric = useRef(metric);
  if (lastMetric.current !== metric) {
    lastMetric.current = metric;
    heights.current.clear();
  }

  const offsets = useMemo(
    () => buildOffsets(rows.map((r) => heights.current.get(r.key) ?? estimateRowHeight(r, density, scale))),
    // `ver` is the signal that heights changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, ver, density, scale],
  );
  const indexByKey = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);
  const latest = useRef({ rows, offsets, indexByKey });
  latest.current = { rows, offsets, indexByKey };

  const [view, setView] = useState<VirtualView>({ start: 0, end: 24, sticky: -1, listTop: 0 });
  const anchor = useRef<{ key: string; off: number } | null>(null);

  const compute = useCallback(() => {
    const sc = scrollerRef.current;
    const list = listRef.current;
    if (!sc || !list) return;
    const { rows: rs, offsets: off } = latest.current;
    const listTop = list.offsetTop;
    const top = sc.scrollTop;
    const vh = Math.max(0, sc.clientHeight - listTop);
    const r = visibleRange(off, top, vh, OVERSCAN);
    const sticky = stickyHeaderIndex(rs, off, top);
    setView((v) => (v.start === r.start && v.end === r.end && v.sticky === sticky && v.listTop === listTop ? v : { ...r, sticky, listTop }));
    const a = findRowAt(off, top);
    const row = a >= 0 ? rs[a] : undefined;
    anchor.current = row ? { key: row.key, off: off[a]! } : null;
  }, [scrollerRef, listRef]);

  // restore a remembered scroll position once, when the list first has rows
  const restored = useRef(false);
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    if (restored.current || !sc || rows.length === 0) return;
    restored.current = true;
    if (initialScrollTop && initialScrollTop > 0) sc.scrollTop = initialScrollTop;
    onRestored?.();
    anchor.current = null;
  }, [rows.length, initialScrollTop, onRestored, scrollerRef]);

  // new query / filter: back to the top
  const firstReset = useRef(true);
  useLayoutEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    const sc = scrollerRef.current;
    if (sc) sc.scrollTop = 0;
    anchor.current = null;
  }, [resetKey, scrollerRef]);

  // after rows/measurements change: keep the first visible row where it was, then recompute the window
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    const a = anchor.current;
    if (sc && a && sc.scrollTop > 0) {
      const idx = latest.current.indexByKey.get(a.key);
      if (idx !== undefined) {
        const delta = offsets[idx]! - a.off;
        if (Math.abs(delta) > 0.5) sc.scrollTop += delta;
      }
    }
    compute();
  }, [offsets, compute, scrollerRef]);

  // scroll + resize
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(compute);
    ro.observe(sc);
    return () => {
      sc.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollerRef, compute]);

  // row measurement
  const roRef = useRef<ResizeObserver | null>(null);
  const pending = useRef(false);
  const els = useRef(new Map<string, HTMLElement>());
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());

  const record = useCallback((key: string, h: number) => {
    const rounded = Math.round(h * 2) / 2;
    const prev = heights.current.get(key);
    if (prev !== undefined && Math.abs(prev - rounded) < 0.5) return;
    heights.current.set(key, rounded);
    if (pending.current) return;
    pending.current = true;
    requestAnimationFrame(() => {
      pending.current = false;
      setVer((v) => v + 1);
    });
  }, []);

  const getRO = useCallback(() => {
    roRef.current ??= new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const key = el.dataset.vkey;
        if (!key) continue;
        record(key, e.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height);
      }
    });
    return roRef.current;
  }, [record]);

  const measure = useCallback(
    (key: string) => {
      let f = refs.current.get(key);
      if (!f) {
        f = (el: HTMLElement | null) => {
          const prev = els.current.get(key);
          if (prev && prev !== el) getRO().unobserve(prev);
          if (el) {
            el.dataset.vkey = key;
            els.current.set(key, el);
            getRO().observe(el);
          } else {
            els.current.delete(key);
            refs.current.delete(key);
          }
        };
        refs.current.set(key, f);
      }
      return f;
    },
    [getRO],
  );

  const gap = density === 'compact' ? COMPACT_GAP : ROW_GAP;
  const scrollToRow = useCallback(
    (index: number) => {
      const sc = scrollerRef.current;
      const list = listRef.current;
      if (!sc || !list) return;
      const vh = Math.max(0, sc.clientHeight - list.offsetTop);
      const target = scrollTargetFor(latest.current.offsets, index, sc.scrollTop, vh, STICKY_H, gap);
      if (target !== null) sc.scrollTop = target;
      compute();
    },
    [scrollerRef, listRef, compute, gap],
  );

  return { view, offsets, total: offsets[offsets.length - 1] ?? 0, measure, scrollToRow };
}
