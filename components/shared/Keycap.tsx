import type { ReactNode } from 'react';
import { keyLabel } from '@/lib/platform';

/** Small keyboard keycap, used in hints and the shortcuts sheet. */
export function Keycap({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <kbd className={`keycap ${className}`}>{children}</kbd>;
}

/** Row of keycaps for a combo like ["Mod","Shift","V"] (Mod = ⌘ on macOS, Ctrl elsewhere; Alt/Shift/Ctrl become ⌥⇧⌃ on macOS). */
export function Combo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k) => (
        <Keycap key={k}>{keyLabel(k)}</Keycap>
      ))}
    </span>
  );
}
