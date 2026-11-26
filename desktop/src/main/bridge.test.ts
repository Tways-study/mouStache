import { describe, expect, it, vi } from 'vitest';
import type { SaveResult } from '@/lib/messaging';
import { saveBridgeCapture } from './bridge';
import { parsePresence } from './presence-settings';

const deps = (res: SaveResult | undefined, presence: Record<string, unknown> = {}) => {
  const request = vi.fn(async (_m: unknown) => res);
  return { request, d: { engine: { request }, presence: { get: () => parsePresence(presence) } } };
};

describe('saveBridgeCapture (what happens to a capture the bridge accepted)', () => {
  it('sends text to the engine as save-text with the page source and via', async () => {
    const { request, d } = deps({ ok: true, id: 'i1', deduped: false });
    const r = await saveBridgeCapture({ kind: 'text', text: 'SELECT name FROM students WHERE gpa > 3.5;', via: 'copy', source: { url: 'https://example.com/p', title: 'P' } }, d);
    expect(request).toHaveBeenCalledWith({
      type: 'save-text',
      text: 'SELECT name FROM students WHERE gpa > 3.5;',
      source: { url: 'https://example.com/p', title: 'P' },
      via: 'copy',
    });
    expect(r.body).toEqual({ ok: true, id: 'i1', deduped: false });
    expect(r.outcome).toEqual({ status: 'saved', label: 'SQL', deduped: false, kind: 'text', id: 'i1' });
  });

  it('sends images as save-image and labels them Image', async () => {
    const { request, d } = deps({ ok: true, id: 'i2' });
    const r = await saveBridgeCapture({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', via: 'screenshot' }, d);
    expect(request.mock.calls[0]![0]).toMatchObject({ type: 'save-image', via: 'screenshot', dataUrl: 'data:image/png;base64,AAAA' });
    expect(r.outcome).toMatchObject({ status: 'saved', label: 'Image', kind: 'image' });
  });

  it('reports a dedupe so the app can stay silent', async () => {
    const { d } = deps({ ok: true, id: 'i1', deduped: true });
    const r = await saveBridgeCapture({ kind: 'text', text: 'docker ps', via: 'copy' }, d);
    expect(r.body).toEqual({ ok: true, id: 'i1', deduped: true });
    expect(r.outcome).toMatchObject({ status: 'saved', deduped: true });
  });

  it('NEVER saves a secret over the bridge, whatever "via" says, and never even asks the engine', async () => {
    for (const via of ['copy', 'context-menu', 'paste', 'screenshot'] as const) {
      const { request, d } = deps({ ok: true, id: 'x' });
      const r = await saveBridgeCapture({ kind: 'text', text: 'AKIAIOSFODNN7EXAMPLE', via }, d);
      expect(r.body).toEqual({ ok: true, skipped: 'secret' });
      expect(r.outcome).toEqual({ status: 'skipped', reason: 'secret' });
      expect(request).not.toHaveBeenCalled();
    }
  });

  it('a secret is saved only if the user turned "skip secrets" off (and it stays flagged by the engine)', async () => {
    const { request, d } = deps({ ok: true, id: 'x' }, { skipSecrets: false });
    await saveBridgeCapture({ kind: 'text', text: 'AKIAIOSFODNN7EXAMPLE', via: 'context-menu' }, d);
    expect(request).toHaveBeenCalledOnce();
  });

  it('pause capture pauses the bridge too', async () => {
    const { request, d } = deps({ ok: true, id: 'x' }, { autoCapture: false });
    const r = await saveBridgeCapture({ kind: 'text', text: 'hello world', via: 'copy' }, d);
    expect(r.body).toEqual({ ok: true, skipped: 'paused' });
    expect(r.outcome).toEqual({ status: 'skipped', reason: 'paused' });
    expect(request).not.toHaveBeenCalled();
  });

  it('passes engine skips through (paused host, empty) and fails generically when the engine fails', async () => {
    const paused = deps({ ok: true, skipped: 'paused' });
    expect((await saveBridgeCapture({ kind: 'text', text: 'x1', via: 'copy' }, paused.d)).body).toEqual({ ok: true, skipped: 'paused' });
    await expect(saveBridgeCapture({ kind: 'text', text: 'x1', via: 'copy' }, deps({ ok: false, error: 'db exploded' }).d)).rejects.toThrow('save failed');
    await expect(saveBridgeCapture({ kind: 'text', text: 'x1', via: 'copy' }, deps(undefined).d)).rejects.toThrow('save failed');
  });
});

describe('bridge port setting', () => {
  it('defaults to 47821 and only accepts real, non-privileged ports', () => {
    expect(parsePresence({}).bridgePort).toBe(47821);
    expect(parsePresence({ bridgePort: 50000 }).bridgePort).toBe(50000);
    for (const bad of [80, 0, 70000, '47821', 1.5, null, -1]) expect(parsePresence({ bridgePort: bad }).bridgePort, String(bad)).toBe(47821);
  });
});
