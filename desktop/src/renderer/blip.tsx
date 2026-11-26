// The shim MUST be evaluated first (tokens/appearance helpers read chrome.* through wxt/browser).
import './chrome-shim';
import './blip.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mascot } from '@/components/shared/Mascot';
import { resolveReduceMotion, systemPrefersReducedMotion } from '@/lib/appearance';
import type { BlipRender } from '../shared/api';

interface State {
  show: boolean;
  text: string;
  position: string;
  reduce: boolean;
  /** bumps each time the pill appears so the mascot's curl replays */
  n: number;
}

function Blip() {
  const [s, setS] = useState<State>({ show: false, text: '', position: 'bottom-right', reduce: false, n: 0 });

  useEffect(() => {
    window.mouDesktop?.onBlip((r: BlipRender) => {
      if (r.op === 'hide') return setS((p) => ({ ...p, show: false }));
      const reduce = resolveReduceMotion(r.reduceMotion, systemPrefersReducedMotion());
      setS((p) => ({ show: true, text: r.text, position: r.position, reduce, n: p.show ? p.n : p.n + 1 }));
    });
  }, []);

  const align = s.position === 'bottom-left' ? 'left' : 'right';
  return (
    <div id="blip-root" data-align={align} style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: align === 'left' ? 'flex-start' : 'flex-end' }} data-motion={s.reduce ? 'reduce' : 'full'}>
      <div className="blip" role="status" aria-live="polite" data-show={s.show} data-reduce={s.reduce} data-testid="blip">
        <Mascot key={s.n} mood={s.reduce ? 'rest' : 'happy'} size={26} />
        <span data-testid="blip-text">{s.text}</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Blip />);
