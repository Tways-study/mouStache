import { useEffect } from 'react';
import { applyAppearance, cacheAppearance, type Appearance } from '@/lib/appearance';

/** Apply theme / text size / reduce-motion to <html> and keep it live (also follows the OS when set to System). */
export function useAppearance(a: Appearance): void {
  const { theme, textSize, reduceMotion } = a;
  useEffect(() => {
    const apply = () => applyAppearance(document.documentElement, { theme, textSize, reduceMotion });
    apply();
    cacheAppearance({ theme, textSize, reduceMotion });
    if (reduceMotion !== 'system') return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    mq?.addEventListener('change', apply);
    return () => mq?.removeEventListener('change', apply);
  }, [theme, textSize, reduceMotion]);
}
