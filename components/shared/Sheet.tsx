import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Small mono breadcrumb above the title, e.g. "~/moustache/settings". */
  crumb?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Full-height slide-over inside the side panel. Slides from the right (220ms ease-out), dims the
 * content behind it, traps focus loosely (focus moves in, returns on close) and unmounts after exit.
 * Esc handling lives in App so nested sheets close in the right order.
 */
export function Sheet({ open, onClose, title, crumb, actions, children, footer }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (open && mounted) {
      const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), 30);
      return () => clearTimeout(t);
    }
    if (!open && returnTo.current && document.contains(returnTo.current)) {
      returnTo.current.focus({ preventScroll: true });
    }
  }, [open, mounted]);

  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-40" data-sheet>
      <div
        className="sheet-scrim absolute inset-0 bg-black/30"
        data-state={open ? 'open' : 'closed'}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-state={open ? 'open' : 'closed'}
        className="sheet-panel absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col bg-surface shadow-modal outline-none sm:left-[6%] sm:w-auto"
      >
        <header className="vibrancy glass flex shrink-0 items-center gap-2 border-b border-separator px-3 py-2.5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="icon-btn -ml-1"
          >
            <Icon name="back" size={18} />
          </button>
          <div className="min-w-0 flex-1">
            {crumb && <div className="truncate font-mono text-[10.5px] leading-3 text-label-tertiary">{crumb}</div>}
            <h2 className="truncate text-[15px] font-semibold leading-5 tracking-[-0.01em]">{title}</h2>
          </div>
          {actions}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer}
      </div>
    </div>
  );
}
