import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StashItemLite } from '@/lib/messaging';

const send = vi.fn();
vi.mock('@/lib/messaging', async (orig) => ({ ...(await orig<typeof import('@/lib/messaging')>()), send: (m: unknown) => send(m) }));

import { Palette } from './Palette';
import { webPaletteHost, type PaletteHost } from './paletteHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string, text: string, tags: string[] = ['sql'], lang?: string): StashItemLite => ({
  id, kind: 'text', text, tags, lang, pinned: false, secret: false, hash: id, createdAt: Date.now(), updatedAt: Date.now(), via: 'copy',
});

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  Element.prototype.scrollIntoView = () => undefined;
  send.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function fakeHost(over: Partial<PaletteHost> = {}) {
  const h: PaletteHost = {
    search: vi.fn(async () => [item('1', 'SELECT 1;'), item('2', 'docker ps', ['command'], 'bash')]),
    activate: vi.fn(async () => undefined),
    close: vi.fn(),
    ...over,
  };
  return h;
}

async function mount(h: PaletteHost, layout: 'overlay' | 'window' = 'window') {
  await act(async () => root.render(<Palette returnFocus={null} host={h} layout={layout} />));
  await flush();
  return host.querySelector<HTMLElement>('[role=dialog]')!.parentElement!;
}

const key = (el: Element, init: KeyboardEventInit) =>
  act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });

describe('Palette host seam (the same component serves the extension overlay and the desktop window)', () => {
  it('searches through the host and renders its results', async () => {
    const h = fakeHost();
    await mount(h);
    expect(h.search).toHaveBeenCalledWith({ query: '', limit: 30 });
    expect(host.textContent).toContain('SELECT 1;');
    expect(host.textContent).toContain('docker ps');
  });

  it('Enter pastes, Shift+Enter copies only, Escape closes', async () => {
    const h = fakeHost();
    const root = await mount(h);
    await key(root, { key: 'Enter' });
    expect(h.activate).toHaveBeenLastCalledWith(expect.objectContaining({ id: '1' }), 'paste');
    await key(root, { key: 'ArrowDown' });
    await key(root, { key: 'Enter', shiftKey: true });
    expect(h.activate).toHaveBeenLastCalledWith(expect.objectContaining({ id: '2' }), 'copy');
    await key(root, { key: 'Escape' });
    expect(h.close).toHaveBeenCalled();
  });

  it('Ctrl/Cmd+Enter pastes as a code block only when the host supports it', async () => {
    const withCode = fakeHost({ codeBlock: true });
    const r1 = await mount(withCode);
    await key(r1, { key: 'Enter', ctrlKey: true });
    expect(withCode.activate).toHaveBeenLastCalledWith(expect.objectContaining({ id: '1' }), 'code');
    expect(host.textContent).toContain('code block');
    await key(r1, { key: 'Enter', metaKey: true });
    expect(withCode.activate).toHaveBeenLastCalledWith(expect.objectContaining({ id: '1' }), 'code');

    act(() => root.unmount());
    root = createRoot(host);
    const without = fakeHost();
    const r2 = await mount(without);
    await key(r2, { key: 'Enter', ctrlKey: true });
    expect(without.activate).toHaveBeenLastCalledWith(expect.objectContaining({ id: '1' }), 'paste'); // extension behaviour unchanged
    expect(host.textContent).not.toContain('code block');
  });

  it('masks secrets in the list (host text is never shown) but still activates them', async () => {
    const secret = { ...item('s', 'AKIAIOSFODNN7EXAMPLE', ['secret']), secret: true, text: undefined };
    const h = fakeHost({ search: vi.fn(async () => [secret]) });
    const r = await mount(h);
    expect(host.textContent).toContain('secret hidden');
    expect(host.textContent).not.toContain('AKIA');
    await key(r, { key: 'Enter' });
    expect(h.activate).toHaveBeenCalledWith(expect.objectContaining({ id: 's', secret: true }), 'paste');
  });

  it('a resting cursor (mousemove with no movement) does not move the selection, a real move does', async () => {
    const h = fakeHost();
    const r = await mount(h);
    const rows = host.querySelectorAll('[role=option]');
    await act(async () => { rows[1]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 0, movementY: 0 })); });
    await key(r, { key: 'Enter' });
    expect(h.activate).toHaveBeenLastCalledWith(expect.objectContaining({ id: '1' }), 'paste');
    await act(async () => { rows[1]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 4, movementY: 0 })); });
    await key(r, { key: 'Enter' });
    expect(h.activate).toHaveBeenLastCalledWith(expect.objectContaining({ id: '2' }), 'paste');
  });

  it('window layout has no page backdrop; overlay layout keeps it', async () => {
    await mount(fakeHost(), 'window');
    expect(host.querySelector('.backdrop-blur-\\[2px\\]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    await mount(fakeHost(), 'overlay');
    expect(host.querySelector('.backdrop-blur-\\[2px\\]')).not.toBeNull();
  });

  it('applies the type filter on the host search (images ask for kind image)', async () => {
    const h = fakeHost();
    const r = await mount(h);
    (h.search as ReturnType<typeof vi.fn>).mockClear();
    await key(r, { key: '4', ctrlKey: true }); // Ctrl+4 = Images
    await flush();
    expect(h.search).toHaveBeenCalledWith({ query: '', limit: 150, kind: 'image' });
  });
});

describe('webPaletteHost (the extension default)', () => {
  it('search goes through the background worker and tolerates a bad reply', async () => {
    send.mockResolvedValueOnce([item('1', 'x1')]).mockResolvedValueOnce(undefined);
    const h = webPaletteHost(null);
    expect(await h.search({ query: 'q', limit: 5, kind: 'image' })).toHaveLength(1);
    expect(send).toHaveBeenCalledWith({ type: 'search', query: 'q', limit: 5, kind: 'image' });
    expect(await h.search({ query: '', limit: 5 })).toEqual([]);
  });

  it('has no code-block mode, so the extension palette is unchanged', () => {
    expect(webPaletteHost(null).codeBlock).toBeUndefined();
  });

  it('Palette without a host prop still works exactly like the content script renders it', async () => {
    send.mockResolvedValue([item('1', 'echo hi', ['command'])]);
    await act(async () => root.render(<Palette returnFocus={null} />));
    await flush();
    expect(send).toHaveBeenCalledWith({ type: 'search', query: '', limit: 30 });
    expect(host.textContent).toContain('echo hi');
  });
});
