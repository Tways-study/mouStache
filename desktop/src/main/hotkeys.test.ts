import { describe, expect, it, vi } from 'vitest';
import { createHotkeys, type GlobalShortcutLike } from './hotkeys';
import { createShortcutStub } from './shortcut-stub';

const handlers = () => ({ palette: vi.fn(), screenshot: vi.fn() });

describe('hotkeys', () => {
  it('registers both defaults and runs the right handler', () => {
    const s = createShortcutStub();
    const h = handlers();
    const hk = createHotkeys(s.stub, h);
    const st = hk.apply({ palette: 'Alt+Shift+V', screenshot: 'Alt+Shift+S' });
    expect(st.palette).toMatchObject({ ok: true, active: 'Alt+Shift+V' });
    expect(st.screenshot).toMatchObject({ ok: true, active: 'Alt+Shift+S' });
    expect(s.registered()).toEqual(['Alt+Shift+S', 'Alt+Shift+V']);
    s.press('Alt+Shift+V');
    expect(h.palette).toHaveBeenCalledOnce();
    expect(h.screenshot).not.toHaveBeenCalled();
  });

  it('re-registers on change and releases the old key', () => {
    const s = createShortcutStub();
    const hk = createHotkeys(s.stub, handlers());
    hk.apply({ palette: 'Alt+Shift+V', screenshot: 'Alt+Shift+S' });
    const st = hk.apply({ palette: 'Control+Alt+P', screenshot: 'Alt+Shift+S' });
    expect(st.palette).toMatchObject({ ok: true, active: 'Control+Alt+P' });
    expect(s.registered()).toEqual(['Alt+Shift+S', 'Control+Alt+P']);
  });

  it('normalises what the user typed', () => {
    const s = createShortcutStub();
    const st = createHotkeys(s.stub, handlers()).apply({ palette: 'shift+alt+v', screenshot: 'ctrl+alt+s' });
    expect(st.palette.active).toBe('Alt+Shift+V');
    expect(st.screenshot.active).toBe('Control+Alt+S');
  });

  it('reports a clear error for an invalid accelerator and keeps the previous working one', () => {
    const s = createShortcutStub();
    const hk = createHotkeys(s.stub, handlers());
    hk.apply({ palette: 'Alt+Shift+V', screenshot: 'Alt+Shift+S' });
    const st = hk.apply({ palette: 'V', screenshot: 'Alt+Shift+S' });
    expect(st.palette.ok).toBe(false);
    expect(st.palette.error).toMatch(/Include Ctrl, Alt/);
    expect(st.palette.active).toBe('Alt+Shift+V'); // still works
    expect(s.registered()).toContain('Alt+Shift+V');
    expect(st.screenshot.ok).toBe(true);
  });

  it('reports a conflict when the OS refuses the shortcut, and falls back', () => {
    const s = createShortcutStub();
    const hk = createHotkeys(s.stub, handlers());
    hk.apply({ palette: 'Alt+Shift+V', screenshot: 'Alt+Shift+S' });
    s.refuse('Control+Alt+P');
    const st = hk.apply({ palette: 'Control+Alt+P', screenshot: 'Alt+Shift+S' });
    expect(st.palette).toMatchObject({ ok: false, active: 'Alt+Shift+V', requested: 'Control+Alt+P' });
    expect(st.palette.error).toMatch(/could not be registered/);
    expect(s.registered()).toContain('Alt+Shift+V');
  });

  it('a throwing globalShortcut is treated as a failed registration, not a crash', () => {
    const gs: GlobalShortcutLike = {
      register: () => {
        throw new Error('boom');
      },
      unregister: () => undefined,
    };
    const st = createHotkeys(gs, handlers()).apply({ palette: 'Alt+Shift+V', screenshot: 'Alt+Shift+S' });
    expect(st.palette.ok).toBe(false);
    expect(st.screenshot.ok).toBe(false);
  });

  it('refuses the same key for both shortcuts', () => {
    const s = createShortcutStub();
    const st = createHotkeys(s.stub, handlers()).apply({ palette: 'Alt+Shift+V', screenshot: 'shift+alt+v' });
    expect(st.palette.ok).toBe(true);
    expect(st.screenshot.ok).toBe(false);
    expect(st.screenshot.error).toMatch(/already used by the quick palette/);
  });

  it('lets the two shortcuts swap keys', () => {
    const s = createShortcutStub();
    const hk = createHotkeys(s.stub, handlers());
    hk.apply({ palette: 'Alt+Shift+V', screenshot: 'Alt+Shift+S' });
    const st = hk.apply({ palette: 'Alt+Shift+S', screenshot: 'Alt+Shift+V' });
    expect(st.palette).toMatchObject({ ok: true, active: 'Alt+Shift+S' });
    expect(st.screenshot).toMatchObject({ ok: true, active: 'Alt+Shift+V' });
  });

  it('does nothing when applied again with the same config, and unregisters everything on quit', () => {
    const s = createShortcutStub();
    const reg = vi.spyOn(s.stub, 'register');
    const hk = createHotkeys(s.stub, handlers());
    hk.apply({ palette: 'Alt+Shift+V', screenshot: 'Alt+Shift+S' });
    hk.apply({ palette: 'Alt+Shift+V', screenshot: 'Alt+Shift+S' });
    expect(reg).toHaveBeenCalledTimes(2);
    hk.unregisterAll();
    expect(s.registered()).toEqual([]);
  });
});
