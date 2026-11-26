import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Density } from '@/lib/types';
import type { ListRow } from '@/lib/panel/virtual';
import { STICKY_H, useVirtualRows } from '@/lib/panel/useVirtual';
import { Icon } from '@/components/shared/Icon';
import { CompactCard, ItemCard, type CardHandlers } from './ItemCard';

export interface ItemListHandle {
  /** Scroll the item into view (it may be virtualised away) and focus it. */
  focusItem: (id: string) => void;
}

interface Props extends CardHandlers {
  rows: ListRow[];
  density: Density;
  scale: number;
  now: number;
  copiedId: string | null;
  freshIds: Set<string>;
  scrollerRef: RefObject<HTMLDivElement>;
  resetKey: string;
  initialScrollTop?: number;
  onRestored?: () => void;
  onToggleSection: (sectionKey: string, collapsed: boolean) => void;
}

type HeaderRow = Extract<ListRow, { type: 'header' }>;

function SectionHeader({ row, onToggle, sticky }: { row: HeaderRow; onToggle: Props['onToggleSection']; sticky?: boolean }) {
  return (
    <button
      type="button"
      className="sec-head"
      aria-expanded={!row.collapsed}
      aria-label={`${row.title}, ${row.count} items, ${row.collapsed ? 'collapsed' : 'expanded'}`}
      style={sticky ? { height: STICKY_H, padding: '0 4px' } : undefined}
      onClick={() => onToggle(row.sectionKey, !row.collapsed)}
    >
      <Icon name="chevron" size={12} className="chev shrink-0" strokeWidth={2.2} />
      <span className="text-[12px] font-semibold tracking-[0.1em] [font-variant-caps:all-small-caps]">{row.title}</span>
      <span className="h-px flex-1 bg-separator" />
      <span className="text-[11px] font-normal tabular-nums text-label-tertiary">{row.count}</span>
    </button>
  );
}

export const ItemList = forwardRef<ItemListHandle, Props>(function ItemList(
  {
    rows, density, scale, now, copiedId, freshIds, scrollerRef, resetKey, initialScrollTop, onRestored, onToggleSection,
    ...handlers
  },
  ref,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const onToggleMore = useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  const { view, offsets, total, measure, scrollToRow } = useVirtualRows({
    scrollerRef, listRef, rows, density, scale, resetKey, initialScrollTop, onRestored,
  });

  const pendingFocus = useRef<string | null>(null);
  const tryFocus = useCallback(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-card][data-id="${CSS.escape(id)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, []);
  useLayoutEffect(tryFocus);

  useImperativeHandle(
    ref,
    () => ({
      focusItem(id: string) {
        const idx = rows.findIndex((r) => r.type === 'item' && r.item.id === id);
        if (idx < 0) return;
        pendingFocus.current = id;
        scrollToRow(idx);
        tryFocus();
      },
    }),
    [rows, scrollToRow, tryFocus],
  );

  const Card = density === 'compact' ? CompactCard : ItemCard;
  const gap = density === 'compact' ? 3 : 8;
  const slice = rows.slice(view.start, view.end);
  const stickyRow = view.sticky >= 0 ? rows[view.sticky] : undefined;

  return (
    <div ref={listRef} role="list" data-list aria-label="Saved items" className="relative" style={{ height: total + 32 }}>
      {stickyRow?.type === 'header' && (
        <div style={{ position: 'sticky', top: view.listTop, height: 0, zIndex: 5 }}>
          <div className="sec-sticky absolute inset-x-0 top-0 px-3" style={{ height: STICKY_H }}>
            <SectionHeader row={stickyRow} onToggle={onToggleSection} sticky />
          </div>
        </div>
      )}
      {slice.map((row, k) => {
        const i = view.start + k;
        const style = { position: 'absolute', top: offsets[i], left: 12, right: 12 } as const;
        if (row.type === 'header') {
          return (
            <div key={row.key} ref={measure(row.key)} style={style} role="presentation">
              <SectionHeader row={row} onToggle={onToggleSection} />
            </div>
          );
        }
        return (
          <div key={row.key} ref={measure(row.key)} style={{ ...style, paddingBottom: gap }}>
            <Card
              item={row.item}
              now={now}
              copied={copiedId === row.item.id}
              fresh={freshIds.has(row.item.id)}
              expanded={expanded.has(row.item.id)}
              onToggleMore={onToggleMore}
              {...handlers}
            />
          </div>
        );
      })}
    </div>
  );
});
