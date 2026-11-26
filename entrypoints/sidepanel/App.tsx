import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { comboText } from '@/lib/platform';
import { DEFAULT_SETTINGS, type Settings, type StashItem } from '@/lib/types';
import { GROUP_META } from '@/lib/tags';
import { FILTER_GROUPS, countFilters, matchesFilter, sectionize, type FilterId } from '@/lib/panel/helpers';
import {
  captureVisibleTab, describeSave, fetchItems, loadSettings, patchItem, removeItem, resetBadge, saveImage, saveText,
  subscribeItems, subscribeSettings,
} from '@/lib/panel/data';
import { copyItem, fileToDataUrl } from '@/lib/panel/clipboard';
import { connectPanel } from '@/lib/panel/ext';
import { useNow } from '@/lib/panel/hooks';
import { useAppearance } from '@/lib/panel/useAppearance';
import { flattenRows, navIdsOf } from '@/lib/panel/virtual';
import {
  createSessionSaver, loadRecent, loadSession, pushRecent, saveRecent, type PanelSession,
} from '@/lib/panel/session';
import { textScale } from '@/lib/appearance';
import { Header } from '@/components/panel/Header';
import { ItemList, type ItemListHandle } from '@/components/panel/ItemList';
import { Onboarding, NoResults } from '@/components/panel/EmptyStates';
import { DetailSheet } from '@/components/panel/DetailSheet';
import { SettingsSheet } from '@/components/panel/SettingsSheet';
import { ShortcutsSheet } from '@/components/panel/ShortcutsSheet';
import type { ChipDef } from '@/components/panel/FilterChips';
import { Snackbar, useToasts } from '@/components/shared/Toast';
import { Icon } from '@/components/shared/Icon';

const UNDO_MS = 4000;
const SEARCH_DEBOUNCE = 150;
const RECENT_SETTLE = 1200;

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el?.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

function reducedMotionNow(): boolean {
  return document.documentElement.getAttribute('data-motion') === 'reduce';
}

export default function App() {
  const [items, setItems] = useState<StashItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [dq, setDq] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [sessionReady, setSessionReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [far, setFar] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const { toast, show, dismiss } = useToasts();
  const now = useNow();

  useAppearance(settings);

  const searchRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<ItemListHandle>(null);
  const seen = useRef<Set<string> | null>(null);
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragDepth = useRef(0);
  const live = useRef(dq);
  live.current = dq;

  // ───────── remembered place (session) ─────────
  const saver = useRef(createSessionSaver());
  const restoreScroll = useRef<number | undefined>(undefined);
  const scrollSaveOk = useRef(false);

  useEffect(() => {
    let alive = true;
    void loadSession().then((s: PanelSession) => {
      if (!alive) return;
      saver.current.init(s);
      restoreScroll.current = s.scrollTop > 0 ? s.scrollTop : undefined;
      scrollSaveOk.current = s.scrollTop <= 0;
      setFilter(s.filter as FilterId);
      setQuery(s.query);
      setDq(s.query);
      setCollapsedMap(s.collapsed);
      setSessionReady(true);
    });
    const flush = () => saver.current.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      alive = false;
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  useEffect(() => {
    if (sessionReady) saver.current.update({ filter, query });
  }, [filter, query, sessionReady]);

  // debounce the search itself
  useEffect(() => {
    const t = setTimeout(() => setDq(query), SEARCH_DEBOUNCE);
    return () => clearTimeout(t);
  }, [query]);

  // remember searches the user settled on
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => commitRecent(q), RECENT_SETTLE);
    return () => clearTimeout(t);
  }, [query]);

  const commitRecent = useCallback((q: string) => {
    setRecent((prev) => {
      const next = pushRecent(prev, q);
      if (next !== prev) saveRecent(next);
      return next;
    });
  }, []);
  const clearRecent = useCallback(() => {
    saveRecent([]);
    setRecent([]);
  }, []);

  // ───────── data ─────────
  const refetch = useCallback(async () => {
    const next = await fetchItems(live.current);
    setItems(next);
    setLoaded(true);
    // arrival animation + "N new" pill: only for new items while browsing the unfiltered feed
    if (!live.current) {
      const ids = new Set(next.map((i) => i.id));
      if (seen.current) {
        const added = next.filter((i) => !seen.current!.has(i.id)).map((i) => i.id);
        if (added.length && added.length <= 5) {
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 2200);
        }
        if (added.length && (scrollerRef.current?.scrollTop ?? 0) > 120) setNewCount((n) => n + added.length);
      }
      seen.current = ids;
    }
  }, []);

  useEffect(() => {
    if (sessionReady) void refetch();
  }, [dq, refetch, sessionReady]);

  useEffect(() => {
    const offItems = subscribeItems(() => void refetch());
    const offPort = connectPanel();
    void resetBadge();
    void loadSettings().then(setSettings);
    const offSettings = subscribeSettings(setSettings);
    const onVis = () => document.visibilityState === 'visible' && (void refetch(), void resetBadge());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      offItems();
      offPort();
      offSettings();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refetch]);

  // commit pending deletes if the panel closes mid-undo
  useEffect(() => {
    const flush = () => {
      deleteTimers.current.forEach((t, id) => {
        clearTimeout(t);
        void removeItem(id);
      });
      deleteTimers.current.clear();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // ───────── derived ─────────
  const visible = useMemo(() => items.filter((i) => !pending.has(i.id)), [items, pending]);
  const counts = useMemo(() => countFilters(visible), [visible]);
  const filtered = useMemo(() => visible.filter((i) => matchesFilter(i, filter)), [visible, filter]);
  const sections = useMemo(() => sectionize(filtered, now), [filtered, now]);
  const rows = useMemo(() => flattenRows(sections, collapsedMap, dq.trim() !== ''), [sections, collapsedMap, dq]);
  const navIds = useMemo(() => navIdsOf(rows), [rows]);
  const navRef = useRef(navIds);
  navRef.current = navIds;

  const chips: ChipDef[] = useMemo(() => {
    const list: ChipDef[] = [
      { id: 'all', label: 'All', count: counts.all },
      { id: 'pinned', label: 'Pinned', count: counts.pinned, icon: 'pin' },
    ];
    for (const g of FILTER_GROUPS) {
      if (counts[g] > 0 || filter === g) list.push({ id: g, label: GROUP_META[g].label, count: counts[g] });
    }
    return list;
  }, [counts, filter]);

  useEffect(() => {
    if (filter !== 'all' && counts[filter] === 0 && loaded && !dq) setFilter('all');
  }, [counts, filter, loaded, dq]);

  const [announce, setAnnounce] = useState('');

  const toggleSection = useCallback((key: string, collapsed: boolean) => {
    setCollapsedMap((m) => {
      const next = { ...m, [key]: collapsed };
      saver.current.update({ collapsed: next });
      return next;
    });
  }, []);

  // ───────── actions ─────────
  const onCopy = useCallback(
    async (item: StashItem) => {
      try {
        await copyItem(item);
        clearTimeout(copyTimer.current);
        setCopiedId(item.id);
        setAnnounce(item.kind === 'image' ? 'Image copied' : 'Copied');
        copyTimer.current = setTimeout(() => setCopiedId(null), 1100);
      } catch {
        show('Couldn’t reach the clipboard', { tone: 'error' });
      }
    },
    [show],
  );

  const onPin = useCallback(async (item: StashItem) => {
    const pinned = !item.pinned;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, pinned } : i)));
    await patchItem(item.id, { pinned });
    setAnnounce(pinned ? 'Pinned' : 'Unpinned');
  }, []);

  const onDelete = useCallback(
    (item: StashItem) => {
      const ids = navRef.current;
      const idx = ids.indexOf(item.id);
      const neighbour = ids[idx + 1] ?? ids[idx - 1];
      const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-card]')?.dataset.id;
      setPending((p) => new Set(p).add(item.id));
      if (focusedId === item.id && neighbour) listRef.current?.focusItem(neighbour);

      const timer = setTimeout(async () => {
        deleteTimers.current.delete(item.id);
        await removeItem(item.id);
        await refetch();
        setPending((p) => {
          const n = new Set(p);
          n.delete(item.id);
          return n;
        });
      }, UNDO_MS);
      deleteTimers.current.set(item.id, timer);

      show('Deleted', {
        ms: UNDO_MS,
        actionLabel: 'Undo',
        onAction: () => {
          clearTimeout(deleteTimers.current.get(item.id));
          deleteTimers.current.delete(item.id);
          setPending((p) => {
            const n = new Set(p);
            n.delete(item.id);
            return n;
          });
          requestAnimationFrame(() => listRef.current?.focusItem(item.id));
        },
      });
      setAnnounce('Deleted. Undo available for 4 seconds.');
    },
    [refetch, show],
  );

  const onTags = useCallback(async (item: StashItem, tags: string[]) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, tags } : i)));
    await patchItem(item.id, { tags });
  }, []);

  const onExpand = useCallback((item: StashItem) => setDetailId(item.id), []);

  const focusFirst = useCallback(() => {
    const first = navRef.current[0];
    if (first) listRef.current?.focusItem(first);
  }, []);

  const toTop = useCallback(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: reducedMotionNow() ? 'auto' : 'smooth' });
    setNewCount(0);
  }, []);

  // ───────── captures ─────────
  const saveFiles = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (!imgs.length) return show('Only images and text can be added', { tone: 'error' });
      for (const f of imgs) {
        try {
          const r = await saveImage(await fileToDataUrl(f));
          show(describeSave(r, 'image'));
        } catch {
          show('Couldn’t save that image', { tone: 'error' });
        }
      }
    },
    [show],
  );

  const saveTextValue = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      try {
        show(describeSave(await saveText(text), 'text'));
      } catch {
        show('Couldn’t save that text', { tone: 'error' });
      }
    },
    [show],
  );

  const pasteFromClipboard = useCallback(async () => {
    try {
      const clip = await navigator.clipboard.read();
      for (const ci of clip) {
        const imgType = ci.types.find((t) => t.startsWith('image/'));
        if (imgType) {
          const blob = await ci.getType(imgType);
          show(describeSave(await saveImage(await fileToDataUrl(blob)), 'image'));
          return;
        }
        if (ci.types.includes('text/plain')) {
          await saveTextValue(await (await ci.getType('text/plain')).text());
          return;
        }
      }
      show('Clipboard is empty');
    } catch {
      try {
        await saveTextValue(await navigator.clipboard.readText());
      } catch {
        show(`Allow clipboard access, or press ${comboText(['Mod', 'V'])} in this panel`, { tone: 'error' });
      }
    }
  }, [saveTextValue, show]);

  const screenshot = useCallback(async () => {
    try {
      show(describeSave(await captureVisibleTab(), 'screenshot'));
    } catch {
      show('Couldn’t capture this tab', { tone: 'error' });
    }
  }, [show]);

  // paste + drag-drop
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault();
        void saveFiles(files);
        return;
      }
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        e.preventDefault();
        void saveTextValue(text);
      }
    };
    const hasPayload = (e: DragEvent) =>
      !!e.dataTransfer && (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain'));
    const enter = (e: DragEvent) => {
      if (!hasPayload(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasPayload(e) && e.preventDefault();
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void saveFiles(files);
      else void saveTextValue(e.dataTransfer?.getData('text/plain') ?? '');
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [saveFiles, saveTextValue]);

  // ───────── keyboard ─────────
  const sheetOpen = settingsOpen || shortcutsOpen || detailId !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (shortcutsOpen) return setShortcutsOpen(false);
        if (settingsOpen) return setSettingsOpen(false);
        if (detailId) return setDetailId(null);
        if (query) return setQuery('');
        return;
      }
      if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') {
        e.preventDefault();
        return setShortcutsOpen(true);
      }
      if (sheetOpen) return;
      if (e.key === '/') {
        e.preventDefault();
        return searchRef.current?.focus();
      }
      const down = e.key === 'j' || e.key === 'ArrowDown';
      const up = e.key === 'k' || e.key === 'ArrowUp';
      if (down || up) {
        const ids = navRef.current;
        if (!ids.length) return;
        e.preventDefault();
        const curId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-card]')?.dataset.id;
        const cur = curId ? ids.indexOf(curId) : -1;
        if (up && cur === 0) return searchRef.current?.focus();
        const next = cur < 0 ? (down ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, cur + (down ? 1 : -1)));
        listRef.current?.focusItem(ids[next]!);
        return;
      }
      // type-to-search: a printable key while the list (not a button/input) has focus jumps into search
      if (e.key.length === 1 && e.key !== ' ' && !e.defaultPrevented) {
        const ae = document.activeElement as HTMLElement | null;
        const inList = !ae || ae === document.body || !!ae.closest('[data-list]') || ae === scrollerRef.current;
        if (!inList) return;
        e.preventDefault();
        const key = e.key;
        setQuery((q) => q + key);
        searchRef.current?.focus();
        requestAnimationFrame(() => {
          const el = searchRef.current;
          if (el) el.setSelectionRange(el.value.length, el.value.length);
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsOpen, settingsOpen, detailId, query, sheetOpen]);

  // keep background inert while a sheet is open
  useEffect(() => {
    const el = document.getElementById('panel-main');
    if (!el) return;
    if (sheetOpen) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [sheetOpen]);

  const detailItem = detailId ? (items.find((i) => i.id === detailId) ?? null) : null;
  useEffect(() => {
    if (detailId && loaded && !detailItem) setDetailId(null);
  }, [detailId, detailItem, loaded]);

  const onRestored = useCallback(() => {
    restoreScroll.current = undefined;
    scrollSaveOk.current = true;
  }, []);

  const ready = loaded && sessionReady;
  const empty = ready && items.length === 0 && !dq;
  const noResults = ready && !empty && filtered.length === 0;
  const total = counts.all;
  const showPill = newCount > 0 || far;

  return (
    <div className="relative h-full overflow-hidden bg-surface text-label-primary">
      <div id="panel-main" className="h-full">
        <div
          ref={scrollerRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const st = el.scrollTop;
            setScrolled(st > 4);
            setFar(st > el.clientHeight * 2);
            if (st < 120) setNewCount(0);
            if (scrollSaveOk.current) saver.current.update({ scrollTop: st });
          }}
          className="thin-scroll h-full overflow-y-auto overscroll-contain"
        >
          <Header
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            total={empty ? 0 : total}
            chips={empty ? [] : chips}
            filter={filter}
            onFilter={setFilter}
            onScreenshot={() => void screenshot()}
            onPasteClipboard={() => void pasteFromClipboard()}
            onSettings={() => setSettingsOpen(true)}
            onFocusList={focusFirst}
            recent={recent}
            onCommitRecent={commitRecent}
            onClearRecent={clearRecent}
            scrolled={scrolled}
          />
          {!ready ? null : empty ? (
            <Onboarding onPaste={() => void pasteFromClipboard()} />
          ) : noResults ? (
            <NoResults
              query={dq}
              onClear={() => {
                setQuery('');
                setFilter('all');
              }}
            />
          ) : (
            <ItemList
              ref={listRef}
              rows={rows}
              density={settings.density}
              scale={textScale(settings.textSize)}
              now={now}
              copiedId={copiedId}
              freshIds={fresh}
              scrollerRef={scrollerRef}
              resetKey={`${dq}|${filter}`}
              initialScrollTop={restoreScroll.current}
              onRestored={onRestored}
              onToggleSection={toggleSection}
              onCopy={onCopy}
              onPin={onPin}
              onExpand={onExpand}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>

      {showPill && !sheetOpen && (
        <button
          type="button"
          onClick={toTop}
          aria-label={newCount > 0 ? `${newCount} new items, scroll to top` : 'Back to top'}
          className={`pill vibrancy glass absolute right-3 z-30 flex h-8 items-center gap-1.5 rounded-full border border-separator pl-3 pr-3.5 text-[12px] font-medium shadow-float transition-[bottom] duration-base hover:bg-hover ${
            toast ? 'bottom-[68px]' : 'bottom-4'
          } ${newCount > 0 ? 'text-accent' : 'text-label-primary'}`}
        >
          <Icon name="arrow-up" size={13} strokeWidth={2.2} />
          {newCount > 0 ? `${newCount} new` : 'Top'}
        </button>
      )}

      <DetailSheet
        open={detailId !== null}
        item={detailItem}
        onClose={() => setDetailId(null)}
        onPin={onPin}
        onDelete={onDelete}
        onTags={onTags}
        onToast={(t, tone) => show(t, { tone })}
      />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onToast={(t, tone) => show(t, { tone })} />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-2xl drop-ring vibrancy">
          <div className="flex flex-col items-center gap-2 text-accent">
            <Icon name="download" size={28} />
            <div className="text-[14px] font-semibold">Drop to save to mouStache</div>
            <div className="text-[12px] opacity-80">Images and text</div>
          </div>
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      <Snackbar toast={toast} onDismiss={dismiss} />
    </div>
  );
}
