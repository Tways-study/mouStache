import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Mascot } from './Mascot';

export interface ToastData {
  id: number;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'error';
  ms: number;
}

/** Snackbar queue (one visible at a time) + a polite aria-live mirror for screen readers. */
export function useToasts() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((text: string, opts: Partial<Omit<ToastData, 'id' | 'text'>> = {}) => {
    clearTimeout(timer.current);
    const id = ++seq.current;
    const ms = opts.ms ?? 2200;
    setToast({ id, text, ms, ...opts });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), ms);
    return id;
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, show, dismiss };
}

export function Snackbar({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {toast?.text}
      </div>
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div
            key={toast.id}
            className="snack pointer-events-auto relative flex max-w-full items-center gap-3 overflow-hidden rounded-full vibrancy glass border border-separator py-2 pl-4 pr-2 text-[13px] font-medium text-label-primary shadow-modal"
          >
            {toast.tone === 'error' ? (
              <span className="text-tag-error">
                <Icon name="close" size={14} />
              </span>
            ) : (
              <Mascot mood="happy" size={22} className="shrink-0 text-accent" />
            )}
            <span className="truncate">{toast.text}</span>
            {toast.actionLabel ? (
              <button
                type="button"
                onClick={() => {
                  toast.onAction?.();
                  onDismiss();
                }}
                className="rounded-full bg-accent-soft px-3 py-1 text-[13px] font-semibold text-accent transition-colors duration-fast hover:bg-[color-mix(in_srgb,var(--accent)_24%,transparent)]"
              >
                {toast.actionLabel}
              </button>
            ) : (
              <span className="w-1" />
            )}
            {toast.actionLabel && (
              <span className="snack-timer absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent/50" style={{ animationDuration: `${toast.ms}ms` }} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
