/** Pure tray logic: which icon state to show, the tooltip text, and icon file names. */

export type TrayState = 'idle' | 'captured' | 'paused' | 'attention';

export interface TrayModelInput {
  paused: boolean;
  attention: boolean;
  /** true during the ~600 ms "curl" after a capture */
  flashing: boolean;
}

/** paused beats attention beats the captured flash. */
export function resolveTrayState(i: TrayModelInput): TrayState {
  if (i.paused) return 'paused';
  if (i.attention) return 'attention';
  return i.flashing ? 'captured' : 'idle';
}

export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export interface TooltipInput {
  count: number;
  last?: { label: string; at: number };
  paused: boolean;
  now: number;
}

const plural = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/** `mouStache · 128 items · last: SQL, 2 min ago` (never any copied content). */
export function tooltipText(i: TooltipInput): string {
  const parts = ['mouStache'];
  if (i.paused) parts.push('Paused');
  parts.push(plural(i.count));
  if (i.last && !i.paused) parts.push(`last: ${i.last.label}, ${relativeTime(i.last.at, i.now)}`);
  return parts.join(' · ');
}

/**
 * Icon file (without extension). macOS uses template images (black + alpha, the OS tints them);
 * Windows picks a dark glyph for a light taskbar and a white one for a dark taskbar.
 */
export function trayIconName(state: TrayState, platform: NodeJS.Platform, darkTaskbar: boolean): string {
  const s = state === 'captured' ? 'curl' : state;
  if (platform === 'darwin') return `mac-${s}Template`;
  return `${darkTaskbar ? 'ondark' : 'onlight'}-${s}`;
}
