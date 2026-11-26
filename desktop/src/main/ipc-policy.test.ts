import { describe, expect, it } from 'vitest';
import { CH } from '../shared/api';
import { IPC_POLICY, isAllowed, mayRoute, type WindowRole } from './ipc-policy';

const ROLES: WindowRole[] = ['panel', 'engine', 'blip', 'palette', 'region'];
/** main -> renderer pushes: not callable by renderers, so intentionally absent from the policy */
const PUSHES: string[] = [CH.message, CH.engineRequest, CH.blip, CH.paletteShow, CH.regionShow];

describe('IPC policy table', () => {
  it('covers every channel in the shared contract, so a new channel cannot be forgotten', () => {
    const all = Object.values(CH) as string[];
    for (const ch of all) {
      if (PUSHES.includes(ch)) continue;
      expect(Object.keys(IPC_POLICY), `channel ${ch} has no policy entry`).toContain(ch);
    }
    for (const ch of Object.keys(IPC_POLICY)) expect(all, `policy for unknown channel ${ch}`).toContain(ch);
  });

  it('every entry names at least one role and only real roles', () => {
    for (const [ch, roles] of Object.entries(IPC_POLICY)) {
      expect(roles.length, ch).toBeGreaterThan(0);
      for (const r of roles) expect(ROLES, `${ch}: ${r}`).toContain(r);
    }
  });

  it('the blip pill can call NOTHING', () => {
    for (const ch of Object.keys(IPC_POLICY)) expect(isAllowed(ch, 'blip'), ch).toBe(false);
  });

  it('the screenshot overlay can only finish or cancel a screenshot', () => {
    const allowed = Object.keys(IPC_POLICY).filter((ch) => isAllowed(ch, 'region'));
    expect(allowed.sort()).toEqual([CH.regionCancel, CH.regionDone].sort());
  });

  it('the palette gets search/copy plumbing and its own channels, and no OS-level powers', () => {
    const allowed = Object.keys(IPC_POLICY).filter((ch) => isAllowed(ch, 'palette'));
    expect(allowed.sort()).toEqual([CH.send, CH.paletteChoose, CH.paletteClose, CH.paletteReady].sort());
    for (const ch of [CH.setLogin, CH.openExternal, CH.ownWrite, CH.bridgeInfo, CH.bridgeRegenerate, CH.writeSecret, CH.settings, CH.engineReply]) {
      expect(isAllowed(ch, 'palette'), ch).toBe(false);
    }
  });

  it('the engine gets only its own plumbing and the broadcast path', () => {
    const allowed = Object.keys(IPC_POLICY).filter((ch) => isAllowed(ch, 'engine'));
    expect(allowed.sort()).toEqual([CH.send, CH.engineReady, CH.engineReply, CH.settings].sort());
    for (const ch of [CH.setLogin, CH.getLogin, CH.openExternal, CH.ownWrite, CH.bridgeInfo, CH.bridgeRegenerate, CH.paletteChoose]) {
      expect(isAllowed(ch, 'engine'), ch).toBe(false);
    }
  });

  it('only the panel may reach privileged things: login item, external links, token, clipboard marks and secret writes', () => {
    for (const ch of [CH.setLogin, CH.getLogin, CH.openExternal, CH.bridgeInfo, CH.bridgeRegenerate, CH.ownWrite, CH.writeSecret, CH.hotkeyStatus]) {
      expect(IPC_POLICY[ch as keyof typeof IPC_POLICY], ch).toEqual(['panel']);
    }
  });

  it('the panel cannot impersonate the engine', () => {
    for (const ch of [CH.engineReady, CH.engineReply, CH.settings, CH.paletteChoose, CH.regionDone]) expect(isAllowed(ch, 'panel'), ch).toBe(false);
  });

  it('an unknown channel or an unknown sender is always refused', () => {
    expect(isAllowed('shell:exec', 'panel')).toBe(false);
    expect(isAllowed(CH.send, undefined)).toBe(false);
  });
});

describe('which engine messages each role may send', () => {
  it('the panel may send any message type', () => {
    for (const t of ['search', 'save-text', 'save-image', 'copy-item', 'badge-reset', 'items-changed', 'capture-region']) expect(mayRoute('panel', t), t).toBe(true);
  });
  it('the palette may only search and copy an item (it cannot save, import or delete anything)', () => {
    expect(mayRoute('palette', 'search')).toBe(true);
    expect(mayRoute('palette', 'copy-item')).toBe(true);
    for (const t of ['save-text', 'save-image', 'capture-region', 'badge-reset', 'desktop:set-settings', 'desktop:stats', undefined]) expect(mayRoute('palette', t as string), String(t)).toBe(false);
  });
  it('the engine may only broadcast items-changed', () => {
    expect(mayRoute('engine', 'items-changed')).toBe(true);
    for (const t of ['search', 'save-text', 'desktop:set-settings', undefined]) expect(mayRoute('engine', t as string), String(t)).toBe(false);
  });
  it('blip and region cannot route anything; neither can an unknown sender', () => {
    for (const r of ['blip', 'region', undefined] as const) for (const t of ['search', 'items-changed', 'save-text']) expect(mayRoute(r, t), `${r} ${t}`).toBe(false);
  });
});
