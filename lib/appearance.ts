import type { ReduceMotion, Settings, TextSize } from './types';

/** Only the settings that change how things look (shared by the side panel and the page overlay). */
export type Appearance = Pick<Settings, 'theme' | 'textSize' | 'reduceMotion'>;

export const TEXT_SCALE: Record<TextSize, number> = {
  small: 0.92,
  default: 1,
  large: 1.1,
  xlarge: 1.2,
};

export function textScale(size: TextSize | undefined): number {
  return TEXT_SCALE[size ?? 'default'] ?? 1;
}

/** `on` always reduces, `off` never, `system` follows the OS. */
export function resolveReduceMotion(setting: ReduceMotion, systemPrefers: boolean): boolean {
  return setting === 'on' ? true : setting === 'off' ? false : systemPrefers;
}

export function systemPrefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Write the appearance onto an element: `data-theme` (absent = follow the OS), `data-motion`
 * (`reduce` | `full`) and the `--ts` text scale. In the overlay this is a wrapper inside the shadow
 * root; custom properties inherit, so the tokens flip for everything below it.
 */
export function applyAppearance(el: HTMLElement, a: Appearance, systemReduce = systemPrefersReducedMotion()): void {
  if (a.theme === 'light' || a.theme === 'dark') el.setAttribute('data-theme', a.theme);
  else el.removeAttribute('data-theme');
  el.setAttribute('data-motion', resolveReduceMotion(a.reduceMotion, systemReduce) ? 'reduce' : 'full');
  el.style.setProperty('--ts', String(textScale(a.textSize)));
}

const CACHE_KEY = 'stash:appearance';

/** Remember the last appearance so the next panel open paints correctly before settings load. */
export function cacheAppearance(a: Appearance): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable */
  }
}

export function readCachedAppearance(): Appearance | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system',
      textSize: v.textSize && v.textSize in TEXT_SCALE ? v.textSize : 'default',
      reduceMotion: v.reduceMotion === 'on' || v.reduceMotion === 'off' ? v.reduceMotion : 'system',
    };
  } catch {
    return null;
  }
}
