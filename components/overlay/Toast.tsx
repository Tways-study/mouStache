import { useEffect, useState } from 'react';
import { overlayStore } from '@/lib/content/store';
import { CheckCircleIcon } from './icons';

const VISIBLE_MS = 1600;
const EXIT_MS = 220;

export function Toast({ id, text }: { id: number; text: string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // next frame so the initial (hidden) styles are painted first -> transition runs
    const raf = requestAnimationFrame(() => setShown(true));
    const hide = setTimeout(() => setShown(false), VISIBLE_MS);
    const clear = setTimeout(() => overlayStore.clearToast(id), VISIBLE_MS + EXIT_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hide);
      clearTimeout(clear);
    };
  }, [id]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[28px] flex justify-center"
      role="status"
      aria-live="polite"
    >
      <div
        className={[
          'vibrancy palette-surface shadow-float flex items-center gap-[8px] rounded-full border border-separator px-[14px] py-[8px]',
          'text-[13px] font-medium leading-[18px] text-label-primary',
          'transition-[opacity,transform] duration-base ease-[var(--ease-out)]',
          'motion-reduce:transition-none',
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-[8px] scale-[0.98] opacity-0',
          'motion-reduce:translate-y-0 motion-reduce:scale-100',
        ].join(' ')}
      >
        <CheckCircleIcon size={16} className="text-accent" />
        <span>{text}</span>
      </div>
    </div>
  );
}
