import { useEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from '@/components/shared/Icon';
import { Logo } from '@/components/shared/Logo';
import { Combo, Keycap } from '@/components/shared/Keycap';
import { FilterChips, type ChipDef } from './FilterChips';
import type { FilterId } from '@/lib/panel/helpers';

interface Props {
  query: string;
  onQuery: (q: string) => void;
  searchRef: RefObject<HTMLInputElement>;
  total: number;
  chips: ChipDef[];
  filter: FilterId;
  onFilter: (f: FilterId) => void;
  onScreenshot: () => void;
  onPasteClipboard: () => void;
  onSettings: () => void;
  onFocusList: () => void;
  recent: string[];
  onCommitRecent: (q: string) => void;
  onClearRecent: () => void;
  scrolled: boolean;
}

export function Header({
  query, onQuery, searchRef, total, chips, filter, onFilter, onScreenshot, onPasteClipboard, onSettings, onFocusList, recent, onCommitRecent, onClearRecent, scrolled,
}: Props) {
  const [menu, setMenu] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const showRecent = searchFocused && query === '' && recent.length > 0;
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus({ preventScroll: true });
    const close = (refocus: boolean) => {
      setMenu(false);
      if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
        return;
      }
      if (e.key === 'Tab') return close(false);
      const list = items();
      if (!list.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation(); // keep App's J/K list navigation from also firing
      const cur = list.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (cur + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[next]?.focus({ preventScroll: true });
    };
    const onHide = () => close(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onHide);
    window.addEventListener('resize', onHide);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onHide);
      window.removeEventListener('resize', onHide);
    };
  }, [menu]);

  return (
    <header
      className={`vibrancy glass sticky top-0 z-20 shrink-0 border-b transition-[border-color] duration-base ${
        scrolled ? 'border-separator' : 'border-transparent'
      }`}
    >
      <div className="flex items-center gap-1 px-3 pb-1.5 pt-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Logo size={22} />
          <h1 className="text-[17px] font-semibold leading-6 tracking-[-0.02em]">mouStache</h1>
          <span className="truncate font-mono text-[11px] text-label-tertiary" aria-label={`${total} items`}>
            ~/moustache{total > 0 ? ` · ${total}` : ''}
          </span>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            ref={triggerRef}
            type="button"
            className="icon-btn"
            aria-label="Add to mouStache"
            aria-haspopup="menu"
            aria-expanded={menu}
            data-on={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <Icon name="plus" size={18} />
          </button>
          {menu && (
            <div
              role="menu"
              className="pop vibrancy glass absolute right-0 top-9 z-30 w-[262px] max-w-[calc(100vw-24px)] rounded-xl border border-separator p-1 shadow-modal"
            >
              <MenuItem
                icon="camera"
                label="Screenshot this tab"
                onClick={() => {
                  setMenu(false);
                  onScreenshot();
                }}
              />
              <MenuItem
                icon="clipboard"
                label="Paste from clipboard"
                hint={<Combo keys={['Mod', 'V']} />}
                onClick={() => {
                  setMenu(false);
                  onPasteClipboard();
                }}
              />
              <div className="mx-2 my-1 h-px bg-separator" />
              <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-[12px] text-label-secondary">
                <span className="flex items-center gap-2">
                  <Icon name="region" size={15} />
                  Region screenshot
                </span>
                <Combo keys={['Alt', 'Shift', 'S']} />
              </div>
            </div>
          )}
        </div>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onSettings}>
          <Icon name="gear" size={17} />
        </button>
      </div>

      <div className="relative px-3 pb-2">
        <label className="group flex h-9 items-center gap-2 rounded-[10px] bg-hover px-2.5 transition-[background,box-shadow] duration-fast focus-within:bg-elevated focus-within:shadow-[0_0_0_2px_var(--accent)]">
          <span className="text-label-tertiary transition-colors group-focus-within:text-accent">
            <Icon name="search" size={15} />
          </span>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                onQuery('');
              } else if (e.key === 'Escape') {
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                if (e.key === 'Enter') onCommitRecent(query);
                onFocusList();
              }
            }}
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="Search your mouStache…"
            aria-label="Search your mouStache"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-label-tertiary"
          />
          {query ? (
            <button type="button" className="icon-btn -mr-1.5 !rounded-full" aria-label="Clear search" onClick={() => onQuery('')}>
              <Icon name="close" size={13} />
            </button>
          ) : (
            <Keycap>/</Keycap>
          )}
        </label>
        {showRecent && (
          <div
            role="group"
            aria-label="Recent searches"
            className="pop vibrancy glass absolute inset-x-3 top-[40px] z-30 rounded-xl border border-separator p-2 shadow-modal"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-label-secondary">Recent</span>
              <button type="button" className="rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-accent hover:bg-accent-soft" onClick={onClearRecent}>
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onQuery(r)}
                  className="max-w-full truncate rounded-full bg-hover px-2.5 py-1 font-mono text-[11.5px] hover:bg-active"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <FilterChips chips={chips} active={filter} onChange={onFilter} />
    </header>
  );
}

function MenuItem({
  icon, label, hint, onClick,
}: {
  icon: string;
  label: string;
  hint?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-fast hover:bg-accent hover:text-accent-contrast focus-visible:bg-accent focus-visible:text-accent-contrast"
    >
      <span className="flex items-center gap-2">
        <Icon name={icon} size={15} />
        {label}
      </span>
      {hint}
    </button>
  );
}
