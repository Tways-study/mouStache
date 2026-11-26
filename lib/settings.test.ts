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

  it('has quiet desktop presence defaults and old stored settings gain them without losing anything', async () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      blipMode: 'blip', blipPosition: 'bottom-right', blipDuration: 'normal',
      menuBarCount: false, weeklySummary: false,
      pausedApps: ['1Password', 'Bitwarden', 'KeePass', 'LastPass', 'Dashlane'],
    });
    expect(DEFAULT_SETTINGS).toMatchObject({ hotkeyPalette: 'Alt+Shift+V', hotkeyScreenshot: 'Alt+Shift+S' });
    store['stash:settings'] = { autoCapture: false, theme: 'dark', pausedHosts: ['example.com'], maxItems: 500 }; // extension-era shape
    const s = await getSettings();
    expect(s).toMatchObject({ autoCapture: false, theme: 'dark', pausedHosts: ['example.com'], maxItems: 500 });
    expect(s.blipMode).toBe('blip');
    expect(s.pausedApps).toEqual(DEFAULT_SETTINGS.pausedApps);
    // the bridge stays OFF and unpaired until the user turns it on
    expect(s).toMatchObject({ bridgeEnabled: false, bridgeToken: '', bridgePort: 47821 });
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
