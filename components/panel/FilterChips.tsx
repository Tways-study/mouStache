import type { FilterId } from '@/lib/panel/helpers';
import { Icon } from '@/components/shared/Icon';
import { ACCENT_ACTIVE, GROUP_STYLE } from './groupStyle';
import type { TagGroup } from '@/lib/types';

export interface ChipDef {
  id: FilterId;
  label: string;
  count: number;
  icon?: string;
}

export function FilterChips({
  chips, active, onChange,
}: {
  chips: ChipDef[];
  active: FilterId;
  onChange: (f: FilterId) => void;
}) {
  if (chips.length === 0) return <div className="h-1" />;
  return (
    <div
      role="tablist"
      aria-label="Filter by type"
      className="scroll-hide chips-fade flex gap-1.5 overflow-x-auto px-3 pb-2.5 pt-0.5"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]'));
        const i = tabs.indexOf(document.activeElement as HTMLElement);
        const next = tabs[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }}
    >
      {chips.map((c) => {
        const on = c.id === active;
        const tone =
          c.id === 'all' || c.id === 'pinned' || c.id === 'text' ? ACCENT_ACTIVE : GROUP_STYLE[c.id as TagGroup].active;
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(c.id)}
            className={`flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-[background,color,box-shadow] duration-fast ${
              on
                ? `${tone} ring-1`
                : 'bg-transparent text-label-secondary shadow-[inset_0_0_0_0.5px_var(--separator)] hover:bg-hover hover:text-label-primary'
            }`}
          >
            {c.icon && <Icon name={c.icon} size={12} />}
            {c.label}
            <span className={`tabular-nums text-[11px] ${on ? 'opacity-70' : 'text-label-tertiary'}`}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}
