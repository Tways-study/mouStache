import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { applyAppearance, type Appearance } from '@/lib/appearance';
import { overlayStore } from '@/lib/content/store';
import { Palette } from './Palette';
import { RegionSelect } from './RegionSelect';
import { Toast } from './Toast';

export const PALETTE_EXIT_MS = 120;

/** Keeps the palette mounted for its exit animation after the store says it is closed. */
function usePalettePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), PALETTE_EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);
  return open || mounted;
}

/** Single React tree living inside the shadow root. */
export function OverlayRoot({ appearance }: { appearance?: Appearance }) {
  const wrap = useRef<HTMLDivElement>(null);
  // theme / reduce-motion live on this wrapper (custom properties inherit through the shadow tree)
  useLayoutEffect(() => {
    if (wrap.current && appearance) applyAppearance(wrap.current, appearance);
  }, [appearance?.theme, appearance?.textSize, appearance?.reduceMotion]);
  const s = useSyncExternalStore(overlayStore.subscribe, overlayStore.get);
  const lastFocus = useRef<Element | null>(null);
  if (s.paletteOpen) lastFocus.current = s.returnFocus;
  const paletteMounted = usePalettePresence(s.paletteOpen);
  return (
    <div ref={wrap} className="pointer-events-none fixed inset-0 font-sans text-[14px] text-label-primary antialiased">
      {paletteMounted && <Palette returnFocus={lastFocus.current} closing={!s.paletteOpen} />}
      {s.regionActive && <RegionSelect />}
      {s.toast && <Toast key={s.toast.id} id={s.toast.id} text={s.toast.text} />}
    </div>
  );
}
