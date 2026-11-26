import { Mascot } from '@/components/shared/Mascot';
import { comboText } from '@/lib/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { send } from '@/lib/messaging';
import type { StashItemLite } from '@/lib/messaging';
import type { TagGroup } from '@/lib/types';
import { tagGroup } from '@/lib/classify';
import { overlayStore } from '@/lib/content/store';
import { debounce } from '@/lib/content/debounce';
import { insertAtCursor, isEditable } from '@/lib/content/insert';
import { writeImageFromDataUrl, writeText } from '@/lib/content/clipboard';
import { hostname, isMonoItem, itemGroup, previewLine, relativeTime, tagLabel } from '@/lib/content/labels';
import { GROUP_STYLE, GroupIcon, PinIcon, SearchIcon } from './icons';

const RESULT_LIMIT = 30;

export const FILTERS: { key: string; label: string; group: TagGroup | null }[] = [
  { key: 'all', label: 'All', group: null },
  { key: 'code', label: 'Code', group: 'code' },
  { key: 'prompt', label: 'Prompts', group: 'prompt' },
  { key: 'image', label: 'Images', group: 'image' },
  { key: 'link', label: 'Links', group: 'link' },
  { key: 'network', label: 'Network', group: 'network' },
  { key: 'error', label: 'Errors', group: 'error' },
];

const GENERIC_TAGS = new Set(['code', 'link', 'image']);
/** Drop generic tags (code/link/image) when a more specific one exists; mirrors the side panel cards. */
function overlayTags(tags: string[]): string[] {
  const specific = tags.filter((t) => !GENERIC_TAGS.has(t));
  return (specific.length ? specific : tags).slice(0, 3);
}



function Keycap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[18px] items-center justify-center rounded-[5px] bg-hover px-[5px] py-[1px] font-sans text-[11px] font-medium leading-[16px] text-label-secondary">
      {children}
    </kbd>
  );
}

function Row({
  item,
  selected,
  onHover,
  onClick,
}: {
  item: StashItemLite;
  selected: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  const group = itemGroup(item);
  const style = GROUP_STYLE[group];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const host = hostname(item.source?.url);
  const preview = item.secret
    ? '•••• secret hidden'
    : item.kind === 'image'
      ? `Image${item.width && item.height ? ` · ${item.width} × ${item.height}` : ''}`
      : previewLine(item.text ?? '');

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      onMouseMove={onHover}
      onClick={onClick}
      className={[
        'mx-[6px] flex cursor-default items-center gap-[12px] rounded-lg px-[10px] py-[8px]',
        selected ? 'bg-accent-soft' : '',
      ].join(' ')}
    >
      {item.kind === 'image' && item.thumbDataUrl ? (
        <img
          src={item.thumbDataUrl}
          alt=""
          className="h-[40px] w-[40px] shrink-0 rounded-lg object-cover shadow-card"
        />
      ) : (
        <div className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-lg ${style.soft} ${style.text}`}>
          <GroupIcon group={group} size={16} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div
          className={[
            'truncate text-[14px] leading-[20px] text-label-primary',
            item.secret ? 'tracking-wide text-label-secondary' : '',
            !item.secret && isMonoItem(item) ? 'font-mono text-[13px]' : '',
          ].join(' ')}
        >
          {preview}
        </div>
        <div className="mt-[2px] flex items-center gap-[6px] text-[11px] leading-[16px] text-label-secondary">
          {overlayTags(item.tags).map((t) => {
            const g = GROUP_STYLE[tagGroup(t)];
            return (
              <span key={t} className={`rounded-full px-[6px] font-medium ${g.soft} ${g.text}`}>
                {tagLabel(t)}
              </span>
            );
          })}
          <span>{relativeTime(item.createdAt)}</span>
          {host && <span className="truncate">· {host}</span>}
        </div>
      </div>
      {item.pinned && <PinIcon size={14} className="shrink-0 text-accent" />}
    </div>
  );
}

export function Palette({ returnFocus, closing = false }: { returnFocus: Element | null; closing?: boolean }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(0);
  const [items, setItems] = useState<StashItemLite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState(0);
  const [entered, setEntered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // enter animation + focus
  useEffect(() => {
    inputRef.current?.focus();
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // restore focus the moment closing starts (the exit animation keeps us mounted ~120ms), or on unmount
  const restored = useRef(false);
  const restoreFocus = useCallback(() => {
    if (restored.current) return;
    restored.current = true;
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }, [returnFocus]);
  useEffect(() => {
    if (closing) restoreFocus();
  }, [closing, restoreFocus]);
  useEffect(() => restoreFocus, [restoreFocus]);

  const run = useCallback(async (q: string, f: number) => {
    const my = ++seq.current;
    const group = FILTERS[f]?.group ?? null;
    try {
      const res = await send({
        type: 'search',
        query: q,
        limit: group ? 150 : RESULT_LIMIT,
        ...(group === 'image' ? { kind: 'image' as const } : {}),
      });
      if (my !== seq.current) return;
      const list = (Array.isArray(res) ? res : []).filter((it) => !group || itemGroup(it) === group);
      setItems(list.slice(0, RESULT_LIMIT));
    } catch {
      if (my !== seq.current) return;
      setItems([]);
    }
    setLoaded(true);
    setSel(0);
  }, []);

  const debounced = useMemo(() => debounce((q: string, f: number) => void run(q, f), 80), [run]);
  useEffect(() => () => debounced.cancel(), [debounced]);

  // filter change / first load: immediate. query change: debounced.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      void run('', filter);
      return;
    }
    void run(query, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const close = () => overlayStore.closePalette();

  const activate = async (item: StashItemLite | undefined, paste: boolean) => {
    if (!item) return;
    try {
      const res = await send({ type: 'copy-item', id: item.id });
      if (!res?.ok) {
        overlayStore.showToast('Could not copy that item');
        return;
      }
      let pastedText: string | undefined;
      if (res.kind === 'image' && res.dataUrl) {
        await writeImageFromDataUrl(res.dataUrl);
        overlayStore.showToast(`Image copied — paste with ${comboText(['Mod', 'V'])}`);
      } else if (res.text !== undefined) {
        await writeText(res.text);
        pastedText = res.text;
        overlayStore.showToast('Copied');
      }
      close();
      if (paste && pastedText !== undefined && isEditable(returnFocus)) {
        // wait a tick so the palette unmounts and focus is restored first
        setTimeout(() => insertAtCursor(returnFocus, pastedText), 0);
      }
    } catch {
      overlayStore.showToast('Could not copy that item');
    }
  };

  const move = (delta: number) => {
    if (!items.length) return;
    setSel((s) => (s + delta + items.length) % items.length);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'n' || e.key === 'N'))) {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'p' || e.key === 'P'))) {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void activate(items[sel], !e.shiftKey);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setFilter((f) => (f + (e.shiftKey ? -1 : 1) + FILTERS.length) % FILTERS.length);
    } else if (mod && /^[1-7]$/.test(e.key)) {
      e.preventDefault();
      setFilter(Number(e.key) - 1);
    }
  };

  return (
    <div
      className={`fixed inset-0 font-sans ${closing ? 'pointer-events-none' : 'pointer-events-auto'}`}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
      onKeyPress={(e) => e.stopPropagation()}
    >
      <div
        className={[
          'absolute inset-0 bg-black/20 backdrop-blur-[2px] dark:bg-black/40 transition-opacity motion-reduce:transition-none',
          closing ? 'duration-[120ms] ease-in' : 'duration-base',
          entered && !closing ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        onMouseDown={close}
      />
      <div
        role="dialog"
        aria-label="mouStache quick palette"
        className={[
          'vibrancy palette-surface shadow-modal absolute left-1/2 top-[20vh] flex max-h-[min(560px,70vh)] w-[min(640px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-separator',
          'transition-[opacity,transform] motion-reduce:transition-none',
          closing ? 'duration-[120ms] ease-in' : 'duration-base ease-[var(--ease-out)]',
          entered && !closing ? 'scale-100 opacity-100' : closing ? 'scale-[0.98] opacity-0' : 'scale-[0.97] opacity-0',
        ].join(' ')}
      >
        <div className="flex items-center gap-[12px] px-[18px] py-[14px]">
          <SearchIcon size={20} className="shrink-0 text-label-secondary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              debounced(e.target.value, filter);
            }}
            placeholder="Search your mouStache…  try 'sql', 'ip', 'prompt'"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent text-[17px] leading-[24px] text-label-primary outline-none placeholder:text-label-tertiary"
            style={{ border: 0, padding: 0, font: 'inherit', fontSize: 17 }}
          />
          <Keycap>esc</Keycap>
        </div>

        <div className="scroll-hide flex items-center gap-[6px] overflow-x-auto px-[16px] pb-[10px]">
          {FILTERS.map((f, i) => (
            <button
              key={f.key}
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setFilter(i);
                inputRef.current?.focus();
              }}
              className={[
                'shrink-0 cursor-default rounded-full px-[10px] py-[3px] text-[12px] font-medium leading-[18px] transition-colors duration-fast motion-reduce:transition-none',
                i === filter ? 'bg-accent text-accent-contrast' : 'bg-hover text-label-secondary hover:bg-active',
              ].join(' ')}
              style={{ border: 0 }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="h-px bg-separator" />

        <div role="listbox" className="thin-scroll min-h-0 flex-1 overflow-y-auto py-[6px]">
          {items.map((it, i) => (
            <Row key={it.id} item={it} selected={i === sel} onHover={() => setSel(i)} onClick={() => void activate(it, true)} />
          ))}
          {loaded && items.length === 0 && (
            <div className="flex flex-col items-center px-[24px] py-[28px] text-center">
              <Mascot mood={query ? 'droop' : 'rest'} size={56} className={query ? 'mb-[10px] text-label-tertiary' : 'mb-[10px] text-accent'} />
              <div className="text-[14px] font-medium text-label-primary">
                {query ? 'Nothing matches that' : 'Nothing under the nose yet'}
              </div>
              <div className="mt-[4px] text-[12px] leading-[18px] text-label-secondary">
                {query
                  ? 'Try a different word, or switch the filter.'
                  : `Copy something on any page and it lands here. Press ${comboText(['Alt', 'Shift', 'V'])} to open this anywhere.`}
              </div>
            </div>
          )}
        </div>

        <div className="h-px bg-separator" />
        <div className="flex items-center gap-[14px] px-[16px] py-[8px] text-[11px] text-label-secondary">
          <span className="flex items-center gap-[5px]">
            <Keycap>↵</Keycap> paste
          </span>
          <span className="flex items-center gap-[5px]">
            <Keycap>⇧↵</Keycap> copy
          </span>
          <span className="flex items-center gap-[5px]">
            <Keycap>esc</Keycap> close
          </span>
          <span className="ml-auto flex items-center gap-[5px]">
            <Keycap>⇥</Keycap> filter
          </span>
        </div>
      </div>
    </div>
  );
}
