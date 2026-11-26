import { useEffect, useRef, useState } from 'react';
import { send } from '@/lib/messaging';
import { overlayStore } from '@/lib/content/store';

interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MIN_SIZE = 8;

export function normalizeRect(d: Drag) {
  const x = Math.min(d.x0, d.x1);
  const y = Math.min(d.y0, d.y1);
  return { x, y, w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
}

const nextFrames = (n: number) =>
  new Promise<void>((res) => {
    const step = (left: number) => (left <= 0 ? res() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

/** Overrides for hosts that are not a browser page (the desktop screenshot window). Without them: page behaviour. */
export interface RegionSelectProps {
  /** Called with the dragged rectangle (CSS px) instead of asking the background worker to capture the tab. */
  onSelect?: (rect: { x: number; y: number; w: number; h: number; dpr: number }) => void;
  /** Called on Esc instead of ending the page overlay. */
  onCancel?: () => void;
}

export function RegionSelect({ onSelect, onCancel }: RegionSelectProps = {}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onCancel) onCancel();
        else overlayStore.endRegion();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const finish = async () => {
    const d = dragRef.current;
    update(null);
    if (!d) return;
    const r = normalizeRect(d);
    if (r.w <= MIN_SIZE || r.h <= MIN_SIZE) return; // too small: stay in select mode
    if (onSelect) {
      onSelect({ ...r, dpr: window.devicePixelRatio || 1 });
      return;
    }
    overlayStore.endRegion();
    await nextFrames(2); // let the overlay disappear before the screenshot
    try {
      await send({ type: 'capture-region', rect: { ...r, dpr: window.devicePixelRatio || 1 } });
    } catch {
      overlayStore.showToast('Could not capture screenshot');
    }
  };

  const rect = drag ? normalizeRect(drag) : null;

  return (
    <div
      ref={ref}
      className="pointer-events-auto fixed inset-0 select-none"
      style={{ cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        ref.current?.setPointerCapture(e.pointerId);
        update({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (d) update({ ...d, x1: e.clientX, y1: e.clientY });
      }}
      onPointerUp={() => void finish()}
      onPointerCancel={() => update(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!rect && <div className="absolute inset-0 bg-black/35" />}
      {rect && (
        <>
          <div
            className="absolute rounded-[2px] border border-accent"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              boxShadow: '0 0 0 100vmax rgba(0,0,0,0.35)',
              borderWidth: 1,
            }}
          />
          <div
            className="vibrancy palette-surface shadow-float absolute rounded-full px-[8px] py-[2px] font-mono text-[11px] font-medium text-label-primary"
            style={{
              left: Math.min(rect.x + rect.w + 8, window.innerWidth - 96),
              top: Math.min(rect.y + rect.h + 8, window.innerHeight - 28),
            }}
          >
            {Math.round(rect.w)} × {Math.round(rect.h)}
          </div>
        </>
      )}
      {!rect && (
        <div className="vibrancy palette-surface shadow-float absolute left-1/2 top-[24px] -translate-x-1/2 rounded-full px-[12px] py-[6px] text-[12px] font-medium text-label-secondary">
          Drag to capture · Esc to cancel
        </div>
      )}
    </div>
  );
}
