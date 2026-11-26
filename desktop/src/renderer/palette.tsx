// The shim MUST be evaluated first (lib/messaging reads chrome.* through wxt/browser).
import './chrome-shim';
import './palette.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Palette } from '@/components/overlay/Palette';
import type { PaletteHost } from '@/components/overlay/paletteHost';
import { applyAppearance, type Appearance } from '@/lib/appearance';
import { send } from '@/lib/messaging';
import { fenceLang } from '@/lib/panel/helpers';
import { getSettings, onSettingsChanged } from '@/lib/settings';

/**
 * The same <Palette/> the extension shows over web pages, hosted in its own window: search goes to the engine,
 * a choice goes to the main process (clipboard + restore focus + paste keystroke).
 */
const host: PaletteHost = {
  codeBlock: true,
  async search({ query, limit, kind }) {
    const res = await send({ type: 'search', query, limit, ...(kind ? { kind } : {}) });
    return Array.isArray(res) ? res : [];
  },
  close: () => window.mouDesktop?.paletteClose(),
  async activate(item, mode) {
    window.mouDesktop?.paletteChoose({ id: item.id, mode, fence: mode === 'code' ? fenceLang(item) : undefined });
  },
};

function App() {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    // each time main shows the window the palette starts fresh (empty query, newest items, focused input)
    window.mouDesktop?.onPaletteShow(() => setShown((n) => n + 1));
    const refocus = () => document.querySelector<HTMLInputElement>('input')?.focus();
    window.addEventListener('focus', refocus);
    return () => window.removeEventListener('focus', refocus);
  }, []);

  // tell main the fresh palette is on screen (after React committed and the browser painted)
  useEffect(() => {
    if (shown === 0) return;
    const raf = requestAnimationFrame(() => window.mouDesktop?.paletteReady());
    return () => cancelAnimationFrame(raf);
  }, [shown]);

  useEffect(() => {
    const apply = (a: Appearance) => applyAppearance(document.documentElement, a);
    void getSettings().then(apply, () => undefined);
    return onSettingsChanged(apply);
  }, []);

  return (
    <div className="font-sans text-[14px] text-label-primary antialiased">
      <Palette key={shown} returnFocus={null} host={host} layout="window" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
