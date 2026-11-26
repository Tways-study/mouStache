import { Sheet } from '@/components/shared/Sheet';
import { Combo } from '@/components/shared/Keycap';

export const SHORTCUT_GROUPS: { title: string; rows: { keys: string[]; alt?: string[]; label: string }[] }[] = [
  {
    title: 'Navigate',
    rows: [
      { keys: ['/'], label: 'Focus search' },
      { keys: ['A–Z'], label: 'Just start typing to search' },
      { keys: ['J'], alt: ['↓'], label: 'Next item' },
      { keys: ['K'], alt: ['↑'], label: 'Previous item' },
      { keys: ['Esc'], label: 'Close sheet · clear search' },
    ],
  },
  {
    title: 'On an item',
    rows: [
      { keys: ['Enter'], label: 'Copy' },
      { keys: ['P'], label: 'Pin or unpin' },
      { keys: ['E'], label: 'Open details' },
      { keys: ['Del'], alt: ['⌫'], label: 'Delete (4 s to undo)' },
    ],
  },
  {
    title: 'Anywhere',
    rows: [
      { keys: ['Mod', 'V'], label: 'Paste text or an image into mouStache' },
      { keys: ['Alt', 'Shift', 'V'], label: 'Quick palette on any page' },
      { keys: ['Alt', 'Shift', 'S'], label: 'Region screenshot' },
      { keys: ['?'], label: 'This cheat sheet' },
    ],
  },
];

export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Keyboard shortcuts" crumb="~/moustache/keys">
      <div className="space-y-5 p-4">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-label-secondary">{g.title}</h3>
            <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-elevated shadow-card">
              {g.rows.map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                  <span>{r.label}</span>
                  <span className="flex items-center gap-2">
                    <Combo keys={r.keys} />
                    {r.alt && (
                      <>
                        <span className="text-[11px] text-label-tertiary">or</span>
                        <Combo keys={r.alt} />
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
