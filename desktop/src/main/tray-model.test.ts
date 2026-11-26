import { describe, expect, it } from 'vitest';
import { parsePresence, createPresenceStore } from './presence-settings';
import { relativeTime, resolveTrayState, tooltipText, trayIconName } from './tray-model';

describe('tray state', () => {
  it('paused beats attention beats the captured flash', () => {
    expect(resolveTrayState({ paused: true, attention: true, flashing: true })).toBe('paused');
    expect(resolveTrayState({ paused: false, attention: true, flashing: true })).toBe('attention');
    expect(resolveTrayState({ paused: false, attention: false, flashing: true })).toBe('captured');
    expect(resolveTrayState({ paused: false, attention: false, flashing: false })).toBe('idle');
  });
});

describe('tooltip', () => {
  const now = 10_000_000;
  it('matches the documented format', () => {
    expect(tooltipText({ count: 128, last: { label: 'SQL', at: now - 2 * 60_000 }, paused: false, now })).toBe(
      'mouStache · 128 items · last: SQL, 2 min ago',
    );
  });
  it('handles singular, no history and paused', () => {
    expect(tooltipText({ count: 1, paused: false, now })).toBe('mouStache · 1 item');
    expect(tooltipText({ count: 5, last: { label: 'SQL', at: now }, paused: true, now })).toBe('mouStache · Paused · 5 items');
  });
  it('relative time buckets', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 90 * 60_000, now)).toBe('2 h ago');
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe('3 d ago');
  });
});

describe('icon names', () => {
  it('macOS uses Template images; Windows picks by taskbar theme', () => {
    expect(trayIconName('idle', 'darwin', false)).toBe('mac-idleTemplate');
    expect(trayIconName('captured', 'darwin', true)).toBe('mac-curlTemplate');
    expect(trayIconName('paused', 'win32', true)).toBe('ondark-paused');
    expect(trayIconName('attention', 'win32', false)).toBe('onlight-attention');
  });
});

describe('presence settings from the engine', () => {
  it('fills defaults for anything missing or invalid', () => {
    expect(parsePresence({ blipMode: 'nonsense', blipDuration: 5, pausedApps: 'x' })).toMatchObject({
      blipMode: 'blip',
      blipDuration: 'normal',
      blipPosition: 'bottom-right',
      autoCapture: true,
      pausedApps: ['1Password', 'Bitwarden', 'KeePass', 'LastPass', 'Dashlane'],
    });
  });
  it('keeps valid values and only string app names', () => {
    const s = parsePresence({ blipMode: 'tray', autoCapture: false, pausedApps: ['Slack', 3, null] });
    expect(s).toMatchObject({ blipMode: 'tray', autoCapture: false, pausedApps: ['Slack'] });
  });
  it('store notifies with first=true once', () => {
    const st = createPresenceStore();
    const seen: boolean[] = [];
    st.onChange((_s, first) => void seen.push(first));
    expect(st.ready).toBe(false);
    st.update({});
    st.update({ blipMode: 'off' });
    expect(seen).toEqual([true, false]);
    expect(st.get().blipMode).toBe('off');
  });
});
