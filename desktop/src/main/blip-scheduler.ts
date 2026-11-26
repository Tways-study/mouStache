/**
 * Pure scheduling for the on-screen "blip" (docs/desktop-ambient-presence.md).
 * Decides WHEN to show/update/hide; the payload only ever carries a type label and a count, never copied text.
 */
import type { BlipDuration, BlipMode, BlipPosition } from '@/lib/types';

export const FADE_IN_MS = 120;
export const FADE_OUT_MS = 200;
export const MIN_GAP_MS = 2000;
export const HOLD_MS: Record<BlipDuration, number> = { short: 800, normal: 1200, long: 2000 };

export interface BlipPayload {
  text: string;
  count: number;
}

export type BlipCommand =
  | { op: 'show'; payload: BlipPayload }
  | { op: 'update'; payload: BlipPayload }
  | { op: 'hide' } // start the fade-out
  | { op: 'close' }; // fade finished: take the window away

/** What the capture pipeline tells the scheduler. `skipped` items must never produce feedback. */
export interface BlipEvent {
  skipped?: boolean;
  label: string;
  deduped?: boolean;
}

export interface BlipConfig {
  mode: BlipMode;
  duration: BlipDuration;
}

export interface BlipTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(t: unknown): void;
}

export interface BlipSchedulerDeps {
  getConfig(): BlipConfig;
  emit(cmd: BlipCommand): void;
  /** e.g. the user is working in the mouStache panel itself */
  isSuppressed?(): boolean;
  now?(): number;
  timers?: BlipTimers;
}

export function blipText(count: number, label: string, deduped: boolean): string {
  if (count > 1) return `Saved · ${count} items`;
  return `${deduped ? 'Already saved' : 'Saved'} · ${label}`;
}

export function createBlipScheduler(d: BlipSchedulerDeps) {
  const now = d.now ?? Date.now;
  const timers: BlipTimers = d.timers ?? { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t as never) };

  let phase: 'idle' | 'visible' | 'fading' = 'idle';
  let lastShownAt = -Infinity;
  let batch = { count: 0, label: '', deduped: false };
  let holdTimer: unknown;
  let closeTimer: unknown;
  let deferTimer: unknown;
  let holdMs = 0;

  const clear = (t: unknown) => t !== undefined && timers.clearTimeout(t);
  const payload = (): BlipPayload => ({ text: blipText(batch.count, batch.label, batch.deduped), count: batch.count });

  function armHold() {
    clear(holdTimer);
    holdTimer = timers.setTimeout(() => {
      phase = 'fading';
      d.emit({ op: 'hide' });
      closeTimer = timers.setTimeout(() => {
        phase = 'idle';
        batch = { count: 0, label: '', deduped: false };
        d.emit({ op: 'close' });
      }, FADE_OUT_MS);
    }, FADE_IN_MS + holdMs);
  }

  function showNow() {
    deferTimer = undefined;
    phase = 'visible';
    lastShownAt = now();
    d.emit({ op: 'show', payload: payload() });
    armHold();
  }

  function add(label: string, deduped: boolean) {
    batch = { count: batch.count + 1, label, deduped: batch.count === 0 ? deduped : false };
  }

  return {
    /** Returns true when the event was accepted (it may still be deferred by the rate limit). */
    notify(e: BlipEvent): boolean {
      const cfg = d.getConfig();
      if (cfg.mode !== 'blip' || e.skipped) return false;
      if (d.isSuppressed?.()) return false;
      holdMs = HOLD_MS[cfg.duration];

      if (phase === 'visible' || phase === 'fading') {
        // same pill: coalesce, keep it up a little longer
        if (phase === 'fading') {
          clear(closeTimer);
          phase = 'visible';
        }
        add(e.label, !!e.deduped);
        d.emit({ op: 'update', payload: payload() });
        armHold();
        return true;
      }
      add(e.label, !!e.deduped);
      if (deferTimer !== undefined) return true; // a show is already queued; it will carry this one too
      const wait = lastShownAt + MIN_GAP_MS - now();
      if (wait <= 0) showNow();
      else deferTimer = timers.setTimeout(showNow, wait);
      return true;
    },

    /**
     * One-off message (first-run hint, "Copied, press Ctrl+V"). Not subject to the 2 s limit. Respects Off and
     * Tray only, unless `force` (messages the user needs in order to finish what they just did) which only Off blocks.
     */
    announce(text: string, holdForMs = 4500, force = false): boolean {
      const mode = d.getConfig().mode;
      if (mode === 'off' || (mode !== 'blip' && !force)) return false;
      clear(holdTimer);
      clear(closeTimer);
      clear(deferTimer);
      deferTimer = undefined;
      holdMs = holdForMs;
      batch = { count: 1, label: '', deduped: false };
      phase = 'visible';
      lastShownAt = now();
      d.emit({ op: 'show', payload: { text, count: 1 } });
      armHold();
      return true;
    },

    dispose() {
      clear(holdTimer);
      clear(closeTimer);
      clear(deferTimer);
    },
    get phase() {
      return phase;
    },
    /** Nothing showing and nothing queued (a deferred show counts as busy). */
    get idle() {
      return phase === 'idle' && deferTimer === undefined;
    },
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Window bounds for the pill: `margin` px inside the display's work area (which excludes the taskbar/dock). */
export function blipBounds(position: BlipPosition, workArea: Rect, size: { width: number; height: number }, margin = 16): Rect {
  const left = position === 'bottom-left';
  const top = position === 'top-right';
  return {
    width: size.width,
    height: size.height,
    x: left ? workArea.x + margin : workArea.x + workArea.width - size.width - margin,
    y: top ? workArea.y + margin : workArea.y + workArea.height - size.height - margin,
  };
}
