import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlipDuration, BlipMode } from '@/lib/types';
import { blipBounds, createBlipScheduler, FADE_IN_MS, FADE_OUT_MS, HOLD_MS, MIN_GAP_MS, type BlipCommand } from './blip-scheduler';

function setup(cfg: { mode?: BlipMode; duration?: BlipDuration; suppressed?: boolean } = {}) {
  const config = { mode: cfg.mode ?? ('blip' as BlipMode), duration: cfg.duration ?? ('normal' as BlipDuration) };
  const cmds: BlipCommand[] = [];
  let suppressed = cfg.suppressed ?? false;
  const s = createBlipScheduler({
    getConfig: () => config,
    emit: (c) => void cmds.push(c),
    isSuppressed: () => suppressed,
    now: () => Date.now(),
  });
  return { s, cmds, config, suppress: (v: boolean) => (suppressed = v), ops: () => cmds.map((c) => c.op) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('blip lifecycle', () => {
  it('shows "Saved · TYPE", holds, fades, then closes', () => {
    const t = setup();
    t.s.notify({ label: 'SQL' });
    expect(t.cmds[0]).toEqual({ op: 'show', payload: { text: 'Saved · SQL', count: 1 } });
    vi.advanceTimersByTime(FADE_IN_MS + HOLD_MS.normal - 1);
    expect(t.ops()).toEqual(['show']);
    vi.advanceTimersByTime(1);
    expect(t.ops()).toEqual(['show', 'hide']);
    vi.advanceTimersByTime(FADE_OUT_MS);
    expect(t.ops()).toEqual(['show', 'hide', 'close']);
    expect(t.s.phase).toBe('idle');
  });

  it.each(['short', 'normal', 'long'] as const)('uses the %s hold duration', (d) => {
    const t = setup({ duration: d });
    t.s.notify({ label: 'Command' });
    vi.advanceTimersByTime(FADE_IN_MS + HOLD_MS[d]);
    expect(t.ops()).toEqual(['show', 'hide']);
  });

  it('labels a duplicate as already saved', () => {
    const t = setup();
    t.s.notify({ label: 'JSON', deduped: true });
    expect(t.cmds[0]).toMatchObject({ payload: { text: 'Already saved · JSON' } });
  });
});

describe('coalescing and rate limit', () => {
  it('a burst updates the same pill instead of stacking', () => {
    const t = setup();
    t.s.notify({ label: 'SQL' });
    vi.advanceTimersByTime(300);
    t.s.notify({ label: 'Command' });
    vi.advanceTimersByTime(300);
    t.s.notify({ label: 'Image' });
    expect(t.ops()).toEqual(['show', 'update', 'update']);
    expect(t.cmds[2]).toEqual({ op: 'update', payload: { text: 'Saved · 3 items', count: 3 } });
    // the hold restarts on each update
    vi.advanceTimersByTime(FADE_IN_MS + HOLD_MS.normal);
    expect(t.ops().at(-1)).toBe('hide');
  });

  it('a copy during the fade-out revives the same pill', () => {
    const t = setup();
    t.s.notify({ label: 'SQL' });
    vi.advanceTimersByTime(FADE_IN_MS + HOLD_MS.normal);
    expect(t.s.phase).toBe('fading');
    t.s.notify({ label: 'SQL' });
    vi.advanceTimersByTime(FADE_OUT_MS + 50);
    expect(t.ops()).not.toContain('close');
  });

  it('allows at most one NEW blip every 2 s: a later copy is deferred, not dropped', () => {
    const t = setup({ duration: 'short' });
    t.s.notify({ label: 'SQL' });
    vi.advanceTimersByTime(FADE_IN_MS + HOLD_MS.short + FADE_OUT_MS); // closed after ~1.1 s
    expect(t.s.phase).toBe('idle');
    t.s.notify({ label: 'Command' });
    expect(t.ops().filter((o) => o === 'show')).toHaveLength(1); // still waiting for the 2 s gap
    vi.advanceTimersByTime(MIN_GAP_MS);
    expect(t.ops().filter((o) => o === 'show')).toHaveLength(2);
    expect(t.cmds.filter((c) => c.op === 'show').at(-1)).toMatchObject({ payload: { text: 'Saved · Command' } });
  });

  it('copies deferred by the rate limit are merged into one blip', () => {
    const t = setup({ duration: 'short' });
    t.s.notify({ label: 'SQL' });
    vi.advanceTimersByTime(FADE_IN_MS + HOLD_MS.short + FADE_OUT_MS);
    t.s.notify({ label: 'A' });
    t.s.notify({ label: 'B' });
    vi.advanceTimersByTime(MIN_GAP_MS);
    expect(t.cmds.filter((c) => c.op === 'show').at(-1)).toMatchObject({ payload: { text: 'Saved · 2 items', count: 2 } });
  });
});

describe('modes and suppression', () => {
  it.each<BlipMode>(['off', 'tray'])('never shows a blip in %s mode', (mode) => {
    const t = setup({ mode });
    expect(t.s.notify({ label: 'SQL' })).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(t.cmds).toEqual([]);
  });

  it('follows a mode change at runtime', () => {
    const t = setup({ mode: 'off' });
    t.s.notify({ label: 'SQL' });
    t.config.mode = 'blip';
    t.s.notify({ label: 'SQL' });
    expect(t.ops()).toEqual(['show']);
  });

  it.each([{ label: 'Secret', skipped: true }, { label: 'x', skipped: true }])(
    'never schedules anything for a skipped item (%j)',
    (e) => {
      const t = setup();
      expect(t.s.notify(e)).toBe(false);
      vi.advanceTimersByTime(10_000);
      expect(t.cmds).toEqual([]);
      expect(t.s.phase).toBe('idle');
    },
  );

  it('stays quiet while the user is working in the mouStache panel', () => {
    const t = setup({ suppressed: true });
    expect(t.s.notify({ label: 'SQL' })).toBe(false);
    t.suppress(false);
    expect(t.s.notify({ label: 'SQL' })).toBe(true);
  });

  it('announce (first-run hint) respects Tray only / Off', () => {
    const t = setup({ mode: 'tray' });
    expect(t.s.announce('mouStache lives in your tray.')).toBe(false);
    expect(t.cmds).toEqual([]);
    t.config.mode = 'blip';
    expect(t.s.announce('mouStache lives in your tray.', 4500)).toBe(true);
    vi.advanceTimersByTime(FADE_IN_MS + 4499);
    expect(t.ops()).toEqual(['show']);
  });
});

describe('payload never carries copied content', () => {
  it('only the type label and a count reach the window, even for hostile labels in the event shape', () => {
    const t = setup();
    // the scheduler's input type has no text field; extra properties are never forwarded
    const copied = 'SELECT password FROM users;';
    t.s.notify({ label: 'SQL', text: copied } as never);
    t.s.notify({ label: 'SQL', text: copied } as never);
    expect(JSON.stringify(t.cmds)).not.toContain(copied);
    expect(JSON.stringify(t.cmds)).not.toContain('password');
    for (const c of t.cmds) if ('payload' in c) expect(Object.keys(c.payload).sort()).toEqual(['count', 'text']);
  });
});

describe('blipBounds', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 }; // work area excludes the 40 px taskbar
  const size = { width: 380, height: 44 };
  it('sits 16 px inside the work area corner', () => {
    expect(blipBounds('bottom-right', wa, size)).toEqual({ x: 1920 - 380 - 16, y: 1040 - 44 - 16, ...size });
    expect(blipBounds('bottom-left', wa, size)).toMatchObject({ x: 16, y: 1040 - 44 - 16 });
    expect(blipBounds('top-right', wa, size)).toMatchObject({ x: 1920 - 380 - 16, y: 16 });
  });
  it('follows a secondary display offset', () => {
    expect(blipBounds('bottom-right', { x: 1920, y: 0, width: 1280, height: 720 }, size).x).toBe(1920 + 1280 - 380 - 16);
  });
});
