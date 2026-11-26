import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (v: Record<string, unknown>) => void Object.assign(store, v),
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
  },
}));

import { getSettings, setSettings } from './settings';
import { DEFAULT_SETTINGS } from './types';
import { applyAppearance, resolveReduceMotion, textScale } from './appearance';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('settings', () => {
  it('has comfort defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      theme: 'system', textSize: 'default', density: 'comfortable', reduceMotion: 'system',
      badgeCount: true, showToast: true, autoCleanupDays: 0,
    });
  });

  it('returns defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges stored settings from an older version over the defaults', async () => {
    store['stash:settings'] = { autoCapture: false, maxItems: 500 }; // pre-comfort shape
    const s = await getSettings();
    expect(s.autoCapture).toBe(false);
    expect(s.maxItems).toBe(500);
    expect(s.theme).toBe('system');
    expect(s.density).toBe('comfortable');
    expect(s.badgeCount).toBe(true);
  });

  it('setSettings merges a partial and persists', async () => {
    const next = await setSettings({ density: 'compact', theme: 'dark' });
    expect(next.density).toBe('compact');
    expect(next.maxItems).toBe(DEFAULT_SETTINGS.maxItems);
    expect((await getSettings()).theme).toBe('dark');
  });
});

describe('appearance', () => {
  it('maps text sizes to scales', () => {
    expect([textScale('small'), textScale('default'), textScale('large'), textScale('xlarge')]).toEqual([0.92, 1, 1.1, 1.2]);
    expect(textScale(undefined)).toBe(1);
  });

  it('resolves reduce-motion against the OS preference', () => {
    expect(resolveReduceMotion('on', false)).toBe(true);
    expect(resolveReduceMotion('off', true)).toBe(false);
    expect(resolveReduceMotion('system', true)).toBe(true);
    expect(resolveReduceMotion('system', false)).toBe(false);
  });

  it('applies theme, motion and scale to an element', () => {
    const el = document.createElement('div');
    applyAppearance(el, { theme: 'dark', textSize: 'large', reduceMotion: 'on' }, false);
    expect(el.getAttribute('data-theme')).toBe('dark');
    expect(el.getAttribute('data-motion')).toBe('reduce');
    expect(el.style.getPropertyValue('--ts')).toBe('1.1');
    applyAppearance(el, { theme: 'system', textSize: 'default', reduceMotion: 'off' }, true);
    expect(el.hasAttribute('data-theme')).toBe(false);
    expect(el.getAttribute('data-motion')).toBe('full');
  });
});
